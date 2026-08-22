"use strict";

/*
 * The bootstrap gate, the records it reads, and the migration for a project
 * that stalled on a paid-plan ruleset.
 *
 * The gate question is "is default-branch history protection verified", and it
 * has two acceptable answers. What it must never do is accept an unverified
 * claim, or accept local enforcement without its narrower trust boundary
 * written down.
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
  recordingRunner,
  gitContextHandlers,
  json,
  TOOL_SRC,
  REPO_ROOT,
} = require("./helpers/sandbox.js");

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

const FORGE_SPEC = read(path.join("skills", "forge-spec", "SKILL.md"));
const FORGE_CODE = read(path.join("skills", "forge-code", "SKILL.md"));
const FORGE_STANDARDS = read(path.join("skills", "forge-standards", "SKILL.md"));

const PLAN_REFUSAL =
  "gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)";

function planRefusalHandlers() {
  return [
    { match: (bin, args) => bin === "gh" && args[0] === "--version", reply: { status: 0, stdout: "gh 2\n" } },
    {
      match: (bin, args) => bin === "gh" && args.join(" ") === "api repos/acme/widget",
      reply: () =>
        json({
          private: true,
          default_branch: "main",
          owner: { type: "User" },
          permissions: { admin: true },
        }),
    },
    { match: (bin, args) => bin === "gh" && args.join(" ") === "api user", reply: () => json({ plan: { name: "free" } }) },
    {
      match: (bin, args) =>
        bin === "gh" && /repos\/acme\/widget\/rulesets\?includes_parents=false$/.test(args.join(" ")),
      reply: () => json([]),
    },
    {
      match: (bin, args) => bin === "gh" && args.indexOf("--method") !== -1,
      reply: { status: 1, stdout: "", stderr: PLAN_REFUSAL },
    },
  ];
}

function planRefusalTool(root) {
  const run = recordingRunner(gitContextHandlers().concat(planRefusalHandlers()));
  return bp.createTool({ cwd: root, run: run, now: () => "2026-08-02T00:00:00.000Z" });
}

function state(overrides) {
  return Object.assign(
    {
      schema: 1,
      provider: "github",
      defaultBranch: "main",
      protections: ["deletion", "non-fast-forward"],
      tier: "remote",
      mechanism: "github-ruleset",
      verified: true,
      trustBoundary: bp.TRUST_BOUNDARY_REMOTE,
      evidence: [],
    },
    overrides || {}
  );
}

/* ---------------- requirement 12: either tier satisfies the gate ---------- */

test("requirement 12: verified server-side enforcement satisfies the gate", () => {
  const tool = bp.createTool({ cwd: process.cwd() });
  const gate = tool.gateStatus(state());
  assert.equal(gate.satisfied, true);
  assert.equal(gate.tier, "remote");
  assert.match(gate.reason, /server-side enforcement verified/);
});

test("requirement 12: verified local enforcement with a recorded trust boundary also satisfies it", () => {
  const tool = bp.createTool({ cwd: process.cwd() });
  const gate = tool.gateStatus(
    state({
      tier: "local",
      mechanism: "managed-pre-push-guard",
      trustBoundary: bp.TRUST_BOUNDARY_LOCAL,
      fallbackReason: "plan: the host withheld the feature",
    })
  );
  assert.equal(gate.satisfied, true);
  assert.equal(gate.tier, "local");
  assert.match(gate.reason, /trust boundary recorded/);
});

test("an unavailable paid feature is not by itself a failed gate", () => {
  // The whole point: a free-plan refusal must not read as a fatal bootstrap
  // failure when the local fallback is valid and verified.
  const tool = bp.createTool({ cwd: process.cwd() });
  const gate = tool.gateStatus(
    state({
      tier: "local",
      mechanism: "managed-pre-push-guard",
      trustBoundary: bp.TRUST_BOUNDARY_LOCAL,
      fallbackReason: "plan: Upgrade to GitHub Pro",
    })
  );
  assert.equal(gate.satisfied, true);
});

test("local enforcement without its trust boundary recorded does NOT satisfy the gate", () => {
  const tool = bp.createTool({ cwd: process.cwd() });
  const gate = tool.gateStatus(state({ tier: "local", trustBoundary: "" }));
  assert.equal(gate.satisfied, false);
  assert.match(gate.reason, /trust boundary/);
});

test("an unverified claim never satisfies the gate, at either tier", () => {
  const tool = bp.createTool({ cwd: process.cwd() });
  assert.equal(tool.gateStatus(state({ verified: false })).satisfied, false);
  assert.equal(
    tool.gateStatus(state({ tier: "local", trustBoundary: bp.TRUST_BOUNDARY_LOCAL, verified: false })).satisfied,
    false
  );
});

