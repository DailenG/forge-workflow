#!/usr/bin/env node
"use strict";

/*
 * Forge managed history-integrity guard (Tier 2 default-branch protection).
 *
 * Installed into a project as .forge/history-guard.js and wired as a pre-push
 * hook. It reads the ref-update records git writes to a pre-push hook's stdin,
 * one per line:
 *
 *     <local ref> <local oid> <remote ref> <remote oid>
 *
 * and refuses two things on the protected branch:
 *
 *   - deletion            (local oid is the null oid)
 *   - non-fast-forward    (remote oid is not an ancestor of the local oid)
 *
 * Ordinary fast-forward pushes pass, including the --no-ff merge commits the
 * forge workflow puts on the default branch, because a merge commit still has
 * the previous tip as an ancestor. Creating the branch for the first time
 * passes, because there is no remote history to lose.
 *
 * TRUST BOUNDARY. This is a local guard. It protects clones that are
 * configured with it. It cannot stop a push from an unconfigured clone, a
 * write through the git host's API or web UI, a deleted or edited hook, or an
 * attacker holding valid credentials. Only server-side protection does that.
 * Tier 1 in .forge/branch-protection.js is preferred wherever the host and
 * account support it; this exists so a plan that forbids server-side
 * protection does not leave the default branch with nothing at all.
 *
 * Exit codes:
 *   0  every proposed update is allowed
 *   1  at least one update is refused by policy
 *   2  the guard could not do its job (no ref records on stdin, malformed
 *      input, or an object it cannot resolve). Fails closed on purpose: a
 *      guard that passes when it cannot see the refs is not a guard.
 *
 * Never bypass this with --no-verify. If it blocks you, it is describing a
 * history-destroying push; fix the push, do not silence the check.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const EXIT_ALLOW = 0;
const EXIT_REJECT = 1;
const EXIT_MISCONFIGURED = 2;

const NULL_OID = /^0+$/;

function isNullOid(oid) {
  return typeof oid === "string" && oid.length > 0 && NULL_OID.test(oid);
}

/*
 * Parse the pre-push stdin payload. Returns { updates, malformed }.
 * A line git did not produce is malformed rather than ignorable: the guard
 * must not silently skip a record it failed to understand.
 */
function parseRefLines(raw) {
  const updates = [];
  const malformed = [];
  const lines = String(raw == null ? "" : raw).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length !== 4) {
      malformed.push(trimmed);
      continue;
    }
    updates.push({
      localRef: parts[0],
      localOid: parts[1],
      remoteRef: parts[2],
      remoteOid: parts[3],
    });
  }
  return { updates, malformed };
}

/*
 * Decide one ref update.
 *
 * isAncestor(ancestor, descendant) must return "yes", "no", or "unknown".
 * "unknown" means git could not resolve one of the objects, which is treated
 * as a refusal: an unverifiable update is not a safe update.
 */
function decide(update, protectedRef, isAncestor) {
  if (update.remoteRef !== protectedRef) {
    return { action: "allow", reason: "not-protected-ref" };
  }
  if (isNullOid(update.localOid)) {
    return { action: "reject", reason: "deletion" };
  }
  if (isNullOid(update.remoteOid)) {
    return { action: "allow", reason: "creation" };
  }
  if (update.localOid === update.remoteOid) {
    return { action: "allow", reason: "no-change" };
  }
  const verdict = isAncestor(update.remoteOid, update.localOid);
  if (verdict === "yes") {
    return { action: "allow", reason: "fast-forward" };
  }
  if (verdict === "no") {
    return { action: "reject", reason: "non-fast-forward" };
  }
  return { action: "unverifiable", reason: "unresolved-object" };
}

function evaluate(raw, protectedBranch, isAncestor) {
  const protectedRef = "refs/heads/" + protectedBranch;
  const { updates, malformed } = parseRefLines(raw);
  const results = [];
  for (const update of updates) {
    results.push({ update, verdict: decide(update, protectedRef, isAncestor) });
  }
  return { updates, malformed, results, protectedRef };
}

