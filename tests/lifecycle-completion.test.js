"use strict";

/*
 * Phase 2 completion is one atomic state transition.
 *
 * Observed failure. A Phase 2 completion wrote `CONTINUE.md` as `Phase: 2`,
 * `Gate: PASSED` with Phase 3 planning next, but left `TODO.md` saying
 * "No implementation task is in progress. Phase 2 environment bootstrap is
 * active." Both files were committed, so the working tree was clean and the
 * contradiction lived entirely in the content. The next session's
 * reconciliation correctly read that as a record-versus-reality discrepancy
 * and stopped, which left the project unable to advance without a human
 * untangling two records that disagreed about the same phase.
 *
 * The completion transition is prompt text, so what is mechanically checkable
 * splits in two, and both halves are here:
 *
 *   - The instructions must name every file the transition touches, the exact
 *     values that go in them, and the prohibitions that caused the failure
 *     (a stale "is active" claim, a self-referential "pending commit"). These
 *     are assertions over the skill sources.
 *   - The record the transition leaves behind must survive the next cold
 *     start. That part runs the real SessionStart hook over a real git
 *     repository holding the completed state and checks the injected block.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const bp = require("../templates/branch-protection.js");
const { REPO_ROOT } = require("./helpers/sandbox.js");

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

const FORGE = read(path.join("skills", "forge", "SKILL.md"));
const FORGE_ENV = read(path.join("skills", "forge-env", "SKILL.md"));

const STALE_CLAIM = "Phase 2 environment bootstrap is active";

/* ---------------- the transition names every record it changes ------------- */

test("Phase 2 completion is described as one atomic transition", () => {
  assert.match(FORGE_ENV, /atomic Phase 2 completion/i);
  assert.match(
    FORGE_ENV,
    /atomic Phase 2 completion[\s\S]*CONTINUE\.md[\s\S]*TODO\.md[\s\S]*docs\/ENVIRONMENT\.md/i,
    "the transition must name all three records it changes"
  );
  assert.match(
    FORGE_ENV,
    /atomic Phase 2 completion[\s\S]*before committing any of them/i,
    "every record is updated first, then committed together"
  );
});

test("the completion record carries the exact handoff values", () => {
  assert.match(FORGE_ENV, /`Phase: 2`/);
  assert.match(FORGE_ENV, /`Gate: PASSED`/);
  assert.match(FORGE_ENV, /`Current task: begin the Phase 3 build plan`/);
  assert.match(FORGE_ENV, /`Working tree: clean`/);
  assert.match(FORGE_ENV, /Next action[^\n]*\/forge[^\n]*Phase 3 planning/i);
});

test("TODO.md stops claiming Phase 2 is active", () => {
  assert.match(FORGE_ENV, /Phase 2 environment bootstrap is complete/);
  const stale = FORGE_ENV.match(new RegExp(STALE_CLAIM, "g")) || [];
  assert.equal(
    stale.length,
    1,
    "the stale claim may appear only once, inside its own prohibition"
  );
  assert.match(
    FORGE_ENV,
    new RegExp("never[^\\n]*`" + STALE_CLAIM + "`"),
    "the exact stale wording has to be named to be prohibited"
  );
});

test("permanent task IDs and existing blockers survive the transition", () => {
  assert.match(FORGE_ENV, /[Pp]reserve[^\n]*permanent task IDs/);
  assert.match(FORGE_ENV, /T-ENV-001/, "the ID from the observed failure is the worked example");
  assert.match(FORGE_ENV, /[Pp]reserve[^\n]*blockers/);
  assert.match(FORGE_ENV, /carry[\s\S]{0,120}Phase 3/i);
  assert.match(FORGE_ENV, /without renumbering/i);
});

test("the completion commit does not record its own work as pending", () => {
  assert.match(FORGE_ENV, /[Dd]o not commit[^\n]*pending commit/);
  assert.match(
    FORGE_ENV,
    /describes[^\n]*resulting clean state|resulting[^\n]*clean state/i,
    "the wording committed must be true after the commit, not during it"
  );
});

test("the transition reconciles itself after committing", () => {
  assert.match(
    FORGE_ENV,
    /[Aa]fter committing[\s\S]*CONTINUE\.md[\s\S]*TODO\.md[\s\S]*docs\/ENVIRONMENT\.md[\s\S]*HEAD[\s\S]*branch[\s\S]*working-tree/,
    "every value the next session reconciles has to be checked here first"
  );
  assert.match(FORGE_ENV, /discrepancy/i);
});

/* ---------------- the next session accepts the completed record ------------ */

test("the lifecycle ladder routes a completed Phase 2 record to the build plan", () => {
  assert.match(
    FORGE,
    /Phase: 2[\s\S]{0,400}Gate: PASSED[\s\S]{0,400}begin the Phase 3 build plan/,
    "the ladder has to recognise the record forge-env actually leaves"
  );
  assert.match(FORGE, /Phase 2 environment bootstrap is complete/);
  assert.match(FORGE, /Run `forge-code`, starting with the build plan/);
  assert.doesNotMatch(
    FORGE,
    new RegExp(STALE_CLAIM + "[^\\n]*(?:is|counts as) (?:a )?(?:valid|complete)", "i"),
    "an active bootstrap claim is never a completed record"
  );
});

