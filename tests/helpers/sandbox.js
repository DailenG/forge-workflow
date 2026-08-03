"use strict";

/*
 * Disposable working directories for the protection tests.
 *
 * Every path here comes from fs.mkdtemp under the system temp directory with
 * the forge selftest prefix, and every removal goes through the tool's own
 * removeDisposable, which refuses anything that is not such a directory. No
 * test ever names a directory to delete.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const GUARD_SRC = path.join(REPO_ROOT, "templates", "history-guard.js");
const TOOL_SRC = path.join(REPO_ROOT, "templates", "branch-protection.js");
const LEFTHOOK_SRC = path.join(REPO_ROOT, "templates", "lefthook.yml");

const tool = require(TOOL_SRC);

/*
 * A stand-in project: .forge/history-guard.js present, protection state
 * naming main as the default branch, and nothing else. Callers add what a
 * particular case needs.
 */
function makeSandbox(options) {
  const opts = options || {};
  const root = tool.createDisposableRoot();
  fs.mkdirSync(path.join(root, ".forge"), { recursive: true });
  if (opts.guard !== false) {
    fs.copyFileSync(GUARD_SRC, path.join(root, ".forge", "history-guard.js"));
  }
  if (opts.protectionState !== false) {
    fs.writeFileSync(
      path.join(root, ".forge", "protection.json"),
      JSON.stringify(
        Object.assign({ schema: 1, defaultBranch: "main" }, opts.protectionState || {}),
        null,
        2
      ) + "\n",
      "utf8"
    );
  }
  if (opts.lefthook) {
    fs.copyFileSync(LEFTHOOK_SRC, path.join(root, "lefthook.yml"));
    // `lefthook install` writes a dispatcher into .git/hooks. Without it
    // nothing in lefthook.yml runs, so the default sandbox has one and a test
    // that cares about its absence opts out.
    if (opts.lefthookInstalled !== false) {
      const hookDir = path.join(root, ".git", "hooks");
      fs.mkdirSync(hookDir, { recursive: true });
      fs.writeFileSync(
        path.join(hookDir, "pre-push"),
        "#!/bin/sh\nlefthook run pre-push \"$@\"\n",
        "utf8"
      );
    }
  }
  if (opts.files) {
    for (const rel of Object.keys(opts.files)) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, opts.files[rel], "utf8");
    }
  }
  return root;
}

function cleanup(root) {
  tool.removeDisposable(root);
}

function guardPath(root) {
  return path.join(root, ".forge", "history-guard.js");
}

/*
 * A recording stub for the tool's command runner. Handlers are tried in
 * order; the first whose match returns true supplies the reply. An unmatched
 * call is a loud failure rather than a silent empty success, so a test cannot
 * pass because a command it forgot to model quietly did nothing.
 */
function recordingRunner(handlers) {
  const calls = [];
  function run(bin, args, opts) {
    const call = { bin: bin, args: args.slice(), input: (opts && opts.input) || null };
    calls.push(call);
    for (const handler of handlers) {
      if (handler.match(bin, args, opts)) {
        const reply = handler.reply;
        const value = typeof reply === "function" ? reply(bin, args, opts) : reply;
        return Object.assign({ status: 0, stdout: "", stderr: "" }, value);
      }
    }
    return {
      status: 1,
      stdout: "",
      stderr: "test stub: unmodelled call: " + bin + " " + args.join(" "),
    };
  }
  run.calls = calls;
  run.find = function (predicate) {
    return calls.filter(predicate);
  };
  return run;
}

function argsAre(expected) {
  return function (bin, args) {
    return args.join(" ") === expected;
  };
}

function argsStartWith(bin, expected) {
  return function (actualBin, args) {
    return actualBin === bin && args.join(" ").indexOf(expected) === 0;
  };
}

function json(value) {
  return { status: 0, stdout: JSON.stringify(value), stderr: "" };
}

/*
 * The git calls the tool makes while establishing local context. Modelled once
 * so each test only declares the provider behaviour it actually cares about.
 */
function gitContextHandlers(overrides) {
  const o = overrides || {};
  return [
    {
      match: argsAre("remote get-url origin"),
      reply: { status: 0, stdout: (o.remoteUrl || "https://github.com/acme/widget.git") + "\n" },
    },
    {
      match: argsAre("symbolic-ref --short refs/remotes/origin/HEAD"),
      reply: { status: 1, stdout: "", stderr: "not a symbolic ref" },
    },
    { match: argsAre("branch --show-current"), reply: { status: 0, stdout: "main\n" } },
    { match: argsAre("config --get init.defaultBranch"), reply: { status: 1, stdout: "" } },
    { match: argsAre("config --get core.hooksPath"), reply: { status: 1, stdout: "" } },
    { match: argsAre("rev-parse --git-dir"), reply: { status: 0, stdout: ".git\n" } },
  ];
}

module.exports = {
  REPO_ROOT: REPO_ROOT,
  GUARD_SRC: GUARD_SRC,
  TOOL_SRC: TOOL_SRC,
  LEFTHOOK_SRC: LEFTHOOK_SRC,
  tool: tool,
  makeSandbox: makeSandbox,
  cleanup: cleanup,
  guardPath: guardPath,
  recordingRunner: recordingRunner,
  argsAre: argsAre,
  argsStartWith: argsStartWith,
  json: json,
  gitContextHandlers: gitContextHandlers,
};
