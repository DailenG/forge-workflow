"use strict";

/*
 * The managed local guard: what it lets through and what it refuses.
 *
 * Covers the four decision cases the policy names (fast-forward accepted,
 * protected-branch deletion refused, non-fast-forward refused, initial branch
 * creation accepted), plus the two ways it is asked to fail closed.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const guard = require("../templates/history-guard.js");
const { makeSandbox, cleanup, guardPath } = require("./helpers/sandbox.js");

const ZERO = "0".repeat(40);
const OID_A = "1111111111111111111111111111111111111111";
const OID_B = "2222222222222222222222222222222222222222";

function alwaysAncestor(verdict) {
  return function () {
    return verdict;
  };
}

function runGuard(cwd, input, args) {
  return spawnSync(process.execPath, [guardPath(cwd)].concat(args || []), {
    cwd: cwd,
    input: input,
    encoding: "utf8",
  });
}

function gitIn(cwd, args) {
  const res = spawnSync("git", args, { cwd: cwd, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error("git " + args.join(" ") + " failed: " + res.stderr + res.stdout);
  }
  return res.stdout.trim();
}

/* ---------------- ref record parsing ---------------- */

test("parses the four field ref records git writes to stdin", () => {
  const { updates, malformed } = guard.parseRefLines(
    "refs/heads/main " + OID_B + " refs/heads/main " + OID_A + "\n\n"
  );
  assert.equal(malformed.length, 0);
  assert.deepEqual(updates, [
    {
      localRef: "refs/heads/main",
      localOid: OID_B,
      remoteRef: "refs/heads/main",
      remoteOid: OID_A,
    },
  ]);
});

test("a record that is not four fields is malformed, not ignored", () => {
  const { updates, malformed } = guard.parseRefLines("refs/heads/main " + OID_B + "\n");
  assert.equal(updates.length, 0);
  assert.deepEqual(malformed, ["refs/heads/main " + OID_B]);
});

test("the null object id is recognised at both sha1 and sha256 widths", () => {
  assert.equal(guard.isNullOid("0".repeat(40)), true);
  assert.equal(guard.isNullOid("0".repeat(64)), true);
  assert.equal(guard.isNullOid(OID_A), false);
  assert.equal(guard.isNullOid(""), false);
});

/* ---------------- the four decisions ---------------- */

test("requirement 5: a fast-forward update of the protected branch is allowed", () => {
  const verdict = guard.decide(
    { localRef: "refs/heads/main", localOid: OID_B, remoteRef: "refs/heads/main", remoteOid: OID_A },
    "refs/heads/main",
    alwaysAncestor("yes")
  );
  assert.deepEqual(verdict, { action: "allow", reason: "fast-forward" });
});

test("requirement 6: deleting the protected branch is rejected", () => {
  const verdict = guard.decide(
    { localRef: "(delete)", localOid: ZERO, remoteRef: "refs/heads/main", remoteOid: OID_A },
    "refs/heads/main",
    alwaysAncestor("yes")
  );
  assert.deepEqual(verdict, { action: "reject", reason: "deletion" });
});

test("requirement 7: a non-fast-forward update is rejected", () => {
  const verdict = guard.decide(
    { localRef: "refs/heads/main", localOid: OID_B, remoteRef: "refs/heads/main", remoteOid: OID_A },
    "refs/heads/main",
    alwaysAncestor("no")
  );
  assert.deepEqual(verdict, { action: "reject", reason: "non-fast-forward" });
});

test("requirement 8: creating the protected branch for the first time is allowed", () => {
  const verdict = guard.decide(
    { localRef: "refs/heads/main", localOid: OID_A, remoteRef: "refs/heads/main", remoteOid: ZERO },
    "refs/heads/main",
    alwaysAncestor("no")
  );
  assert.deepEqual(verdict, { action: "allow", reason: "creation" });
});

test("an update git cannot resolve is unverifiable, and unverifiable is not allowed", () => {
  const verdict = guard.decide(
    { localRef: "refs/heads/main", localOid: OID_B, remoteRef: "refs/heads/main", remoteOid: OID_A },
    "refs/heads/main",
    alwaysAncestor("unknown")
  );
  assert.equal(verdict.action, "unverifiable");
});

test("other branches are not this guard's business", () => {
  const verdict = guard.decide(
    { localRef: "refs/heads/slice/x", localOid: ZERO, remoteRef: "refs/heads/slice/x", remoteOid: OID_A },
    "refs/heads/main",
    alwaysAncestor("no")
  );
  assert.deepEqual(verdict, { action: "allow", reason: "not-protected-ref" });
});

test("a batch containing one bad update fails the whole push", () => {
  const raw = [
    "refs/heads/slice/x " + OID_B + " refs/heads/slice/x " + OID_A,
    "refs/heads/main " + ZERO + " refs/heads/main " + OID_A,
  ].join("\n");
  const evaluated = guard.evaluate(raw, "main", alwaysAncestor("yes"));
  assert.equal(evaluated.results.filter((r) => r.verdict.action === "reject").length, 1);
});

