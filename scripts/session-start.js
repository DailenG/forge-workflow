#!/usr/bin/env node
"use strict";

/*
 * SessionStart hook for the forge plugin.
 *
 * Purpose: make cold-start resumption deterministic. Without this, resuming
 * depends on the model choosing to read CONTINUE.md. With it, the file is in
 * context before the first user message is processed.
 *
 * Emits nothing when the project is not an forge project, so it is
 * harmless in unrelated repositories.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();

function readIfPresent(relativePath) {
  try {
    return fs.readFileSync(path.join(projectDir, relativePath), "utf8");
  } catch (err) {
    return null;
  }
}

function git(args) {
  try {
    return execFileSync("git", args, {
      cwd: projectDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch (err) {
    return null;
  }
}

function ageInHours(relativePath) {
  try {
    const stat = fs.statSync(path.join(projectDir, relativePath));
    return (Date.now() - stat.mtimeMs) / 3600000;
  } catch (err) {
    return null;
  }
}

/*
 * CONTINUE.md is injected verbatim, so its size is a tax on every session in the
 * project. The budget is set so a file honouring the 200 line ceiling in
 * forge-standards is never capped: exceeding it means the file is carrying
 * history, and the fix is to compact the file rather than keep paying for it.
 *
 * Prompt caching does not make this budget unnecessary, and the argument that it
 * does will come up. Caching is a per-token multiplier, so it scales a large
 * injection and a small one by the same factor and cannot change the ratio
 * between them. It also buys nothing on the two costs that matter most here:
 * context window occupancy is identical whether tokens were cached or not, and a
 * stale claim buried in an injected essay is just as wrong when it is read at a
 * discount. Invalidation is prefix exact and this file is rewritten every slice
 * by rule, so a large injection is re-written at the cache write premium as often
 * as it changes rather than amortized once.
 */
const CONTINUE_BUDGET_CHARS = 20000;

// The fields the detection ladder routes on. Small, always present, never dropped.
const STATE_FIELD =
  /^(Phase|Gate|Mode|Capabilities|Last updated|Current task|Branch|Working tree|Last release|Test suite)\s*:/;

/*
 * Sections describing what happens next, in the order a session needs them.
 * Budget is spent in this order, so the next action outranks everything: a
 * session that knows what to do can read the rest on purpose, while one that
 * does not has to reconstruct it. Nothing outside this list is ever injected,
 * however much budget is left over. Filling the remainder with closed-slice
 * narrative is the exact cost this cap exists to remove.
 */
const LIVE_SECTIONS = [
  /^#+\s*(read this first|next action|start here)/i,
  /^#+\s*blocked/i,
  /^#+\s*in flight/i,
  /^#+\s*verify current state/i,
  /^#+\s*notes for the next session/i,
];

/*
 * A heading that says it is no longer current. The Record hygiene standard says
 * to correct by superseding rather than by layering, and a project following it
 * marks the superseded section in its own heading. Injecting such a section is
 * worse than injecting nothing: the model reads a stale next action and acts on
 * it while believing it is current.
 *
 * Found by running this against a real project through the omp bridge. The file
 * carried both `## Start here next session [HISTORICAL, superseded by the top
 * section of this file]` and a current `## READ THIS FIRST: where the work
 * stopped`. The stale one matched a live pattern, the current one matched none,
 * so the injection carried the stale next action and withheld the real one, and
 * the model correctly reported that it had been handed superseded history.
 */
const SUPERSEDED_HEADING = /\b(historical|superseded|obsolete|out of date|no longer (current|accurate))\b/i;

function isLive(heading) {
  if (SUPERSEDED_HEADING.test(heading)) return false;
  return LIVE_SECTIONS.some((pattern) => pattern.test(heading));
}

