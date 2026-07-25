#!/usr/bin/env node
// Structural repository checks:
//   1. Both JSON manifests parse.
//   2. hooks/hooks.json references only scripts that exist on disk.
//   3. docs/index.html exists and is non-empty.
"use strict";

const fs = require("fs");
const path = require("path");

const root = process.cwd();
let failures = 0;

function fail(msg) {
  console.error("FAIL: " + msg);
  failures++;
}

function ok(msg) {
  console.log("ok: " + msg);
}

// 1. JSON manifests parse.
const manifests = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
];
for (const rel of manifests) {
  const abs = path.join(root, rel);
  try {
    JSON.parse(fs.readFileSync(abs, "utf8"));
    ok(`${rel} parses`);
  } catch (e) {
    fail(`${rel} does not parse: ${e.message}`);
  }
}

// 2. hooks.json references existing scripts.
try {
  const hooksRaw = fs.readFileSync(path.join(root, "hooks/hooks.json"), "utf8");
  const hooks = JSON.parse(hooksRaw);
  const commands = [];
  for (const eventArr of Object.values(hooks.hooks || {})) {
    for (const group of eventArr) {
      for (const h of group.hooks || []) {
        if (typeof h.command === "string") commands.push(h.command);
      }
    }
  }
  const referenced = new Set();
  for (const cmd of commands) {
    const re = /scripts\/[A-Za-z0-9._-]+\.js/g;
    let m;
    while ((m = re.exec(cmd)) !== null) referenced.add(m[0]);
  }
  if (referenced.size === 0) {
    fail("hooks.json references no scripts (expected at least one)");
  }
  for (const rel of referenced) {
    if (fs.existsSync(path.join(root, rel))) {
      ok(`hooks.json -> ${rel} exists`);
    } else {
      fail(`hooks.json references missing script: ${rel}`);
    }
  }
} catch (e) {
  fail(`could not read hooks/hooks.json: ${e.message}`);
}

// 3. docs/index.html exists and is non-empty.
try {
  const st = fs.statSync(path.join(root, "docs/index.html"));
  if (st.size > 0) {
    ok(`docs/index.html exists and is non-empty (${st.size} bytes)`);
  } else {
    fail("docs/index.html is empty");
  }
} catch (e) {
  fail("docs/index.html is missing");
}

if (failures > 0) {
  console.error(`\nManifest checks failed: ${failures} problem(s).`);
  process.exit(1);
}
console.log("\nAll manifest checks passed.");