function gitAncestorProbe(cwd) {
  return function isAncestor(ancestor, descendant) {
    const res = spawnSync(
      "git",
      ["merge-base", "--is-ancestor", ancestor, descendant],
      { cwd: cwd, encoding: "utf8" }
    );
    if (res.error) return "unknown";
    if (res.status === 0) return "yes";
    if (res.status === 1) return "no";
    return "unknown";
  };
}

function gitCapture(cwd, args) {
  const res = spawnSync("git", args, { cwd: cwd, encoding: "utf8" });
  if (res.error || res.status !== 0) return null;
  return String(res.stdout || "").trim();
}

/*
 * Protected branch resolution, most explicit source first. The recorded
 * default branch in .forge/protection.json is authoritative when present,
 * because that is the branch the protection decision was actually made about.
 *
 * init.defaultBranch deliberately ranks below an existing branch: it states
 * what git would name a branch it creates next, not what this repository's
 * default branch is. A machine configured with init.defaultBranch=master and
 * a repository whose default branch is main is a real and common combination,
 * and trusting the config there would silently protect a branch that does not
 * exist while leaving the real one open.
 */
function resolveProtectedBranch(options) {
  const opts = options || {};
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;

  if (opts.branch) return { branch: opts.branch, source: "argument" };
  if (env.FORGE_PROTECTED_BRANCH) {
    return { branch: env.FORGE_PROTECTED_BRANCH, source: "environment" };
  }

  const statePath = opts.statePath || ".forge/protection.json";
  try {
    const state = JSON.parse(
      fs.readFileSync(path.resolve(cwd, statePath), "utf8")
    );
    if (state && state.defaultBranch) {
      return { branch: state.defaultBranch, source: "protection-state" };
    }
  } catch (err) {
    // No recorded state. Fall through to git.
  }

  const configured = gitCapture(cwd, ["config", "--get", "forge.protectedBranch"]);
  if (configured) return { branch: configured, source: "forge.protectedBranch" };

  const remote = opts.remote || "origin";
  const head = gitCapture(cwd, [
    "symbolic-ref",
    "--short",
    "refs/remotes/" + remote + "/HEAD",
  ]);
  if (head) {
    // Plain string trim, not a regex: a remote may legitimately be named
    // "up.stream" or "fork(a)", and interpolating that into a RegExp would
    // either mis-strip or throw.
    const prefix = remote + "/";
    const short = head.indexOf(prefix) === 0 ? head.slice(prefix.length) : head;
    if (short) return { branch: short, source: "remote-head" };
  }

  for (const candidate of ["main", "master"]) {
    const found = spawnSync(
      "git",
      ["show-ref", "--verify", "--quiet", "refs/heads/" + candidate],
      { cwd: cwd, encoding: "utf8" }
    );
    if (!found.error && found.status === 0) {
      return { branch: candidate, source: "existing-branch" };
    }
  }

  const initDefault = gitCapture(cwd, ["config", "--get", "init.defaultBranch"]);
  if (initDefault) return { branch: initDefault, source: "init.defaultBranch" };

  return { branch: "main", source: "default" };
}

function readStdin() {
  if (process.stdin.isTTY) {
    return { ok: false, reason: "tty" };
  }
  try {
    return { ok: true, data: fs.readFileSync(0, "utf8") };
  } catch (err) {
    return { ok: false, reason: "unreadable", error: err };
  }
}

/*
 * git invokes a pre-push hook as: pre-push <remote-name> <remote-url>. The
 * first positional is therefore the remote actually being pushed to, which
 * matters when a repository has more than one remote with different default
 * branches. --branch and --remote override it for manual invocation.
 */
function parseArgs(argv) {
  const out = { branch: null, remote: null };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--branch" && argv[i + 1]) {
      out.branch = argv[++i];
    } else if (argv[i] === "--remote" && argv[i + 1]) {
      out.remote = argv[++i];
    } else if (argv[i].indexOf("-") !== 0) {
      positional.push(argv[i]);
    }
  }
  if (out.remote === null && positional.length > 0) out.remote = positional[0];
  return out;
}

