"use strict";

/*
 * The Stage 1 record programs run in the user's project rather than in the
 * model's context, so they are ordinary programs and get ordinary tests. The
 * cases here are the ones where a silent failure would be worst:
 *
 *  - the views guard emitting anything other than a real deny, because a guard
 *    that returns success lets the write land and says nothing
 *  - the linter passing a dangling edge or a supersession fork, because the
 *    whole design rests on the record set being trustworthy
 *  - forge-views.js rendering nondeterministically, because `check` is a byte
 *    comparison and a gate that fails at random gets switched off
 *  - the migration inventing an edge, because a wrong edge is reported as
 *    nothing at all while a missing one is reported as an orphan warning
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const bp = require("../templates/branch-protection.js");
const { REPO_ROOT } = require("./helpers/sandbox.js");

const LIB = path.join(REPO_ROOT, "templates", "forge-records-lib.js");
const LINT = path.join(REPO_ROOT, "templates", "forge-records-lint.js");
const INDEX = path.join(REPO_ROOT, "templates", "forge-index.js");
const VIEWS = path.join(REPO_ROOT, "templates", "forge-views.js");
const MIGRATE = path.join(REPO_ROOT, "templates", "forge-records-migrate.js");
const GUARD = path.join(REPO_ROOT, "scripts", "views-guard.js");

const lib = require(LIB);

/* A project root with the four programs in .forge/ and an empty record set. */
function makeProject() {
  const root = bp.createDisposableRoot();
  fs.mkdirSync(path.join(root, ".forge"), { recursive: true });
  for (const src of [LIB, LINT, INDEX, VIEWS, MIGRATE]) {
    fs.copyFileSync(src, path.join(root, ".forge", path.basename(src)));
  }
  for (const dir of ["decisions", "tasks", "requirements", "uxd"]) {
    fs.mkdirSync(path.join(root, "docs", "records", dir), { recursive: true });
  }
  return root;
}

function writeRecord(root, dir, id, fields, body) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) lines.push(key + ": [" + value.join(", ") + "]");
    else if (value === null) lines.push(key + ": null");
    else lines.push(key + ": " + value);
  }
  lines.push("---", "", body || "Body.", "");
  fs.writeFileSync(path.join(root, "docs", "records", dir, id + ".md"), lines.join("\n"));
}

function task(root, id, extra) {
  writeRecord(root, "tasks", id, Object.assign({
    id, type: "task", status: "open", date: "2026-01-01", title: "Task " + id,
    closes: [], satisfies: [], supersedes: null, superseded_by: null, decided_in: null,
  }, extra || {}));
}

function requirement(root, id, extra) {
  writeRecord(root, "requirements", id, Object.assign({
    id, type: "requirement", status: "approved", date: "2026-01-01", title: "Requirement " + id,
    closes: [], satisfies: [], supersedes: null, superseded_by: null, decided_in: null,
  }, extra || {}));
}

function decision(root, id, extra) {
  writeRecord(root, "decisions", id, Object.assign({
    id, type: "decision", status: "live", date: "2026-01-01", title: "Decision " + id,
    closes: [], satisfies: [], supersedes: null, superseded_by: null, decided_in: null,
  }, extra || {}));
}

function run(script, args, root) {
  return spawnSync(process.execPath, [script].concat(args), { cwd: root, encoding: "utf8" });
}

function guard(filePath) {
  const res = spawnSync(process.execPath, [GUARD], {
    input: JSON.stringify({ tool_input: { file_path: filePath } }),
    encoding: "utf8",
  });
  assert.equal(res.status, 0, "the guard must never exit non-zero: " + res.stderr);
  return res.stdout.trim();
}

// ------------------------------------------------------------- the guard

test("the views guard denies a write under docs/views with the documented shape", () => {
  const out = guard("C:/proj/docs/views/traceability.md");
  const parsed = JSON.parse(out);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /forge-views\.js render/);
});

test("the views guard denies on posix paths too", () => {
  const parsed = JSON.parse(guard("/home/me/proj/docs/views/open-work.md"));
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
});

