#!/usr/bin/env node
"use strict";

/*
 * Validates the forge record set under docs/records/.
 *
 * THIS IS A PRE-PUSH GATE, NOT ADVISORY, and the reason is worth stating where
 * anyone tempted to soften it will read it. Checks 1 through 6 catch the class
 * of defect that makes the record set untrustworthy: a dangling edge, a
 * duplicate ID, a fork in supersession. A record set that cannot be trusted is
 * worse than the single 1 MB append-only file it replaced, because that file at
 * least contained the answer somewhere. Forge already treats the pre-push hook
 * as the only automated gate before the default branch and never uses
 * --no-verify, so this belongs there beside build, tests, lint, and the secret
 * scan.
 *
 * --warn-only exists for the mid-slice case and for the first run of a
 * migration. It is not what the pre-push hook invokes.
 *
 * Usage:
 *   node .forge/forge-records-lint.js [--fix] [--warn-only] [--if-present] [--records <dir>]
 *
 * --if-present exits 0 when there is no record set at all. The pre-push hook
 * passes it so that a project whose `records` capability is skipped, or not yet
 * backfilled, has an inert gate rather than a failing one.
 *
 * Exit 0  clean, or warnings only
 * Exit 1  one or more hard failures, each named with its file and field
 * Exit 2  the record set could not be read at all
 */

const fs = require("fs");
const path = require("path");
const lib = require("./forge-records-lib.js");

