#!/usr/bin/env node
"use strict";

/*
 * Forge default-branch protection, capability based and provider neutral.
 *
 * THE POLICY, stated without reference to any host:
 *
 *   The default branch must not be deletable, and must not accept a
 *   non-fast-forward update. Ordinary fast-forward pushes, including the
 *   --no-ff merge commits this workflow puts on the default branch, must keep
 *   working.
 *
 * There are two ways to satisfy that policy, and forge takes the strongest one
 * the repository and account actually support.
 *
 *   Tier 1, server side. The git host enforces it for every writer. Preferred
 *   whenever available. Adapters live in the PROVIDERS table below.
 *
 *   Tier 2, managed local. A pre-push hook (.forge/history-guard.js) enforces
 *   the same two rules in every clone that is configured with it. Used when
 *   the host has no such feature, the account's plan withholds it, or the
 *   token lacks the permission.
 *
 * Tier 2 exists because server-side protection of a PRIVATE repository is a
 * paid feature on some hosts (GitHub personal free accounts answer "Upgrade to
 * GitHub Pro or make this repository public to enable this feature"), and
 * neither buying a plan nor publishing a private repository is an acceptable
 * price for a lifecycle gate. Repository visibility is never changed by this
 * tool; runProvider below refuses to issue a visibility mutation at all.
 *
 * TRUST BOUNDARY of tier 2. It protects configured development clones. It does
 * not protect against an unconfigured clone, a write through the host's API or
 * web UI, a hook that was deleted or edited, or an attacker holding valid
 * credentials. That is a real reduction in guarantee and it is recorded in the
 * state file and the environment report rather than papered over.
 *
 * Subcommands:
 *   detect    report provider, repository, and protection capability
 *   apply     take the strongest available tier and record it
 *   verify    prove the recorded tier is actually in force
 *   selftest  prove the local guard works, using disposable repositories only
 *   gate      answer the bootstrap gate question, exit 0 when satisfied
 *   migrate   re-run detection for a project blocked on a paid-plan ruleset
 *   report    emit the docs/ENVIRONMENT.md section for the recorded protection
 *   status    print the recorded state
 *
 * Add --json to any subcommand for machine-readable output.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const RULESET_NAME = "forge-default-branch-history";
const GUARD_FILENAME = "history-guard.js";
const DEFAULT_GUARD_REL = ".forge/" + GUARD_FILENAME;
const DEFAULT_STATE_REL = ".forge/protection.json";
const SELFTEST_PREFIX = "forge-protection-selftest-";
const STATE_SCHEMA = 1;

const REQUIRED_PROTECTIONS = ["deletion", "non-fast-forward"];

const TRUST_BOUNDARY_LOCAL =
  "Local enforcement only. The managed pre-push guard protects clones " +
  "configured with it. It cannot stop a push from an unconfigured clone, a " +
  "write through the git host API or web UI, a hook that was deleted or " +
  "edited, or an attacker holding valid credentials.";

const TRUST_BOUNDARY_REMOTE =
  "Server-side enforcement. The git host applies the rule to every writer, " +
  "including API and web UI writes, independently of any local clone.";

/* ------------------------------------------------------------------ *
 * Disposable path handling
 *
 * Every recursive delete in this file goes through removeDisposable, which
 * refuses anything that is not a directory this process created under the
 * system temp directory with the selftest prefix. No unresolved path, no
 * workspace root, no home directory, no broad parent.
 * ------------------------------------------------------------------ */

function tempBase() {
  return fs.realpathSync(os.tmpdir());
}

function createDisposableRoot() {
  return fs.realpathSync(fs.mkdtempSync(path.join(tempBase(), SELFTEST_PREFIX)));
}

function disposableRejection(target) {
  if (typeof target !== "string" || target.trim() === "") {
    return "path is empty";
  }
  const base = tempBase();
  let real;
  try {
    real = fs.realpathSync(path.resolve(target));
  } catch (err) {
    return "path does not resolve";
  }
  if (real === base) return "path is the temp root itself";
  try {
    if (real === fs.realpathSync(os.homedir())) return "path is the home directory";
  } catch (err) {
    // No resolvable home directory. The checks below still apply.
  }
  if (real === fs.realpathSync(process.cwd())) return "path is the working directory";
  const rel = path.relative(base, real);
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    return "path is outside the system temp directory";
  }
  const firstSegment = rel.split(path.sep)[0];
  if (firstSegment.indexOf(SELFTEST_PREFIX) !== 0) {
    return "path is not a forge selftest directory (prefix " + SELFTEST_PREFIX + ")";
  }
  return null;
}

function removeDisposable(target) {
  const rejection = disposableRejection(target);
  if (rejection !== null) {
    throw new Error("refusing recursive delete: " + rejection + ": " + target);
  }
  fs.rmSync(fs.realpathSync(path.resolve(target)), {
    recursive: true,
    force: true,
  });
}

/* ------------------------------------------------------------------ *
 * Remote URL parsing and provider identification
 * ------------------------------------------------------------------ */

function parseRemoteUrl(url) {
  if (typeof url !== "string" || url.trim() === "") return null;
  const raw = url.trim();

  // scp-like: git@host:owner/repo.git
  let m = /^[A-Za-z0-9._-]+@([^:/]+):(.+)$/.exec(raw);
  if (m) return normalizeRemote(m[1], m[2]);

  // scheme://[user@]host[:port]/path
  m = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/.exec(raw);
  if (m) return normalizeRemote(m[1], m[2]);

  // file path or bare local remote
  return { host: null, slug: null, local: true, url: raw };
}

