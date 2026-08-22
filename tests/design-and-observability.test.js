"use strict";

/*
 * The design, UX, and observability contract.
 *
 * These are prompt files, so what is testable is structural: the discipline
 * exists as a skill, every phase carries its duty, and the two rules that stop
 * experience work from evaporating (a disposition for every observation, a
 * polish pass before a release) are stated where the model will read them.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { REPO_ROOT } = require("./helpers/sandbox.js");

function skill(name) {
  return fs.readFileSync(path.join(REPO_ROOT, "skills", name, "SKILL.md"), "utf8");
}

function template(name) {
  return fs.readFileSync(path.join(REPO_ROOT, "templates", name), "utf8");
}

const DESIGN = skill("forge-design");
const SPEC = skill("forge-spec");
const ENV = skill("forge-env");
const CODE = skill("forge-code");
const STANDARDS = skill("forge-standards");
const FORGE = skill("forge");

/* ---------------- the discipline exists and is reachable ---------------- */

test("forge-design ships as a skill with a description that can load it", () => {
  assert.match(DESIGN, /^---\nname: forge-design\n/);
  const front = DESIGN.split("---")[1];
  assert.match(front, /description:/);
  assert.doesNotMatch(
    front,
    /disable-model-invocation:\s*true/,
    "design work has to be reachable without an explicit command, unlike a phase"
  );
});

test("the orchestrator names forge-design as cross-cutting rather than a phase", () => {
  assert.match(FORGE, /`forge-design`/);
  assert.match(FORGE, /docs\/DESIGN\.md/);
});

test("every tier has a polish checklist, so no surface class is exempt", () => {
  for (const tier of ["GUI", "CLI/TUI", "API", "Service"]) {
    assert.ok(DESIGN.includes(tier), "missing design tier: " + tier);
  }
  const polish = DESIGN.slice(DESIGN.indexOf("## The polish pass"));
  for (const tier of ["**GUI**", "**CLI/TUI**", "**API**", "**Service**"]) {
    assert.ok(polish.includes(tier), "polish pass has no checklist for " + tier);
  }
});

/* ---------------- observations cannot be dismissed ---------------- */

test("the design pass offers exactly two dispositions and refuses subjectivity as one", () => {
  assert.match(DESIGN, /two dispositions/);
  assert.match(DESIGN, /UXD-nnn/);
  assert.match(DESIGN, /subjective is not a disposition/i);
});

