#!/usr/bin/env node
"use strict";

/*
 * PreToolUse hook for the forge plugin. Fires before Write and Edit.
 *
 * DENIES a write whose target is under docs/views/, because everything there is
 * generated from docs/records/ and a hand edit is silently lost on the next
 * render.
 *
 * WHY THIS DENIES RATHER THAN WARNS, and why it is PreToolUse. A generated file
 * that anyone may edit becomes an unreliable hand-maintained file within a week.
 * That is not a prediction: the hand-maintained traceability table this design
 * replaces reached 342 KB on a real project, with eight rows whose Status column
 * held narrative prose, and it had its column boundaries destroyed once and was
 * rebuilt cell by cell. The sibling hook `ascii-check.js` is PostToolUse and
 * says in its own header that it "warns rather than blocks", which is all a
 * PostToolUse hook can do: it fires after the write has landed. Only PreToolUse
 * can refuse, so this is PreToolUse.
 *
 * The deny is expressed as hookSpecificOutput.permissionDecision, not as exit 2,
 * because the JSON form carries a reason the model reads and acts on. Exit stays
 * 0 on every path: a guard that crashes on an unexpected payload and thereby
 * blocks every edit in the project is worse than the rot it prevents.
 *
 * Reads no file contents and does not consult the record set. It runs before
 * every Write and Edit in the project, so it stays a string comparison.
 */

const fs = require("fs");
const path = require("path");

let raw = "";
try {
  raw = fs.readFileSync(0, "utf8");
} catch (err) {
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch (err) {
  process.exit(0);
}

const input = payload.tool_input || payload.toolInput || {};
const filePath = input.file_path || input.filePath || input.path || payload.file_path;

if (!filePath || typeof filePath !== "string") {
  process.exit(0);
}

// Normalise separators so a Windows path and a posix one are judged alike, and
// compare on a path segment rather than a substring: a project directory named
// something like `previews/` must not match.
const normalised = filePath.replace(/\\/g, "/");
const segments = normalised.split("/");

let guarded = false;
for (let i = 0; i < segments.length - 1; i += 1) {
  if (segments[i] === "docs" && segments[i + 1] === "views") {
    guarded = true;
    break;
  }
}

if (!guarded) {
  process.exit(0);
}

const name = path.basename(normalised);

const reason = [
  "forge: VIEWS GUARD. " + name + " is generated, not authored.",
  "",
  "Everything under docs/views/ is rendered from docs/records/ by",
  "forge-views.js. An edit here is lost on the next render, and a generated",
  "file that gets hand-edited stops being trustworthy for everyone reading it.",
  "",
  "Edit the record instead, then regenerate:",
  "",
  "  1. Change the record under docs/records/ that carries the fact.",
  "     A requirement's status lives on its own requirement record; what",
  "     satisfies it lives in the `satisfies` field of whatever satisfies it.",
  "  2. node .forge/forge-records-lint.js",
  "  3. node .forge/forge-views.js render",
  "",
  "If this view is wrong in a way no record can express, that is a defect in",
  "forge-views.js, not a reason to edit its output.",
].join("\n");

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  }) + "\n"
);
process.exit(0);