function normalizeRemote(host, repoPath) {
  const cleaned = repoPath.replace(/^\/+/, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  return {
    host: host.toLowerCase(),
    slug: cleaned || null,
    local: false,
    url: null,
  };
}

function identifyProvider(host) {
  if (!host) return "none";
  const h = host.toLowerCase();
  if (h === "github.com" || h === "www.github.com" || /(^|\.)github\./.test(h)) {
    return "github";
  }
  if (h === "gitlab.com" || /(^|\.)gitlab[.-]/.test(h) || /(^|\.)gitlab\./.test(h)) {
    return "gitlab";
  }
  return "unknown";
}

/* ------------------------------------------------------------------ *
 * Failure classification
 *
 * A paid-plan refusal, a missing permission, and a host that has no such
 * feature all end in the same place (tier 2) but must be reported differently,
 * because only one of them is worth a user decision.
 * ------------------------------------------------------------------ */

function classifyRemoteFailure(status, stderr) {
  const text = String(stderr || "");
  if (/upgrade to github pro/i.test(text) || /make this repository public/i.test(text)) {
    return {
      kind: "plan",
      message:
        "The host withheld default-branch protection on this repository " +
        "because of the account plan.",
    };
  }
  if (/upgrade (your |the )?(plan|subscription)/i.test(text) || /premium|ultimate feature/i.test(text)) {
    return { kind: "plan", message: "The host withheld the feature because of the account plan." };
  }
  if (/HTTP 401/i.test(text) || /gh auth login/i.test(text) || /not logged in/i.test(text) || /401 unauthorized/i.test(text)) {
    return { kind: "auth", message: "Not authenticated to the host." };
  }
  if (/HTTP 403/i.test(text) || /must have admin/i.test(text) || /resource not accessible/i.test(text)) {
    return { kind: "permission", message: "The token lacks permission to configure protection." };
  }
  if (status === 127) {
    return { kind: "tooling", message: "The provider CLI is not installed or not on PATH." };
  }
  if (/HTTP 404/i.test(text) || /not found/i.test(text)) {
    return {
      kind: "unsupported-api",
      message: "The host does not expose this protection endpoint.",
    };
  }
  return { kind: "unknown", message: text.trim() || "The host refused without an explanation." };
}

/* ------------------------------------------------------------------ *
 * lefthook wiring inspection
 *
 * The guard must run BEFORE the expensive quality commands, and lefthook only
 * forwards git's ref records to a command that declares use_stdin: true. A
 * guard wired without it receives nothing, fails closed, and blocks every
 * push; catching that here turns a confusing outage into a clear message.
 * ------------------------------------------------------------------ */

function parseLefthookPrePush(text) {
  const lines = String(text || "").split(/\r?\n/);
  let inPrePush = false;
  let commandsIndent = null;
  let commandIndent = null;
  let current = null;
  const commands = [];
  const hook = { parallel: false, piped: false };

  function indentOf(line) {
    const m = /^(\s*)/.exec(line);
    return m[1].length;
  }

  for (const line of lines) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const indent = indentOf(line);
    const body = line.trim();

    if (indent === 0) {
      inPrePush = /^pre-push\s*:/.test(body);
      commandsIndent = null;
      commandIndent = null;
      current = null;
      continue;
    }
    if (!inPrePush) continue;

    if (commandsIndent === null) {
      if (/^parallel\s*:/.test(body)) hook.parallel = /true/i.test(body);
      if (/^piped\s*:/.test(body)) hook.piped = /true/i.test(body);
      if (/^commands\s*:/.test(body)) commandsIndent = indent;
      continue;
    }
    if (indent <= commandsIndent) {
      // Left the commands block while still inside pre-push.
      commandsIndent = null;
      commandIndent = null;
      current = null;
      if (/^parallel\s*:/.test(body)) hook.parallel = /true/i.test(body);
      if (/^piped\s*:/.test(body)) hook.piped = /true/i.test(body);
      if (/^commands\s*:/.test(body)) commandsIndent = indent;
      continue;
    }
    if (commandIndent === null) commandIndent = indent;

    if (indent === commandIndent && /^[A-Za-z0-9_.-]+\s*:\s*$/.test(body)) {
      current = {
        key: body.replace(/\s*:\s*$/, ""),
        run: "",
        useStdin: false,
        priority: null,
        conditional: false,
      };
      commands.push(current);
      continue;
    }
    if (current === null) continue;

    // Only direct children of the command key. A nested mapping such as
    // skip: with its own run: must not overwrite the command's own fields.
    if (indent !== commandIndent + 2) continue;

    if (/^run\s*:/.test(body)) {
      current.run = body.replace(/^run\s*:\s*/, "");
    } else if (/^use_stdin\s*:/.test(body)) {
      current.useStdin = /true/i.test(body);
    } else if (/^priority\s*:/.test(body)) {
      const n = parseInt(body.replace(/^priority\s*:\s*/, ""), 10);
      current.priority = isNaN(n) ? null : n;
    } else if (/^(skip|only)\s*:/.test(body)) {
      current.conditional = true;
    }
  }

  return Object.assign(commands, { hook: hook });
}

/*
 * lefthook does not run commands in the order they appear in the file. It
 * sorts by explicit priority when set, then by the leading number in the
 * command name, then alphabetically. Checking file order would both accept a
 * guard that actually runs last and reject one that actually runs first.
 */
function lefthookExecutionOrder(commands) {
  return commands
    .map((c, i) => Object.assign({}, c, { declared: i }))
    .sort(function (a, b) {
      const ap = a.priority === null ? Infinity : a.priority;
      const bp = b.priority === null ? Infinity : b.priority;
      if (ap !== bp) return ap - bp;
      const an = /^(\d+)/.exec(a.key);
      const bn = /^(\d+)/.exec(b.key);
      if (an && bn && Number(an[1]) !== Number(bn[1])) return Number(an[1]) - Number(bn[1]);
      if (an && !bn) return -1;
      if (!an && bn) return 1;
      if (a.key !== b.key) return a.key < b.key ? -1 : 1;
      return a.declared - b.declared;
    });
}

function checkLefthookWiring(text, guardRef) {
  const parsed = parseLefthookPrePush(text);
  const hook = parsed.hook || { parallel: false, piped: false };
  const ordered = lefthookExecutionOrder(parsed);
  const needle = guardRef || GUARD_FILENAME;
  const index = ordered.findIndex((c) => c.run.indexOf(needle) !== -1);
  if (index === -1) {
    return {
      found: false,
      useStdin: false,
      runsFirst: false,
      ok: false,
      commands: ordered.map((c) => c.key),
      problem:
        "no pre-push command runs " +
        needle +
        ". The history check must be wired into the hook manager.",
    };
  }
  const cmd = ordered[index];
  const problems = [];
  if (!cmd.useStdin) {
    problems.push(
      "the '" +
        cmd.key +
        "' command is missing use_stdin: true, so lefthook will not " +
        "forward git's ref-update records to it"
    );
  }
  if (hook.parallel) {
    problems.push(
      "the pre-push hook sets parallel: true, which leaves the order of the " +
        "history check relative to the quality checks undefined"
    );
  }
  if (index !== 0) {
    problems.push(
      "lefthook runs '" +
        cmd.key +
        "' after " +
        index +
        " other command(s) (it orders by priority, then by the leading number " +
        "in the name, then alphabetically); the history check must run before " +
        "the expensive quality checks"
    );
  }
  if (!hook.piped) {
    problems.push(
      "the pre-push hook is missing piped: true, so the quality checks still " +
        "run after the history check has already refused the push"
    );
  }
  if (cmd.conditional) {
    problems.push(
      "the '" + cmd.key + "' command carries a skip or only condition, so it " +
        "will not always run"
    );
  }
  return {
    found: true,
    key: cmd.key,
    useStdin: cmd.useStdin,
    runsFirst: index === 0,
    piped: hook.piped,
    parallel: hook.parallel,
    ok: problems.length === 0,
    commands: ordered.map((c) => c.key),
    problem: problems.length === 0 ? null : problems.join("; "),
  };
}

const LEFTHOOK_SNIPPET = [
  "pre-push:",
  "  parallel: false",
  "  piped: true",
  "  commands:",
  "    00_history:",
  "      # The leading 00 is what puts this first: lefthook orders by priority,",
  "      # then by the leading number in the name, not by position in the file.",
  "      # use_stdin is what feeds it git's ref records.",
  "      use_stdin: true",
  "      run: node .forge/history-guard.js",
  '      fail_text: "Refused: this push would delete or rewrite default-branch history."',
].join("\n");

const PLAIN_HOOK_MARKER = "forge managed history-integrity guard";

function plainHookBody(guardRel) {
  return [
    "#!/bin/sh",
    "# " + PLAIN_HOOK_MARKER,
    "# git writes one ref-update record per line to this hook's stdin. Keep the",
    "# guard first so a history-destroying push is refused before anything",
    "# expensive runs. Do not consume stdin before it.",
    'node "' + guardRel + '" "$@" || exit $?',
    "exit 0",
    "",
  ].join("\n");
}

/* ------------------------------------------------------------------ *
 * Visibility mutation interlock
 *
 * Making a private repository public would "solve" a paid-plan refusal, and
 * that trade is never forge's to make. Rather than trusting every code path
 * not to do it, the single choke point through which provider calls run
 * refuses to issue one at all.
 * ------------------------------------------------------------------ */

const VISIBILITY_MUTATIONS = [
  /--visibility\b/i,
  /\brepo\s+edit\b[\s\S]*--(public|private|internal)\b/i,
  /"(visibility|private)"\s*:/i,
  /(^|[\s&?=])(visibility|private)=/i,
];

