#!/usr/bin/env node
"use strict";

/*
 * Builds .forge/index.json, the live-state index the skills read instead of
 * re-deriving where a project stands.
 *
 * THE TRAP THIS AVOIDS, stated so nobody walks into it while extending the
 * file. An index that enumerates every record recreates the problem one level
 * up, in a file nobody reviews: on the project this design was measured
 * against, all requirements plus tasks plus UX debt rows came to about 42 KB.
 * The index carries what is LIVE. History stays addressable by ID and is never
 * enumerated here. If you are about to add a list whose length grows with the
 * project's age rather than with its open work, add a count instead.
 *
 * The file is generated and gitignored. It is authoritative about nothing:
 * delete it and `build` reproduces it.
 *
 * Usage:
 *   node .forge/forge-index.js build [--out .forge/index.json] [--records docs/records]
 *   node .forge/forge-index.js check
 *
 * Exit 0  index written, or `check` found it current
 * Exit 1  `check` found it stale; stdout names the fields that differ
 * Exit 2  a record could not be parsed, or the record set is missing
 */

const fs = require("fs");
const path = require("path");
const lib = require("./forge-records-lib.js");

const STATE_FIELD = /^(Phase|Gate|Mode|Capabilities)\s*:\s*(.*)$/;

function parseArgs(argv) {
  const opts = { command: argv[0], out: ".forge/index.json", records: "docs/records", continueFile: "CONTINUE.md" };
  for (let i = 1; i < argv.length; i += 1) {
    if (argv[i] === "--out") {
      opts.out = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--records") {
      opts.records = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--continue") {
      opts.continueFile = argv[i + 1];
      i += 1;
    } else {
      process.stdout.write("forge-index: unknown argument " + argv[i] + "\n");
      process.exit(2);
    }
  }
  return opts;
}

/*
 * The ladder fields still live in CONTINUE.md, which stays the authoritative
 * pointer file. The index caches them so a consumer reads one small JSON file
 * rather than parsing markdown, but it does not own them.
 */
function readLadder(file) {
  const ladder = { phase: null, gate: null, mode: null, capabilities: {} };
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    return ladder;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = STATE_FIELD.exec(line.trim());
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim();
    if (key === "Phase") {
      const n = parseInt(value, 10);
      ladder.phase = Number.isNaN(n) ? value : n;
    } else if (key === "Gate") {
      ladder.gate = value;
    } else if (key === "Mode") {
      ladder.mode = value;
    } else if (key === "Capabilities") {
      // `design: backfilled, records: slice` or free prose. Only well-formed
      // pairs are lifted; prose is left to CONTINUE.md rather than mangled.
      for (const part of value.split(",")) {
        const pair = /^\s*([a-z][a-z-]*)\s*:\s*([a-z]+)\s*$/.exec(part);
        if (pair) ladder.capabilities[pair[1]] = pair[2];
      }
    }
  }
  return ladder;
}

function build(opts) {
  const recordsDir = path.resolve(process.cwd(), opts.records);
  if (!fs.existsSync(recordsDir)) {
    process.stdout.write("forge-index: no record set at " + opts.records + "\n");
    process.exit(2);
  }

  const { records, errors } = lib.readRecords(recordsDir);
  if (errors.length) {
    const out = ["forge-index: " + errors.length + " record(s) could not be parsed", ""];
    for (const e of errors) {
      out.push("  " + path.relative(process.cwd(), e.file) + (e.line ? ":" + e.line : "") + "  " + e.message);
    }
    process.stdout.write(out.join("\n") + "\n");
    process.exit(2);
  }

  const ladder = readLadder(path.resolve(process.cwd(), opts.continueFile));

  const openTasks = records.filter((r) => r.data.type === "task" && lib.isOpen(r));
  const openUxd = records.filter((r) => r.data.type === "uxd" && lib.isOpen(r));

  const counts = {};
  for (const type of lib.TYPES) {
    const ofType = records.filter((r) => r.data.type === type);
    counts[type] = ofType.length;
    counts[type + "_live"] = ofType.filter((r) => lib.isLive(r)).length;
    counts[type + "_open"] = ofType.filter((r) => lib.isOpen(r)).length;
  }

  // Requirements with no satisfying record. A count and the IDs, because the
  // gap set is live work rather than history, and on a real project it is the
  // one enumerated list that earns its place.
  const satisfied = new Set();
  for (const rec of records) {
    for (const id of rec.data.satisfies || []) satisfied.add(id);
  }
  const gaps = records
    .filter((r) => r.data.type === "requirement" && lib.isLive(r) && !satisfied.has(r.data.id))
    .map((r) => r.data.id);

  const nextAction = openTasks.find((r) => r.data.status === "in-progress") || openTasks[0] || null;

  return {
    generated: new Date().toISOString().replace(/\.[0-9]{3}Z$/, "Z"),
    records_hash: lib.recordsHash(records),
    phase: ladder.phase,
    gate: ladder.gate,
    mode: ladder.mode,
    capabilities: ladder.capabilities,
    open: {
      tasks: openTasks.map((r) => r.data.id),
      uxd: openUxd.map((r) => ({ id: r.data.id, severity: r.data.severity || null })),
    },
    counts,
    requirement_gaps: gaps,
    next_action: nextAction ? nextAction.data.id : null,
  };
}

const opts = parseArgs(process.argv.slice(2));

if (opts.command === "build") {
  const index = build(opts);
  const outPath = path.resolve(process.cwd(), opts.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(index, null, 2) + "\n");
  process.stdout.write(
    "forge-index: wrote " + opts.out + ", " +
      index.open.tasks.length + " open task(s), " +
      index.open.uxd.length + " open UX defect(s)\n"
  );
  process.exit(0);
}

if (opts.command === "check") {
  const fresh = build(opts);
  const outPath = path.resolve(process.cwd(), opts.out);
  let onDisk;
  try {
    onDisk = JSON.parse(fs.readFileSync(outPath, "utf8"));
  } catch (err) {
    process.stdout.write("forge-index: " + opts.out + " is missing or unreadable\n");
    process.exit(1);
  }

  // `generated` is a timestamp and always differs. Comparing it would make
  // check fail on every run, which trains everyone to ignore it.
  const differing = [];
  for (const key of Object.keys(fresh)) {
    if (key === "generated") continue;
    if (JSON.stringify(fresh[key]) !== JSON.stringify(onDisk[key])) {
      differing.push(key);
    }
  }

  if (differing.length) {
    process.stdout.write(
      "forge-index: " + opts.out + " is stale. Differing: " + differing.join(", ") + "\n" +
        "Run: node .forge/forge-index.js build\n"
    );
    process.exit(1);
  }

  process.stdout.write("forge-index: " + opts.out + " is current\n");
  process.exit(0);
}

process.stdout.write("Usage: forge-index.js build|check [--out <file>] [--records <dir>]\n");
process.exit(2);
