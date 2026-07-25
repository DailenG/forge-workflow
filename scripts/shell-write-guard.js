#!/usr/bin/env node
"use strict";

/*
 * PreToolUse hook for the forge plugin. Fires before Bash.
 *
 * Motivation: a real incident. A PowerShell one-liner did
 * `$n = $c.Replace([char]0x2014, "--")`, which threw because the char overload
 * rejects a two-character replacement. Without strict mode the script kept
 * going and called WriteAllText($f, $null), truncating two files to zero bytes.
 * The follow-up check, "zero em dashes remain", passed vacuously on the empty
 * files.
 *
 * Three lessons encoded here:
 *   1. Shell rewrites of existing files bypass the typography hook, lose CRLF,
 *      and have no undo. Use the Edit tool instead.
 *   2. PowerShell without a strict preamble continues past a throw.
 *   3. Absence-based verification passes on destroyed data.
 *
 * Warns, does not block. Exit 0 always.
 */

const fs = require("fs");

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
const cmd = input.command || "";
if (!cmd) {
  process.exit(0);
}

// Writes that replace whole file contents. Append-only forms are excluded,
// since they cannot truncate.
const WHOLE_FILE_WRITE = [
  /WriteAllText/i,
  /WriteAllLines/i,
  /WriteAllBytes/i,
  /\bSet-Content\b/i,
  /\bOut-File\b/i,
  /\bsed\s+-i\b/,
  /(^|[^>])>[^>|&]/,
];

const DESTRUCTIVE = [
  /\bRemove-Item\b[^|]*-Recurse/i,
  /\brm\s+-[a-zA-Z]*[rf]/,
  /\bgit\s+checkout\s+--\s/,
  /\bgit\s+reset\s+--hard/,
  /\bgit\s+clean\s+-[a-zA-Z]*f/,
  /\bTruncate\b/i,
];

const isWrite = WHOLE_FILE_WRITE.some((re) => re.test(cmd));
const isDestructive = DESTRUCTIVE.some((re) => re.test(cmd));

if (!isWrite && !isDestructive) {
  process.exit(0);
}

const looksPowerShell =
  /\$[A-Za-z_]/.test(cmd) ||
  /\b(Get|Set|Out|Add|Remove|Write)-[A-Z]/.test(cmd) ||
  /\[System\./i.test(cmd) ||
  /\bpwsh\b|\bpowershell\b/i.test(cmd);

const hasStrictPreamble =
  /ErrorActionPreference\s*=\s*['"]Stop['"]/i.test(cmd) &&
  /Set-StrictMode/i.test(cmd);

const out = [];
out.push("forge: SHELL WRITE GUARD");
out.push("");

if (isWrite) {
  out.push("This command replaces the contents of a file through the shell.");
  out.push("");
  out.push("Prefer the Edit tool for changing existing files. Shell rewrites:");
  out.push("  - bypass the typography hook, so violations go unreported");
  out.push("  - collapse CRLF line endings on Windows");
  out.push("  - have no undo, and Phase 1 files are not yet under git");
  out.push("");
}

if (isDestructive) {
  out.push("This command can destroy work irreversibly. Confirm with the user");
  out.push("before running it, regardless of FLOW mode.");
  out.push("");
}

if (looksPowerShell && !hasStrictPreamble) {
  out.push("PowerShell without a strict preamble continues past a throw, and a");
  out.push("half-assigned variable written back to disk truncates the file.");
  out.push("Prepend both of these:");
  out.push("");
  out.push("  $ErrorActionPreference = 'Stop'");
  out.push("  Set-StrictMode -Version Latest");
  out.push("");
}

if (isWrite) {
  out.push("If a shell write is genuinely necessary, then before writing:");
  out.push("  1. Assert the new content is non-empty and within a sane size of");
  out.push("     the original. Never write a variable that could be null");
  out.push("  2. Verify POSITIVELY afterwards. Check that expected content is");
  out.push("     still present, such as line count or a known string. Checking");
  out.push("     only that bad input is absent passes on an empty file");
}

process.stdout.write(out.join("\n") + "\n");
process.exit(0);
