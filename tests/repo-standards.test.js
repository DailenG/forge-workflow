"use strict";

/*
 * Requirement 15: the existing repository checks still hold.
 *
 * The build, lint, documentation, traceability, and secret checks this repo
 * actually runs are the CI scripts plus plugin validation. This suite runs the
 * ones that do not need a network, and adds the structural invariants the new
 * protection code introduces.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { REPO_ROOT } = require("./helpers/sandbox.js");

function node(args, options) {
  return spawnSync(process.execPath, args,
    Object.assign({ cwd: REPO_ROOT, encoding: "utf8" }, options || {}));
}

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/* ---------------- the checks CI already ran ---------------- */

test("the manifest and hook reference check still passes", () => {
  const res = node([path.join(".github", "scripts", "manifest-check.js")]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /All manifest checks passed/);
});

test("the typography check still passes over tracked files", () => {
  const res = node([path.join(".github", "scripts", "typography-check.js")]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
});

test("every hook script and shipped template parses", () => {
  const files = [];
  for (const dir of ["scripts", "templates", "tests", path.join(".github", "scripts")]) {
    const full = path.join(REPO_ROOT, dir);
    for (const entry of fs.readdirSync(full)) {
      if (entry.endsWith(".js")) files.push(path.join(dir, entry));
    }
  }
  assert.ok(files.length >= 8, "expected the script and template set to be non-empty");
  for (const file of files) {
    const res = node(["--check", file]);
    assert.equal(res.status, 0, file + ": " + res.stderr);
  }
});

/*
 * typography-check.js reads `git ls-files`, so it cannot see a file that is
 * not committed yet. This repeats the rule over the working tree so a new file
 * cannot slip an em dash in before its first commit.
 */
test("the ASCII typography rule holds over the working tree, committed or not", () => {
  const FORBIDDEN = {
    "em dash": 0x2014,
    "en dash": 0x2013,
    "left single quote": 0x2018,
    "right single quote": 0x2019,
    "left double quote": 0x201c,
    "right double quote": 0x201d,
    ellipsis: 0x2026,
    "non-breaking space": 0x00a0,
    "unicode minus": 0x2212,
  };
  const byChar = new Map(
    Object.keys(FORBIDDEN).map((name) => [String.fromCharCode(FORBIDDEN[name]), name])
  );

  const roots = ["scripts", "templates", "tests", "skills", "hooks", ".github"];
  const violations = [];

  function walk(rel) {
    const full = path.join(REPO_ROOT, rel);
    for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
      const childRel = path.join(rel, entry.name);
      if (entry.isDirectory()) {
        walk(childRel);
        continue;
      }
      if (!/\.(js|json|md|ya?ml|toml)$/i.test(entry.name)) continue;
      const text = fs.readFileSync(path.join(REPO_ROOT, childRel), "utf8");
      text.split(/\r?\n/).forEach((line, i) => {
        for (const ch of line) {
          const name = byChar.get(ch);
          if (name) violations.push(childRel + ":" + (i + 1) + ": " + name);
        }
      });
    }
  }

  for (const root of roots) walk(root);
  for (const file of ["README.md", "CHANGELOG.md", "CONTRIBUTING.md", "CLAUDE.md"]) {
    const text = read(file);
    text.split(/\r?\n/).forEach((line, i) => {
      for (const ch of line) {
        const name = byChar.get(ch);
        if (name) violations.push(file + ":" + (i + 1) + ": " + name);
      }
    });
  }
  assert.deepEqual(violations, []);
});

test("no PowerShell block in the skills or docs uses &&", () => {
  const offenders = [];
  for (const rel of ["skills", "templates"]) {
    const dir = path.join(REPO_ROOT, rel);
    const stack = [dir];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
          continue;
        }
        if (!/\.md$/i.test(entry.name)) continue;
        const text = fs.readFileSync(full, "utf8");
        const inPowerShell = /```powershell([\s\S]*?)```/gi;
        let match;
        while ((match = inPowerShell.exec(text)) !== null) {
          if (match[1].indexOf("&&") !== -1) {
            offenders.push(path.relative(REPO_ROOT, full));
          }
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});

/* ---------------- structural invariants of the new code ---------------- */

test("every provider call goes through the visibility interlock", () => {
  const source = read(path.join("templates", "branch-protection.js"));
  const direct = source.match(/(?<!Provider)\brun\(\s*"(gh|glab)"/g) || [];
  assert.deepEqual(
    direct,
    [],
    "provider CLIs must be invoked through runProvider so a visibility change cannot be issued"
  );
  assert.match(source, /function runProvider/);
  assert.match(source, /isVisibilityMutation/);
});

test("the only recursive delete in the protection code is the guarded one", () => {
  const source = read(path.join("templates", "branch-protection.js"));
  const removals = source.match(/fs\.rmSync\([^)]*/g) || [];
  assert.equal(removals.length, 1, "expected exactly one rmSync, inside removeDisposable");
  assert.match(source, /function removeDisposable[\s\S]{0,400}refusing recursive delete/);
});

test("the guard still forbids working around it", () => {
  const guard = read(path.join("templates", "history-guard.js"));
  assert.match(guard, /--no-verify is prohibited/);
  assert.match(guard, /TRUST BOUNDARY/);
});

test("the shipped templates the environment phase copies all exist", () => {
  for (const file of [
    "branch-protection.js",
    "history-guard.js",
    "lefthook.yml",
    "ci.yml",
    "CONTINUE.md",
    "TODO.md",
    "traceability.md",
    "docs-manifest.yml",
    "images-manifest.md",
    "cliff.toml",
  ]) {
    assert.ok(
      fs.existsSync(path.join(REPO_ROOT, "templates", file)),
      "missing template: " + file
    );
  }
});

/* ---------------- the release standards this repo enforces ---------------- */

test("the plugin version was bumped past the release that had no fallback", () => {
  const manifest = JSON.parse(read(path.join(".claude-plugin", "plugin.json")));
  const parts = manifest.version.split(".").map(Number);
  assert.ok(
    parts[0] > 1 || (parts[0] === 1 && parts[1] >= 1),
    "a behaviour change to skills or templates needs a version bump, got " + manifest.version
  );
});

test("the changelog records the protection change", () => {
  const changelog = read("CHANGELOG.md");
  assert.match(changelog, /## \[Unreleased\]|## \[1\.1\.0\]/);
  assert.match(changelog, /protection/i);
});

/* ---------------- the skills say what the code does ---------------- */

test("the environment phase describes both protection tiers", () => {
  const skill = read(path.join("skills", "forge-env", "SKILL.md"));
  assert.match(skill, /branch-protection\.js/);
  assert.match(skill, /history-guard\.js/);
  assert.match(skill, /trust boundary/i);
  assert.doesNotMatch(
    skill,
    /Configure a GitHub ruleset on `main` blocking force pushes and deletions/,
    "the GitHub-only instruction must be gone"
  );
});

test("the lifecycle gate accepts either tier", () => {
  const skill = read(path.join("skills", "forge", "SKILL.md"));
  assert.match(skill, /default-branch history protection verified/i);
  assert.match(skill, /server-side|managed local/i);
});

test("the standards state the protection policy once, provider neutrally", () => {
  const standards = read(path.join("skills", "forge-standards", "SKILL.md"));
  assert.match(standards, /default branch/i);
  assert.match(standards, /trust boundary/i);
  assert.doesNotMatch(standards, /Upgrade to GitHub Pro/);
});
