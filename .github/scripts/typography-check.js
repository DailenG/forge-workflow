#!/usr/bin/env node
// Fail if any tracked text file contains a non-ASCII typography character that
// Forge forbids. Characters are defined by code point so this checker does not
// trip itself. grep -P is unreliable for multibyte matching on some runners,
// so this is done in Node.
"use strict";

const { execSync } = require("child_process");
const fs = require("fs");

// name -> code point
const FORBIDDEN = {
  "em dash": 0x2014,
  "en dash": 0x2013,
  "left single quote": 0x2018,
  "right single quote": 0x2019,
  "left double quote": 0x201c,
  "right double quote": 0x201d,
  "ellipsis": 0x2026,
  "non-breaking space": 0x00a0,
  "unicode minus": 0x2212,
};

const CHAR_TO_NAME = new Map(
  Object.entries(FORBIDDEN).map(([name, cp]) => [String.fromCharCode(cp), name])
);

// Extensions that are binary or otherwise not prose/code we should scan.
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".svg",
  ".zip", ".gz", ".tar", ".pdf",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
]);

function trackedFiles() {
  const out = execSync("git ls-files", { encoding: "utf8" });
  return out.split(/\r?\n/).filter(Boolean);
}

function looksBinary(buf) {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

let violations = 0;
let scanned = 0;

for (const file of trackedFiles()) {
  const dot = file.lastIndexOf(".");
  const ext = dot >= 0 ? file.slice(dot).toLowerCase() : "";
  if (SKIP_EXT.has(ext)) continue;

  let buf;
  try {
    buf = fs.readFileSync(file);
  } catch (e) {
    continue; // deleted or unreadable
  }
  if (looksBinary(buf)) continue;

  scanned++;
  const text = buf.toString("utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const ch of line) {
      const name = CHAR_TO_NAME.get(ch);
      if (name) {
        const col = line.indexOf(ch) + 1;
        console.error(
          `${file}:${idx + 1}:${col}: forbidden ${name} (U+${ch
            .charCodeAt(0)
            .toString(16)
            .toUpperCase()
            .padStart(4, "0")})`
        );
        violations++;
      }
    }
  });
}

if (violations > 0) {
  console.error(`\nTypography check failed: ${violations} forbidden character(s).`);
  process.exit(1);
}
console.log(`Typography check passed: ${scanned} file(s) scanned, no forbidden characters.`);