test("the views guard leaves every other path alone", () => {
  for (const p of [
    "C:/proj/docs/records/tasks/T-1.md",
    "C:/proj/CONTINUE.md",
    "C:/proj/src/views/Main.tsx",
    "C:/proj/docs/SRS.md",
  ]) {
    assert.equal(guard(p), "", p + " must not be denied");
  }
});

test("a directory merely containing the word views is not guarded", () => {
  // A substring match would deny writes to a project's own previews directory,
  // and a guard that blocks unrelated work gets removed wholesale.
  assert.equal(guard("C:/proj/docs/previews/thing.md"), "");
  assert.equal(guard("C:/proj/views/thing.md"), "");
});

test("the guard survives a payload it does not understand", () => {
  for (const input of ["", "not json", "{}", '{"tool_input":{}}']) {
    const res = spawnSync(process.execPath, [GUARD], { input, encoding: "utf8" });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "");
  }
});

// ------------------------------------------------------------- the parser

test("the front matter parser reads the documented subset and rejects the rest", () => {
  const ok = lib.parseFrontMatter(
    ["---", "id: D-0001", "closes: [T-1, T-2]", "supersedes: null", 'title: "quoted: value"', "---", "", "Body."].join("\n"),
    "x.md"
  );
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.data.id, "D-0001");
  assert.deepEqual(ok.data.closes, ["T-1", "T-2"]);
  assert.equal(ok.data.supersedes, null);
  assert.equal(ok.data.title, "quoted: value");
  assert.equal(ok.body, "Body.");

  const nested = lib.parseFrontMatter(["---", "id: D-1", "meta:", "  nested: true", "---"].join("\n"), "x.md");
  assert.ok(nested.errors.length, "nested mappings are outside the subset and must be reported, not guessed at");

  const unfenced = lib.parseFrontMatter("no front matter here", "x.md");
  assert.ok(unfenced.errors.length);
});

test("a duplicate front matter key is reported rather than silently last-wins", () => {
  const r = lib.parseFrontMatter(["---", "id: D-1", "id: D-2", "---"].join("\n"), "x.md");
  assert.ok(r.errors.some((e) => /duplicate key/.test(e.message)));
});

// -------------------------------------------------------------- the linter

test("a clean record set lints clean", () => {
  const root = makeProject();
  requirement(root, "FR-GW-001");
  task(root, "T-1", { satisfies: ["FR-GW-001"] });
  decision(root, "D-0001", { decided_in: "T-1" });
  const res = run(LINT, [], root);
  assert.equal(res.status, 0, res.stdout);
  assert.match(res.stdout, /clean|WARNINGS/);
  bp.removeDisposable(root);
});

test("a dangling edge is a hard failure naming the field", () => {
  const root = makeProject();
  task(root, "T-1", { satisfies: ["FR-NOPE-999"] });
  const res = run(LINT, [], root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /FR-NOPE-999/);
  assert.match(res.stdout, /\[satisfies\]/);
  bp.removeDisposable(root);
});

test("a filename that disagrees with its own id is a hard failure", () => {
  const root = makeProject();
  task(root, "T-1");
  fs.renameSync(
    path.join(root, "docs", "records", "tasks", "T-1.md"),
    path.join(root, "docs", "records", "tasks", "T-2.md")
  );
  const res = run(LINT, [], root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /filename says/);
  bp.removeDisposable(root);
});

test("a field outside the closed set is a hard failure", () => {
  const root = makeProject();
  writeRecord(root, "tasks", "T-1", {
    id: "T-1", type: "task", status: "open", date: "2026-01-01", title: "T", superseeds: "T-9",
  });
  const res = run(LINT, [], root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /superseeds/, "a typo in an edge field must be reported, not ignored");
  bp.removeDisposable(root);
});

test("a status illegal for its type is a hard failure", () => {
  const root = makeProject();
  task(root, "T-1", { status: "fixed" });
  const res = run(LINT, [], root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /not legal for type task/);
  bp.removeDisposable(root);
});

