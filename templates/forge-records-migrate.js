#!/usr/bin/env node
"use strict";

/*
 * One-time migration of a monolithic forge record set into docs/records/.
 *
 * THE RULE THIS PROGRAM OBEYS ABOVE ALL OTHERS: it never guesses an edge. On
 * the project this was measured against, 91 percent of decision entries already
 * name a task ID and 69 percent name a requirement ID, so inference is
 * mechanical for better than nine entries in ten. The remaining tenth is left
 * unconnected and reported, because a wrong edge is worse than a missing one:
 * the linter reports a missing edge as an orphan warning, and reports a wrong
 * edge as nothing at all.
 *
 * IT DESTROYS NOTHING. The originals are moved, not deleted, to
 * docs/archive/pre-records/, and they remain in git history regardless. A
 * --dry-run prints the plan and writes nothing.
 *
 * THIS IS ITS OWN SLICE. It rewrites every artifact the lifecycle reads.
 * Running it across an open branch collides with whatever that branch is
 * editing, and the collision surfaces as a record-versus-reality discrepancy at
 * the worst possible moment. The program refuses to run against a dirty working
 * tree for that reason.
 *
 * Usage:
 *   node .forge/forge-records-migrate.js [--dry-run] [--force-dirty]
 *
 * Exit 0  migration complete, or the dry run printed its plan
 * Exit 1  refused: dirty working tree, or docs/records/ already exists
 * Exit 2  a source file could not be read
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const CWD = process.cwd();
const RECORDS = path.join(CWD, "docs", "records");
const ARCHIVE = path.join(CWD, "docs", "archive", "pre-records");

const opts = { dryRun: false, forceDirty: false };
for (const arg of process.argv.slice(2)) {
  if (arg === "--dry-run") opts.dryRun = true;
  else if (arg === "--force-dirty") opts.forceDirty = true;
  else {
    process.stdout.write("forge-records-migrate: unknown argument " + arg + "\n");
    process.exit(2);
  }
}

const report = [];
function say(line) {
  report.push(line);
}

// ---------------------------------------------------------------- preflight

if (fs.existsSync(RECORDS)) {
  process.stdout.write(
    "forge-records-migrate: docs/records/ already exists. This migration runs once.\n" +
      "If you meant to re-run it, move the existing directory aside first.\n"
  );
  process.exit(1);
}

if (!opts.forceDirty) {
  const status = spawnSync("git", ["status", "--porcelain"], { cwd: CWD, encoding: "utf8" });
  if (status.status === 0 && status.stdout.trim() !== "") {
    process.stdout.write(
      "forge-records-migrate: the working tree is dirty and this migration rewrites\n" +
        "every artifact the lifecycle reads. Commit or stash first.\n" +
        "\n" +
        status.stdout +
        "\n(--force-dirty overrides, and you will merge this by hand.)\n"
    );
    process.exit(1);
  }
}

// ------------------------------------------------------------------ helpers

function read(rel) {
  const file = path.join(CWD, rel);
  try {
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    return null;
  }
}

const ID_IN_PROSE = /\b([A-Z]{1,5}(?:-[A-Z]{2,5})?-[0-9]{1,5}[a-z]?)\b/g;

// Prefixes that match the ID shape but are prose. SHA-256 is the one that
// actually occurs; the rest are here because they cost nothing and a false edge
// is expensive. An undeclared prefix is only a lint warning, so anything missed
// here surfaces rather than corrupting the graph.
const NOT_IDS = new Set(["SHA", "RFC", "ISO", "UTF", "AES", "RSA", "HTTP", "IPV", "CVE", "ECMA"]);

function idsIn(text) {
  const found = new Set();
  let m;
  ID_IN_PROSE.lastIndex = 0;
  while ((m = ID_IN_PROSE.exec(text)) !== null) {
    const id = m[1];
    const prefix = id.replace(/-[0-9]{1,5}[a-z]?$/, "");
    if (NOT_IDS.has(prefix)) continue;
    found.add(id);
  }
  return Array.from(found).sort();
}

function taskIds(ids) {
  return ids.filter((id) => /^T-[0-9]+[a-z]?$/.test(id));
}

function requirementIds(ids) {
  return ids.filter((id) => !/^T-[0-9]+[a-z]?$/.test(id) && !/^UXD-[0-9]+[a-z]?$/.test(id) && !/^D-[0-9]+$/.test(id));
}

function escapeTitle(text) {
  return text.replace(/\s+/g, " ").replace(/^[#\s*>-]+/, "").trim().slice(0, 160);
}

function frontMatter(fields) {
  const out = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      out.push(key + ": [" + value.join(", ") + "]");
    } else if (value === null || value === undefined) {
      out.push(key + ": null");
    } else {
      out.push(key + ": " + value);
    }
  }
  out.push("---");
  return out.join("\n");
}

const planned = [];
function emit(dir, id, fields, body) {
  planned.push({
    file: path.join(RECORDS, dir, id + ".md"),
    text: frontMatter(fields) + "\n\n" + (body || "").trim() + "\n",
  });
}

// ------------------------------------------------------- 1. decision records

const decisionsText = read("docs/DECISIONS.md");
let decisionCount = 0;
const orphans = [];

if (decisionsText === null) {
  say("docs/DECISIONS.md: not present, skipped");
} else {
  // Split on headings. An entry is a heading block that carries a date, which
  // is how the existing files are actually written.
  const blocks = decisionsText.split(/\n(?=#{2,4}\s)/);
  let seq = 0;
  for (const block of blocks) {
    const headingLine = block.split(/\r?\n/)[0] || "";
    const dateMatch = /\b(20[0-9]{2}-[0-9]{2}-[0-9]{2})\b/.exec(block.slice(0, 400));
    if (!/^#{2,4}\s/.test(headingLine) || !dateMatch) continue;

    seq += 1;
    const id = "D-" + String(seq).padStart(4, "0");
    const ids = idsIn(block);
    const tasks = taskIds(ids);
    const reqs = requirementIds(ids);

    // decided_in, never closes. Whether an entry closed a task or merely
    // happened under it is not inferable from prose, and inventing `closes`
    // would create edges the traceability view then reports as evidence.
    emit("decisions", id, {
      id,
      type: "decision",
      status: "live",
      date: dateMatch[1],
      title: escapeTitle(headingLine),
      closes: [],
      satisfies: reqs,
      supersedes: null,
      superseded_by: null,
      decided_in: tasks.length ? tasks[0] : null,
    }, block);

    decisionCount += 1;
    if (!tasks.length && !reqs.length) {
      orphans.push({ id, title: escapeTitle(headingLine) });
    }
  }
  say("docs/DECISIONS.md: " + decisionCount + " decision record(s), " + orphans.length + " orphan(s)");
}

// ---------------------------------------------- 2. task and UX debt records

const todoText = read("TODO.md");
let taskCount = 0;
let uxdCount = 0;

if (todoText === null) {
  say("TODO.md: not present, skipped");
} else {
  const today = new Date().toISOString().slice(0, 10);
  const seenTask = new Set();
  const seenUxd = new Set();

  for (const block of todoText.split(/\n(?=[-*]\s|#{2,4}\s)/)) {
    const head = block.split(/\r?\n/)[0] || "";

    const uxd = /\b(UXD-[0-9]+[a-z]?)\b/.exec(head);
    if (uxd && !seenUxd.has(uxd[1])) {
      seenUxd.add(uxd[1]);
      const lower = block.toLowerCase();
      let status = "open";
      if (/\bclosed\b|\bfixed\b|\[x\]/.test(lower)) status = "fixed";
      else if (/\bslipped\b|\bdeferred\b/.test(lower)) status = "slipped";
      let severity = "degrades";
      if (/\bblocks\b/.test(lower)) severity = "blocks";
      else if (/\bfinish\b|\bpolish\b/.test(lower)) severity = "finish";
      emit("uxd", uxd[1], {
        id: uxd[1],
        type: "uxd",
        status,
        date: today,
        title: escapeTitle(head),
        severity,
        closes: [],
        satisfies: requirementIds(idsIn(block)),
        supersedes: null,
        superseded_by: null,
        decided_in: null,
      }, block);
      uxdCount += 1;
      continue;
    }

    const task = /\b(T-[0-9]+[a-z]?)\b/.exec(head);
    if (task && !seenTask.has(task[1])) {
      seenTask.add(task[1]);
      const lower = block.toLowerCase();
      let status = "open";
      if (/\bclosed\b|\bdone\b|\bshipped\b|\[x\]/.test(lower)) status = "closed";
      else if (/\babandoned\b|\bdropped\b|\bwon't do\b|\bwont do\b/.test(lower)) status = "abandoned";
      else if (/\bin progress\b|\bin-progress\b|\bstarted\b/.test(lower)) status = "in-progress";
      emit("tasks", task[1], {
        id: task[1],
        type: "task",
        status,
        date: today,
        title: escapeTitle(head),
        closes: [],
        satisfies: requirementIds(idsIn(block)),
        supersedes: null,
        superseded_by: null,
        decided_in: null,
      }, block);
      taskCount += 1;
    }
  }
  say("TODO.md: " + taskCount + " task record(s), " + uxdCount + " UX debt record(s)");
}

// ------------------------------------------------- 3. requirement records

const srsText = read("docs/SRS.md");
let reqCount = 0;
let changeLogBytes = 0;

if (srsText === null) {
  say("docs/SRS.md: not present, skipped");
} else {
  const today = new Date().toISOString().slice(0, 10);
  const seen = new Set();

  // The Change Log section becomes supersession history rather than records.
  // On the measured project it was 51,577 B of a 174 KB requirements document.
  const changeLog = /\n#{1,3}\s*[0-9]*\.?\s*Change Log\b[\s\S]*$/i.exec(srsText);
  const body = changeLog ? srsText.slice(0, changeLog.index) : srsText;
  if (changeLog) {
    changeLogBytes = changeLog[0].length;
    say("docs/SRS.md: Change Log is " + changeLogBytes + " B and becomes supersession history, not records");
  }

  for (const block of body.split(/\n(?=#{2,5}\s|[-*]\s)/)) {
    const head = block.split(/\r?\n/)[0] || "";
    const m = /\b([A-Z]{2,5}(?:-[A-Z]{2,5})?-[0-9]{1,5}[a-z]?)\b/.exec(head);
    if (!m) continue;
    const id = m[1];
    const prefix = id.replace(/-[0-9]{1,5}[a-z]?$/, "");
    if (NOT_IDS.has(prefix)) continue;
    if (/^T-/.test(id) || /^UXD-/.test(id) || /^D-/.test(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    emit("requirements", id, {
      id,
      type: "requirement",
      status: "approved",
      date: today,
      title: escapeTitle(head),
      closes: [],
      satisfies: [],
      supersedes: null,
      superseded_by: null,
      decided_in: null,
    }, block);
    reqCount += 1;
  }
  say("docs/SRS.md: " + reqCount + " requirement record(s)");
}

// --------------------------------- 4. traceability rows become satisfies

const traceText = read("docs/traceability.md");
const unparsedRows = [];
let edgesFromTrace = 0;

if (traceText === null) {
  say("docs/traceability.md: not present, skipped");
} else {
  const byId = new Map();
  for (const p of planned) {
    const idMatch = /^id:\s*(\S+)$/m.exec(p.text);
    if (idMatch) byId.set(idMatch[1], p);
  }

  // Column positions come from the header row, and the header is re-read every
  // time one appears rather than latched from the first. Two mistakes were made
  // here against a real 342 KB file and both were silent:
  //
  //   1. Counting back from the end put Status on the Notes column, which is
  //      always prose. It declared 321 of 321 rows unparseable, recovering one
  //      edge, and reported that as success.
  //   2. Latching the first header meant a second table further down (a manual
  //      verification log, with `Result` where the first has `Status`) was read
  //      with the wrong column names, and every one of its rows fell through
  //      without being counted either as parsed or as skipped.
  //
  // Anything genuinely not understood is counted, so the report cannot claim a
  // clean run over rows it never looked at.
  let statusCol = -1;
  let evidenceCol = -1;
  let skipped = 0;

  for (const line of traceText.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const heads = cells.map((c) => c.toLowerCase());

    // A header row for this table, or the divider under it.
    const at = heads.findIndex((h) => h === "status" || h === "result");
    if (at !== -1) {
      statusCol = at;
      evidenceCol = heads.findIndex((h) => /test|evidence|proof/.test(h));
      continue;
    }
    if (/^\|[\s|:-]+\|$/.test(line.trim())) continue;

    // An ID cell may name more than one requirement: `FR-MTL-003, FR-MTL-004`.
    const idCell = cells.find((c) => /^[A-Z]{2,5}(-[A-Z]{2,5})?-[0-9]{1,5}[a-z]?(\s*,\s*[A-Z]{2,5}(-[A-Z]{2,5})?-[0-9]{1,5}[a-z]?)*$/.test(c));
    if (!idCell) {
      skipped += 1;
      continue;
    }
    const reqs = idCell.split(",").map((c) => c.trim());

    const status = statusCol >= 0 ? cells[statusCol] || "" : "";
    // A Status cell holding narrative prose is exactly how the hand-maintained
    // table rotted. It cannot be parsed and it is not guessed at.
    if (statusCol >= 0 && status.split(/\s+/).filter(Boolean).length > 3) {
      unparsedRows.push(reqs.join(", "));
      continue;
    }
    // Task IDs come from the evidence column only. The Notes column narrates
    // many tasks that did not satisfy the requirement, and an edge inferred
    // from narration is a wrong edge, which nothing downstream reports.
    const source = evidenceCol >= 0 ? cells[evidenceCol] || "" : "";
    const tasks = taskIds(idsIn(source));
    if (!tasks.length) continue;
    for (const t of tasks) {
      const rec = byId.get(t);
      if (!rec) continue;
      for (const req of reqs) {
        rec.text = rec.text.replace(/^satisfies: \[(.*)\]$/m, (whole, inner) => {
          const list = inner.trim() === "" ? [] : inner.split(",").map((s) => s.trim()).filter(Boolean);
          if (!list.includes(req)) {
            list.push(req);
            edgesFromTrace += 1;
          }
          return "satisfies: [" + list.join(", ") + "]";
        });
      }
    }
  }
  if (skipped) {
    say("docs/traceability.md: " + skipped + " row(s) had no parseable requirement ID cell");
  }
  say(
    "docs/traceability.md: " + edgesFromTrace + " satisfies edge(s), " +
      unparsedRows.length + " row(s) with prose in the Status column left for a human"
  );
}

// ------------------------------------- 5. edges that resolve to nothing

/*
 * A monolith names IDs that no longer have anywhere to live: a task split into
 * T-007b and T-007c whose parent heading is the only one left in TODO.md, or a
 * prefix that was always prose. Run against a real project this produced 52
 * dangling edges, and leaving them in front matter would hand the user a
 * migrated record set that cannot pass its own pre-push gate on day one.
 *
 * They are not silently dropped either. The edge leaves the front matter, so the
 * graph is sound, and the ID is written into the record's body under a heading
 * that says what happened, so nothing is lost and a human can reconnect it. The
 * prose that mentioned it was already in the body regardless.
 */
