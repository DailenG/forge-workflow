"use strict";

/*
 * Requirement 11: end to end proof against a disposable remote.
 *
 * Nothing here touches a real remote. A bare repository created by mkdtemp
 * under the system temp directory stands in for the server, and every removal
 * goes through the tool's own guarded delete.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const bp = require("../templates/branch-protection.js");
const { makeSandbox, cleanup, TOOL_SRC } = require("./helpers/sandbox.js");

test("requirement 11: the guard is proven on throwaway repositories", () => {
  const root = makeSandbox();
  try {
    const tool = bp.createTool({ cwd: root });
    const result = tool.selftest();

    const byCase = {};
    for (const e of result.evidence) byCase[e.case] = e;

    // The four decisions the policy names, observed through a real git push.
    assert.equal(byCase["initial branch creation"].pass, true);
    assert.equal(byCase["fast-forward push"].pass, true);
    assert.equal(byCase["protected branch deletion"].pass, true);
    assert.equal(byCase["non-fast-forward push"].pass, true);

    // git must actually refuse, not merely print something.
    assert.notEqual(byCase["protected branch deletion"].observed, "exit 0");
    assert.notEqual(byCase["non-fast-forward push"].observed, "exit 0");

    // The quality commands still run on an accepted push, and are skipped when
    // the history check refuses, which is what proves the ordering.
    assert.equal(byCase["quality checks run on an accepted push"].pass, true);
    assert.equal(byCase["quality checks run again"].pass, true);
    assert.equal(byCase["quality checks skipped when the guard refuses a deletion"].pass, true);
    assert.equal(byCase["quality checks skipped when the guard refuses a rewrite"].pass, true);

    assert.equal(byCase["remote history survived both refusals"].pass, true);
    assert.equal(byCase["guard with no ref records on stdin"].pass, true);

    assert.equal(result.ok, true);
    assert.equal(result.problem, null);

    // Requirement: the temporary repositories are safely removed.
    assert.equal(fs.existsSync(result.root), false, "the disposable root must be gone");
  } finally {
    cleanup(root);
  }
});

test("requirement 11: the same proof runs from the command line", () => {
  const root = makeSandbox();
  try {
    const res = spawnSync(process.execPath, [TOOL_SRC, "selftest"], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.match(res.stdout, /pass {2}protected branch deletion/);
    assert.match(res.stdout, /pass {2}non-fast-forward push/);
    assert.doesNotMatch(res.stdout, /FAIL/);
  } finally {
    cleanup(root);
  }
});

/* ---------------- the delete guard around the delete ---------------- */

test("recursive deletion is refused for anything that is not a disposable root", () => {
  const cases = [
    ["", "path is empty"],
    [os.tmpdir(), "temp root"],
    [os.homedir(), "home directory"],
    [process.cwd(), "working directory"],
    [path.join(os.tmpdir(), "definitely-not-created-by-this-test"), "does not resolve"],
  ];
  for (const entry of cases) {
    const rejection = bp.disposableRejection(entry[0]);
    assert.notEqual(rejection, null, "expected " + entry[0] + " to be refused");
    assert.throws(() => bp.removeDisposable(entry[0]), /refusing recursive delete/);
  }
});

test("a temp directory without the forge prefix is still refused", () => {
  const stranger = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "unrelated-"));
  try {
    assert.match(bp.disposableRejection(stranger), /not a forge selftest directory/);
    assert.throws(() => bp.removeDisposable(stranger), /refusing recursive delete/);
    assert.equal(fs.existsSync(stranger), true, "the refusal must leave it alone");
  } finally {
    fs.rmSync(stranger, { recursive: true, force: true });
  }
});

test("a disposable root is accepted, removed, and only removed once", () => {
  const root = bp.createDisposableRoot();
  fs.writeFileSync(path.join(root, "f.txt"), "x", "utf8");
  assert.equal(bp.disposableRejection(root), null);
  bp.removeDisposable(root);
  assert.equal(fs.existsSync(root), false);
  assert.throws(() => bp.removeDisposable(root), /refusing recursive delete/);
});

test("a path that escapes the temp directory through a parent reference is refused", () => {
  const root = bp.createDisposableRoot();
  try {
    assert.throws(
      () => bp.removeDisposable(path.join(root, "..", "..")),
      /refusing recursive delete/
    );
  } finally {
    bp.removeDisposable(root);
  }
});
