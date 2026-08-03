"use strict";

/*
 * Capability detection and tier selection.
 *
 * The tool must take server-side enforcement whenever the host and account
 * actually provide it, fall back to the managed local guard when they do not,
 * and never reach for the third option a paid-plan refusal dangles in front of
 * it, which is publishing a private repository.
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const bp = require("../templates/branch-protection.js");
const {
  makeSandbox,
  cleanup,
  recordingRunner,
  argsAre,
  json,
  gitContextHandlers,
} = require("./helpers/sandbox.js");

const PLAN_REFUSAL =
  "gh: Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)";

function githubRepo(overrides) {
  return Object.assign(
    {
      full_name: "acme/widget",
      private: false,
      default_branch: "main",
      owner: { type: "Organization" },
      permissions: { admin: true },
    },
    overrides || {}
  );
}

/*
 * A GitHub stub that keeps its ruleset list, so create and read-back are the
 * same object rather than two unrelated canned answers.
 */
function githubHandlers(options) {
  const opts = options || {};
  const rulesets = opts.rulesets || [];
  const state = { rulesets: rulesets.slice() };
  return {
    state: state,
    handlers: [
      { match: (bin, args) => bin === "gh" && args[0] === "--version", reply: { status: 0, stdout: "gh 2.0\n" } },
      {
        match: (bin, args) => bin === "gh" && args.join(" ") === "api repos/acme/widget",
        reply: () =>
          opts.repoFailure
            ? opts.repoFailure
            : json(githubRepo(opts.repo)),
      },
      {
        match: (bin, args) => bin === "gh" && args.join(" ") === "api user",
        reply: () => json({ plan: { name: opts.plan || "pro" } }),
      },
      {
        match: (bin, args) =>
          bin === "gh" && /repos\/acme\/widget\/rulesets\?includes_parents=false$/.test(args.join(" ")),
        reply: () => json(state.rulesets),
      },
      {
        match: (bin, args) =>
          bin === "gh" &&
          args.indexOf("--method") !== -1 &&
          /rulesets(\/\d+)?$/.test(args[args.indexOf("--method") + 2] || ""),
        reply: () => {
          if (opts.createFailure) return opts.createFailure;
          const created = { id: 42, name: bp.RULESET_NAME };
          state.rulesets.push(created);
          return json(created);
        },
      },
      {
        match: (bin, args) => bin === "gh" && /^api repos\/acme\/widget\/rulesets\/\d+$/.test(args.join(" ")),
        reply: () =>
          json({
            id: 42,
            name: bp.RULESET_NAME,
            enforcement: opts.enforcement || "active",
            rules: opts.rules || [{ type: "deletion" }, { type: "non_fast_forward" }],
          }),
      },
    ],
  };
}

function toolFor(root, handlers, remoteUrl) {
  const run = recordingRunner(gitContextHandlers({ remoteUrl: remoteUrl }).concat(handlers));
  const tool = bp.createTool({
    cwd: root,
    run: run,
    now: () => "2026-08-02T00:00:00.000Z",
  });
  return { tool: tool, run: run };
}

/* ---------------- URL and provider identification ---------------- */

test("remote URLs are parsed in every shape git accepts", () => {
  assert.deepEqual(bp.parseRemoteUrl("https://github.com/acme/widget.git"), {
    host: "github.com",
    slug: "acme/widget",
    local: false,
    url: null,
  });
  assert.deepEqual(bp.parseRemoteUrl("git@github.com:acme/widget.git"), {
    host: "github.com",
    slug: "acme/widget",
    local: false,
    url: null,
  });
  assert.equal(bp.parseRemoteUrl("ssh://git@gitlab.example.net:2222/team/sub/widget.git").slug, "team/sub/widget");
  assert.equal(bp.parseRemoteUrl("/srv/git/widget.git").local, true);
  assert.equal(bp.parseRemoteUrl(""), null);
});