function parseArgs(argv) {
  const opts = { fix: false, warnOnly: false, ifPresent: false, records: "docs/records" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--fix") opts.fix = true;
    else if (arg === "--warn-only") opts.warnOnly = true;
    else if (arg === "--if-present") opts.ifPresent = true;
    else if (arg === "--records") {
      opts.records = argv[i + 1];
      i += 1;
    } else {
      process.stdout.write("forge-records-lint: unknown argument " + arg + "\n");
      process.exit(2);
    }
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const recordsDir = path.resolve(process.cwd(), opts.records);

if (!fs.existsSync(recordsDir)) {
  if (opts.ifPresent) {
    process.stdout.write("forge-records-lint: no record set at " + opts.records + ", nothing to check\n");
    process.exit(0);
  }
  process.stdout.write("forge-records-lint: no record set at " + opts.records + "\n");
  process.exit(2);
}

const { records, errors: parseErrors } = lib.readRecords(recordsDir);
const vocabulary = lib.loadVocabulary(recordsDir);

const problems = [];

for (const err of parseErrors) {
  problems.push({
    file: err.file,
    field: "front matter",
    severity: "error",
    message: err.message + (err.line ? " (line " + err.line + ")" : ""),
  });
}

// Check 1: filename matches the id inside.
for (const rec of records) {
  if (rec.data.id && rec.basename !== rec.data.id) {
    problems.push({
      file: rec.file,
      field: "id",
      severity: "error",
      message: "filename says `" + rec.basename + "` and the front matter says `" + rec.data.id + "`",
    });
  }
  // The directory a record sits in must agree with its declared type, or a
  // reader who walks one directory gets a different answer from one who reads
  // the field.
  if (rec.data.type && rec.data.type !== rec.dirType) {
    problems.push({
      file: rec.file,
      field: "type",
      severity: "error",
      message: "type `" + rec.data.type + "` but the record sits in the " + rec.dirType + " directory",
    });
  }
}

// Check 2: ids are unique across the whole set.
const byId = new Map();
for (const rec of records) {
  const id = rec.data.id;
  if (!id) continue;
  if (byId.has(id)) {
    problems.push({
      file: rec.file,
      field: "id",
      severity: "error",
      message: "duplicate id, also used by " + byId.get(id).file,
    });
    continue;
  }
  byId.set(id, rec);
}

// Checks 3, 4, and 7: per-record shape, closed field set, declared vocabulary.
for (const rec of records) {
  problems.push(...lib.validateRecord(rec, vocabulary));
}

// Check 5: every edge resolves to a record that exists.
const EDGE_FIELDS = ["closes", "satisfies", "supersedes", "decided_in"];
for (const rec of records) {
  for (const field of EDGE_FIELDS) {
    const value = rec.data[field];
    if (value === undefined || value === null || value === "") continue;
    const targets = Array.isArray(value) ? value : [value];
    for (const target of targets) {
      if (!byId.has(target)) {
        problems.push({
          file: rec.file,
          field,
          severity: "error",
          message: "`" + target + "` does not resolve to any record",
        });
      }
    }
  }
}

// Check 6a: no two live records superseding the same target. That is a fork,
// and it means two records both claim to be the current answer.
const supersedersOf = new Map();
for (const rec of records) {
  const target = rec.data.supersedes;
  if (!target) continue;
  if (!supersedersOf.has(target)) supersedersOf.set(target, []);
  supersedersOf.get(target).push(rec);
}
for (const [target, claimants] of supersedersOf) {
  const live = claimants.filter((r) => lib.isLive(r));
  if (live.length > 1) {
    problems.push({
      file: live[0].file,
      field: "supersedes",
      severity: "error",
      message:
        "`" + target + "` is superseded by more than one live record: " +
        live.map((r) => r.data.id).join(", "),
    });
  }
}

// Check 6b: no cycle. A -> B -> C terminates; A -> B -> A does not.
for (const rec of records) {
  const seen = new Set();
  let cursor = rec;
  while (cursor && cursor.data.supersedes) {
    if (seen.has(cursor.data.id)) {
      problems.push({
        file: rec.file,
        field: "supersedes",
        severity: "error",
        message: "supersession cycle through " + Array.from(seen).join(" -> "),
      });
      break;
    }
    seen.add(cursor.data.id);
    cursor = byId.get(cursor.data.supersedes);
  }
}

// Check 8: an orphan decision. A warning, because a decision that genuinely
// relates to no task is a legitimate record, and roughly 7 percent of a real
// project's decision entries are exactly that.
for (const rec of records) {
  if (rec.data.type !== "decision") continue;
  const hasEdge =
    (rec.data.closes && rec.data.closes.length) ||
    (rec.data.satisfies && rec.data.satisfies.length) ||
    rec.data.decided_in;
  if (!hasEdge) {
    problems.push({
      file: rec.file,
      field: "closes",
      severity: "warning",
      message: "orphan decision: names no task and no requirement",
    });
  }
}

/*
 * --fix writes the reverse supersession edge and nothing else. It never invents
 * an edge, never deletes a record, and never touches a body: the forward edge
 * is a human judgement and the reverse edge is its mechanical consequence.
 */
let fixed = 0;
if (opts.fix) {
  for (const rec of records) {
    const target = rec.data.supersedes;
    if (!target) continue;
    const victim = byId.get(target);
    if (!victim) continue;
    const already = victim.data.superseded_by;
    if (already === rec.data.id) continue;
    if (already) continue; // a fork, already reported above; do not overwrite

    let text = fs.readFileSync(victim.file, "utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    if (/^superseded_by:.*$/m.test(text)) {
      text = text.replace(/^superseded_by:.*$/m, "superseded_by: " + rec.data.id);
    } else {
      // Insert immediately before the closing fence of the front matter.
      const lines = text.split(/\r?\n/);
      let end = -1;
      for (let i = 1; i < lines.length; i += 1) {
        if (lines[i] === "---") {
          end = i;
          break;
        }
      }
      if (end === -1) continue;
      lines.splice(end, 0, "superseded_by: " + rec.data.id);
      text = lines.join(eol);
    }
    const superseded = lib.STATUS_BY_TYPE[victim.data.type].includes("superseded");
    if (superseded) {
      text = text.replace(/^status:.*$/m, "status: superseded");
    }
    fs.writeFileSync(victim.file, text);
    fixed += 1;
  }
}

const errorsFound = problems.filter((p) => p.severity === "error");
const warningsFound = problems.filter((p) => p.severity === "warning");

const out = [];
out.push("forge-records-lint: " + records.length + " records, " + vocabulary.size + " declared prefixes");
if (opts.fix) {
  out.push("--fix wrote " + fixed + " reverse supersession edge(s)");
}
out.push("");

function render(list, label) {
  if (!list.length) return;
  out.push(label + " (" + list.length + ")");
  for (const p of list) {
    out.push("  " + path.relative(process.cwd(), p.file) + "  [" + p.field + "]  " + p.message);
  }
  out.push("");
}

render(errorsFound, "ERRORS");
render(warningsFound, "WARNINGS");

if (!errorsFound.length && !warningsFound.length) {
  out.push("clean");
}

process.stdout.write(out.join("\n") + "\n");

if (errorsFound.length && !opts.warnOnly) {
  process.exit(1);
}
process.exit(0);