/*
 * Deliberately unconditional. An earlier version skipped the check for calls
 * it believed were GETs, which was wrong twice over: gh accepts -X as well as
 * --method, and gh silently upgrades to POST or PATCH whenever a body is
 * present. Both gaps let a visibility mutation through. No read this tool
 * issues contains any of these patterns, so there is nothing to gain from a
 * fast path and a real hole in having one.
 */
function isVisibilityMutation(bin, args, input) {
  const argv = Array.isArray(args) ? args : [];
  const probe = [bin].concat(argv).join(" ") + " " + String(input || "");
  return VISIBILITY_MUTATIONS.some((re) => re.test(probe));
}

/* ------------------------------------------------------------------ *
 * The tool
 * ------------------------------------------------------------------ */

function createTool(options) {
  const opts = options || {};
  const cwd = opts.cwd || process.cwd();
  const env = opts.env || process.env;
  const guardRel = opts.guardRel || DEFAULT_GUARD_REL;
  const stateRel = opts.stateRel || DEFAULT_STATE_REL;
  const now = opts.now || (() => new Date().toISOString());

  // Provider and context calls are injectable so a test can model a host
  // without a network. The selftest deliberately is not: its whole purpose is
  // to observe what real git really does with a real hook, and a stub there
  // would prove nothing.
  const run = opts.run || defaultRun;
  const realRun = defaultRun;

  function defaultRun(bin, args, runOpts) {
    const o = runOpts || {};
    const candidates =
      process.platform === "win32" ? [bin, bin + ".exe", bin + ".cmd"] : [bin];
    let last = null;
    for (const candidate of candidates) {
      const res = spawnSync(candidate, args, {
        cwd: o.cwd || cwd,
        encoding: "utf8",
        input: o.input,
        env: o.env || env,
        windowsHide: true,
      });
      if (res.error && res.error.code === "ENOENT") {
        last = { status: 127, stdout: "", stderr: String(res.error.message) };
        continue;
      }
      if (res.error) {
        return { status: 127, stdout: "", stderr: String(res.error.message) };
      }
      return {
        status: res.status === null ? 1 : res.status,
        stdout: String(res.stdout || ""),
        stderr: String(res.stderr || ""),
      };
    }
    return last || { status: 127, stdout: "", stderr: bin + " not found" };
  }

  /*
   * Every provider call funnels through here, so a visibility mutation is
   * blocked at the point of execution rather than merely avoided by
   * convention. See isVisibilityMutation at module scope.
   */
  function runProvider(bin, args, runOpts) {
    if (isVisibilityMutation(bin, args, runOpts && runOpts.input)) {
      throw new Error(
        "blocked: this call would change repository visibility. Forge never " +
          "changes visibility to satisfy a protection gate."
      );
    }
    return run(bin, args, runOpts);
  }

  function git(args, runOpts) {
    return run("git", args, runOpts);
  }

  function gitValue(args) {
    const res = git(args);
    if (res.status !== 0) return null;
    const value = res.stdout.trim();
    return value === "" ? null : value;
  }

  function abs(rel) {
    return path.resolve(cwd, rel);
  }

  function readJson(file) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      return null;
    }
  }

  /* ---------------- state ---------------- */

  function readState() {
    return readJson(abs(stateRel));
  }

  function writeState(state) {
    const file = abs(stateRel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n", "utf8");
    return file;
  }

  /* ---------------- detection ---------------- */

  function localDefaultBranch() {
    const remoteHead = gitValue([
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    if (remoteHead) return remoteHead.replace(/^origin\//, "");
    const current = gitValue(["branch", "--show-current"]);
    if (current) return current;
    const configured = gitValue(["config", "--get", "init.defaultBranch"]);
    return configured || "main";
  }

  function detect(detectOpts) {
    const remoteName = (detectOpts && detectOpts.remote) || "origin";
    const url = gitValue(["remote", "get-url", remoteName]);
    const parsed = parseRemoteUrl(url);
    const host = parsed ? parsed.host : null;
    const provider = url === null ? "none" : identifyProvider(host);

    const base = {
      provider: provider,
      host: host,
      remote: remoteName,
      remoteUrl: url,
      repository: parsed ? parsed.slug : null,
      defaultBranch: localDefaultBranch(),
      visibility: null,
      serverSide: "no",
      mechanism: null,
      reason: null,
      cli: null,
    };

    const adapter = ADAPTERS[provider] || ADAPTERS.unknown;
    return adapter.probe(base);
  }

  /* ---------------- GitHub adapter ---------------- */

  function ghJson(args) {
    const res = runProvider("gh", args);
    if (res.status !== 0) {
      return { ok: false, res: res, failure: classifyRemoteFailure(res.status, res.stderr || res.stdout) };
    }
    try {
      return { ok: true, res: res, json: JSON.parse(res.stdout) };
    } catch (err) {
      return {
        ok: false,
        res: res,
        failure: { kind: "unknown", message: "provider returned unparsable JSON" },
      };
    }
  }

  const ADAPTERS = {
    github: {
      probe: function (base) {
        const out = Object.assign({}, base, { cli: "gh" });
        const version = runProvider("gh", ["--version"]);
        if (version.status !== 0) {
          out.serverSide = "unknown";
          out.reason = "the gh CLI is not installed, so GitHub capability cannot be determined";
          return out;
        }
        if (!out.repository) {
          out.serverSide = "unknown";
          out.reason = "the remote URL does not name an owner/repo pair";
          return out;
        }
        const repo = ghJson(["api", "repos/" + out.repository]);
        if (!repo.ok) {
          out.serverSide = repo.failure.kind === "permission" || repo.failure.kind === "auth" ? "no" : "unknown";
          out.reason = repo.failure.message;
          out.failureKind = repo.failure.kind;
          return out;
        }
        const json = repo.json || {};
        out.visibility = json.private ? "private" : "public";
        out.defaultBranch = json.default_branch || out.defaultBranch;
        out.ownerType = json.owner && json.owner.type ? json.owner.type : null;
        out.mechanism = "github-ruleset";

        const admin = json.permissions && json.permissions.admin === true;
        if (json.permissions && !admin) {
          out.serverSide = "no";
          out.failureKind = "permission";
          out.reason = "the authenticated account is not an admin of this repository";
          return out;
        }

        // A private repository on a personal free plan is the known refusal.
        // It is a hint, not a verdict: apply() still asks the host.
        if (out.visibility === "private" && out.ownerType === "User") {
          const user = ghJson(["api", "user"]);
          const plan = user.ok && user.json && user.json.plan ? user.json.plan.name : null;
          out.planHint = plan;
          if (plan && /^free$/i.test(plan)) {
            out.serverSide = "unlikely";
            out.reason =
              "private repository on a personal free plan; GitHub reserves " +
              "rulesets and protected branches for paid plans there";
            return out;
          }
        }
        out.serverSide = "likely";
        out.reason = "GitHub rulesets endpoint is available to this account";
        return out;
      },

      apply: function (capability) {
        const slug = capability.repository;
        const payload = JSON.stringify({
          name: RULESET_NAME,
          target: "branch",
          enforcement: "active",
          conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
          rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
        });

        // includes_parents=false: an org or enterprise ruleset that happens to
        // share this name is not ours, and treating it as ours would make the
        // follow-up read of repos/{slug}/rulesets/{id} 404 and send us down
        // the classic-protection path on a false premise.
        const existing = ghJson([
          "api",
          "--paginate",
          "repos/" + slug + "/rulesets?includes_parents=false",
        ]);
        let existingId = null;
        if (existing.ok && Array.isArray(existing.json)) {
          const match = existing.json.find((r) => r && r.name === RULESET_NAME);
          if (match) existingId = match.id;
        }

        const args = existingId
          ? ["api", "--method", "PUT", "repos/" + slug + "/rulesets/" + existingId, "--input", "-"]
          : ["api", "--method", "POST", "repos/" + slug + "/rulesets", "--input", "-"];
        const res = runProvider("gh", args, { input: payload });

        if (res.status === 0) {
          let id = existingId;
          try {
            const created = JSON.parse(res.stdout);
            if (created && created.id) id = created.id;
          } catch (err) {
            // Keep the id we already had; verify reads by name if it is null.
          }
          return { applied: true, mechanism: "github-ruleset", rulesetId: id };
        }

        const failure = classifyRemoteFailure(res.status, res.stderr || res.stdout);
        if (failure.kind !== "unsupported-api") {
          return { applied: false, failure: failure, mechanism: "github-ruleset" };
        }

        // Older GitHub Enterprise Server has no rulesets. Try the classic
        // branch protection endpoint before giving up on tier 1.
        const legacy = runProvider(
          "gh",
          [
            "api",
            "--method",
            "PUT",
            "repos/" + slug + "/branches/" + encodeURIComponent(capability.defaultBranch) + "/protection",
            "--input",
            "-",
          ],
          {
            input: JSON.stringify({
              required_status_checks: null,
              enforce_admins: true,
              required_pull_request_reviews: null,
              restrictions: null,
              allow_force_pushes: false,
              allow_deletions: false,
            }),
          }
        );
        if (legacy.status === 0) {
          return { applied: true, mechanism: "github-branch-protection" };
        }
        return {
          applied: false,
          failure: classifyRemoteFailure(legacy.status, legacy.stderr || legacy.stdout),
          mechanism: "github-branch-protection",
        };
      },

      verify: function (capability, applied) {
        const slug = capability.repository;
        if (applied.mechanism === "github-branch-protection") {
          const res = ghJson([
            "api",
            "repos/" + slug + "/branches/" + encodeURIComponent(capability.defaultBranch) + "/protection",
          ]);
          if (!res.ok) return { verified: false, detail: res.failure.message };
          const j = res.json || {};
          const deletionBlocked = j.allow_deletions && j.allow_deletions.enabled === false;
          const forceBlocked = j.allow_force_pushes && j.allow_force_pushes.enabled === false;
          return {
            verified: Boolean(deletionBlocked && forceBlocked),
            detail:
              "branch protection: allow_deletions=" +
              String(j.allow_deletions && j.allow_deletions.enabled) +
              " allow_force_pushes=" +
              String(j.allow_force_pushes && j.allow_force_pushes.enabled),
          };
        }

        const res = ghJson([
          "api",
          "--paginate",
          "repos/" + slug + "/rulesets?includes_parents=false",
        ]);
        if (!res.ok) return { verified: false, detail: res.failure.message };
        const list = Array.isArray(res.json) ? res.json : [];
        const summary = list.find((r) => r && r.name === RULESET_NAME);
        if (!summary) {
          return { verified: false, detail: "no ruleset named " + RULESET_NAME + " on the repository" };
        }
        const full = ghJson(["api", "repos/" + slug + "/rulesets/" + summary.id]);
        if (!full.ok) return { verified: false, detail: full.failure.message };
        const j = full.json || {};
        const types = (j.rules || []).map((r) => r && r.type);
        const active = String(j.enforcement || "").toLowerCase() === "active";
        const hasDeletion = types.indexOf("deletion") !== -1;
        const hasNonFf = types.indexOf("non_fast_forward") !== -1;
        return {
          verified: Boolean(active && hasDeletion && hasNonFf),
          detail:
            "ruleset " +
            summary.id +
            " enforcement=" +
            String(j.enforcement) +
            " rules=[" +
            types.join(", ") +
            "]",
        };
      },
    },

    gitlab: {
      probe: function (base) {
        const out = Object.assign({}, base, { cli: "glab", mechanism: "gitlab-protected-branch" });
        const version = runProvider("glab", ["--version"]);
        if (version.status !== 0) {
          out.serverSide = "unknown";
          out.reason = "the glab CLI is not installed, so GitLab capability cannot be determined";
          return out;
        }
        if (!out.repository) {
          out.serverSide = "unknown";
          out.reason = "the remote URL does not name a project path";
          return out;
        }
        const project = ghJsonLike("glab", ["api", "projects/" + encodeURIComponent(out.repository)]);
        if (!project.ok) {
          out.serverSide = "unknown";
          out.reason = project.failure.message;
          out.failureKind = project.failure.kind;
          return out;
        }
        const j = project.json || {};
        out.visibility = j.visibility || null;
        out.defaultBranch = j.default_branch || out.defaultBranch;
        out.serverSide = "likely";
        out.reason = "GitLab protected branches are available on this project";
        return out;
      },

      apply: function (capability) {
        const project = encodeURIComponent(capability.repository);
        const branch = encodeURIComponent(capability.defaultBranch);
        const entry = "projects/" + project + "/protected_branches/" + branch;

        // Explicit access levels. Left unset, GitLab defaults push and merge to
        // Maintainer, which would stop every Developer pushing to the default
        // branch at all. The policy is about deletion and force pushes, not
        // about who may push, so 30 (Developer) preserves ordinary pushes.
        const settings =
          "?name=" +
          branch +
          "&allow_force_push=false&push_access_level=30&merge_access_level=30";

        // Already protected is not a failure. GitLab answers 409 on a repeat
        // POST, and treating that as "server-side unavailable" would downgrade
        // a correctly protected project to tier 2 and record a false reason.
        const existing = ghJsonLike("glab", ["api", entry]);
        if (existing.ok) {
          const j = existing.json || {};
          if (j.allow_force_push === false) {
            return { applied: true, mechanism: "gitlab-protected-branch", preexisting: true };
          }
          const patched = runProvider("glab", [
            "api",
            "--method",
            "PATCH",
            entry + "?allow_force_push=false",
          ]);
          if (patched.status === 0) {
            return { applied: true, mechanism: "gitlab-protected-branch" };
          }
          return {
            applied: false,
            mechanism: "gitlab-protected-branch",
            failure: classifyRemoteFailure(patched.status, patched.stderr || patched.stdout),
          };
        }

        const res = runProvider("glab", [
          "api",
          "--method",
          "POST",
          "projects/" + project + "/protected_branches" + settings,
        ]);
        if (res.status === 0) {
          return { applied: true, mechanism: "gitlab-protected-branch" };
        }
        return {
          applied: false,
          mechanism: "gitlab-protected-branch",
          failure: classifyRemoteFailure(res.status, res.stderr || res.stdout),
        };
      },

      verify: function (capability) {
        const project = encodeURIComponent(capability.repository);
        const res = ghJsonLike("glab", [
          "api",
          "projects/" + project + "/protected_branches/" + encodeURIComponent(capability.defaultBranch),
        ]);
        if (!res.ok) return { verified: false, detail: res.failure.message };
        const j = res.json || {};

        // allow_force_push already defaults to false, so asserting only that
        // would pass for any protected-branch entry created by anyone. Require
        // the entry to name this branch, to block force pushes, and to leave
        // pushing possible, which is what deletion protection on GitLab rides
        // on: a protected branch cannot be deleted.
        const named = j.name === capability.defaultBranch;
        const forceBlocked = j.allow_force_push === false;
        const pushable =
          Array.isArray(j.push_access_levels) && j.push_access_levels.length > 0;
        return {
          verified: Boolean(named && forceBlocked && pushable),
          detail:
            "protected branch " +
            String(j.name) +
            " allow_force_push=" +
            String(j.allow_force_push) +
            " push_access_levels=" +
            (Array.isArray(j.push_access_levels)
              ? j.push_access_levels.map((a) => a && a.access_level).join(",")
              : "none"),
        };
      },
    },

    unknown: {
      probe: function (base) {
        const out = Object.assign({}, base);
        out.serverSide = "no";
        out.failureKind = "unsupported";
        out.reason =
          base.provider === "none"
            ? "no git remote is configured, so there is no server to enforce protection"
            : "no adapter recognises the host " +
              String(base.host) +
              ", so server-side capability is unknown and cannot be relied on";
        return out;
      },
      apply: function () {
        return {
          applied: false,
          mechanism: null,
          failure: {
            kind: "unsupported",
            message: "no server-side protection adapter for this provider",
          },
        };
      },
      verify: function () {
        return { verified: false, detail: "no server-side mechanism to verify" };
      },
    },
  };

  ADAPTERS.none = ADAPTERS.unknown;

  function ghJsonLike(bin, args) {
    const res = runProvider(bin, args);
    if (res.status !== 0) {
      return { ok: false, res: res, failure: classifyRemoteFailure(res.status, res.stderr || res.stdout) };
    }
    try {
      return { ok: true, res: res, json: JSON.parse(res.stdout) };
    } catch (err) {
      return { ok: false, res: res, failure: { kind: "unknown", message: "provider returned unparsable JSON" } };
    }
  }

  function adapterFor(provider) {
    return ADAPTERS[provider] || ADAPTERS.unknown;
  }

  /* ---------------- tier 2 installation ---------------- */

  function hookManager() {
    for (const name of ["lefthook.yml", "lefthook.yaml", ".lefthook.yml", ".lefthook.yaml"]) {
      const file = abs(name);
      if (fs.existsSync(file)) return { manager: "lefthook", file: file, name: name };
    }
    return { manager: "none", file: null, name: null };
  }

  /*
   * Where git will actually look for hooks. core.hooksPath moves it, and a
   * hook written to .git/hooks when core.hooksPath points elsewhere is a file
   * git never runs. Checking this is the difference between "a hook exists"
   * and "a hook will fire".
   */
  function hooksDir() {
    const configured = gitValue(["config", "--get", "core.hooksPath"]);
    if (configured) return path.resolve(cwd, configured);
    return path.join(gitDir(), "hooks");
  }

  /*
   * Read-only. Reports whether the guard is wired and live, without writing
   * anything. verify() uses this rather than installLocal, because an install
   * that repairs what it is checking can never observe a deleted hook.
   */
  function inspectLocal() {
    const guardFile = abs(guardRel);
    if (!fs.existsSync(guardFile)) {
      return {
        installed: false,
        manager: null,
        problem:
          "the managed guard is missing at " +
          guardRel +
          ". Copy templates/history-guard.js there before wiring the hook.",
      };
    }

    const hookPath = path.join(hooksDir(), "pre-push");
    const hookExists = fs.existsSync(hookPath);
    const hookBody = hookExists ? fs.readFileSync(hookPath, "utf8") : "";

    const manager = hookManager();
    if (manager.manager === "lefthook") {
      const wiring = checkLefthookWiring(fs.readFileSync(manager.file, "utf8"), GUARD_FILENAME);
      const dispatches = hookExists && /lefthook/i.test(hookBody);
      const problems = [];
      if (!wiring.ok) problems.push(wiring.problem);
      if (!dispatches) {
        problems.push(
          "no pre-push hook at " +
            hookPath +
            " dispatches to lefthook, so nothing in lefthook.yml runs. Run " +
            "lefthook install"
        );
      }
      return {
        installed: problems.length === 0,
        manager: "lefthook",
        managerFile: manager.name,
        hookPath: hookPath,
        wiring: wiring,
        problem: problems.length === 0 ? null : problems.join("; "),
        requiredSnippet: wiring.ok ? null : LEFTHOOK_SNIPPET,
      };
    }

    if (!hookExists) {
      return {
        installed: false,
        manager: "git",
        hookPath: hookPath,
        problem: "no pre-push hook at " + hookPath,
        requiredSnippet: plainHookBody(guardRel),
      };
    }
    if (hookBody.indexOf(PLAIN_HOOK_MARKER) === -1) {
      return {
        installed: false,
        manager: "git",
        hookPath: hookPath,
        problem:
          "the pre-push hook at " +
          hookPath +
          " was not written by forge and does not reference the guard",
        requiredSnippet: plainHookBody(guardRel),
      };
    }
    return { installed: true, manager: "git", hookPath: hookPath, problem: null };
  }

  function installLocal() {
    const guardFile = abs(guardRel);
    if (!fs.existsSync(guardFile)) {
      return {
        installed: false,
        problem:
          "the managed guard is missing at " +
          guardRel +
          ". Copy templates/history-guard.js there before wiring the hook.",
      };
    }

    const manager = hookManager();
    if (manager.manager === "lefthook") {
      // Never rewrite someone's lefthook.yml. Report what it needs.
      return inspectLocal();
    }

    const hookPath = path.join(hooksDir(), "pre-push");
    if (fs.existsSync(hookPath)) {
      const existing = fs.readFileSync(hookPath, "utf8");
      if (existing.indexOf(PLAIN_HOOK_MARKER) === -1) {
        return {
          installed: false,
          manager: "git",
          problem:
            "a pre-push hook already exists at " +
            hookPath +
            " and was not written by forge. Merge the guard into it by hand " +
            "rather than losing whatever it does.",
          requiredSnippet: plainHookBody(guardRel),
        };
      }
    }
    fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    fs.writeFileSync(hookPath, plainHookBody(guardRel), "utf8");
    try {
      fs.chmodSync(hookPath, 0o755);
    } catch (err) {
      // Windows filesystems without POSIX modes. git runs the hook regardless.
    }
    return { installed: true, manager: "git", hookPath: hookPath, problem: null };
  }

  function gitDir() {
    const dir = gitValue(["rev-parse", "--git-dir"]);
    if (!dir) return path.join(cwd, ".git");
    return path.isAbsolute(dir) ? dir : path.resolve(cwd, dir);
  }

  /* ---------------- selftest ---------------- *
   *
   * Proves the guard on throwaway repositories. Nothing here touches the
   * project's own remote: a bare repository in the system temp directory
   * stands in for the server, and both it and the working clone are removed
   * through removeDisposable when the run ends.
   */

  function selftest() {
    const guardFile = abs(guardRel);
    if (!fs.existsSync(guardFile)) {
      return {
        ok: false,
        evidence: [],
        problem: "the managed guard is missing at " + guardRel,
      };
    }

    const root = createDisposableRoot();
    const evidence = [];
    try {
      const remoteDir = path.join(root, "remote.git");
      const workDir = path.join(root, "work");
      const markerFile = path.join(root, "quality-ran.log");

      sh("git", ["-c", "init.defaultBranch=main", "init", "--bare", remoteDir], root);

      // Park the bare remote's HEAD off main. git itself refuses to delete the
      // branch HEAD points at, and that refusal would mask a guard that did
      // nothing: the delete case has to fail because of the hook, not because
      // of the server.
      sh("git", ["symbolic-ref", "HEAD", "refs/heads/forge-selftest-parking"], remoteDir);

      sh("git", ["-c", "init.defaultBranch=main", "init", workDir], root);
      sh("git", ["config", "user.email", "forge-selftest@example.invalid"], workDir);
      sh("git", ["config", "user.name", "Forge Selftest"], workDir);
      sh("git", ["config", "commit.gpgsign", "false"], workDir);
      sh("git", ["config", "core.hooksPath", ".git/hooks"], workDir);
      sh("git", ["remote", "add", "origin", remoteDir], workDir);

      fs.mkdirSync(path.join(workDir, ".forge"), { recursive: true });
      fs.copyFileSync(guardFile, path.join(workDir, ".forge", GUARD_FILENAME));

      // The guard reads the protected branch from this file first, exactly as
      // it does in a real project.
      fs.writeFileSync(
        path.join(workDir, ".forge", "protection.json"),
        JSON.stringify({ schema: STATE_SCHEMA, defaultBranch: "main" }, null, 2) + "\n",
        "utf8"
      );

      // Stands in for the expensive quality commands. It must run on an
      // allowed push and must NOT run when the guard refuses, which is what
      // proves the ordering.
      fs.writeFileSync(
        path.join(workDir, ".forge", "quality-check.js"),
        [
          '"use strict";',
          'require("fs").appendFileSync(' + JSON.stringify(markerFile) + ', "ran\\n");',
          "process.exit(0);",
          "",
        ].join("\n"),
        "utf8"
      );

      const hookDir = path.join(workDir, ".git", "hooks");
      fs.mkdirSync(hookDir, { recursive: true });
      const hookFile = path.join(hookDir, "pre-push");
      fs.writeFileSync(
        hookFile,
        [
          "#!/bin/sh",
          "# " + PLAIN_HOOK_MARKER,
          'node ".forge/history-guard.js" "$@" || exit $?',
          'node ".forge/quality-check.js" || exit $?',
          "exit 0",
          "",
        ].join("\n"),
        "utf8"
      );
      try {
        fs.chmodSync(hookFile, 0o755);
      } catch (err) {
        // No POSIX modes here. git still executes the hook.
      }

      function markerCount() {
        try {
          return fs.readFileSync(markerFile, "utf8").split("\n").filter(Boolean).length;
        } catch (err) {
          return 0;
        }
      }

      function commit(name, body) {
        fs.writeFileSync(path.join(workDir, name), body, "utf8");
        sh("git", ["add", "-A"], workDir);
        sh("git", ["commit", "-m", "chore: " + name], workDir);
        return sh("git", ["rev-parse", "HEAD"], workDir).stdout.trim();
      }

      const oidA = commit("a.txt", "a\n");
      const push1 = realRun("git", ["push", "origin", "main"], { cwd: workDir });
      record(evidence, "initial branch creation", "accepted", push1.status === 0, push1);
      record(
        evidence,
        "quality checks run on an accepted push",
        "1 run",
        markerCount() === 1,
        null,
        markerCount() + " run(s)"
      );

      const oidB = commit("b.txt", "b\n");
      const push2 = realRun("git", ["push", "origin", "main"], { cwd: workDir });
      record(evidence, "fast-forward push", "accepted", push2.status === 0, push2);
      record(
        evidence,
        "quality checks run again",
        "2 runs",
        markerCount() === 2,
        null,
        markerCount() + " run(s)"
      );

      const del = realRun("git", ["push", "origin", "--delete", "main"], { cwd: workDir });
      record(evidence, "protected branch deletion", "refused, non-zero exit", del.status !== 0, del);
      record(
        evidence,
        "quality checks skipped when the guard refuses a deletion",
        "still 2 runs",
        markerCount() === 2,
        null,
        markerCount() + " run(s)"
      );

      sh("git", ["reset", "--hard", oidA], workDir);
      const oidC = commit("c.txt", "c\n");
      const force = realRun("git", ["push", "--force", "origin", "main"], { cwd: workDir });
      record(evidence, "non-fast-forward push", "refused, non-zero exit", force.status !== 0, force);
      record(
        evidence,
        "quality checks skipped when the guard refuses a rewrite",
        "still 2 runs",
        markerCount() === 2,
        null,
        markerCount() + " run(s)"
      );

      const remoteTip = sh("git", ["rev-parse", "refs/heads/main"], remoteDir).stdout.trim();
      record(
        evidence,
        "remote history survived both refusals",
        "remote tip is still the last accepted commit",
        remoteTip === oidB && remoteTip !== oidC,
        null,
        remoteTip
      );

      const starved = realRun("node", [path.join(workDir, ".forge", GUARD_FILENAME)], {
        cwd: workDir,
        input: "",
      });
      record(
        evidence,
        "guard with no ref records on stdin",
        "fails closed, exit 2",
        starved.status === 2,
        starved
      );

      const ok = evidence.every((e) => e.pass);
      return { ok: ok, evidence: evidence, root: root, problem: ok ? null : "one or more selftest cases failed" };
    } finally {
      removeDisposable(root);
    }
  }

  function sh(bin, args, dir) {
    const res = realRun(bin, args, { cwd: dir });
    if (res.status !== 0) {
      throw new Error(
        "selftest setup failed: " + bin + " " + args.join(" ") + "\n" + res.stderr + res.stdout
      );
    }
    return res;
  }

  function record(evidence, name, expectation, pass, res, observed) {
    evidence.push({
      case: name,
      expectation: expectation,
      observed:
        observed !== undefined && observed !== null
          ? String(observed)
          : "exit " + String(res && res.status),
      pass: Boolean(pass),
    });
  }

  /* ---------------- apply / verify ---------------- */

  function apply(applyOpts) {
    const options2 = applyOpts || {};
    const capability = options2.capability || detect(options2);
    const adapter = adapterFor(capability.provider);
    const attempts = [];

    let applied = null;
    if (capability.serverSide !== "no") {
      applied = adapter.apply(capability);
      attempts.push({
        tier: "remote",
        mechanism: applied.mechanism,
        applied: applied.applied,
        failure: applied.failure || null,
      });
      if (applied.applied) {
        const verified = adapter.verify(capability, applied);
        attempts[attempts.length - 1].verified = verified.verified;
        attempts[attempts.length - 1].detail = verified.detail;
        if (verified.verified) {
          // Tier 1 is in force, but the local guard usually stays wired as a
          // cheap second line. Report its wiring: a guard wired without
          // use_stdin fails closed and would block every push, and nothing
          // else in the tier 1 path would notice.
          const localGuard = installLocal();
          // The guard is optional at tier 1, so its absence is not a failure.
          // A guard that is present but cannot receive ref records is.
          const guardPresent = fs.existsSync(abs(guardRel));
          return finish(capability, {
            tier: "remote",
            mechanism: applied.mechanism,
            verified: true,
            trustBoundary: TRUST_BOUNDARY_REMOTE,
            fallbackReason: null,
            localGuard: {
              wired: localGuard.installed,
              manager: localGuard.manager || null,
              problem: localGuard.problem || null,
            },
            evidence: [
              {
                case: "server-side protection read back from the host",
                expectation: "deletion and non-fast-forward blocked",
                observed: verified.detail,
                pass: true,
              },
              {
                case: "local guard wiring, defence in depth",
                expectation: guardPresent
                  ? "wired and able to receive ref records"
                  : "optional at this tier",
                observed: localGuard.installed
                  ? "wired via " + localGuard.manager
                  : String(localGuard.problem),
                pass: localGuard.installed || !guardPresent,
              },
            ],
            attempts: attempts,
          });
        }
      }
    } else {
      attempts.push({
        tier: "remote",
        mechanism: null,
        applied: false,
        failure: { kind: capability.failureKind || "unsupported", message: capability.reason },
      });
    }

    const remoteFailure =
      (applied && applied.failure) ||
      (attempts[0] && attempts[0].failure) || {
        kind: "unknown",
        message: "server-side protection could not be established",
      };

    const install = installLocal();
    if (!install.installed) {
      return finish(capability, {
        tier: "local",
        mechanism: "managed-pre-push-guard",
        verified: false,
        trustBoundary: TRUST_BOUNDARY_LOCAL,
        fallbackReason: remoteFailure.kind + ": " + remoteFailure.message,
        evidence: [],
        attempts: attempts,
        problem: install.problem,
        requiredSnippet: install.requiredSnippet || null,
      });
    }

    // Always proven, never asserted. There is deliberately no switch that
    // records verified: true without running the proof.
    const proof = selftest();
    return finish(capability, {
      tier: "local",
      mechanism: "managed-pre-push-guard",
      hookManager: install.manager,
      verified: proof.ok,
      trustBoundary: TRUST_BOUNDARY_LOCAL,
      fallbackReason: remoteFailure.kind + ": " + remoteFailure.message,
      evidence: proof.evidence,
      attempts: attempts,
      problem: proof.ok ? null : proof.problem,
    });
  }

  function finish(capability, result) {
    const state = {
      schema: STATE_SCHEMA,
      generatedBy: "forge branch-protection",
      recordedAt: now(),
      provider: capability.provider,
      host: capability.host,
      repository: capability.repository,
      defaultBranch: capability.defaultBranch,
      visibility: capability.visibility,
      visibilityChanged: false,
      tier: result.tier,
      mechanism: result.mechanism,
      hookManager: result.hookManager || null,
      localGuard: result.localGuard || null,
      // Only claim coverage that was actually established. Recording the two
      // behaviours unconditionally would make the gate's coverage check dead
      // code on every state this tool writes.
      protections: result.verified ? REQUIRED_PROTECTIONS.slice() : [],
      verified: Boolean(result.verified),
      trustBoundary: result.trustBoundary,
      fallbackReason: result.fallbackReason,
      attempts: result.attempts,
      evidence: result.evidence,
    };
    if (result.problem) state.problem = result.problem;
    if (result.requiredSnippet) state.requiredSnippet = result.requiredSnippet;
    writeState(state);
    return state;
  }

  function verify(verifyOpts) {
    const state = readState();
    if (!state) {
      return { verified: false, reason: "no protection state recorded at " + stateRel };
    }
    if (state.tier === "remote") {
      const capability = (verifyOpts && verifyOpts.capability) || detect(verifyOpts);
      const adapter = adapterFor(capability.provider);
      const res = adapter.verify(capability, { mechanism: state.mechanism });
      const updated = Object.assign({}, state, {
        verified: res.verified,
        protections: res.verified ? REQUIRED_PROTECTIONS.slice() : [],
        recordedAt: now(),
        evidence: [
          {
            case: "server-side protection read back from the host",
            expectation: "deletion and non-fast-forward blocked",
            observed: res.detail,
            pass: res.verified,
          },
        ],
      });
      writeState(updated);
      return { verified: res.verified, reason: res.detail, state: updated };
    }

    // inspectLocal, not installLocal: a verify that repairs what it is
    // checking can never observe a hook someone deleted.
    const install = inspectLocal();
    if (!install.installed) {
      const updated = Object.assign({}, state, {
        verified: false,
        protections: [],
        recordedAt: now(),
        problem: install.problem,
      });
      writeState(updated);
      return { verified: false, reason: install.problem, state: updated };
    }
    const proof = selftest();
    const updated = Object.assign({}, state, {
      verified: proof.ok,
      protections: proof.ok ? REQUIRED_PROTECTIONS.slice() : [],
      hookManager: install.manager,
      recordedAt: now(),
      evidence: proof.evidence,
    });
    delete updated.problem;
    if (!proof.ok) updated.problem = proof.problem;
    writeState(updated);
    return { verified: proof.ok, reason: proof.problem, state: updated };
  }

  /* ---------------- gate ---------------- */

  function gateStatus(state) {
    const s = state === undefined ? readState() : state;
    if (!s) {
      return {
        satisfied: false,
        tier: null,
        reason: "no protection state recorded; run branch-protection apply",
      };
    }
    if (!s.verified) {
      return {
        satisfied: false,
        tier: s.tier,
        reason: s.problem || "protection is recorded but not verified",
      };
    }
    const missing = REQUIRED_PROTECTIONS.filter(
      (p) => (s.protections || []).indexOf(p) === -1
    );
    if (missing.length > 0) {
      return {
        satisfied: false,
        tier: s.tier,
        reason: "protection does not cover: " + missing.join(", "),
      };
    }
    if (s.tier === "remote") {
      return {
        satisfied: true,
        tier: "remote",
        reason: "server-side enforcement verified via " + s.mechanism,
      };
    }
    if (s.tier === "local") {
      if (!s.trustBoundary || String(s.trustBoundary).trim() === "") {
        return {
          satisfied: false,
          tier: "local",
          reason:
            "local enforcement is verified but its narrower trust boundary is " +
            "not recorded; the gate needs the limitation written down",
        };
      }
      return {
        satisfied: true,
        tier: "local",
        reason:
          "managed local enforcement verified, with the narrower trust " +
          "boundary recorded",
      };
    }
    return { satisfied: false, tier: s.tier, reason: "unrecognised protection tier: " + String(s.tier) };
  }

  /* ---------------- migration ---------------- *
   *
   * For a project whose environment phase stalled on "private repository
   * rulesets need a paid plan". Re-detects, stands up the fallback, and hands
   * back a plan naming exactly which recorded blocker to clear. It edits the
   * state file it owns and nothing else: CONTINUE.md and DECISIONS.md are the
   * lifecycle's files, and forge edits those with the Edit tool.
   */

  const RULESET_BLOCKER = /(ruleset|branch protection|protected branch|force[- ]push|branch deletion)/i;
  const PLAN_MARKER = /(github pro|paid|upgrade|plan|private repositor|billing)/i;

  function classifyBlockers(text) {
    const clear = [];
    const preserve = [];
    const lines = String(text || "").split(/\r?\n/);
    let inBlocked = false;
    for (const line of lines) {
      if (/^#{1,6}\s/.test(line)) {
        inBlocked = /blocked on me/i.test(line);
        continue;
      }
      if (!inBlocked) continue;
      const item = /^\s*(?:[-*+]|\d+\.)\s+(.*\S)\s*$/.exec(line);
      if (!item) continue;
      const body = item[1];
      if (RULESET_BLOCKER.test(body) && PLAN_MARKER.test(body)) {
        clear.push(body);
      } else {
        preserve.push(body);
      }
    }
    return { clear: clear, preserve: preserve };
  }

  function migrate(migrateOpts) {
    const options2 = migrateOpts || {};
    const continuePath = abs(options2.continuePath || "CONTINUE.md");
    let continueText = "";
    try {
      continueText = fs.readFileSync(continuePath, "utf8");
    } catch (err) {
      continueText = "";
    }
    const blockers = classifyBlockers(continueText);
    const previous = readState();
    const state = apply(options2);
    const gate = gateStatus(state);

    return {
      previousTier: previous ? previous.tier : null,
      state: state,
      gate: gate,
      blockers: blockers,
      recordUpdates: {
        continueMd: {
          clear: blockers.clear,
          preserve: blockers.preserve,
          note:
            gate.satisfied && state.tier === "local"
              ? "Default-branch history protection is now satisfied by managed " +
                "local enforcement. Record the narrower trust boundary alongside it."
              : null,
        },
        decisionsMd:
          state.tier === "local"
            ? decisionEntry(state)
            : "Server-side default-branch protection is now in force via " +
              String(state.mechanism) +
              ". Supersedes the earlier blocked ruleset attempt.",
        environmentMd: report(state),
      },
      resumeAt:
        gate.satisfied
          ? "Phase 2 gate item 'default-branch history protection verified' is " +
            "satisfied. Continue the environment phase from the next unmet item."
          : "Protection is still unsatisfied: " + gate.reason,
    };
  }

  function decisionEntry(state) {
    return [
      "Default-branch protection: managed local enforcement (tier 2).",
      "",
      "Server-side protection was not available: " + String(state.fallbackReason) + ".",
      "Repository visibility was left as " + String(state.visibility) + " and was not changed.",
      "",
      "Mechanism: " + String(state.mechanism) + " via " + String(state.hookManager || "git hook") + ".",
      "Trust boundary: " + TRUST_BOUNDARY_LOCAL,
    ].join("\n");
  }

  /* ---------------- report ---------------- */

  function report(state) {
    const s = state === undefined ? readState() : state;
    if (!s) return "## Default-branch protection\n\nNot yet configured.\n";
    const gate = gateStatus(s);
    const lines = [];
    lines.push("## Default-branch protection");
    lines.push("");
    lines.push("| Field | Value |");
    lines.push("|---|---|");
    lines.push("| Provider | " + String(s.provider) + " (" + String(s.host) + ") |");
    lines.push("| Repository | " + String(s.repository) + " |");
    lines.push("| Default branch | " + String(s.defaultBranch) + " |");
    lines.push("| Visibility | " + String(s.visibility) + ", unchanged by forge |");
    lines.push("| Tier | " + (s.tier === "remote" ? "1, server side" : "2, managed local") + " |");
    lines.push("| Mechanism | " + String(s.mechanism) + " |");
    lines.push("| Protects against | " + (s.protections || []).join(", ") + " |");
    lines.push("| Verified | " + (s.verified ? "yes" : "no") + " |");
    lines.push("| Gate | " + (gate.satisfied ? "satisfied" : "NOT satisfied") + ", " + gate.reason + " |");
    lines.push("");
    if (s.fallbackReason) {
      lines.push("Server-side enforcement was not used: " + s.fallbackReason);
      lines.push("");
    }
    lines.push("Trust boundary: " + String(s.trustBoundary));
    lines.push("");
    lines.push("### Verification evidence");
    lines.push("");
    lines.push("| Case | Expected | Observed | Result |");
    lines.push("|---|---|---|---|");
    for (const e of s.evidence || []) {
      lines.push(
        "| " +
          e.case +
          " | " +
          e.expectation +
          " | " +
          String(e.observed) +
          " | " +
          (e.pass ? "pass" : "FAIL") +
          " |"
      );
    }
    lines.push("");
    return lines.join("\n");
  }

  return {
    cwd: cwd,
    guardRel: guardRel,
    stateRel: stateRel,
    detect: detect,
    apply: apply,
    verify: verify,
    selftest: selftest,
    gateStatus: gateStatus,
    migrate: migrate,
    classifyBlockers: classifyBlockers,
    report: report,
    readState: readState,
    writeState: writeState,
    runProvider: runProvider,
    installLocal: installLocal,
    hookManager: hookManager,
    adapters: ADAPTERS,
  };
}

/* ------------------------------------------------------------------ *
 * CLI
 * ------------------------------------------------------------------ */

function main(argv, io) {
  const out = (io && io.out) || ((s) => process.stdout.write(s));
  const err = (io && io.err) || ((s) => process.stderr.write(s));
  const command = argv[0] || "status";
  const json = argv.indexOf("--json") !== -1;
  const tool = createTool({ cwd: (io && io.cwd) || process.cwd() });

  function emit(value, human) {
    if (json) {
      out(JSON.stringify(value, null, 2) + "\n");
    } else {
      out(human + "\n");
    }
  }

  try {
    if (command === "detect") {
      const c = tool.detect();
      emit(
        c,
        [
          "provider:        " + c.provider + " (" + String(c.host) + ")",
          "repository:      " + String(c.repository),
          "default branch:  " + c.defaultBranch,
          "visibility:      " + String(c.visibility),
          "server-side:     " + c.serverSide,
          "reason:          " + String(c.reason),
        ].join("\n")
      );
      return 0;
    }

    if (command === "apply") {
      const state = tool.apply();
      const gate = tool.gateStatus(state);
      emit(
        { state: state, gate: gate },
        [
          "tier:      " + (state.tier === "remote" ? "1, server side" : "2, managed local"),
          "mechanism: " + String(state.mechanism),
          "verified:  " + String(state.verified),
          "gate:      " + (gate.satisfied ? "satisfied" : "NOT satisfied") + ", " + gate.reason,
          state.fallbackReason ? "fallback:  " + state.fallbackReason : "",
          state.problem ? "problem:   " + state.problem : "",
          state.requiredSnippet ? "\nRequired wiring:\n" + state.requiredSnippet : "",
        ]
          .filter(Boolean)
          .join("\n")
      );
      return gate.satisfied ? 0 : 1;
    }

    if (command === "verify") {
      const res = tool.verify();
      emit(res, (res.verified ? "verified" : "NOT verified") + ": " + String(res.reason));
      return res.verified ? 0 : 1;
    }

    if (command === "selftest") {
      const res = tool.selftest();
      emit(
        res,
        res.evidence
          .map((e) => (e.pass ? "pass  " : "FAIL  ") + e.case + " -> " + String(e.observed))
          .join("\n") || String(res.problem)
      );
      return res.ok ? 0 : 1;
    }

    if (command === "gate") {
      const g = tool.gateStatus();
      emit(g, (g.satisfied ? "GATE SATISFIED" : "GATE NOT SATISFIED") + ": " + g.reason);
      return g.satisfied ? 0 : 1;
    }

    if (command === "migrate") {
      const res = tool.migrate();
      emit(
        res,
        [
          "previous tier: " + String(res.previousTier),
          "new tier:      " + String(res.state.tier),
          "gate:          " + (res.gate.satisfied ? "satisfied" : "NOT satisfied"),
          "",
          "clear these blockers from CONTINUE.md:",
          ...(res.blockers.clear.length ? res.blockers.clear.map((b) => "  - " + b) : ["  (none)"]),
          "",
          "preserve these blockers:",
          ...(res.blockers.preserve.length ? res.blockers.preserve.map((b) => "  - " + b) : ["  (none)"]),
          "",
          res.resumeAt,
        ].join("\n")
      );
      return res.gate.satisfied ? 0 : 1;
    }

    if (command === "report") {
      out(tool.report() + "\n");
      return 0;
    }

    if (command === "status") {
      const state = tool.readState();
      const gate = tool.gateStatus(state);
      emit({ state: state, gate: gate }, state ? tool.report(state) : "no protection state recorded");
      return gate.satisfied ? 0 : 1;
    }

    err("unknown subcommand: " + command + "\n");
    return 2;
  } catch (e) {
    err("branch-protection: " + (e && e.message ? e.message : String(e)) + "\n");
    return 2;
  }
}

module.exports = {
  RULESET_NAME: RULESET_NAME,
  SELFTEST_PREFIX: SELFTEST_PREFIX,
  TRUST_BOUNDARY_LOCAL: TRUST_BOUNDARY_LOCAL,
  TRUST_BOUNDARY_REMOTE: TRUST_BOUNDARY_REMOTE,
  REQUIRED_PROTECTIONS: REQUIRED_PROTECTIONS,
  LEFTHOOK_SNIPPET: LEFTHOOK_SNIPPET,
  parseRemoteUrl: parseRemoteUrl,
  identifyProvider: identifyProvider,
  classifyRemoteFailure: classifyRemoteFailure,
  parseLefthookPrePush: parseLefthookPrePush,
  checkLefthookWiring: checkLefthookWiring,
  isVisibilityMutation: isVisibilityMutation,
  disposableRejection: disposableRejection,
  removeDisposable: removeDisposable,
  createDisposableRoot: createDisposableRoot,
  plainHookBody: plainHookBody,
  createTool: createTool,
  main: main,
};

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}