test("providers are identified by host, including self-hosted instances", () => {
  assert.equal(bp.identifyProvider("github.com"), "github");
  assert.equal(bp.identifyProvider("github.acme-corp.net"), "github");
  assert.equal(bp.identifyProvider("gitlab.com"), "gitlab");
  assert.equal(bp.identifyProvider("gitlab.internal.example"), "gitlab");
  assert.equal(bp.identifyProvider("git.internal.example.net"), "unknown");
  assert.equal(bp.identifyProvider("mygithub.example.net"), "unknown");
  assert.equal(bp.identifyProvider(null), "none");
});

/* ---------------- failure classification ---------------- */

test("a paid-plan refusal is classified apart from a permission refusal", () => {
  assert.equal(bp.classifyRemoteFailure(1, PLAN_REFUSAL).kind, "plan");
  assert.equal(
    bp.classifyRemoteFailure(1, "gh: Resource not accessible by integration (HTTP 403)").kind,
    "permission"
  );
  assert.equal(bp.classifyRemoteFailure(1, "gh: Not Found (HTTP 404)").kind, "unsupported-api");
  assert.equal(bp.classifyRemoteFailure(1, "gh auth login required (HTTP 401)").kind, "auth");
  assert.equal(bp.classifyRemoteFailure(127, "gh not found").kind, "tooling");
});

/* ---------------- requirement 1: server-side selection ---------------- */

test("requirement 1: when the host supports it, server-side protection is selected and verified", () => {
  const root = makeSandbox();
  try {
    const gh = githubHandlers({});
    const { tool, run } = toolFor(root, gh.handlers);

    const capability = tool.detect();
    assert.equal(capability.provider, "github");
    assert.equal(capability.repository, "acme/widget");
    assert.equal(capability.serverSide, "likely");

    const state = tool.apply({ capability: capability });
    assert.equal(state.tier, "remote");
    assert.equal(state.mechanism, "github-ruleset");
    assert.equal(state.verified, true);
    assert.deepEqual(state.protections, ["deletion", "non-fast-forward"]);
    assert.equal(state.trustBoundary, bp.TRUST_BOUNDARY_REMOTE);
    assert.equal(state.fallbackReason, null);

    // The ruleset that was actually sent blocks exactly the two things the
    // policy names, and nothing that would break ordinary pushes or --no-ff
    // merges.
    const post = run.calls.find((c) => c.args.indexOf("--method") !== -1);
    const payload = JSON.parse(post.input);
    assert.equal(payload.enforcement, "active");
    assert.deepEqual(
      payload.rules.map((r) => r.type).sort(),
      ["deletion", "non_fast_forward"]
    );
    assert.deepEqual(payload.conditions.ref_name.include, ["~DEFAULT_BRANCH"]);
  } finally {
    cleanup(root);
  }
});

test("tier 1 still reports the local guard's wiring, because a broken one blocks every push", () => {
  const root = makeSandbox({ lefthook: true });
  try {
    // Server-side protection is in force, but the guard is wired without
    // use_stdin. It would fail closed on every push and tier 1 alone would
    // never notice.
    const file = path.join(root, "lefthook.yml");
    fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^\s*use_stdin: true\s*$/m, ""), "utf8");

    const { tool } = toolFor(root, githubHandlers({}).handlers);
    const state = tool.apply();

    assert.equal(state.tier, "remote", "the server-side tier still satisfies the policy");
    assert.equal(state.verified, true);
    assert.equal(state.localGuard.wired, false);
    assert.match(state.localGuard.problem, /use_stdin/);
    const wiring = state.evidence.find((e) => e.case === "local guard wiring, defence in depth");
    assert.equal(wiring.pass, false, "a present but unusable guard must be surfaced");
  } finally {
    cleanup(root);
  }
});