test("protection that misses one of the two required behaviours fails the gate", () => {
  const tool = bp.createTool({ cwd: process.cwd() });
  const gate = tool.gateStatus(state({ protections: ["deletion"] }));
  assert.equal(gate.satisfied, false);
  assert.match(gate.reason, /non-fast-forward/);
});

test("no recorded protection at all fails the gate", () => {
  const tool = bp.createTool({ cwd: process.cwd() });
  const gate = tool.gateStatus(null);
  assert.equal(gate.satisfied, false);
  assert.match(gate.reason, /no protection state recorded/);
});

/* ---------------- requirement 13: state file and environment report ------- */

test("requirement 13: apply writes a state file that records the tier and the evidence", () => {
  const root = makeSandbox();
  try {
    const recorded = planRefusalTool(root).apply();
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, ".forge", "protection.json"), "utf8"));

    assert.deepEqual(onDisk, recorded, "the returned state is the state that was written");
    assert.equal(onDisk.schema, 1);
    assert.equal(onDisk.provider, "github");
    assert.equal(onDisk.repository, "acme/widget");
    assert.equal(onDisk.defaultBranch, "main");
    assert.equal(onDisk.visibility, "private");
    assert.equal(onDisk.visibilityChanged, false);
    assert.equal(onDisk.tier, "local");
    assert.equal(onDisk.mechanism, "managed-pre-push-guard");
    assert.deepEqual(onDisk.protections, ["deletion", "non-fast-forward"]);
    assert.equal(onDisk.verified, true);
    assert.equal(onDisk.trustBoundary, bp.TRUST_BOUNDARY_LOCAL);
    assert.match(onDisk.fallbackReason, /^plan: /);

    // The rejected tier-1 attempt is kept, so the record says what was tried.
    assert.equal(onDisk.attempts[0].tier, "remote");
    assert.equal(onDisk.attempts[0].applied, false);
    assert.equal(onDisk.attempts[0].failure.kind, "plan");

    assert.ok(onDisk.evidence.length >= 8, "the local tier records its proof");
    assert.ok(onDisk.evidence.every((e) => e.pass));
  } finally {
    cleanup(root);
  }
});

