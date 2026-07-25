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
lines.push("--- CONTINUE.md ---");
lines.push(continueDoc.trim());
lines.push("--- end CONTINUE.md ---");
lines.push("");

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