test("a tier 1 project with no local guard file is not penalised for it", () => {
  const root = makeSandbox({ guard: false });
  try {
    const { tool } = toolFor(root, githubHandlers({}).handlers);
    const state = tool.apply();
    assert.equal(state.tier, "remote");
    const wiring = state.evidence.find((e) => e.case === "local guard wiring, defence in depth");
    assert.equal(wiring.pass, true, "the local guard is optional when the host enforces the rule");
    assert.equal(tool.gateStatus(state).satisfied, true);
  } finally {
    cleanup(root);
  }
});

test("an existing forge ruleset is updated rather than duplicated", () => {
  const root = makeSandbox();
  try {
    const gh = githubHandlers({ rulesets: [{ id: 42, name: bp.RULESET_NAME }] });
    const { tool, run } = toolFor(root, gh.handlers);
    const state = tool.apply();
    assert.equal(state.tier, "remote");
    const mutation = run.calls.find((c) => c.args.indexOf("--method") !== -1);
    assert.equal(mutation.args[mutation.args.indexOf("--method") + 1], "PUT");
    assert.match(mutation.args.join(" "), /rulesets\/42/);
  } finally {
    cleanup(root);
  }
});

test("a ruleset that reads back missing a rule is not accepted as verified", () => {
  const root = makeSandbox();
  try {
    const gh = githubHandlers({ rules: [{ type: "deletion" }] });
    const { tool } = toolFor(root, gh.handlers);
    const state = tool.apply();
    assert.equal(state.tier, "local", "an unverifiable remote claim must not satisfy tier 1");
  } finally {
    cleanup(root);
  }
});

/* ---------------- requirement 2: plan and permission rejection ---------------- */

test("requirement 2: a GitHub paid-plan refusal falls back without changing visibility", () => {
  const root = makeSandbox();
  try {
    const gh = githubHandlers({
      repo: { private: true, owner: { type: "User" }, permissions: { admin: true } },
      plan: "free",
      createFailure: { status: 1, stdout: "", stderr: PLAN_REFUSAL },
    });
    const { tool, run } = toolFor(root, gh.handlers);

    const capability = tool.detect();
    assert.equal(capability.visibility, "private");
    assert.equal(capability.serverSide, "unlikely", "a free personal plan is a hint, not a verdict");

    const state = tool.apply();
    assert.equal(state.tier, "local");
    assert.equal(state.mechanism, "managed-pre-push-guard");
    assert.match(state.fallbackReason, /^plan: /);
    assert.equal(state.trustBoundary, bp.TRUST_BOUNDARY_LOCAL);

    // Requirement 4, at the point it matters most: the one moment the host
    // suggests making the repository public.
    assert.equal(state.visibility, "private");
    assert.equal(state.visibilityChanged, false);
    const visibilityCalls = run.calls.filter((c) =>
      /visibility|--public|--private/i.test(c.args.join(" ") + String(c.input || ""))
    );
    assert.deepEqual(visibilityCalls, [], "no call may touch repository visibility");
  } finally {
    cleanup(root);
  }
});

test("requirement 2: a missing admin permission is reported as permission, not plan", () => {
  const root = makeSandbox();
  try {
    const gh = githubHandlers({ repo: { permissions: { admin: false } } });
    const { tool } = toolFor(root, gh.handlers);

    const capability = tool.detect();
    assert.equal(capability.serverSide, "no");
    assert.equal(capability.failureKind, "permission");

    const state = tool.apply();
    assert.equal(state.tier, "local");
    assert.match(state.fallbackReason, /^permission: /);
  } finally {
    cleanup(root);
  }
});

/* ---------------- requirement 3: unknown providers ---------------- */

test("requirement 3: an unrecognised host falls back rather than guessing", () => {
  const root = makeSandbox();
  try {
    const { tool, run } = toolFor(root, [], "https://git.internal.example.net/team/widget.git");
    const capability = tool.detect();
    assert.equal(capability.provider, "unknown");
    assert.equal(capability.serverSide, "no");

    const state = tool.apply();
    assert.equal(state.tier, "local");
    assert.match(state.fallbackReason, /^unsupported: /);
    assert.equal(
      run.calls.filter((c) => c.bin !== "git").length,
      0,
      "no provider CLI should be invoked for a host with no adapter"
    );
  } finally {
    cleanup(root);
  }
});