/* ---------------- protected branch resolution ---------------- */

test("the recorded protection state names the protected branch", () => {
  const root = makeSandbox({ protectionState: { defaultBranch: "trunk" } });
  try {
    const resolved = guard.resolveProtectedBranch({ cwd: root });
    assert.equal(resolved.branch, "trunk");
    assert.equal(resolved.source, "protection-state");
  } finally {
    cleanup(root);
  }
});

test("an explicit branch argument outranks the recorded state", () => {
  const root = makeSandbox({ protectionState: { defaultBranch: "trunk" } });
  try {
    const resolved = guard.resolveProtectedBranch({ cwd: root, branch: "release" });
    assert.equal(resolved.branch, "release");
    assert.equal(resolved.source, "argument");
  } finally {
    cleanup(root);
  }
});

test("init.defaultBranch never outranks a branch that actually exists", () => {
  // A workstation configured with init.defaultBranch=master and a repository
  // whose default branch is main is common. Trusting the config there would
  // protect a branch that does not exist and leave the real one open.
  const root = makeSandbox({ protectionState: false });
  try {
    gitIn(root, ["-c", "init.defaultBranch=main", "init", "."]);
    gitIn(root, ["config", "user.email", "t@example.invalid"]);
    gitIn(root, ["config", "user.name", "T"]);
    gitIn(root, ["config", "init.defaultBranch", "master"]);
    fs.writeFileSync(path.join(root, "f.txt"), "x\n", "utf8");
    gitIn(root, ["add", "-A"]);
    gitIn(root, ["-c", "commit.gpgsign=false", "commit", "-m", "chore: init"]);

    const resolved = guard.resolveProtectedBranch({ cwd: root });
    assert.equal(resolved.branch, "main");
    assert.equal(resolved.source, "existing-branch");
  } finally {
    cleanup(root);
  }
});

/* ---------------- process level, exit codes git acts on ---------------- */

test("requirement 6, end to end: a deletion record makes the guard exit non-zero", () => {
  const root = makeSandbox();
  try {
    const res = runGuard(root, "(delete) " + ZERO + " refs/heads/main " + OID_A + "\n");
    assert.equal(res.status, 1);
    assert.match(res.stderr, /PUSH REFUSED, branch deletion/);
  } finally {
    cleanup(root);
  }
});

test("requirement 8, end to end: a creation record exits zero", () => {
  const root = makeSandbox();
  try {
    const res = runGuard(root, "refs/heads/main " + OID_A + " refs/heads/main " + ZERO + "\n");
    assert.equal(res.status, 0);
  } finally {
    cleanup(root);
  }
});

test("requirements 5 and 7, end to end against real git objects", () => {
  const root = makeSandbox();
  try {
    gitIn(root, ["-c", "init.defaultBranch=main", "init", "."]);
    gitIn(root, ["config", "user.email", "t@example.invalid"]);
    gitIn(root, ["config", "user.name", "T"]);
    gitIn(root, ["config", "commit.gpgsign", "false"]);

    fs.writeFileSync(path.join(root, "a.txt"), "a\n", "utf8");
    gitIn(root, ["add", "-A"]);
    gitIn(root, ["commit", "-m", "chore: a"]);
    const first = gitIn(root, ["rev-parse", "HEAD"]);

    fs.writeFileSync(path.join(root, "b.txt"), "b\n", "utf8");
    gitIn(root, ["add", "-A"]);
    gitIn(root, ["commit", "-m", "chore: b"]);
    const second = gitIn(root, ["rev-parse", "HEAD"]);

    const forward = runGuard(
      root,
      "refs/heads/main " + second + " refs/heads/main " + first + "\n"
    );
    assert.equal(forward.status, 0, forward.stderr);

    const backward = runGuard(
      root,
      "refs/heads/main " + first + " refs/heads/main " + second + "\n"
    );
    assert.equal(backward.status, 1);
    assert.match(backward.stderr, /non-fast-forward/);
  } finally {
    cleanup(root);
  }
});

test("a malformed record fails closed rather than being skipped", () => {
  const root = makeSandbox();
  try {
    const res = runGuard(root, "refs/heads/main " + OID_A + "\n");
    assert.equal(res.status, 2);
    assert.match(res.stderr, /MALFORMED REF RECORD/);
  } finally {
    cleanup(root);
  }
});

test("the refusal message forbids working around it with --no-verify", () => {
  const root = makeSandbox();
  try {
    const res = runGuard(root, "(delete) " + ZERO + " refs/heads/main " + OID_A + "\n");
    assert.match(res.stderr, /--no-verify is prohibited/);
  } finally {
    cleanup(root);
  }
});
