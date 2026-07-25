#!/usr/bin/env node
"use strict";

/*
 * PostToolUse hook for the forge plugin. Fires after Write and Edit.
 *
 * Purpose: mechanically enforce the ASCII typography rule instead of relying on
 * a skill being loaded. Smart quotes and dashes inside string literals,
 * identifiers, or shell commands are real defects, and the rule is easy to lose
 * when the standards skill has not triggered.
 *
 * Flags only the typographic characters that are almost always accidental. It
 * deliberately does not flag all non-ASCII, because a project may legitimately
 * need unicode in test fixtures, for example a path scanner testing unicode
 * filenames.
 *
 * Warns rather than blocks. The model sees the report and corrects it.
 */

const fs = require("fs");
const path = require("path");

const OFFENDERS = [
  { re: /\u2014/g, name: "em dash", fix: "-" },
  { re: /\u2013/g, name: "en dash", fix: "-" },
  { re: /[\u2018\u2019]/g, name: "curly single quote", fix: "'" },
  { re: /[\u201C\u201D]/g, name: "curly double quote", fix: '"' },
  { re: /\u2026/g, name: "ellipsis character", fix: "three periods" },
  { re: /\u00A0/g, name: "non-breaking space", fix: "regular space" },
  { re: /\u2212/g, name: "minus sign", fix: "-" },
];

// Read the hook payload from stdin. Fall back silently if unavailable, since a
// hook that throws is worse than a hook that does nothing.
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

// Locate the written file across the shapes a Write or Edit payload may take.
const input = payload.tool_input || payload.toolInput || {};
const filePath =
  input.file_path || input.filePath || input.path || payload.file_path;

if (!filePath) {
  process.exit(0);
}

let content;
try {
  content = fs.readFileSync(filePath, "utf8");
} catch (err) {
  process.exit(0);
}

const lines = content.split("\n");
const findings = [];

for (const offender of OFFENDERS) {
  lines.forEach((line, index) => {
    offender.re.lastIndex = 0;
    if (offender.re.test(line)) {
      findings.push({
        line: index + 1,
        name: offender.name,
        fix: offender.fix,
        text: line.trim().slice(0, 90),
      });
    }
  });
}

if (findings.length === 0) {
  process.exit(0);
}

const ext = path.extname(filePath).toLowerCase();
const prose = [".md", ".markdown", ".txt", ".rst"].includes(ext);

const out = [];
out.push("forge: TYPOGRAPHY VIOLATION in " + filePath);
out.push("");

if (!prose) {
  out.push(
    "This is a code or config file. These characters break string literals,"
  );
  out.push("identifiers, and shell commands. Fix them now, before continuing.");
} else {
  out.push("Project standard is ASCII typography. Fix these.");
}
out.push("");

// Collapse to one line per finding, capped so a large paste does not flood.
const shown = findings.slice(0, 25);
for (const f of shown) {
  out.push("  line " + f.line + ": " + f.name + " -> use " + f.fix);
  out.push("    " + f.text);
}
if (findings.length > shown.length) {
  out.push("  ... and " + (findings.length - shown.length) + " more");
}

out.push("");
out.push("Rewrite the affected lines with ASCII equivalents. Do not leave them.");

process.stdout.write(out.join("\n") + "\n");
process.exit(0);