test("two live records superseding the same target is a fork and fails", () => {
  const root = makeProject();
  decision(root, "D-0001");
  decision(root, "D-0002", { supersedes: "D-0001" });
  decision(root, "D-0003", { supersedes: "D-0001" });
  const res = run(LINT, [], root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /more than one live record/);
  bp.removeDisposable(root);
});

test("a supersession cycle fails rather than looping forever", () => {
  const root = makeProject();
  decision(root, "D-0001", { supersedes: "D-0002" });
  decision(root, "D-0002", { supersedes: "D-0001" });
  const res = run(LINT, [], root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /cycle/);
  bp.removeDisposable(root);
});

test("an undeclared ID prefix warns and does not fail", () => {
  // The first run against a real project finds prose that matches the ID shape:
  // SHA-256 does. A linter that is unusable on day one gets switched off.
  const root = makeProject();
  task(root, "T-1");
  fs.writeFileSync(
    path.join(root, "docs", "records", "VOCABULARY.md"),
    ["| Prefix | Record type | Meaning |", "|---|---|---|", "| D | decision | Decision |"].join("\n")
  );
  const res = run(LINT, [], root);
  assert.equal(res.status, 0, "an undeclared prefix must not fail the gate");
  assert.match(res.stdout, /WARNINGS/);
  assert.match(res.stdout, /not declared in VOCABULARY/);
  bp.removeDisposable(root);
});

test("an orphan decision warns and does not fail", () => {
  const root = makeProject();
  decision(root, "D-0001");
  const res = run(LINT, [], root);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /orphan decision/);
  bp.removeDisposable(root);
});

test("--warn-only reports hard failures and still exits 0", () => {
  const root = makeProject();
  task(root, "T-1", { satisfies: ["FR-NOPE-999"] });
  const res = run(LINT, ["--warn-only"], root);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /ERRORS/, "--warn-only must still report, or the migration learns nothing");
  bp.removeDisposable(root);
});

test("--fix writes the reverse edge and nothing else", () => {
  const root = makeProject();
  decision(root, "D-0001");
  decision(root, "D-0002", { supersedes: "D-0001" });
  const before = fs.readFileSync(path.join(root, "docs", "records", "decisions", "D-0002.md"), "utf8");

  const res = run(LINT, ["--fix"], root);
  assert.equal(res.status, 0, res.stdout);

  const victim = fs.readFileSync(path.join(root, "docs", "records", "decisions", "D-0001.md"), "utf8");
  assert.match(victim, /^superseded_by: D-0002$/m);
  assert.match(victim, /^status: superseded$/m);
  assert.match(victim, /Body\./, "--fix must never touch a body");

  const after = fs.readFileSync(path.join(root, "docs", "records", "decisions", "D-0002.md"), "utf8");
  assert.equal(after, before, "--fix must not edit the record that carries the forward edge");
  bp.removeDisposable(root);
});

test("a superseded record leaves the live set", () => {
  const root = makeProject();
  decision(root, "D-0001", { superseded_by: "D-0002", status: "superseded" });
  decision(root, "D-0002", { supersedes: "D-0001" });
  const { records } = lib.readRecords(path.join(root, "docs", "records"));
  const live = records.filter((r) => lib.isLive(r)).map((r) => r.data.id);
  assert.deepEqual(live, ["D-0002"], "the whole design rests on exactly one record being live");
  bp.removeDisposable(root);
});

// --------------------------------------------------------------- the index

test("the index carries live state and never enumerates history", () => {
  const root = makeProject();
  fs.writeFileSync(path.join(root, "CONTINUE.md"), "Phase: 3\nGate:  PASSED\nMode:  FLOW\nCapabilities: records: backfilled\n");
  requirement(root, "FR-GW-001");
  requirement(root, "FR-GW-002");
  task(root, "T-1", { satisfies: ["FR-GW-001"] });
  for (let i = 2; i < 40; i += 1) task(root, "T-" + i, { status: "closed" });

  const res = run(INDEX, ["build"], root);
  assert.equal(res.status, 0, res.stdout);
  const index = JSON.parse(fs.readFileSync(path.join(root, ".forge", "index.json"), "utf8"));

  assert.equal(index.phase, 3);
  assert.equal(index.gate, "PASSED");
  assert.equal(index.mode, "FLOW");
  assert.equal(index.capabilities.records, "backfilled");
  assert.deepEqual(index.open.tasks, ["T-1"]);
  assert.equal(index.counts.task, 39);
  assert.deepEqual(index.requirement_gaps, ["FR-GW-002"]);

  // The trap this design exists to avoid: an index whose length grows with the
  // project's age rather than its open work.
  const size = fs.statSync(path.join(root, ".forge", "index.json")).size;
  assert.ok(size < 2000, "the index must not enumerate history; it was " + size + " B");
  bp.removeDisposable(root);
});

