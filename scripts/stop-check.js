#!/usr/bin/env node
"use strict";

/*
 * Stop hook for the forge plugin.
 *
 * Purpose: enforce the resumability invariant. Fires when Claude finishes
 * responding. If the working tree is dirty and CONTINUE.md was not updated to
 * explain why, the next cold-start session will be misled. This surfaces that
 * before the session ends rather than after.
 *
 * This warns. It does not block. Blocking a turn on a bookkeeping check is
 * more disruptive than the problem it prevents.
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const continuePath = path.join(projectDir, "CONTINUE.md");

// Not an forge project. Stay silent.
if (!fs.existsSync(continuePath)) {
  process.exit(0);
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

const status = git(["status", "--porcelain"]);

// Clean tree means nothing in flight. Nothing to warn about.
if (status === null || status === "") {
  process.exit(0);
}

const changedPaths = status
  .split("\n")
  .filter(Boolean)
  .map((line) => line.slice(3).trim());

const continueTouched = changedPaths.some((p) => /(^|\/)CONTINUE\.md$/.test(p));
const todoTouched = changedPaths.some((p) => /(^|\/)TODO\.md$/.test(p));

// Determine whether CONTINUE.md was modified recently enough to plausibly
// describe the current uncommitted work.
let continueRecentlyWritten = false;
try {
  const ageMinutes = (Date.now() - fs.statSync(continuePath).mtimeMs) / 60000;
  continueRecentlyWritten = ageMinutes < 30;
} catch (err) {
  continueRecentlyWritten = false;
}

if (continueTouched || continueRecentlyWritten) {
  // State was recorded. Optionally nudge about TODO.md, but do not nag.
  if (!todoTouched && changedPaths.length > 3) {
    process.stdout.write(
      "forge: CONTINUE.md is current, but TODO.md was not updated " +
        "despite " +
        changedPaths.length +
        " changed paths. Confirm task state is accurate.\n"
    );
  }
  process.exit(0);
}

process.stdout.write(
  [
    "forge: RESUMABILITY WARNING",
    "",
    "The working tree has " +
      changedPaths.length +
      " uncommitted change(s), but CONTINUE.md was not updated.",
    "",
    "If this session ends now, the next cold start will read a CONTINUE.md that",
    "does not describe the work in progress, and will proceed on a false premise.",
    "",
    "Before finishing: either commit the work, or update CONTINUE.md to record",
    "what is in flight and what the next concrete action is.",
    "",
    "Uncommitted paths:",
  ]
    .concat(changedPaths.slice(0, 20).map((p) => "  " + p))
    .concat(changedPaths.length > 20 ? ["  ... and " + (changedPaths.length - 20) + " more"] : [])
    .join("\n") + "\n"
);

process.exit(0);
