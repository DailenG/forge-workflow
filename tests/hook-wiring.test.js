"use strict";

/*
 * Hook wiring: the part that is easy to get wrong and silent when you do.
 *
 * lefthook only forwards git's ref-update records to a command that declares
 * use_stdin: true. A guard wired without it sees nothing. This suite proves
 * the shipped template declares it, that the checker catches a template that
 * does not, and that a starved guard fails closed instead of waving pushes
 * through.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const bp = require("../templates/branch-protection.js");
const {
  makeSandbox,
  cleanup,
  guardPath,
  LEFTHOOK_SRC,
  recordingRunner,
  argsAre,
} = require("./helpers/sandbox.js");

const ZERO = "0".repeat(40);
const OID_A = "1111111111111111111111111111111111111111";
const DELETE_RECORD = "(delete) " + ZERO + " refs/heads/main " + OID_A + "\n";

const SHIPPED_LEFTHOOK = fs.readFileSync(LEFTHOOK_SRC, "utf8");

/* ---------------- the shipped template ---------------- */

test("the shipped lefthook template runs the history check first, with use_stdin", () => {
  const wiring = bp.checkLefthookWiring(SHIPPED_LEFTHOOK, "history-guard.js");
  assert.equal(wiring.found, true);
  assert.equal(wiring.useStdin, true, "use_stdin: true is what feeds the guard git's ref records");
  assert.equal(wiring.runsFirst, true, "the history check must precede the expensive quality checks");
  assert.equal(wiring.ok, true);
  assert.equal(wiring.problem, null);
});

test("the quality commands survive alongside the history check", () => {
  const commands = bp.parseLefthookPrePush(SHIPPED_LEFTHOOK);
  const keys = commands.map((c) => c.key);
  assert.equal(keys[0], "00_history");
  for (const expected of ["01_secrets", "02_lint", "03_build", "04_test"]) {
    assert.ok(keys.indexOf(expected) > 0, "expected the " + expected + " command to remain wired");
  }
});

/* ---------------- requirement 10: wiring that cannot deliver input ---------- */

test("requirement 10: a guard wired without use_stdin is reported, not accepted", () => {
  const broken = SHIPPED_LEFTHOOK.replace(/^\s*use_stdin: true\s*$/m, "");
  const wiring = bp.checkLefthookWiring(broken, "history-guard.js");
  assert.equal(wiring.found, true);
  assert.equal(wiring.useStdin, false);
  assert.equal(wiring.ok, false);
  assert.match(wiring.problem, /use_stdin/);
});

test("a history check placed after the quality commands is reported", () => {
  const yaml = [
    "pre-push:",
    "  parallel: false",
    "  commands:",
    "    01_test:",
    "      run: npm test",
    "    02_history:",
    "      use_stdin: true",
    "      run: node .forge/history-guard.js",
  ].join("\n");
  const wiring = bp.checkLefthookWiring(yaml, "history-guard.js");
  assert.equal(wiring.ok, false);
  assert.match(wiring.problem, /must run before the expensive/);
});

test("a lefthook file with no history command at all is reported", () => {
  const yaml = ["pre-push:", "  commands:", "    01_test:", "      run: npm test"].join("\n");
  const wiring = bp.checkLefthookWiring(yaml, "history-guard.js");
  assert.equal(wiring.found, false);
  assert.match(wiring.problem, /no pre-push command runs/);
});

test("a pre-commit block cannot be mistaken for the pre-push block", () => {
  const yaml = [
    "pre-commit:",
    "  commands:",
    "    00_history:",
    "      use_stdin: true",
    "      run: node .forge/history-guard.js",
    "pre-push:",
    "  commands:",
    "    01_test:",
    "      run: npm test",
  ].join("\n");
  assert.equal(bp.checkLefthookWiring(yaml, "history-guard.js").found, false);
});

/* ---------------- requirement 9: stdin propagation ---------------- */

test("requirement 9: a manager that forwards stdin lets the guard see the ref records", () => {
  const root = makeSandbox();
  try {
    // Stands in for lefthook with use_stdin: true. It inherits its own stdin,
    // which is exactly what forwarding the records means.
    fs.writeFileSync(
      path.join(root, "forwarding-manager.js"),
      [
        '"use strict";',
        'const { spawnSync } = require("child_process");',
        "const res = spawnSync(process.execPath, [" +
          JSON.stringify(guardPath(root)) +
          '], { stdio: "inherit" });',
        "process.exit(res.status === null ? 1 : res.status);",
        "",
      ].join("\n"),
      "utf8"
    );

    const res = spawnSync(process.execPath, [path.join(root, "forwarding-manager.js")], {
      cwd: root,
      input: DELETE_RECORD,
      encoding: "utf8",
    });
    assert.equal(res.status, 1, "the guard saw the deletion record and refused");
    assert.match(res.stderr, /PUSH REFUSED, branch deletion/);
  } finally {
    cleanup(root);
  }
});