test("index check reports staleness and ignores its own timestamp", () => {
  const root = makeProject();
  task(root, "T-1");
  assert.equal(run(INDEX, ["build"], root).status, 0);
  assert.equal(run(INDEX, ["check"], root).status, 0, "a freshly built index must check clean");

  task(root, "T-2");
  const stale = run(INDEX, ["check"], root);
  assert.equal(stale.status, 1);
  assert.match(stale.stdout, /stale/);
  bp.removeDisposable(root);
});

test("a body edit does not invalidate the records hash", () => {
  const root = makeProject();
  task(root, "T-1");
  assert.equal(run(INDEX, ["build"], root).status, 0);
  const file = path.join(root, "docs", "records", "tasks", "T-1.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8") + "\nMore prose, no edges changed.\n");
  assert.equal(run(INDEX, ["check"], root).status, 0, "prose is not state");
  bp.removeDisposable(root);
});

// --------------------------------------------------------------- the views

test("rendering is deterministic, which is what makes check a usable gate", () => {
  const root = makeProject();
  requirement(root, "FR-GW-001");
  requirement(root, "FR-AI-002");
  task(root, "T-1", { satisfies: ["FR-GW-001"], decided_in: "T-1" });
  writeRecord(root, "uxd", "UXD-1", {
    id: "UXD-1", type: "uxd", status: "open", date: "2026-01-01", title: "Debt",
    severity: "blocks", closes: [], satisfies: [], supersedes: null, superseded_by: null, decided_in: null,
  });

  assert.equal(run(VIEWS, ["render"], root).status, 0);
  const first = fs.readFileSync(path.join(root, "docs", "views", "traceability.md"), "utf8");
  assert.equal(run(VIEWS, ["render"], root).status, 0);
  const second = fs.readFileSync(path.join(root, "docs", "views", "traceability.md"), "utf8");
  assert.equal(first, second);
  assert.equal(run(VIEWS, ["check"], root).status, 0);
  bp.removeDisposable(root);
});

test("every generated view carries the do-not-edit banner", () => {
  const root = makeProject();
  task(root, "T-1");
  assert.equal(run(VIEWS, ["render"], root).status, 0);
  for (const name of ["traceability.md", "open-work.md", "DONE-ARCHIVE.md"]) {
    const text = fs.readFileSync(path.join(root, "docs", "views", name), "utf8");
    assert.match(text.split("\n")[0], /GENERATED by forge-views\.js/, name + " must announce itself");
  }
  bp.removeDisposable(root);
});

test("a hand-edited view is caught by check and named with the line", () => {
  const root = makeProject();
  task(root, "T-1");
  assert.equal(run(VIEWS, ["render"], root).status, 0);
  const file = path.join(root, "docs", "views", "open-work.md");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("Task T-1", "Task T-1, and a note somebody typed"));
  const res = run(VIEWS, ["check"], root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /open-work\.md/);
  assert.match(res.stdout, /line [0-9]+/);
  bp.removeDisposable(root);
});

