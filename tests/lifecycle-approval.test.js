"use strict";

/*
 * The Phase 1 to 2 boundary, and the one recorded field that could never be true.
 *
 * Two defects of the same family as the Phase 2 completion failure: a record
 * that describes a state which either does not exist or cannot exist.
 *
 * A. The approval transition was instructed to pass through `Phase: 1` with
 *    `Gate: PASSED`. No consumer reads that combination, and it describes a
 *    project that is neither awaiting approval nor bootstrapping. A session
 *    interrupted during the Phase 2 inventory would read `Phase: 1` while
 *    Phase 2 work was already underway.
 *
 * B. `templates/CONTINUE.md` carried a `Last commit:` field. Writing a SHA into
 *    a file and then committing that file changes the commit the field names, so
 *    the value is stale by exactly one commit the moment it is recorded, every
 *    time, forever. Step 2 then reconciled against it, which manufactured a
 *    discrepancy out of a record that was working as designed. Commit identity
 *    comes from git, so the field is gone and reconciliation reads git.
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
const FORGE_SPEC = read(path.join("skills", "forge-spec", "SKILL.md"));
const CONTINUE_TEMPLATE = read(path.join("templates", "CONTINUE.md"));

/* ---------------- A: approval is one transition ---------------- */

test("no skill instructs an intermediate Phase 1 passed gate", () => {
  for (const [name, text] of [["forge-spec", FORGE_SPEC], ["forge", FORGE]]) {
    assert.doesNotMatch(
      text,
      /Set `Gate: PASSED` only after/,
      name + " still instructs the intermediate state"
    );
  }
  assert.match(FORGE_SPEC, /Do not set a Phase 1 `Gate: PASSED`/);
  assert.match(FORGE, /Do not write a `Phase: 1`, `Gate: PASSED`/);
});

test("explicit approval moves straight to Phase 2 bootstrapping", () => {
  assert.match(FORGE_SPEC, /`Phase: 2`[^\n]*`Gate: IN_PROGRESS`/);
  assert.match(FORGE, /Approval is one transition/);
  assert.match(
    FORGE,
    /Approval is one transition[\s\S]*`Phase: 2`[\s\S]*`Gate: IN_PROGRESS`/,
    "the transition has to name the state it lands on"
  );
  assert.match(FORGE, /Approval is one transition[\s\S]*one conventional commit/);
  assert.match(FORGE, /Approval is one transition[\s\S]*[Ii]nvoke `forge-env`/);
});

test("the approval transition preserves the rest of the record", () => {
  assert.match(FORGE, /Approval is one transition[\s\S]*preserving `Mode:`/);
  assert.match(
    FORGE,
    /Approval is one transition[\s\S]*Blocked on me[\s\S]{0,120}other blockers alone/,
    "clearing the approval item must not clear the others"
  );
});

test("the ladder keys the approved spec on the phase it actually lands on", () => {
  assert.match(
    FORGE,
    /\| 3 \|[^|]*`Phase: 2`[^|]*no `docs\/ENVIRONMENT\.md`[^|]*\|/,
    "row 3 has to match the record the approval transition writes"
  );
  assert.match(FORGE_SPEC, /never self-approve/i, "the gate itself is unchanged");
});

/* ---------------- D: no field that is stale by construction ---------------- */

test("the CONTINUE template records no commit identity", () => {
  assert.doesNotMatch(
    CONTINUE_TEMPLATE,
    /^Last commit:/m,
    "a recorded SHA is stale the moment the file naming it is committed"
  );
  assert.match(CONTINUE_TEMPLATE, /^Branch:/m, "the fields that can be true stay");
  assert.match(CONTINUE_TEMPLATE, /^Working tree:/m);
});

test("reconciliation reads git rather than a recorded commit", () => {
  assert.doesNotMatch(
    FORGE,
    /Does the last commit match what is recorded\?/,
    "that check compared git against a field that cannot agree with it"
  );
  assert.match(
    FORGE,
    /`Last commit:`[\s\S]{0,400}not a discrepancy/i,
    "legacy projects carry the field, so its staleness must be declared harmless"
  );
  assert.match(FORGE, /`Last commit:`[\s\S]{0,400}(?:drop|remove)/i);
});

/*
 * The executable half: commit identity in the injected context comes from git,
 * so a record with no commit field still cold starts with a real HEAD and
 * nothing to reconcile.
 */
test("a template-shaped record cold starts with a real HEAD and no warnings", () => {
  const root = bp.createDisposableRoot();
  try {
    fs.writeFileSync(path.join(root, "CONTINUE.md"), CONTINUE_TEMPLATE, "utf8");
    const git = (args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    git(["init", "--initial-branch=main"]);
    git(["config", "user.name", "Forge Test"]);
    git(["config", "user.email", "forge@example.invalid"]);
    git(["add", "CONTINUE.md"]);
    git(["commit", "-m", "docs: record the approval transition"]);

    const head = execFileSync("git", ["log", "-1", "--oneline"], {
      cwd: root,
      encoding: "utf8",
    }).trim();

    const res = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", "session-start.js")], {
      cwd: root,
      encoding: "utf8",
      env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root }),
    });
    assert.equal(res.status, 0, res.stdout + res.stderr);

    assert.ok(
      res.stdout.indexOf("last commit: " + head) !== -1,
      "the injected commit identity has to be the real HEAD"
    );
    assert.match(res.stdout, /working tree: clean/);
    assert.doesNotMatch(res.stdout, /WARNING/);

    // The echoed CONTINUE.md must not contribute a second, competing answer.
    const echoed = res.stdout.split("--- CONTINUE.md ---")[1].split("--- end CONTINUE.md ---")[0];
    assert.doesNotMatch(echoed, /Last commit:/);
  } finally {
    bp.removeDisposable(root);
  }
});