test("requirement 10: a manager that swallows stdin makes the guard fail closed", () => {
  const root = makeSandbox();
  try {
    // Stands in for lefthook WITHOUT use_stdin: the child gets an empty pipe.
    fs.writeFileSync(
      path.join(root, "swallowing-manager.js"),
      [
        '"use strict";',
        'const { spawnSync } = require("child_process");',
        "const res = spawnSync(process.execPath, [" +
          JSON.stringify(guardPath(root)) +
          '], { input: "", encoding: "utf8" });',
        "process.stderr.write(res.stderr);",
        "process.exit(res.status === null ? 1 : res.status);",
        "",
      ].join("\n"),
      "utf8"
    );

    const res = spawnSync(process.execPath, [path.join(root, "swallowing-manager.js")], {
      cwd: root,
      input: DELETE_RECORD,
      encoding: "utf8",
    });
    assert.equal(res.status, 2, "a guard that cannot see the refs must not report success");
    assert.match(res.stderr, /NO REF UPDATES ON STDIN/);
    assert.match(res.stderr, /use_stdin: true/, "the message must name the actual fix");
  } finally {
    cleanup(root);
  }
});

/* ---------------- installation ---------------- */

function localToolFor(root) {
  const run = recordingRunner([
    { match: argsAre("rev-parse --git-dir"), reply: { status: 0, stdout: ".git\n" } },
  ]);
  return bp.createTool({ cwd: root, run: run });
}

test("with no hook manager present, a plain pre-push hook is written", () => {
  const root = makeSandbox();
  try {
    const result = localToolFor(root).installLocal();
    assert.equal(result.installed, true);
    assert.equal(result.manager, "git");
    const body = fs.readFileSync(path.join(root, ".git", "hooks", "pre-push"), "utf8");
    assert.match(body, /forge managed history-integrity guard/);
    assert.match(body, /history-guard\.js/);
    assert.match(body, /"\$@"/, "the hook must pass git's arguments through");
  } finally {
    cleanup(root);
  }
});

test("an existing hook someone else wrote is never overwritten", () => {
  const root = makeSandbox();
  try {
    const hookDir = path.join(root, ".git", "hooks");
    fs.mkdirSync(hookDir, { recursive: true });
    const existing = "#!/bin/sh\necho someone elses hook\n";
    fs.writeFileSync(path.join(hookDir, "pre-push"), existing, "utf8");

    const result = localToolFor(root).installLocal();
    assert.equal(result.installed, false);
    assert.match(result.problem, /already exists/);
    assert.equal(fs.readFileSync(path.join(hookDir, "pre-push"), "utf8"), existing);
    assert.ok(result.requiredSnippet, "the caller needs the snippet to merge by hand");
  } finally {
    cleanup(root);
  }
});

test("when lefthook manages hooks, the wiring is checked rather than rewritten", () => {
  const root = makeSandbox({ lefthook: true });
  try {
    const before = fs.readFileSync(path.join(root, "lefthook.yml"), "utf8");
    const hookBefore = fs.readFileSync(path.join(root, ".git", "hooks", "pre-push"), "utf8");
    const result = localToolFor(root).installLocal();
    assert.equal(result.manager, "lefthook");
    assert.equal(result.installed, true);
    assert.equal(fs.readFileSync(path.join(root, "lefthook.yml"), "utf8"), before);
    assert.equal(
      fs.readFileSync(path.join(root, ".git", "hooks", "pre-push"), "utf8"),
      hookBefore,
      "the lefthook dispatcher must not be overwritten"
    );
  } finally {
    cleanup(root);
  }
});

test("a correct lefthook.yml that was never installed is not reported as protected", () => {
  // lefthook.yml alone does nothing. Without the dispatcher in .git/hooks,
  // git never invokes lefthook and the guard never runs.
  const root = makeSandbox({ lefthook: true, lefthookInstalled: false });
  try {
    const result = localToolFor(root).installLocal();
    assert.equal(result.installed, false);
    assert.match(result.problem, /lefthook install/);
  } finally {
    cleanup(root);
  }
});

test("a hook written where core.hooksPath does not point is not a live hook", () => {
  const root = makeSandbox();
  try {
    const run = recordingRunner([
      { match: argsAre("config --get core.hooksPath"), reply: { status: 0, stdout: ".githooks\n" } },
      { match: argsAre("rev-parse --git-dir"), reply: { status: 0, stdout: ".git\n" } },
    ]);
    const result = bp.createTool({ cwd: root, run: run }).installLocal();
    assert.equal(result.installed, true);
    assert.equal(
      fs.existsSync(path.join(root, ".githooks", "pre-push")),
      true,
      "the hook must be written where git will actually look for it"
    );
    assert.equal(fs.existsSync(path.join(root, ".git", "hooks", "pre-push")), false);
  } finally {
    cleanup(root);
  }
});