test("open work excludes closed work and traceability counts the gaps", () => {
  const root = makeProject();
  requirement(root, "FR-GW-001");
  requirement(root, "FR-GW-002");
  task(root, "T-1", { satisfies: ["FR-GW-001"] });
  task(root, "T-2", { status: "closed" });
  assert.equal(run(VIEWS, ["render"], root).status, 0);

  const open = fs.readFileSync(path.join(root, "docs", "views", "open-work.md"), "utf8");
  assert.match(open, /T-1/);
  assert.doesNotMatch(open, /T-2/, "closed work must not appear in the working set");

  const done = fs.readFileSync(path.join(root, "docs", "views", "DONE-ARCHIVE.md"), "utf8");
  assert.match(done, /T-2/);

  const trace = fs.readFileSync(path.join(root, "docs", "views", "traceability.md"), "utf8");
  assert.match(trace, /1 with no satisfying record/);
  bp.removeDisposable(root);
});

test("a pipe inside a title cannot break the table", () => {
  const root = makeProject();
  requirement(root, "FR-GW-001", { title: "Accept a | b as input" });
  assert.equal(run(VIEWS, ["render"], root).status, 0);
  const trace = fs.readFileSync(path.join(root, "docs", "views", "traceability.md"), "utf8");
  const row = trace.split("\n").find((l) => l.includes("FR-GW-001"));
  assert.match(row, /\\\|/, "the pipe must be escaped, which is how the predecessor table was destroyed");
  assert.equal(row.split(/(?<!\\)\|/).length - 1, 6, "the row must still have its column count");
  bp.removeDisposable(root);
});

// ----------------------------------------------------------- the migration

test("the migration refuses a dirty working tree", () => {
  const root = makeProject();
  spawnSync("git", ["init"], { cwd: root, encoding: "utf8" });
  fs.writeFileSync(path.join(root, "TODO.md"), "- T-1 something\n");
  fs.rmSync(path.join(root, "docs", "records"), { recursive: true, force: true });
  const res = run(MIGRATE, [], root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /working tree is dirty/);
  bp.removeDisposable(root);
});

test("the migration refuses to run twice", () => {
  const root = makeProject();
  const res = run(MIGRATE, ["--force-dirty"], root);
  assert.equal(res.status, 1);
  assert.match(res.stdout, /already exists/);
  bp.removeDisposable(root);
});

test("the migration infers decided_in but never invents closes", () => {
  const root = makeProject();
  fs.rmSync(path.join(root, "docs", "records"), { recursive: true, force: true });
  fs.writeFileSync(
    path.join(root, "docs", "DECISIONS.md"),
    ["## 2026-08-14 Reversed the dispose ordering", "", "Work done under T-108 against FR-GW-001.", ""].join("\n")
  );
  // Both targets must exist, or the edge-resolution pass correctly nulls them:
  // an edge is only written when something carries the ID.
  fs.writeFileSync(path.join(root, "TODO.md"), "- T-108 the dispose work\n");
  fs.writeFileSync(path.join(root, "docs", "SRS.md"), "### FR-GW-001 The gateway accepts input\n");
  const res = run(MIGRATE, ["--force-dirty"], root);
  assert.equal(res.status, 0, res.stdout);

  const rec = fs.readFileSync(path.join(root, "docs", "records", "decisions", "D-0001.md"), "utf8");
  assert.match(rec, /^decided_in: T-108$/m);
  assert.match(rec, /^satisfies: \[FR-GW-001\]$/m);
  assert.match(rec, /^closes: \[\]$/m, "closes is a judgement prose does not carry, and a wrong edge is invisible");
  bp.removeDisposable(root);
});

test("the migration treats SHA-256 as prose, not as an ID", () => {
  const root = makeProject();
  fs.rmSync(path.join(root, "docs", "records"), { recursive: true, force: true });
  fs.writeFileSync(
    path.join(root, "docs", "DECISIONS.md"),
    ["## 2026-08-14 Hashing", "", "We use SHA-256 here. Decided under T-1.", ""].join("\n")
  );
  assert.equal(run(MIGRATE, ["--force-dirty"], root).status, 0);
  const rec = fs.readFileSync(path.join(root, "docs", "records", "decisions", "D-0001.md"), "utf8");
  assert.doesNotMatch(rec, /satisfies: \[SHA-256\]/, "SHA-256 matches the ID shape and must not become an edge");
  bp.removeDisposable(root);
});

