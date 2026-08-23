"use strict";

/*
 * The SessionStart hook injects CONTINUE.md, so the file's size is a cost every
 * session in the project pays before any work starts. A real project grew that
 * file to 118KB, roughly 30k tokens per session, of which better than a third
 * was narrative about already-closed slices.
 *
 * A budget alone is not enough: cutting from the top only reaches the live state
 * if the live state is at the top, and on that project the opening section was
 * 44KB of accreted prose. So the hook selects rather than truncates. These tests
 * pin both halves: what always arrives, and what is never injected however much
 * budget is left over.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const bp = require("../templates/branch-protection.js");
const { REPO_ROOT } = require("./helpers/sandbox.js");

const HOOK = path.join(REPO_ROOT, "scripts", "session-start.js");
const BUDGET = 20000;

function sessionStart(root) {
  const res = spawnSync(process.execPath, [HOOK], {
    cwd: root,
    encoding: "utf8",
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root }),
  });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  return res.stdout;
}

function projectWithContinue(body) {
  const root = bp.createDisposableRoot();
  fs.writeFileSync(path.join(root, "CONTINUE.md"), body, "utf8");
  return root;
}

function injectedBody(output) {
  const open = "--- CONTINUE.md ---";
  const start = output.indexOf(open);
  const end = output.indexOf("--- end CONTINUE.md ---");
  assert.ok(start !== -1 && end > start, "the hook must delimit what it injected");
  return output.slice(start + open.length, end);
}

/*
 * Shaped like the file that motivated the cap: a live state header buried under
 * a preamble larger than the whole budget, the next action and the blocker far
 * below it, and section after section of closed-slice narrative after that.
 */
function buriedContinue() {
  const head = ["# Continue Here", "", "Phase: 3", "Gate:  PASSED", "Mode:  FLOW"];
  const wrapped = [
    "Capabilities: design=backfilled 2026-01-31, and this value wraps onto a",
    "second line the way a real one does, which must travel with its field.",
  ];
  const preamble = [];
  for (let i = 0; i < 30; i += 1) {
    preamble.push("Accreted framing paragraph " + i + ". " + "y".repeat(900));
    preamble.push("");
  }
  const live = [
    "## Next action",
    "",
    "Add the refresh branch to AuthClient.refresh in src/auth/client.ts.",
    "",
    "## Blocked on me",
    "",
    "Whether the updater ships in 1.0. Needs your answer.",
    "",
  ];
  const history = [];
  for (let i = 0; i < 20; i += 1) {
    history.push("## What T-" + (100 + i) + " shipped, in case something needs picking apart");
    history.push("");
    history.push("z".repeat(400));
    history.push("");
  }
  return head.concat(wrapped, [""], preamble, live, history).join("\n");
}

test("a CONTINUE.md within budget is injected whole", () => {
  const body = [
    "# Continue Here",
    "",
    "Phase: 3",
    "Gate:  PASSED",
    "Mode:  FLOW",
    "",
    "## Next action",
    "",
    "Add the refresh branch to AuthClient.refresh.",
  ].join("\n");
  const root = projectWithContinue(body);
  try {
    const out = sessionStart(root);
    assert.ok(body.length < BUDGET, "fixture must sit under the budget");
    assert.equal(injectedBody(out).trim(), body.trim());
    assert.doesNotMatch(out, /over the \d+ character budget/, "nothing was withheld to report");
  } finally {
    bp.removeDisposable(root);
  }
});

test("an oversized CONTINUE.md is held to the budget", () => {
  const body = buriedContinue();
  const root = projectWithContinue(body);
  try {
    assert.ok(body.length > BUDGET * 1.5, "fixture must exceed the budget by a clear margin");
    const out = sessionStart(root);
    const injected = injectedBody(out);
    assert.ok(
      injected.length <= BUDGET + 64,
      "injected " + injected.length + " characters against a budget of " + BUDGET
    );
  } finally {
    bp.removeDisposable(root);
  }
});