test("the always-loaded standards carry the disposition rule, not only forge-design", () => {
  assert.match(STANDARDS, /## Design and UX/);
  assert.match(STANDARDS, /disposition/i);
  assert.match(STANDARDS, /UXD-nnn/);
});

test("a slice cannot close over an unlooked-at surface or an open blocker", () => {
  const close = CODE.slice(CODE.indexOf("### 4. Close the slice"), CODE.indexOf("### 5. Report"));
  assert.match(close, /looked at every surface it changed/);
  assert.match(close, /UXD-nnn/);
  assert.match(close, /blocks/);
});

test("the UX debt register has a home in the shipped TODO template", () => {
  const todo = template("TODO.md");
  assert.match(todo, /## UX Debt/);
  assert.match(todo, /UXD-001/);
  assert.match(todo, /blocks[\s\S]*degrades[\s\S]*finish/);
});

/* ---------------- design is specified, not improvised ---------------- */

test("experience design is a gating coverage area in Phase 1", () => {
  const critical = SPEC.slice(
    SPEC.indexOf("### Critical (these gate the overall score)"),
    SPEC.indexOf("### Important (report but do not gate)")
  );
  assert.match(critical, /Experience and interaction design/);
  assert.match(critical, /quality bar/);
  assert.match(critical, /[Aa]ccessibility/);
});

test("Phase 1 writes the design brief and numbers UX requirements", () => {
  assert.match(SPEC, /docs\/DESIGN\.md/);
  assert.match(SPEC, /UX-001/);
  assert.match(SPEC, /templates\/DESIGN\.md/);
  const protect = SPEC.slice(SPEC.indexOf("## Protect the work before stopping"));
  assert.match(protect, /docs\/DESIGN\.md/, "the brief is part of the Phase 1 safety net commit");
});

test("the design brief template carries the decisions and the polish log", () => {
  const brief = template("DESIGN.md");
  for (const heading of [
    "## Surface inventory",
    "## Primary tasks",
    "## Design language",
    "## Copy and tone",
    "## UX requirements",
    "## Polish log",
  ]) {
    assert.ok(brief.includes(heading), "design brief template is missing " + heading);
  }
});

test("UX requirements are traced like functional ones", () => {
  const trace = template("traceability.md");
  assert.match(trace, /UX-001/);
  assert.match(trace, /interaction test/);
  assert.match(DESIGN, /docs\/traceability\.md/);
});

test("Phase 2 installs what the verification methods need", () => {
  assert.match(ENV, /## Step 11a: Surface verification and observability tooling/);
  assert.match(ENV, /accessibility scanner/i);
  assert.match(ENV, /UX-nnn/);
  const gate = ENV.slice(ENV.indexOf("## Gate"));
  assert.match(gate, /UX-nnn/, "the Phase 2 gate has to account for the verification tooling");
});

test("the Phase 2 gate lists agree between the orchestrator and the phase", () => {
  const forgeGate = FORGE.slice(FORGE.indexOf("The Phase 2 gate (row 4)"));
  assert.match(forgeGate, /UX-nnn/);
});

/* ---------------- polish is a release gate ---------------- */

test("the ladder has a polish rung before release ready", () => {
  const ladder = FORGE.slice(FORGE.indexOf("| # | Condition | Phase | Action |"));
  assert.match(ladder, /\| 8 \|[^|]*polish pass not run[^|]*\| Polish due \|/);
  assert.match(ladder, /\| 9 \|[^|]*polish pass done[^|]*\| Release ready \|/);
  assert.match(ladder, /\| 11 \| All requirements closed and released \|/);
});

test("the release checklist and the phase 3 order both run the polish pass", () => {
  const releases = STANDARDS.slice(STANDARDS.indexOf("## Releases"));
  assert.match(releases, /polish pass/);
  assert.match(releases, /polish log/);
  assert.match(releases, /UX-nnn/);

  const codeReleases = CODE.slice(CODE.indexOf("## Releases"), CODE.indexOf("## Documentation duties"));
  assert.match(codeReleases, /polish pass/);
  assert.match(codeReleases, /docs\/DESIGN\.md/);
});

test("slipping a polish finding is an always-strict gate in both places that list them", () => {
  for (const [name, text] of [["forge-standards", STANDARDS], ["forge", FORGE]]) {
    const gates = text.slice(text.indexOf("- SRS approval"), text.indexOf("- Any discrepancy"));
    assert.match(gates, /polish/i, name + " must list the polish slip as always-strict");
  }
});

/*
 * Regression, issue #4: the write side of the slip rule existed and nothing ever
 * read it back, so findings anchored to a version that shipped without them
 * stopped gating anything while still reading as open work.
 */
test("a slipped finding is recorded where it can be read back", () => {
  const todo = template("TODO.md");
  assert.match(todo, /\| Slip target \|/, "the UX debt register needs a slip target column");
  assert.match(todo, /Slip target is the version[\s\S]*read again/);

  const designUx = STANDARDS.slice(STANDARDS.indexOf("## Design and UX"), STANDARDS.indexOf("## Observability"));
  assert.match(designUx, /Slip target/);
  assert.match(designUx, /live anchor/);
});

test("a tag cannot pass over debt whose slip target is at or below it", () => {
  const releases = STANDARDS.slice(STANDARDS.indexOf("## Releases"));
  assert.match(releases, /slip target is at or below this version/);
  assert.match(releases, /re-anchored forward/);

  const codeReleases = CODE.slice(CODE.indexOf("## Releases"), CODE.indexOf("## Documentation duties"));
  assert.match(codeReleases, /slip target is at or below this version/);

  const polish = DESIGN.slice(DESIGN.indexOf("## The polish pass"));
  assert.match(polish, /at or below the version about to be tagged/);
});

test("overriding a proposed version sweeps the version being skipped", () => {
  const releases = STANDARDS.slice(STANDARDS.indexOf("## Releases"));
  assert.match(releases, /override of a proposed version/i);
  assert.match(releases, /skipped version never arrives/i);
});

test("an item anchored to an already published version is a Step 2 discrepancy", () => {
  const step2 = FORGE.slice(FORGE.indexOf("## Step 2: Reconcile"), FORGE.indexOf("## Step 2a"));
  assert.match(step2, /slip target[\s\S]*already been published/);
  assert.match(step2, /is a discrepancy/);
  assert.match(step2, /Re-anchor it to the next real target, or close it/);
});

test("a defect in the workflow itself is filed upstream, not patched locally", () => {
  assert.match(STANDARDS, /## Defects in the workflow itself/);
  const upstream = STANDARDS.slice(STANDARDS.indexOf("## Defects in the workflow itself"), STANDARDS.indexOf("## Modifying files"));
  assert.match(upstream, /filed upstream/);
  assert.match(upstream, /does not survive an update/);
});

/* ---------------- observability is decided, not invented ---------------- */

test("Phase 1 extracts the observability decisions, including a null answer", () => {
  const section = SPEC.slice(
    SPEC.indexOf("## Observability, in detail"),
    SPEC.indexOf("## Platform and language selection")
  );
  assert.ok(section.length > 200, "the observability section has to say more than a heading");
  for (const topic of [/destination/i, /[Ll]evels/, /never logged/i, /[Tt]elemetry/, /[Aa]udit trail/]) {
    assert.match(section, topic);
  }
  assert.match(section, /Unrecorded is the only wrong answer/);
});

test("the SRS deliverable has an observability section and UX requirements", () => {
  const deliverable = SPEC.slice(SPEC.indexOf("## Deliverable"), SPEC.indexOf("## Confirm the hooks can run"));
  assert.match(deliverable, /Observability, logging, and telemetry/);
  assert.match(deliverable, /UX-001/);
});

test("the standards own the logging rules once, and the secrets section defers to them", () => {
  const observability = STANDARDS.slice(
    STANDARDS.indexOf("## Observability"),
    STANDARDS.indexOf("## Git lifecycle")
  );
  assert.match(observability, /Redact at the logging boundary/);
  assert.match(observability, /opt in/);
  assert.match(observability, /ERROR/);

  const secrets = STANDARDS.slice(
    STANDARDS.indexOf("## Secrets and safety"),
    STANDARDS.indexOf("## Dependencies and tool substitution")
  );
  assert.doesNotMatch(
    secrets,
    /Redact at the logging boundary/,
    "the redaction rule belongs to the observability section only"
  );
});

test("Phase 2 provisions the logging layer and Phase 3 reads its output", () => {
  const step = ENV.slice(
    ENV.indexOf("## Step 11a: Surface verification and observability tooling"),
    ENV.indexOf("## Step 12: CI")
  );
  assert.match(step, /logging library/);
  assert.match(step, /Do not install a metrics stack/);

  assert.match(CODE, /read the log output/i);
  const close = CODE.slice(CODE.indexOf("### 4. Close the slice"), CODE.indexOf("### 5. Report"));
  assert.match(close, /log/i);
});

/* ---------------- projects that predate the discipline ---------------- */

test("a missing capability routes to a backfill offer, not the discrepancy stop", () => {
  const step = FORGE.slice(FORGE.indexOf("## Step 2a: Capability backfill"), FORGE.indexOf("## Step 3: Detection ladder"));
  assert.ok(step.length > 400, "the backfill step has to carry the actual mechanism");
  assert.match(
    step,
    /not a record-versus-reality discrepancy/i,
    "an old project must not trip the Step 2 stop"
  );
  for (const missing of [
    /docs\/DESIGN\.md/,
    /UX Debt section/,
    /[Oo]bservability/,
    /Step 11a/,
  ]) {
    assert.match(step, missing);
  }
});

test("the backfill offer has three answers and marks skip as not recommended", () => {
  const step = FORGE.slice(FORGE.indexOf("## Step 2a: Capability backfill"), FORGE.indexOf("## Step 3: Detection ladder"));
  assert.match(step, /Backfill now/);
  assert.match(step, /Backfill as its own slice/);
  assert.match(step, /Skip for this project\.\*\* Not recommended/);
  assert.match(step, /Capabilities:/);
  assert.match(step, /do not ask again|you do not ask again/i);
  assert.match(step, /no recorded answer is unasked, not skipped/);
});

test("a recorded skip makes the capability inert everywhere it would otherwise gate", () => {
  assert.match(FORGE, /Row 8 does not match at all when `CONTINUE\.md` records the design capability as skipped/);
  assert.match(CODE, /recorded as skipped in the `Capabilities:` line/);
  assert.match(STANDARDS, /recorded skip makes that capability's rules inert/);
});

test("the CONTINUE template carries the capability record the mechanism depends on", () => {
  const cont = template("CONTINUE.md");
  assert.match(cont, /^Capabilities: /m);
  assert.match(cont, /backfilled/);
  assert.match(cont, /skipped/);
});

test("forge-design says how to retrofit without restaging Phase 1", () => {
  const retro = DESIGN.slice(
    DESIGN.indexOf("## Retrofitting a project already under way"),
    DESIGN.indexOf("## Verification is looking")
  );
  assert.ok(retro.length > 400, "the retrofit recipe has to be actionable");
  assert.match(retro, /Do not restage Phase 1/i);
  assert.match(retro, /design pass per shipping surface/i);
  assert.match(retro, /amendment/i, "adding UX requirements to the SRS is still a gate");
});

/* ---------------- external design tools stay optional ---------------- */

test("the external tool options are named, with what each contributes", () => {
  const section = DESIGN.slice(
    DESIGN.indexOf("## External design tools"),
    DESIGN.indexOf("## Duty by phase")
  );
  for (const tool of [
    /Claude Design/,
    /claude\.com\/product\/design/,
    /frontend-design/,
    /figma/,
    /chrome-devtools-mcp/,
    /playwright/,
  ]) {
    assert.match(section, tool);
  }
  assert.match(section, /handoff bundle/);
});

test("no external design tool may become a prerequisite", () => {
  const section = DESIGN.slice(
    DESIGN.indexOf("## External design tools"),
    DESIGN.indexOf("## Duty by phase")
  );
  assert.match(section, /None of them is a prerequisite/);
  assert.match(section, /The brief is authoritative, not the tool/);
  assert.match(section, /prototype is not a requirement/i);
  assert.match(ENV, /Nothing in the build, the docs, or the tests may require any of them/);
});

test("the install path is offered rather than assumed, and a declined answer is recorded", () => {
  const step = ENV.slice(
    ENV.indexOf("### Optional integrations, offered rather than assumed"),
    ENV.indexOf("## Step 12: CI")
  );
  assert.match(step, /claude plugin install frontend-design@claude-plugins-official/);
  assert.match(step, /take "none" as an answer/);
  assert.match(step, /declined/);
  assert.match(SPEC, /Claude Design/, "Phase 1 raises the options while the design language is open");
});

test("uploading repository contents to a hosted service is an always-strict gate", () => {
  for (const [name, text] of [["forge-standards", STANDARDS], ["forge", FORGE]]) {
    const gates = text.slice(text.indexOf("- SRS approval"), text.indexOf("- Any discrepancy"));
    assert.match(gates, /[Uu]ploading/, name + " must gate disclosure to an external service");
  }
  const section = DESIGN.slice(DESIGN.indexOf("## External design tools"), DESIGN.indexOf("## Duty by phase"));
  assert.match(section, /Ask before the first upload/);
  assert.match(section, /research preview/, "Claude Design access is confirmed, not assumed");
});