test("a repository with no remote at all still gets local protection", () => {
  const root = makeSandbox();
  try {
    const run = recordingRunner([
      { match: argsAre("remote get-url origin"), reply: { status: 1, stdout: "", stderr: "no such remote" } },
      { match: argsAre("symbolic-ref --short refs/remotes/origin/HEAD"), reply: { status: 1 } },
      { match: argsAre("branch --show-current"), reply: { status: 0, stdout: "main\n" } },
      { match: argsAre("rev-parse --git-dir"), reply: { status: 0, stdout: ".git\n" } },
    ]);
    const tool = bp.createTool({ cwd: root, run: run, now: () => "2026-08-02T00:00:00.000Z" });
    const state = tool.apply();
    assert.equal(state.provider, "none");
    assert.equal(state.tier, "local");
  } finally {
    cleanup(root);
  }
});

test("GitLab is probed through its own adapter and falls back when glab is absent", () => {
  const root = makeSandbox();
  try {
    const { tool } = toolFor(
      root,
      [{ match: (bin) => bin === "glab", reply: { status: 127, stdout: "", stderr: "glab not found" } }],
      "https://gitlab.com/team/widget.git"
    );
    const capability = tool.detect();
    assert.equal(capability.provider, "gitlab");
    assert.equal(capability.serverSide, "unknown");
    assert.match(capability.reason, /glab CLI is not installed/);

    const state = tool.apply();
    assert.equal(state.tier, "local");
  } finally {
    cleanup(root);
  }
});

/*
 * The GitLab project stub keeps state, because apply reads the protected
 * branch entry before creating it and verify reads it afterwards. A stub that
 * answered the same way both times would hide the ordering.
 */
function gitlabHandlers(options) {
  const opts = options || {};
  const project = encodeURIComponent("team/widget");
  const entry = "api projects/" + project + "/protected_branches/main";
  const state = { branch: opts.existing || null };
  return {
    state: state,
    handlers: [
      { match: (bin, args) => bin === "glab" && args[0] === "--version", reply: { status: 0, stdout: "glab 1\n" } },
      {
        match: (bin, args) => bin === "glab" && args.join(" ") === "api projects/" + project,
        reply: () => json({ visibility: "private", default_branch: "main" }),
      },
      {
        match: (bin, args) => bin === "glab" && args.join(" ") === entry,
        reply: () =>
          state.branch
            ? json(state.branch)
            : { status: 1, stdout: "", stderr: "404 Not Found" },
      },
      {
        match: (bin, args) => bin === "glab" && args.indexOf("--method") !== -1,
        reply: (bin, args) => {
          const query = args[args.length - 1];
          state.branch = {
            name: "main",
            allow_force_push: /allow_force_push=false/.test(query) ? false : true,
            push_access_levels: [{ access_level: 30 }],
          };
          return json(state.branch);
        },
      },
    ],
  };
}

test("GitLab protected branches are used when glab is available", () => {
  const root = makeSandbox();
  try {
    const gl = gitlabHandlers({});
    const { tool, run } = toolFor(root, gl.handlers, "https://gitlab.com/team/widget.git");
    const state = tool.apply();
    assert.equal(state.tier, "remote");
    assert.equal(state.mechanism, "gitlab-protected-branch");
    assert.equal(state.visibility, "private", "a private GitLab project stays private");

    // Left unset, GitLab defaults push access to Maintainer, which would stop
    // Developers pushing at all. The policy is about force pushes and
    // deletion, not about who may push.
    const create = run.calls.find((c) => c.bin === "glab" && c.args.indexOf("POST") !== -1);
    assert.match(create.args.join(" "), /push_access_level=30/);
    assert.match(create.args.join(" "), /allow_force_push=false/);
  } finally {
    cleanup(root);
  }
});