test("the live state arrives even when it is buried below the budget's worth of prose", () => {
  // The failure this exists to catch: a positional cut spends the whole budget
  // on the preamble and the session never sees what it is supposed to do.
  const root = projectWithContinue(buriedContinue());
  try {
    const out = sessionStart(root);
    const injected = injectedBody(out);

    assert.match(injected, /Phase: 3/);
    assert.match(injected, /Gate: {2}PASSED/);
    assert.match(injected, /Mode: {2}FLOW/);
    assert.match(injected, /## Next action/);
    assert.match(injected, /AuthClient\.refresh/);
    assert.match(injected, /## Blocked on me/);
    assert.match(injected, /Needs your answer/);
  } finally {
    bp.removeDisposable(root);
  }
});

test("a wrapped state field keeps its continuation lines", () => {
  const root = projectWithContinue(buriedContinue());
  try {
    const injected = injectedBody(sessionStart(root));
    assert.match(injected, /Capabilities: design=backfilled/);
    assert.match(
      injected,
      /must travel with its field/,
      "a clipped field value is worse than none: it reads as complete"
    );
  } finally {
    bp.removeDisposable(root);
  }
});

test("closed-slice narrative is never injected, however much budget is left", () => {
  // Greedy filling of the remainder is what made the file expensive in the first
  // place. Leftover budget is not a resource to spend on history.
  const root = projectWithContinue(buriedContinue());
  try {
    const injected = injectedBody(sessionStart(root));
    assert.doesNotMatch(injected, /shipped, in case something needs picking apart/);
    assert.doesNotMatch(injected, /Accreted framing paragraph/);
  } finally {
    bp.removeDisposable(root);
  }
});

test("what was withheld is named with its size, so it can be read on purpose", () => {
  const body = buriedContinue();
  const root = projectWithContinue(body);
  try {
    const out = sessionStart(root);
    assert.match(out, new RegExp("CONTINUE\\.md is " + body.trim().length + " characters"));
    assert.match(out, new RegExp("over the " + BUDGET + " character budget"));
    assert.match(out, /Withheld, readable on purpose/);
    assert.match(out, /the preamble beyond its state fields \(\d+ chars\)/);
    assert.match(out, /What T-1\d\d shipped[^(]*\(\d+ chars\)/);
    assert.match(out, /and \d+ more/, "the withheld list is capped, and says so");
    assert.match(out, /not the history of closed work/);
  } finally {
    bp.removeDisposable(root);
  }
});

test("a record whose sections are named something else still says something", () => {
  // Selection must degrade to the file's opening rather than to state fields
  // alone, or a project that renamed its sections gets nothing useful.
  const body = [
    "# Continue Here",
    "",
    "Phase: 3",
    "",
    "## Situation report",
    "",
    "x".repeat(30000),
  ].join("\n");
  const root = projectWithContinue(body);
  try {
    const out = sessionStart(root);
    const injected = injectedBody(out);
    assert.match(injected, /Phase: 3/);
    assert.ok(injected.length <= BUDGET + 64, "the fallback still respects the budget");
    assert.match(out, /Situation report \(\d+ chars\)/, "the unrecognized section is named");
  } finally {
    bp.removeDisposable(root);
  }
});

test("the always-loaded standards carry the ceiling, not only the hook", () => {
  const standards = fs.readFileSync(
    path.join(REPO_ROOT, "skills", "forge-standards", "SKILL.md"),
    "utf8"
  );

  assert.match(standards, /## Record hygiene/, "the rule needs a home a reader can find");
  assert.match(standards, /200 lines/, "a ceiling with no number is not a ceiling");
  assert.match(standards, /One fact, one owner/, "duplication is the maintenance cost, not size");
  assert.match(
    standards,
    /superseding/,
    "layering corrections is what let a record assert two answers at once"
  );
  assert.match(standards, /DONE-ARCHIVE\.md/, "the archive threshold must be a rule, not a hint");
});

test("the ceiling and the injection budget agree", () => {
  // A file honouring the stated ceiling must never be capped, or the guidance
  // and the hook are telling a project two different things.
  const hook = fs.readFileSync(HOOK, "utf8");
  const found = hook.match(/CONTINUE_BUDGET_CHARS = (\d+)/);
  assert.ok(found, "the budget must be a named constant");
  const budget = Number(found[1]);
  const standards = fs.readFileSync(
    path.join(REPO_ROOT, "skills", "forge-standards", "SKILL.md"),
    "utf8"
  );
  const ceiling = Number(standards.match(/Ceiling: (\d+) lines/)[1]);

  // 100 characters per line is generous for a state-and-next-action file.
  assert.ok(
    ceiling * 100 <= budget,
    "a " + ceiling + " line file can exceed the " + budget + " character budget"
  );
});

test("the shipped templates state the ceiling and the archive threshold", () => {
  const continueTemplate = fs.readFileSync(
    path.join(REPO_ROOT, "templates", "CONTINUE.md"),
    "utf8"
  );
  const todoTemplate = fs.readFileSync(path.join(REPO_ROOT, "templates", "TODO.md"), "utf8");

  assert.match(continueTemplate, /200 lines/);
  assert.match(continueTemplate, /injected at every session start/);
  assert.match(todoTemplate, /DONE-ARCHIVE\.md once this passes 50/);
  assert.match(todoTemplate, /evict a CLOSED task/);
});

test("the read lists are scoped, so a mature project's records stay readable", () => {
  const code = fs.readFileSync(path.join(REPO_ROOT, "skills", "forge-code", "SKILL.md"), "utf8");
  const orchestrator = fs.readFileSync(path.join(REPO_ROOT, "skills", "forge", "SKILL.md"), "utf8");

  assert.match(code, /Skip Completed/, "the largest section of a mature TODO.md is closed work");
  assert.match(code, /Grep by ID rather than reading front to back/);
  assert.match(code, /outgrow a context window/);
  assert.match(orchestrator, /Skip Completed/);
  assert.match(orchestrator, /name what you skipped/, "a partial read must be declared as one");
  assert.match(orchestrator, /The injection is capped/, "Step 1 must know the hook withholds");
});