test("verify does not resurrect a hook someone deleted", () => {
  const root = makeSandbox({
    protectionState: {
      defaultBranch: "main",
      tier: "local",
      mechanism: "managed-pre-push-guard",
      protections: ["deletion", "non-fast-forward"],
      verified: true,
      trustBoundary: bp.TRUST_BOUNDARY_LOCAL,
    },
  });
  try {
    const tool = localToolFor(root);
    assert.equal(tool.installLocal().installed, true);

    // The user disables the guard by deleting the hook. verify must notice.
    fs.rmSync(path.join(root, ".git", "hooks", "pre-push"));

    const result = tool.verify();
    assert.equal(result.verified, false, "a verify that reinstalls can never observe a missing hook");
    assert.match(result.reason, /no pre-push hook/);
    assert.equal(fs.existsSync(path.join(root, ".git", "hooks", "pre-push")), false);
    assert.equal(tool.gateStatus().satisfied, false);
  } finally {
    cleanup(root);
  }
});

/* ---------------- lefthook's real execution order ---------------- */

test("execution order follows lefthook's rules, not the order of the file", () => {
  // lefthook sorts by priority, then by the leading number in the command
  // name, then alphabetically. A guard listed first but named 99_ runs last.
  const yaml = [
    "pre-push:",
    "  parallel: false",
    "  piped: true",
    "  commands:",
    "    99_history:",
    "      use_stdin: true",
    "      run: node .forge/history-guard.js",
    "    01_build:",
    "      run: npm run build",
  ].join("\n");
  const wiring = bp.checkLefthookWiring(yaml, "history-guard.js");
  assert.equal(wiring.ok, false, "listed first, but lefthook runs 01_build before it");
  assert.match(wiring.problem, /after 1 other command/);
});

test("a guard listed last but named 00_ is correctly accepted", () => {
  const yaml = [
    "pre-push:",
    "  parallel: false",
    "  piped: true",
    "  commands:",
    "    01_build:",
    "      run: npm run build",
    "    00_history:",
    "      use_stdin: true",
    "      run: node .forge/history-guard.js",
  ].join("\n");
  const wiring = bp.checkLefthookWiring(yaml, "history-guard.js");
  assert.equal(wiring.ok, true, "lefthook orders by name, so 00_history runs first");
});

test("an explicit priority is honoured over the name", () => {
  const yaml = [
    "pre-push:",
    "  parallel: false",
    "  piped: true",
    "  commands:",
    "    00_history:",
    "      use_stdin: true",
    "      run: node .forge/history-guard.js",
    "    01_build:",
    "      priority: 1",
    "      run: npm run build",
  ].join("\n");
  const wiring = bp.checkLefthookWiring(yaml, "history-guard.js");
  assert.equal(wiring.ok, false);
  assert.match(wiring.problem, /after 1 other command/);
});

test("parallel: true makes the ordering guarantee meaningless and is reported", () => {
  const yaml = [
    "pre-push:",
    "  parallel: true",
    "  piped: true",
    "  commands:",
    "    00_history:",
    "      use_stdin: true",
    "      run: node .forge/history-guard.js",
  ].join("\n");
  const wiring = bp.checkLefthookWiring(yaml, "history-guard.js");
  assert.equal(wiring.ok, false);
  assert.match(wiring.problem, /parallel: true/);
});

test("without piped: true the expensive checks still run after a refusal", () => {
  const yaml = [
    "pre-push:",
    "  parallel: false",
    "  commands:",
    "    00_history:",
    "      use_stdin: true",
    "      run: node .forge/history-guard.js",
    "    01_test:",
    "      run: npm test",
  ].join("\n");
  const wiring = bp.checkLefthookWiring(yaml, "history-guard.js");
  assert.equal(wiring.ok, false);
  assert.match(wiring.problem, /piped: true/);
});

test("a nested skip block cannot masquerade as the command's own run", () => {
  const yaml = [
    "pre-push:",
    "  parallel: false",
    "  piped: true",
    "  commands:",
    "    00_history:",
    "      use_stdin: true",
    "      run: node .forge/history-guard.js",
    "      skip:",
    "        - run: git rev-parse --abbrev-ref HEAD | grep wip",
  ].join("\n");
  const wiring = bp.checkLefthookWiring(yaml, "history-guard.js");
  assert.equal(wiring.found, true, "the nested run: must not overwrite the command's own");
  assert.equal(wiring.ok, false, "a conditional guard does not always run");
  assert.match(wiring.problem, /skip or only condition/);
});

test("a broken lefthook wiring blocks installation and hands back the snippet", () => {
  const root = makeSandbox({ lefthook: true });
  try {
    const file = path.join(root, "lefthook.yml");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^\s*use_stdin: true\s*$/m, ""), "utf8");
    const result = localToolFor(root).installLocal();
    assert.equal(result.installed, false);
    assert.match(result.problem, /use_stdin/);
    assert.match(result.requiredSnippet, /use_stdin: true/);
  } finally {
    cleanup(root);
  }
});

test("a missing guard file is a problem, not a silently empty install", () => {
  const root = makeSandbox({ guard: false });
  try {
    const result = localToolFor(root).installLocal();
    assert.equal(result.installed, false);
    assert.match(result.problem, /missing at \.forge\/history-guard\.js/);
  } finally {
    cleanup(root);
  }
});