const plannedIds = new Set();
for (const p of planned) {
  const m = /^id:\s*(\S+)$/m.exec(p.text);
  if (m) plannedIds.add(m[1]);
}

let droppedEdges = 0;
const droppedByRecord = [];

for (const p of planned) {
  const dropped = [];

  p.text = p.text.replace(/^(satisfies|closes): \[(.*)\]$/gm, (whole, field, inner) => {
    const list = inner.trim() === "" ? [] : inner.split(",").map((s) => s.trim()).filter(Boolean);
    const kept = list.filter((id) => {
      if (plannedIds.has(id)) return true;
      dropped.push(field + " " + id);
      return false;
    });
    return field + ": [" + kept.join(", ") + "]";
  });

  p.text = p.text.replace(/^(decided_in|supersedes): (\S+)$/gm, (whole, field, value) => {
    if (value === "null" || plannedIds.has(value)) return whole;
    dropped.push(field + " " + value);
    return field + ": null";
  });

  if (dropped.length) {
    droppedEdges += dropped.length;
    const id = (/^id:\s*(\S+)$/m.exec(p.text) || [])[1];
    droppedByRecord.push({ id, dropped });
    p.text +=
      "\n## Edges the migration could not resolve\n\n" +
      "These IDs appear in the prose above but no record carries them, so they were\n" +
      "not written as edges. Reconnect them by hand if they should be edges.\n\n" +
      dropped.map((d) => "- " + d).join("\n") + "\n";
  }
}