test("a GitLab branch that is already correctly protected is not treated as a failure", () => {
  const root = makeSandbox();
  try {
    const gl = gitlabHandlers({
      existing: { name: "main", allow_force_push: false, push_access_levels: [{ access_level: 30 }] },
    });
    const { tool, run } = toolFor(root, gl.handlers, "https://gitlab.com/team/widget.git");
    const state = tool.apply();
    assert.equal(state.tier, "remote", "a repeat POST would 409; that is not a reason to downgrade");
    assert.equal(state.fallbackReason, null);
    assert.equal(
      run.calls.filter((c) => c.bin === "glab" && c.args.indexOf("POST") !== -1).length,
      0
    );
  } finally {
    cleanup(root);
  }
});

test("a GitLab entry that only exists is not accepted as verified", () => {
  const root = makeSandbox();
  try {
    // allow_force_push already defaults to false, so an entry with no push
    // access levels must not read as proof that pushes still work.
    const gl = gitlabHandlers({
      existing: { name: "main", allow_force_push: false, push_access_levels: [] },
    });
    const { tool } = toolFor(root, gl.handlers, "https://gitlab.com/team/widget.git");
    const state = tool.apply();
    assert.equal(state.tier, "local");
  } finally {
    cleanup(root);
  }
});

/* ---------------- requirement 4: visibility is never forge's to change --------- */

test("requirement 4: the provider choke point refuses to issue a visibility change", () => {
  assert.equal(bp.isVisibilityMutation("gh", ["repo", "edit", "acme/widget", "--visibility", "public"]), true);
  assert.equal(bp.isVisibilityMutation("gh", ["repo", "edit", "acme/widget", "--public"]), true);
  assert.equal(
    bp.isVisibilityMutation("gh", ["api", "--method", "PATCH", "repos/acme/widget", "--input", "-"], '{"private":false}'),
    true
  );
  assert.equal(
    bp.isVisibilityMutation("glab", ["api", "--method", "PUT", "projects/1?visibility=public"]),
    true
  );
  assert.equal(
    bp.isVisibilityMutation("gh", ["api", "--method", "POST", "repos/acme/widget/rulesets", "--input", "-"], "{}"),
    false
  );
  assert.equal(bp.isVisibilityMutation("gh", ["api", "repos/acme/widget"]), false);
  assert.equal(
    bp.isVisibilityMutation("gh", ["api", "--paginate", "repos/acme/widget/rulesets?includes_parents=false"]),
    false
  );

  // gh accepts -X as the short form of --method, and silently upgrades to
  // POST or PATCH whenever a body is present. An interlock that only looked
  // at --method let both of these through.
  assert.equal(bp.isVisibilityMutation("gh", ["api", "-X", "PATCH", "repos/acme/widget", "-f", "private=true"]), true);
  assert.equal(
    bp.isVisibilityMutation("gh", ["api", "repos/acme/widget", "--input", "-"], '{"private": true}'),
    true
  );
  assert.equal(bp.isVisibilityMutation("gh", ["api", "repos/acme/widget", "-f", "visibility=public"]), true);
});

test("requirement 4: a runner that is handed a visibility change never executes it", () => {
  const root = makeSandbox();
  try {
    let executed = false;
    const run = recordingRunner([
      {
        match: () => true,
        reply: () => {
          executed = true;
          return { status: 0, stdout: "{}" };
        },
      },
    ]);
    const tool = bp.createTool({ cwd: root, run: run });
    // runProvider is the single choke point every adapter call goes through.
    assert.throws(
      () => tool.runProvider("gh", ["repo", "edit", "acme/widget", "--visibility", "public"]),
      /never changes visibility/
    );
    assert.throws(
      () =>
        tool.runProvider("gh", ["api", "--method", "PATCH", "repos/acme/widget", "--input", "-"], {
          input: '{"private": false}',
        }),
      /never changes visibility/
    );
    assert.equal(executed, false, "the blocked call must not reach the runner");
  } finally {
    cleanup(root);
  }
});
