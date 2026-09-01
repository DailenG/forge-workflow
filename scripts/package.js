#!/usr/bin/env node
"use strict";

/*
 * Builds forge-workflow.zip, the manual-install artifact attached to a GitHub
 * Release. The payload is declared here and nowhere else, so the release is
 * never assembled by hand and a shipped file cannot be forgotten. LICENSE was
 * missing from every hand-built zip; a missing payload member now fails the
 * build by name instead of shipping without it.
 *
 * Node has no zip writer, so the tree is staged in a temp directory this script
 * created and handed to Compress-Archive on Windows or zip elsewhere. Every
 * entry is prefixed forge-workflow/ so the zip unpacks into its own directory.
 *
 * Usage: node scripts/package.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const PREFIX = "forge-workflow";
const OUTPUT = path.join(REPO_ROOT, PREFIX + ".zip");

// A string is one file. An object expands a directory at build time, so a new
// skill or template joins the artifact without anyone editing this list.
const PAYLOAD = [
  ".claude-plugin/plugin.json",
  "hooks/hooks.json",
  "scripts/ascii-check.js",
  "scripts/session-start.js",
  "scripts/shell-write-guard.js",
  "scripts/stop-check.js",
  "scripts/views-guard.js",
  { dir: "skills", each: "SKILL.md" },
  "harness/README.md",
  "harness/omp/forge-bridge.ts",
  { dir: "templates" },
  "README.md",
  "LICENSE",
];

function posix(rel) {
  return rel.split(path.sep).join("/");
}

// Repo-relative payload paths, directories expanded against the real tree.
function resolveFiles(root) {
  const base = root || REPO_ROOT;
  const files = [];
  for (const entry of PAYLOAD) {
    if (typeof entry === "string") {
      files.push(entry);
      continue;
    }
    const dir = path.join(base, entry.dir);
    if (!fs.existsSync(dir)) {
      throw new Error("payload directory is missing: " + entry.dir);
    }
    for (const name of fs.readdirSync(dir).sort()) {
      const child = path.join(dir, name);
      if (entry.each) {
        if (fs.statSync(child).isDirectory()) {
          files.push(posix(path.join(entry.dir, name, entry.each)));
        }
      } else if (fs.statSync(child).isFile()) {
        files.push(posix(path.join(entry.dir, name)));
      }
    }
  }
  return files;
}

function quote(value) {
  return "'" + value.replace(/'/g, "''") + "'";
}

// One archiver per platform, tried in order. Failures are collected so the
// error names every tool that was attempted rather than dying silently.
function candidates(stage) {
  const command =
    "Compress-Archive -Path " +
    quote(path.join(stage, PREFIX)) +
    " -DestinationPath " +
    quote(OUTPUT);
  if (process.platform === "win32") {
    const args = ["-NoProfile", "-NonInteractive", "-Command", command];
    return [
      { file: "powershell", args: args },
      { file: "pwsh", args: args },
    ];
  }
  return [{ file: "zip", args: ["-r", "-q", OUTPUT, PREFIX] }];
}

function compress(stage) {
  const failures = [];
  for (const candidate of candidates(stage)) {
    const res = spawnSync(candidate.file, candidate.args, {
      cwd: stage,
      encoding: "utf8",
    });
    if (res.status === 0) return candidate.file;
    const why = res.error ? res.error.message : (res.stderr || "").trim();
    failures.push(candidate.file + ": " + (why || "exit " + res.status));
  }
  throw new Error(
    "no archiver could write " + OUTPUT + "\n  " + failures.join("\n  ")
  );
}

function build() {
  const files = resolveFiles(REPO_ROOT);
  const absent = files.filter(
    (rel) => !fs.existsSync(path.join(REPO_ROOT, rel))
  );
  if (absent.length > 0) {
    throw new Error(
      "refusing to build the release artifact, payload files are missing:\n  " +
        absent.join("\n  ")
    );
  }

  if (fs.existsSync(OUTPUT)) fs.rmSync(OUTPUT);

  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "forge-package-"));
  let archiver;
  try {
    for (const rel of files) {
      const dest = path.join(stage, PREFIX, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(REPO_ROOT, rel), dest);
    }
    archiver = compress(stage);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }

  if (!fs.existsSync(OUTPUT)) {
    throw new Error(archiver + " reported success but wrote no " + OUTPUT);
  }

  process.stdout.write(
    "forge: packaged " +
      files.length +
      " entries under " +
      PREFIX +
      "/ into " +
      OUTPUT +
      "\n"
  );
  return { output: OUTPUT, files: files };
}

if (require.main === module) {
  try {
    build();
  } catch (err) {
    process.stderr.write("forge: " + err.message + "\n");
    process.exit(1);
  }
}

module.exports = { PAYLOAD, PREFIX, OUTPUT, resolveFiles, build };