// ------------------------------------------------------------------ output

say("");
say("Total: " + planned.length + " record(s) to write");
if (droppedEdges) {
  say(
    droppedEdges + " edge(s) across " + droppedByRecord.length + " record(s) named an ID no " +
      "record carries. Each is recorded in its own record's body under a heading, not dropped silently."
  );
}

if (orphans.length) {
  say("");
  say("ORPHANS, for a human to connect or to leave connected to nothing.");
  say("A decision that genuinely relates to no task is a legitimate record,");
  say("which is why the linter reports these as warnings rather than failures.");
  for (const o of orphans) {
    say("  " + o.id + "  " + o.title);
  }
}

if (unparsedRows.length) {
  say("");
  say("TRACEABILITY ROWS NOT PARSED, Status column holds prose:");
  say("  " + unparsedRows.join(", "));
}

if (opts.dryRun) {
  say("");
  say("--dry-run: nothing written.");
  process.stdout.write(report.join("\n") + "\n");
  process.exit(0);
}

for (const dir of ["decisions", "tasks", "requirements", "uxd"]) {
  fs.mkdirSync(path.join(RECORDS, dir), { recursive: true });
}
for (const p of planned) {
  fs.writeFileSync(p.file, p.text);
}

// A first-run vocabulary, seeded from the prefixes that actually occur, so the
// linter's prefix check has something to check against on day one.
const prefixes = new Map();
for (const p of planned) {
  const idMatch = /^id:\s*(\S+)$/m.exec(p.text);
  const typeMatch = /^type:\s*(\S+)$/m.exec(p.text);
  if (!idMatch || !typeMatch) continue;
  prefixes.set(idMatch[1].replace(/-[0-9]{1,5}[a-z]?$/, ""), typeMatch[1]);
}
const vocab = [
  "# ID vocabulary",
  "",
  "Authoritative and hand-maintained. The linter warns on any ID whose prefix is",
  "not listed here. Seeded by the migration from the prefixes that actually",
  "occurred; add a meaning to each row and delete any that were prose.",
  "",
  "| Prefix | Record type | Meaning |",
  "|---|---|---|",
];
for (const prefix of Array.from(prefixes.keys()).sort()) {
  vocab.push("| " + prefix + " | " + prefixes.get(prefix) + " |  |");
}
fs.writeFileSync(path.join(RECORDS, "VOCABULARY.md"), vocab.join("\n") + "\n");

// Move the originals aside rather than deleting them.
fs.mkdirSync(ARCHIVE, { recursive: true });
const moved = [];
for (const rel of ["docs/DECISIONS.md", "TODO.md", "docs/traceability.md"]) {
  const from = path.join(CWD, rel);
  if (!fs.existsSync(from)) continue;
  const to = path.join(ARCHIVE, path.basename(rel));
  fs.renameSync(from, to);
  moved.push(rel);
}

say("");
say("Wrote " + planned.length + " records and docs/records/VOCABULARY.md");
say("Moved to docs/archive/pre-records/: " + (moved.length ? moved.join(", ") : "nothing"));
say("docs/SRS.md was NOT moved: it stays the approved requirements document.");
say("");
say("Next:");
say("  node .forge/forge-records-lint.js --warn-only");
say("  node .forge/forge-index.js build");
say("  node .forge/forge-views.js render");

process.stdout.write(report.join("\n") + "\n");
process.exit(0);