test("the migration reports orphans and moves originals aside rather than deleting", () => {
  const root = makeProject();
  fs.rmSync(path.join(root, "docs", "records"), { recursive: true, force: true });
  fs.writeFileSync(
    path.join(root, "docs", "DECISIONS.md"),
    ["## 2026-08-14 A decision naming nothing", "", "Just prose.", ""].join("\n")
  );
  const res = run(MIGRATE, ["--force-dirty"], root);
  assert.equal(res.status, 0, res.stdout);
  assert.match(res.stdout, /ORPHANS/);
  assert.ok(
    fs.existsSync(path.join(root, "docs", "archive", "pre-records", "DECISIONS.md")),
    "the original must be moved, never deleted"
  );
  assert.ok(!fs.existsSync(path.join(root, "docs", "DECISIONS.md")));
  bp.removeDisposable(root);
});

test("--dry-run writes nothing", () => {
  const root = makeProject();
  fs.rmSync(path.join(root, "docs", "records"), { recursive: true, force: true });
  fs.writeFileSync(path.join(root, "docs", "DECISIONS.md"), "## 2026-08-14 Thing\n\nUnder T-1.\n");
  const res = run(MIGRATE, ["--dry-run", "--force-dirty"], root);
  assert.equal(res.status, 0);
  assert.ok(!fs.existsSync(path.join(root, "docs", "records")));
  assert.ok(fs.existsSync(path.join(root, "docs", "DECISIONS.md")));
  bp.removeDisposable(root);
});

test("a migrated set lints, indexes, and renders end to end", () => {
  const root = makeProject();
  fs.rmSync(path.join(root, "docs", "records"), { recursive: true, force: true });
  fs.writeFileSync(
    path.join(root, "docs", "DECISIONS.md"),
    ["## 2026-08-14 First", "", "Under T-1, satisfying FR-GW-001.", "", "## 2026-08-15 Second", "", "Under T-2.", ""].join("\n")
  );
  fs.writeFileSync(path.join(root, "TODO.md"), ["- T-1 build the thing", "- T-2 closed: ship it", "- UXD-1 blocks: the button lies", ""].join("\n"));
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "SRS.md"), ["### FR-GW-001 The gateway accepts input", "", "Prose.", ""].join("\n"));

  assert.equal(run(MIGRATE, ["--force-dirty"], root).status, 0);
  const lint = run(LINT, ["--warn-only"], root);
  assert.equal(lint.status, 0, lint.stdout);
  assert.equal(run(INDEX, ["build"], root).status, 0);
  assert.equal(run(VIEWS, ["render"], root).status, 0);
  assert.equal(run(VIEWS, ["check"], root).status, 0);

  const vocab = fs.readFileSync(path.join(root, "docs", "records", "VOCABULARY.md"), "utf8");
  assert.match(vocab, /\| T \| task \|/, "the migration seeds the vocabulary so the prefix check has something to check");
  bp.removeDisposable(root);
});

test("--if-present makes the pre-push gate inert on a project with no record set", () => {
  // A skipped or not-yet-backfilled `records` capability must leave a gate that
  // passes, not one that fails. Otherwise every pre-1.5.0 project cannot push.
  const root = bp.createDisposableRoot();
  fs.mkdirSync(path.join(root, ".forge"), { recursive: true });
  for (const src of [LIB, LINT, VIEWS]) {
    fs.copyFileSync(src, path.join(root, ".forge", path.basename(src)));
  }

  const lint = run(LINT, ["--if-present"], root);
  assert.equal(lint.status, 0, lint.stdout);
  const views = run(VIEWS, ["check", "--if-present"], root);
  assert.equal(views.status, 0, views.stdout);

  // Without the flag, a missing record set is still exit 2, so a project that
  // believes it has records learns that it does not.
  assert.equal(run(LINT, [], root).status, 2);
  assert.equal(run(VIEWS, ["check"], root).status, 2);
  bp.removeDisposable(root);
});

test("the pre-push template wires both record gates with --if-present", () => {
  const yml = fs.readFileSync(path.join(REPO_ROOT, "templates", "lefthook.yml"), "utf8");
  assert.match(yml, /forge-records-lint\.js --if-present/);
  assert.match(yml, /forge-views\.js check --if-present/);
});