const MISCONFIGURED_HELP = [
  "forge history guard: NO REF UPDATES ON STDIN",
  "",
  "git hands a pre-push hook one line per ref it is about to update. This",
  "guard received none, so it cannot tell a fast-forward from a force push",
  "and is refusing the push rather than waving it through.",
  "",
  "Almost always this is hook wiring, not your push. Check:",
  "",
  "  lefthook   the pre-push command running this guard needs use_stdin: true",
  "  plain hook .git/hooks/pre-push must exec this script and pass stdin",
  "             through, not consume it first",
  "",
  "Verify the wiring with:  node .forge/branch-protection.js verify",
];

function main(argv, io) {
  const out = (io && io.out) || ((s) => process.stdout.write(s));
  const err = (io && io.err) || ((s) => process.stderr.write(s));
  const cwd = (io && io.cwd) || process.cwd();

  const args = parseArgs(argv);
  const resolved = resolveProtectedBranch({
    cwd: cwd,
    branch: args.branch,
    remote: args.remote,
  });

  const stdin = (io && io.readStdin ? io.readStdin : readStdin)();
  if (!stdin.ok) {
    err(MISCONFIGURED_HELP.join("\n") + "\n");
    return EXIT_MISCONFIGURED;
  }

  const isAncestor = (io && io.isAncestor) || gitAncestorProbe(cwd);
  const evaluated = evaluate(stdin.data, resolved.branch, isAncestor);

  if (evaluated.updates.length === 0 && evaluated.malformed.length === 0) {
    err(MISCONFIGURED_HELP.join("\n") + "\n");
    return EXIT_MISCONFIGURED;
  }

  if (evaluated.malformed.length > 0) {
    err(
      [
        "forge history guard: MALFORMED REF RECORD",
        "",
        "Expected four whitespace separated fields per line. Got:",
      ]
        .concat(evaluated.malformed.map((l) => "  " + l))
        .join("\n") + "\n"
    );
    return EXIT_MISCONFIGURED;
  }

  const rejected = evaluated.results.filter((r) => r.verdict.action === "reject");
  const unverifiable = evaluated.results.filter(
    (r) => r.verdict.action === "unverifiable"
  );

  if (rejected.length === 0 && unverifiable.length === 0) {
    out(
      "forge history guard: ok, " +
        evaluated.results.length +
        " ref update(s) checked against " +
        evaluated.protectedRef +
        "\n"
    );
    return EXIT_ALLOW;
  }

  const lines = [];
  for (const r of rejected) {
    if (r.verdict.reason === "deletion") {
      lines.push("forge history guard: PUSH REFUSED, branch deletion");
      lines.push("");
      lines.push(
        "  " + r.update.remoteRef + " is the protected default branch."
      );
      lines.push("  Deleting it on the remote would take its history with it.");
    } else {
      lines.push("forge history guard: PUSH REFUSED, non-fast-forward");
      lines.push("");
      lines.push("  " + r.update.remoteRef);
      lines.push("    remote is at " + r.update.remoteOid);
      lines.push("    you are pushing " + r.update.localOid);
      lines.push(
        "  The remote commit is not an ancestor of yours, so this push would"
      );
      lines.push("  drop commits that exist on the remote.");
      lines.push("");
      lines.push("  Rebase or merge the remote tip in and push a fast-forward.");
    }
    lines.push("");
  }
  for (const r of unverifiable) {
    lines.push("forge history guard: PUSH REFUSED, cannot verify");
    lines.push("");
    lines.push("  " + r.update.remoteRef);
    lines.push(
      "  git could not resolve " +
        r.update.remoteOid +
        " locally, so whether this is a"
    );
    lines.push(
      "  fast-forward is unknown. Run git fetch and try again. An update that"
    );
    lines.push("  cannot be verified is not allowed through.");
    lines.push("");
  }
  lines.push("--no-verify is prohibited by project standards. Fix the push.");
  err(lines.join("\n") + "\n");

  return rejected.length > 0 ? EXIT_REJECT : EXIT_MISCONFIGURED;
}

module.exports = {
  EXIT_ALLOW: EXIT_ALLOW,
  EXIT_REJECT: EXIT_REJECT,
  EXIT_MISCONFIGURED: EXIT_MISCONFIGURED,
  isNullOid: isNullOid,
  parseRefLines: parseRefLines,
  decide: decide,
  evaluate: evaluate,
  resolveProtectedBranch: resolveProtectedBranch,
  main: main,
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