test("requirement 13: the environment report states the tier, the boundary, and the evidence", () => {
  const root = makeSandbox();
  try {
    const tool = planRefusalTool(root);
    const recorded = tool.apply();
    const markdown = tool.report(recorded);

    assert.match(markdown, /## Default-branch protection/);
    assert.match(markdown, /\| Tier \| 2, managed local \|/);
    assert.match(markdown, /\| Mechanism \| managed-pre-push-guard \|/);
    assert.match(markdown, /\| Visibility \| private, unchanged by forge \|/);
    assert.match(markdown, /\| Protects against \| deletion, non-fast-forward \|/);
    assert.match(markdown, /\| Gate \| satisfied/);
    assert.match(markdown, /Server-side enforcement was not used: plan:/);
    assert.match(markdown, /Trust boundary: Local enforcement only/);
    assert.match(markdown, /### Verification evidence/);
    assert.match(markdown, /\| protected branch deletion \|/);
    assert.doesNotMatch(markdown, /FAIL/);
  } finally {
    cleanup(root);
  }
});

test("requirement 13: a tier 1 report names server-side enforcement instead", () => {
  const root = makeSandbox();
  try {
    const tool = bp.createTool({ cwd: root });
    const markdown = tool.report(state({ visibility: "public", evidence: [] }));
    assert.match(markdown, /\| Tier \| 1, server side \|/);
    assert.match(markdown, /Trust boundary: Server-side enforcement/);
  } finally {
    cleanup(root);
  }
});

/* ---------------- requirement 14: migrating a blocked project ------------- */

const BLOCKED_CONTINUE = [
  "# Continue Here",
  "",
  "Phase: 2",
  "Gate:  IN_PROGRESS",
  "Mode:  FLOW",
  "",
  "## Blocked on me",
  "",
  "- GitHub refused the ruleset on main: private repository rulesets require a paid plan (Upgrade to GitHub Pro).",
  "- Need the staging database credentials before slice 4 can be built.",
  "- Waiting on a decision about whether to support Windows 10.",
  "",
  "## Notes for the next session",
  "",
  "- The ruleset attempt is recorded in docs/DECISIONS.md.",
].join("\n");

test("requirement 14: only the ruleset blocker is classified for clearing", () => {
  const tool = bp.createTool({ cwd: process.cwd() });
  const blockers = tool.classifyBlockers(BLOCKED_CONTINUE);
  assert.equal(blockers.clear.length, 1);
  assert.match(blockers.clear[0], /ruleset/);
  assert.equal(blockers.preserve.length, 2);
  assert.match(blockers.preserve[0], /staging database credentials/);
  assert.match(blockers.preserve[1], /Windows 10/);
});

test("a blocker that merely mentions a plan is preserved, not cleared", () => {
  const tool = bp.createTool({ cwd: process.cwd() });
  const blockers = tool.classifyBlockers(
    ["## Blocked on me", "", "- The client has to upgrade their plan before SSO can be enabled."].join("\n")
  );
  assert.deepEqual(blockers.clear, []);
  assert.equal(blockers.preserve.length, 1);
});

test("blockers outside the Blocked on me section are not touched", () => {
  const tool = bp.createTool({ cwd: process.cwd() });
  const blockers = tool.classifyBlockers(
    [
      "## Notes for the next session",
      "",
      "- The ruleset needs a paid plan, which is why we stopped.",
    ].join("\n")
  );
  assert.deepEqual(blockers, { clear: [], preserve: [] });
});

test("requirement 14: a project blocked on a paid ruleset resumes on the local tier", () => {
  const root = makeSandbox({
    protectionState: false,
    files: { "CONTINUE.md": BLOCKED_CONTINUE },
  });
  try {
    const result = planRefusalTool(root).migrate();

    assert.equal(result.previousTier, null, "this project predates the protection state file");
    assert.equal(result.state.tier, "local");
    assert.equal(result.state.verified, true);
    assert.equal(result.state.visibility, "private", "visibility is preserved through migration");
    assert.equal(result.state.visibilityChanged, false);
    assert.equal(result.gate.satisfied, true);

    assert.equal(result.blockers.clear.length, 1);
    assert.equal(result.blockers.preserve.length, 2);
    assert.deepEqual(result.recordUpdates.continueMd.clear, result.blockers.clear);
    assert.deepEqual(result.recordUpdates.continueMd.preserve, result.blockers.preserve);
    assert.match(result.recordUpdates.continueMd.note, /narrower trust boundary/);

    assert.match(result.recordUpdates.decisionsMd, /managed local enforcement/);
    assert.match(result.recordUpdates.decisionsMd, /was not changed/);
    assert.match(result.recordUpdates.decisionsMd, /Trust boundary:/);
    assert.match(result.recordUpdates.environmentMd, /## Default-branch protection/);

    assert.match(result.resumeAt, /satisfied/);

    // Migration touches the file it owns and no lifecycle file.
    assert.equal(fs.readFileSync(path.join(root, "CONTINUE.md"), "utf8"), BLOCKED_CONTINUE);
    assert.ok(fs.existsSync(path.join(root, ".forge", "protection.json")));
  } finally {
    cleanup(root);
  }
});

test("requirement 14: a project that previously recorded a failed remote attempt migrates too", () => {
  const root = makeSandbox({
    protectionState: {
      tier: "remote",
      mechanism: "github-ruleset",
      verified: false,
      problem: "ruleset creation refused: Upgrade to GitHub Pro",
    },
    files: { "CONTINUE.md": BLOCKED_CONTINUE },
  });
  try {
    const result = planRefusalTool(root).migrate();
    assert.equal(result.previousTier, "remote");
    assert.equal(result.state.tier, "local");
    assert.equal(result.gate.satisfied, true);
    assert.equal(result.state.problem, undefined, "the stale failure must not survive the migration");
  } finally {
    cleanup(root);
  }
});

/* ---------------- the gate as a command ---------------- */

test("the gate subcommand exits zero only when the gate is satisfied", () => {
  const satisfied = makeSandbox({
    protectionState: {
      tier: "local",
      mechanism: "managed-pre-push-guard",
      protections: ["deletion", "non-fast-forward"],
      verified: true,
      trustBoundary: bp.TRUST_BOUNDARY_LOCAL,
    },
  });
  const unsatisfied = makeSandbox({
    protectionState: {
      tier: "local",
      protections: ["deletion", "non-fast-forward"],
      verified: false,
    },
  });
  try {
    const good = spawnSync(process.execPath, [TOOL_SRC, "gate"], { cwd: satisfied, encoding: "utf8" });
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /GATE SATISFIED/);

    const bad = spawnSync(process.execPath, [TOOL_SRC, "gate"], { cwd: unsatisfied, encoding: "utf8" });
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /GATE NOT SATISFIED/);
  } finally {
    cleanup(satisfied);
    cleanup(unsatisfied);
  }
});

/* ---------------- issue #1: the packaging advisory and the release artifact ---------------- */

/*
 * Phase 1 recorded a distribution story that nothing downstream read, so no
 * artifact was ever produced. The advisory now records a concrete mechanism,
 * and the Phase 3 release order consumes it.
 */

function releaseSteps() {
  const after = FORGE_CODE.split("The execution order in this phase:")[1].replace(/\r\n/g, "\n");
  return after
    .split("\n\n")[1]
    .split("\n")
    .map((line) => {
      const m = /^(\d+)\.\s+(.*)$/.exec(line);
      assert.ok(m, "unparsed release-order line: " + line);
      return { n: Number(m[1]), text: m[2] };
    });
}

function artifactStep() {
  const steps = releaseSteps();
  const step = steps.filter((s) => /gh release upload/.test(s.text));
  assert.equal(step.length, 1, "exactly one step attaches the artifact");
  return step[0].text;
}

test("issue 1: Phase 1 recommends a mechanism and records it where Phase 3 reads it", () => {
  assert.match(FORGE_SPEC, /## Packaging and distribution, in detail/);
  assert.match(FORGE_SPEC, /record the chosen mechanism in the SRS/i);
  assert.match(
    FORGE_SPEC,
    /Deployment, distribution, update mechanism.*packaging mechanism chosen/,
    "the SRS outline must carry the decision, not just the discussion"
  );
  assert.match(FORGE_SPEC, /an unrecorded answer produces no artifact/i);
});

test("issue 1: the easiest-means tier is named, with the default and the non-default marked", () => {
  assert.match(FORGE_SPEC, /versioned zip or tarball of the build output/i);
  assert.match(FORGE_SPEC, /The default\./);
  assert.match(FORGE_SPEC, /7-Zip self-extracting exe/);
  assert.match(FORGE_SPEC, /MSI built with WiX/);
  assert.match(FORGE_SPEC, /not the easy default/, "the MSI must not read as the recommendation");
  assert.match(FORGE_SPEC, /single binary attached to the GitHub Release is the default/);
  assert.match(FORGE_SPEC, /npm, PyPI, crates\.io/, "the registry option is named but handed over");
});

test("issue 1: the heavy and the ill-fitting cases are handed to the user by name", () => {
  assert.match(FORGE_SPEC, /Signing, notarization, app store submission, and auto-update are user-owned/);
  assert.match(FORGE_SPEC, /"Not applicable, hosted service" is a complete and valid recorded answer/);
  assert.match(FORGE_SPEC, /Packaging there means deployment, which forge does not own/);
  assert.match(FORGE_SPEC, /a Windows artifact helps Windows users only/);
  assert.match(FORGE_SPEC, /user-guided/, "mac and Linux formats stay with the user");
});

test("issue 1: no packaging mechanism adds an always-on dependency", () => {
  assert.match(FORGE_SPEC, /zip or tarball path uses tooling already present/);
  assert.match(FORGE_SPEC, /provisioned in Phase 2 only when that mechanism is the one chosen/);
});

test("issue 1: the Phase 3 release order builds, smoke tests, and attaches the artifact", () => {
  const steps = releaseSteps();
  assert.deepEqual(
    steps.map((s) => s.n),
    steps.map((_, i) => i + 1),
    "the list is numbered 1..n with no repeat or gap"
  );

  const at = (re) => steps.findIndex((s) => re.test(s.text));
  const tag = at(/annotated tag/);
  const publish = at(/Publish a GitHub Release/);
  const artifact = at(/gh release upload/);
  assert.ok(tag !== -1 && publish !== -1, "the tag and release steps still exist");
  assert.ok(artifact > tag, "nothing is packaged before the tag it belongs to");
  assert.ok(artifact > publish, "an asset cannot be attached to a release that does not exist yet");

  const step = steps[artifact].text;
  assert.match(step, /Build the artifact the SRS distribution section names/);
  assert.match(step, /smoke test it on a clean target/);
  assert.match(step, /not the build tree/, "smoke testing in the build tree proves nothing");
});

test("issue 1: an exe or MSI is never shipped without the unsigned warning", () => {
  const step = artifactStep();
  assert.match(step, /unsigned/);
  assert.match(step, /SmartScreen/);
  assert.match(step, /Gatekeeper/);
  assert.match(step, /never do any of them silently/);
});

test("issue 1: a project with no artifact says why and attaches nothing", () => {
  const step = artifactStep();
  assert.match(step, /not applicable, hosted service/);
  assert.match(step, /attach nothing/);
  assert.match(step, /say that in one line in the release notes/);
});

test("issue 1: the standards release checklist agrees with the phase", () => {
  const releases = FORGE_STANDARDS.replace(/\r\n/g, "\n").split("\n## Releases\n")[1].split("\n## ")[0];
  assert.match(releases, /At each release:/);
  assert.match(releases, /artifact the SRS distribution section names/);
  assert.match(releases, /smoke-tested on a clean target/);
  assert.match(releases, /attached to that release/);
  assert.match(releases, /why none applies/);
  assert.match(releases, /unsigned-binary warning/);
});