/*
 * The reconciliation the next session performs is prompt text, but the state it
 * reconciles against is not: the SessionStart hook reads the committed records
 * and the real git tree. A completed Phase 2 transition has to produce a block
 * with no warnings in it, because a warning is exactly what stopped the
 * observed run.
 */

const COMPLETED_CONTINUE = [
  "# Continue Here",
  "",
  "Phase: 2",
  "Gate:  PASSED",
  "Mode:  FLOW",
  "",
  "Current task: begin the Phase 3 build plan",
  "Branch: main",
  "Working tree: clean",
  "",
  "## Next action",
  "",
  "Invoke /forge to begin Phase 3 planning.",
  "",
  "## Blocked on me",
  "",
  "- Waiting on a decision about whether to support Windows 10.",
  "",
].join("\n");

const COMPLETED_TODO = [
  "# TODO",
  "",
  "Task IDs are permanent. Never renumber. Requirement IDs refer to docs/SRS.md.",
  "",
  "## In Progress",
  "",
  "None. Phase 2 environment bootstrap is complete.",
  "",
  "## Needed",
  "",
  "- **T-001** Build plan for Phase 3. Closes: FR-001.",
  "",
  "## Blocked",
  "",
  "## Completed",
  "",
  "- **T-ENV-001** Toolchain and repository bootstrap. Done: 2026-08-03.",
  "",
].join("\n");

const COMPLETED_ENVIRONMENT = [
  "# Environment",
  "",
  "Phase 2 environment bootstrap is complete.",
  "",
  "## Known gaps",
  "",
  "- None.",
  "",
].join("\n");

function completedProject() {
  const root = bp.createDisposableRoot();
  fs.writeFileSync(path.join(root, "CONTINUE.md"), COMPLETED_CONTINUE, "utf8");
  fs.writeFileSync(path.join(root, "TODO.md"), COMPLETED_TODO, "utf8");
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "docs", "ENVIRONMENT.md"), COMPLETED_ENVIRONMENT, "utf8");

  const git = (args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "Forge Test"]);
  git(["config", "user.email", "forge@example.invalid"]);
  git(["add", "CONTINUE.md", "TODO.md", path.join("docs", "ENVIRONMENT.md")]);
  git(["commit", "-m", "chore: complete Phase 2 environment bootstrap"]);
  return root;
}

function sessionStart(root) {
  const res = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "session-start.js")], {
    cwd: root,
    encoding: "utf8",
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root }),
  });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  return res.stdout;
}

test("a completed Phase 2 record cold starts with nothing to reconcile", () => {
  const root = completedProject();
  try {
    const injected = sessionStart(root);

    assert.match(injected, /Phase: 2/);
    assert.match(injected, /Gate: {2}PASSED/);
    assert.match(injected, /Current task: begin the Phase 3 build plan/);
    assert.match(injected, /working tree: clean/);
    assert.doesNotMatch(injected, /DIRTY/);
    assert.doesNotMatch(injected, /WARNING/, "a completed transition leaves nothing to warn about");

    // The contradiction from the observed failure is absent from the record.
    assert.doesNotMatch(injected, new RegExp(STALE_CLAIM));
    assert.doesNotMatch(injected, /pending commit/i);
  } finally {
    bp.removeDisposable(root);
  }
});

test("the observed failure is still caught when the two records disagree", () => {
  // The negative control: same completed CONTINUE.md, but TODO.md left saying
  // bootstrap is active. Nothing may make this read as a healthy record.
  const root = completedProject();
  try {
    const todo = path.join(root, "TODO.md");
    fs.writeFileSync(
      todo,
      COMPLETED_TODO.replace(
        "None. Phase 2 environment bootstrap is complete.",
        "No implementation task is in progress. " + STALE_CLAIM + "."
      ),
      "utf8"
    );

    const injected = sessionStart(root);
    assert.match(injected, /Gate: {2}PASSED/);
    assert.match(injected, /working tree: DIRTY/);
    assert.match(
      injected,
      /CONTINUE\.md is not among the changes/,
      "an uncommitted TODO.md beside a passed gate is the discrepancy signal"
    );
    assert.match(injected, /Reconcile before continuing/);
  } finally {
    bp.removeDisposable(root);
  }
});

/* ---------------- the templates do not seed the stale claim ---------------- */

test("no shipped skill or template carries the stale bootstrap claim as guidance", () => {
  const offenders = [];
  const roots = ["skills", "templates"];

  function walk(rel) {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
      const childRel = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        walk(childRel);
        continue;
      }
      if (!/\.(md|ya?ml|json)$/i.test(entry.name)) continue;
      const text = read(childRel);
      if (text.indexOf(STALE_CLAIM) === -1) continue;
      // The only permitted occurrence is forge-env prohibiting it.
      if (childRel === path.join("skills", "forge-env", "SKILL.md")) continue;
      offenders.push(childRel);
    }
  }

  for (const rel of roots) walk(rel);
  assert.deepEqual(offenders, []);
});