test("a task ID with a letter suffix is a legal ID", () => {
  // Real projects split T-006 into T-006a, T-006b as the work turns out to have
  // parts. On the project this was measured against, 845 ID occurrences carried
  // such a suffix, and a shape that rejected them would have silently dropped
  // every edge naming a split task.
  assert.ok(lib.isId("T-006a"));
  assert.ok(lib.isId("T-006"));
  assert.ok(lib.isId("FR-GW-001"));
  assert.equal(lib.prefixOf("T-006a"), "T");
  assert.equal(lib.prefixOf("FR-GW-001"), "FR-GW");
  assert.ok(!lib.isId("SHA-256a-x"));
});

test("the migration drops an edge nothing carries, into the body rather than silently", () => {
  // A monolith names IDs that no longer have anywhere to live. Leaving them in
  // front matter hands the user a record set that cannot pass its own pre-push
  // gate on day one; dropping them silently loses the reference.
  const root = makeProject();
  fs.rmSync(path.join(root, "docs", "records"), { recursive: true, force: true });
  fs.writeFileSync(
    path.join(root, "docs", "DECISIONS.md"),
    ["## 2026-08-14 A decision", "", "Work under T-007b, which no longer has a backlog entry.", ""].join("\n")
  );
  const res = run(MIGRATE, ["--force-dirty"], root);
  assert.equal(res.status, 0, res.stdout);
  assert.match(res.stdout, /named an ID no record carries/);

  const rec = fs.readFileSync(path.join(root, "docs", "records", "decisions", "D-0001.md"), "utf8");
  assert.match(rec, /^decided_in: null$/m, "the unresolvable edge must leave the front matter");
  assert.match(rec, /Edges the migration could not resolve/);
  assert.match(rec, /decided_in T-007b/, "and must be written down, not lost");

  // The whole point: the migrated set passes the real gate, not just --warn-only.
  const lint = run(LINT, [], root);
  assert.equal(lint.status, 0, "a freshly migrated set must pass the pre-push gate: " + lint.stdout);
  bp.removeDisposable(root);
});

test("the migration reads a second table with its own column names", () => {
  // A real traceability file carried a manual verification log below the main
  // table, with `Result` where the first has `Status`. Latching the first
  // header read that table with the wrong columns and every row fell through
  // counted as neither parsed nor skipped.
  const root = makeProject();
  fs.rmSync(path.join(root, "docs", "records"), { recursive: true, force: true });
  fs.writeFileSync(path.join(root, "TODO.md"), "- T-1 build it\n");
  fs.writeFileSync(path.join(root, "docs", "SRS.md"), "### FR-GW-001 The gateway\n\n### FR-GW-002 The other one\n");
  fs.writeFileSync(
    path.join(root, "docs", "traceability.md"),
    [
      "| Req ID | Requirement | Test file and name | Level | Status | Notes |",
      "|---|---|---|---|---|---|",
      "| FR-GW-001 | The gateway | `GatewayTests` T-1 | Unit | COVERED | narrative mentioning T-99 |",
      "",
      "## Manual verification log",
      "",
      "| Req ID | Verified by | Date | Result | Evidence |",
      "|---|---|---|---|---|",
      "| FR-GW-002 | a human | 2026-08-01 | PASS | ran it, see T-1 |",
      "",
    ].join("\n")
  );
  const res = run(MIGRATE, ["--force-dirty"], root);
  assert.equal(res.status, 0, res.stdout);

  const t1 = fs.readFileSync(path.join(root, "docs", "records", "tasks", "T-1.md"), "utf8");
  const satisfies = /^satisfies: \[(.*)\]$/m.exec(t1)[1];
  assert.match(satisfies, /FR-GW-001/, "the first table's evidence column names T-1");
  assert.match(satisfies, /FR-GW-002/, "and so does the second table's, under a different header");
  assert.doesNotMatch(t1, /T-99/, "a task merely narrated in the Notes column is not an edge");
  bp.removeDisposable(root);
});