function splitSections(text) {
  const parts = [];
  const pattern = /^## .*$/gm;
  let match = pattern.exec(text);
  const preambleEnd = match ? match.index : text.length;
  parts.push({ name: "preamble", body: text.slice(0, preambleEnd).trimEnd() });

  while (match) {
    const start = match.index;
    const heading = match[0];
    match = pattern.exec(text);
    parts.push({
      name: heading.replace(/^#+\s*/, ""),
      heading,
      body: text.slice(start, match ? match.index : text.length).trimEnd(),
    });
  }
  return parts;
}

/*
 * A budget cut from the top only works when the top of the file is the live
 * state. On a file that has accreted, the opening section alone can exceed the
 * budget, so a positional cut spends everything before reaching the next
 * action. Select instead: the ladder fields and the action sections always
 * arrive, whatever else is withheld gets named so it can be read on purpose.
 */
function withinBudget(doc) {
  const trimmed = doc.trim();
  if (trimmed.length <= CONTINUE_BUDGET_CHARS) {
    return { text: trimmed, total: trimmed.length, kept: trimmed.length, withheld: [] };
  }

  const sections = splitSections(trimmed);
  const preamble = sections[0];
  const preambleLines = preamble.body.split("\n");

  // Title and state fields first. These are tiny and the ladder needs them. A
  // field's value may wrap, so continuation lines travel with their field.
  const state = [];
  let carrying = false;
  for (const line of preambleLines) {
    if (STATE_FIELD.test(line) || /^#\s/.test(line)) {
      state.push(line);
      carrying = STATE_FIELD.test(line);
    } else if (carrying && line.trim() !== "" && !/^#/.test(line)) {
      state.push(line);
    } else {
      carrying = false;
    }
  }

  const stateSet = new Set(state);
  const preambleProse = preambleLines
    .filter((line) => !stateSet.has(line))
    .join("\n")
    .trim();

  const kept = state.slice();
  let used = kept.join("\n").length;
  const withheld = [];

  const rest = sections.slice(1);
  const eligible = [];
  for (const pattern of LIVE_SECTIONS) {
    for (const section of rest) {
      // isLive, not the pattern alone: the pattern establishes priority order,
      // and isLive additionally refuses a heading that says it is superseded.
      // Testing the pattern directly here would have let a stale section in.
      if (pattern.test(section.heading) && isLive(section.heading) && !eligible.includes(section)) {
        eligible.push(section);
      }
    }
  }

  for (const section of eligible) {
    const cost = section.body.length + 2;
    if (used + cost <= CONTINUE_BUDGET_CHARS) {
      kept.push("", section.body);
      used += cost;
    } else {
      withheld.push(`${section.name} (${section.body.length} chars)`);
    }
  }

  /*
   * A file whose sections are named something else entirely would otherwise
   * arrive as state fields and nothing. Fall back to its opening, cut on a line
   * boundary, so a nonstandard record still says something.
   */
  if (kept.length === state.length && preambleProse) {
    const room = CONTINUE_BUDGET_CHARS - used - 2;
    const window = preambleProse.slice(0, Math.max(room, 0));
    const cut = window.lastIndexOf("\n");
    const opening = cut > 0 ? window.slice(0, cut) : window;
    if (opening) {
      kept.push("", opening);
      used += opening.length + 2;
    }
    if (opening.length < preambleProse.length) {
      withheld.push(
        `the preamble past its first ${opening.length} chars (${preambleProse.length} total)`
      );
    }
  } else if (preambleProse) {
    withheld.push(`the preamble beyond its state fields (${preambleProse.length} chars)`);
  }

  for (const section of rest) {
    if (!isLive(section.heading)) {
      withheld.push(`${section.name} (${section.body.length} chars)`);
    }
  }

  return { text: kept.join("\n"), total: trimmed.length, kept: used, withheld };
}

const continueDoc = readIfPresent("CONTINUE.md");

// Not an forge project. Stay silent.
if (continueDoc === null) {
  process.exit(0);
}

const lines = [];
lines.push("=== FORGE: PROJECT STATE ===");
lines.push("");
lines.push("CONTINUE.md was loaded automatically. Treat it as the starting point");
lines.push("for this session, but verify it against the repository before acting.");
lines.push("");
const injected = withinBudget(continueDoc);
const truncated = injected.withheld.length > 0;

lines.push("--- CONTINUE.md ---");
lines.push(injected.text);
lines.push("--- end CONTINUE.md ---");
lines.push("");

if (truncated) {
  lines.push(
    `CONTINUE.md is ${injected.total} characters, over the ${CONTINUE_BUDGET_CHARS} character budget.`
  );
  lines.push("The state fields and the sections describing what happens next were loaded.");
  lines.push("Withheld, readable on purpose if the state above does not settle a decision:");
  for (const name of injected.withheld.slice(0, 8)) {
    lines.push("  - " + name);
  }
  if (injected.withheld.length > 8) {
    lines.push(`  - and ${injected.withheld.length - 8} more`);
  }
  lines.push("");
  lines.push("Treat the size as a finding: CONTINUE.md holds current state and the next");
  lines.push("action, not the history of closed work. Compacting it is part of the next");
  lines.push("slice, not a separate errand.");
  lines.push("");
}

const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
const status = git(["status", "--porcelain"]);
const lastCommit = git(["log", "-1", "--oneline"]);
const lastTag = git(["describe", "--tags", "--abbrev=0"]);

if (branch !== null) {
  lines.push("--- actual git state ---");
  lines.push("branch: " + branch);
  lines.push("last commit: " + (lastCommit || "none"));
  lines.push("last tag: " + (lastTag || "none"));
  if (status) {
    const dirtyCount = status.split("\n").filter(Boolean).length;
    lines.push("working tree: DIRTY, " + dirtyCount + " changed path(s)");
    lines.push(status);
  } else {
    lines.push("working tree: clean");
  }
  lines.push("--- end git state ---");
  lines.push("");
}

// Staleness warning. A CONTINUE.md older than the last commit is suspect.
const continueAge = ageInHours("CONTINUE.md");
if (continueAge !== null && continueAge > 24) {
  lines.push(
    "WARNING: CONTINUE.md was last written " +
      Math.round(continueAge) +
      " hours ago. Confirm it still reflects reality."
  );
  lines.push("");
}

if (status && !/CONTINUE\.md/.test(status)) {
  lines.push(
    "WARNING: the working tree is dirty but CONTINUE.md is not among the changes."
  );
  lines.push(
    "The previous session may have ended without recording state. Reconcile before continuing."
  );
  lines.push("");
}

lines.push("Before doing any work: confirm CONTINUE.md matches the git state above.");
lines.push("If they disagree, say so plainly and ask how to reconcile. Do not guess.");
lines.push("");
lines.push("The user does not need to name a phase. Invoke the 'forge' skill to");
lines.push("determine where this project stands and continue from there.");
lines.push("=== END PROJECT STATE ===");

process.stdout.write(lines.join("\n") + "\n");
process.exit(0);
