---
name: forge-env
description: Phase 2 of the SRS workflow. Verify and provision the Windows toolchain from zero, create the local and GitHub repositories, wire up CodeGraph, testing, documentation, and the git lifecycle guards. Use only when explicitly invoked.
disable-model-invocation: true
---

> Typography and shell rules are in `forge-standards`: ASCII only, and no `&&` in PowerShell. They apply to every file this phase writes.

# Phase 2: Workstation, Repository, and Toolchain Bootstrap

You are a build environment engineer preparing a Windows development workstation and standing up a new project repository.

## Read first

Read `docs/SRS.md`, particularly the selected technology stack, the testing strategy, the observability decisions, and the documentation plan. If it does not exist or names no stack, stop and say so. Read `docs/DESIGN.md` too: the design tier and the verification method behind each `UX-nnn` requirement decide what tooling Step 11a installs.

## Core principle

A tool exists only if a command you ran in this session proved it. Detect broadly and quietly without asking permission for individual detection commands, then report once.

Install only what is actually missing. Do not reinstall, upgrade, or refresh anything already meeting the version requirement.

Prefer detection commands that fail quietly: test with `Get-Command` and check for null rather than invoking a binary that may not exist.

## Step 1: Inventory

Detect and record, without elevation:

- Windows edition and build
- PowerShell version, both Windows PowerShell and PowerShell 7 if present
- winget availability and function
- Chocolatey or Scoop presence
- git version, and whether `user.name` and `user.email` are configured
- GitHub CLI (`gh`) presence and authentication state
- Node.js and npm, needed for tooling even when the stack does not use them
- Every runtime, SDK, compiler, package manager, and CLI the chosen stack requires, with actual versions
- The stack's test runner and coverage tool
- Available disk space
- Whether long path support or developer mode matters for this stack, and its current state

## Step 2: Report

Print a table: Tool, Required Version, Found Version, Status (OK, MISSING, TOO OLD, UNKNOWN). Then list exactly what you intend to install, and proceed.

Routine installs need no approval. Stop and ask before anything that changes system-wide configuration, modifies the registry, disables a security control, or touches an existing installation of a different version.

## Step 3: Install what is missing

Preference order:

1. winget, non-elevated user scope where supported
2. Chocolatey, if already present or winget lacks the package
3. Language-native version managers (nvm, pyenv-win, rustup) where the SRS implies multiple versions
4. Direct vendor installer as a last resort, with a link and published checksum if available

Pin to versions the SRS requires. Where it is silent, choose current stable rather than latest preview, and record the choice in `docs/DECISIONS.md`.

## Step 4: Elevation handoff

You cannot elevate yourself. Elevation is an always-strict gate. When a step needs administrator rights:

1. State which step needs elevation and why
2. Give exact steps to open an elevated PowerShell: press Win + X then A and approve the UAC prompt, or press Start, type PowerShell, and press Ctrl + Shift + Enter
3. Give one copy-paste block with only that step's commands. No commentary inside the block
4. Give a separate one-line verification command, and say what correct output looks like
5. Wait. Do not continue until the user pastes back the result
6. Verify the result yourself rather than treating "it worked" as proof

Batch elevated work. If three steps need admin, hand over one block, not three.

## Step 5: PATH staleness

After installing anything that modifies PATH, the current session will not see it. Either refresh the environment within the session or tell the user a new shell is needed, then re-verify. A stale PATH looks exactly like a failed install.

## Step 6: Smoke test the toolchain

Create a throwaway minimal project in a temp directory, then build it, run it, and run its test harness. All three must pass.

**Then verify the harness reports failures.** Add a deliberately failing test and confirm the runner exits non-zero and names the failing test. A misconfigured runner that discovers zero tests usually reports success, and that silent failure would invalidate every green build afterward.

If the stack targets mobile, confirm the SDK plus an emulator or simulator target is functional.

Clean up the temp project. Report the exact commands and their output.

## Step 7: Local repository

Only after the toolchain smoke test passes:

- Create the project directory if needed and run `git init`
- Configure `user.name` and `user.email` if unset. Ask for the values
- Write `.gitignore` **before the first commit**, covering the stack, IDE files, OS files, build output, `.env`, coverage output, and `.codegraph/`. A secret committed once lives in history forever, so this ordering is not negotiable. Do not ignore `.forge/`: the guards and the record programs have to be committed, or a fresh clone has neither. Ignore `.forge/index.json` specifically, since it is generated and rebuildable
- Write `.gitattributes` with sane line ending handling
- Create the directory skeleton the SRS implies, including the test directory layout
- Do not scaffold application code; that is Phase 3

## Step 8: GitHub repository

- Confirm `gh` is installed and authenticated. If not, walk the user through `gh auth login`
- Confirm the repository name
- **Ask explicitly whether the repository should be public or private.** This is an always-strict gate: do not assume, do not default, wait for the answer
- Create the repo, set the remote, push the initial commit
- Record the answer and repo URL in `docs/DECISIONS.md`

## Step 9: Git lifecycle guards

Set up the guards that make the branch-per-slice workflow safe, then explain it (see "Explain the workflow" below).

- Install lefthook, or the stack's equivalent hook manager
- Copy `templates/lefthook.yml` and fill in the stack's real commands
- Configure a **pre-push** hook that runs build, tests, lint, and a secret scan, refusing the push if any fail. This is the only automated gate before code reaches main, since there is no pull request review
- Add gitleaks or equivalent to the pre-push hook
- **Prove the hook blocks.** Make a deliberate failure, attempt a push, and confirm it is refused. A hook that silently does not run is worse than no hook
- Record in `docs/DECISIONS.md` that `--no-verify` is prohibited

## Step 9a: Default-branch history protection

The policy, stated without reference to any host: **the default branch must not be deletable and must not accept a non-fast-forward update.** Ordinary fast-forward pushes and this workflow's `--no-ff` merges must keep working.

Two mechanisms satisfy that. Take the strongest one this repository and account actually support, and record which.

**Tier 1, server side.** The git host enforces it for every writer. Preferred whenever available.

**Tier 2, managed local.** A pre-push guard enforces the same two rules in every clone configured with it. Used when the host has no such feature, the plan withholds it, or the token lacks the permission.

Tier 2 exists because server-side protection of a private repository is a paid feature on some hosts. GitHub personal free accounts answer `Upgrade to GitHub Pro or make this repository public to enable this feature`. **A paid plan is not a baseline requirement for forge, and a repository is never made public to satisfy a gate.** Repository visibility is only ever what the user chose in Step 8.

Copy `templates/branch-protection.js` and `templates/history-guard.js` into `.forge/` in the project, commit them, then:

```powershell
node .forge/branch-protection.js detect
node .forge/branch-protection.js apply
```

`apply` probes the provider (GitHub, GitLab, self-hosted, or unrecognised), takes tier 1 if the host grants it, otherwise installs and proves tier 2, and writes `.forge/protection.json` with the provider, the mechanism, and the verification evidence. It never issues a visibility change.

With lefthook, three things have to be true, and `templates/lefthook.yml` already does all three:

- The guard declares `use_stdin: true`. That is what forwards git's ref-update records to it; without them the guard fails closed and blocks every push.
- The guard sorts first. lefthook orders commands by `priority`, then by the leading number in the command name, then alphabetically, **never** by their position in the file, which is why it is named `00_history`.
- The hook sets `piped: true`, so the build and test commands do not run after the history check has already refused.

`lefthook install` must also have been run, or nothing in `lefthook.yml` executes at all. Confirm all of it with:

```powershell
node .forge/branch-protection.js verify
```

Verification uses disposable repositories in a temp directory and proves a fast-forward push is accepted, a protected-branch deletion is refused, a non-fast-forward push is refused, and the quality checks still run. **Never test a destructive push against the project's real remote.**

### Say the limitation once

When tier 2 is selected, tell the user plainly, once, using the reason `apply` actually reported rather than assuming it was the plan:

> This account's plan does not allow server-side branch protection on a private repository. I have installed a local pre-push guard instead, which blocks deleting or rewriting `main` from this clone. It does not stop a push from an unconfigured clone, a change made through the web UI or API, a deleted hook, or someone with your credentials. Making the repository public would enable the server-side version; I have not done that and will not without you asking.

In FLOW mode, proceed. Ask for a decision only when the SRS actually requires server-side enforcement, or when more than one writer has push access. Do not raise it again, and do not repeat the upgrade suggestion.

Record in `docs/DECISIONS.md`: the provider, which tier is in force, the mechanism, why tier 1 was unavailable if it was, that visibility was unchanged, and the trust boundary.

## Step 10: Code intelligence layer

The workflow uses a local code-intelligence layer for impact analysis before edits and as the source for architecture documentation. **CodeGraph (colbymchenry) is the default because it is MIT licensed**, not because it is uniquely capable.

### License gate, before anything else

Read the licensing posture recorded in `docs/SRS.md`. If the project is commercial, internal business tooling, or client work, the layer must be licensed for that use.

**If a code-intelligence tool is already installed and MCP-registered, do not adopt it automatically.** Capability equivalence is not license equivalence, and "only install what is missing" reasons about capability alone. Two known cases:

- **CodeGraph** is MIT. Fine for any use
- **GitNexus** is PolyForm Noncommercial. Fine for personal and non-commercial projects, **not** for commercial or internal business tooling without a separate commercial agreement

If an installed tool's license does not cover this project's use, say so, do not adopt it, and install CodeGraph alongside it. Two tools coexisting is the correct outcome. If the license is unclear, ask; a repository with no LICENSE file is all rights reserved by default.

Record the tool chosen, its license, and the reasoning in `docs/DECISIONS.md`.

### Setup

- Install the chosen tool using its non-interactive path so optional upsell prompts never appear
- Run its agent-wiring step so the MCP server is registered with Claude Code. Installing a CLI alone usually does not do this
- Run per-project index initialization from the repository root
- Confirm the index directory is gitignored
- Confirm the MCP server is reachable and its tools respond
- These tools move fast, so enumerate the real subcommands from help output and the actual MCP tools exposed to you rather than relying on remembered names. Record both lists verbatim in `docs/ENVIRONMENT.md`
- Pin the version, record it, and do not enable auto-update

### It stays optional

Nothing in the workflow may depend on this layer existing. The SRS, the documentation, and the build must all remain correct if it were removed tomorrow. Use it for structural questions and impact analysis, never as a prerequisite.

## Step 11: Testing, documentation, and release tooling

Sized to the SRS testing strategy and documentation plan:

- The stack's test framework and runner, if not already present from the smoke test
- Coverage tooling, reporting in a format CI can consume
- A test fixture or factory approach appropriate to the stack, if the SRS calls for one
- The stack's native API reference generator (TypeDoc, Sphinx autodoc, rustdoc, godoc, DocFX, platyPS)
- git-cliff, with a `cliff.toml` configured for conventional commits
- lychee or equivalent for dead link checking
- If the documentation plan calls for web screenshots: Playwright plus shot-scraper, with a `shots.yml` stub
- No docs site generator yet. Plain markdown under `docs/` rendered by GitHub is the starting point; MkDocs Material is the upgrade path when navigation and search are actually needed

## Step 11a: Surface verification and observability tooling

`docs/DESIGN.md` names a verification method per `UX-nnn` requirement, and the SRS observability section names a log destination and format. Both need a tool by the first slice, so install them here, sized to the design tier.

For the design tier in play:

- **GUI, web.** A browser driver the tests can use (Playwright or the stack's equivalent), shot-scraper for screenshots, and an accessibility scanner (axe-core, or the driver's built-in audit). Prove all three run against a throwaway page
- **GUI, desktop or mobile.** Whatever driver the stack actually supports, and a working way to capture a window or simulator screenshot. Where no driver exists, say so plainly: those `UX-nnn` requirements verify by task walkthrough and captured screenshot instead, and the manual entries go in `docs/images/MANIFEST.md`
- **CLI or TUI.** A harness that captures stdout, stderr, and exit code separately, so output shape is testable rather than eyeballed
- **API.** The doc example runner for the stack (doctest, doc-tests, or a test that executes the README examples), so a shipped example cannot rot silently

Then the observability layer, matching what the SRS decided:

- The structured logging library, or the standard library if the decision was that plain is enough. Pin it and record it
- A human-readable formatter for development, when the production format is machine-readable
- The error reporting or crash-report path, only if the SRS calls for one. It stays off in development
- A one-command way to see the logs while developing, and record that command in `CLAUDE.md`

Do not install a metrics stack, a tracing backend, or an analytics SDK the SRS did not ask for. Record what was installed and what was deliberately skipped in `docs/ENVIRONMENT.md`.

### Optional integrations, offered rather than assumed

If Phase 1 chose one, set it up now; if Phase 1 did not raise it, offer the list once here, in one message, and take "none" as an answer. `forge-design` carries what each one contributes and the rules that keep it from becoming a dependency.

```powershell
claude plugin install frontend-design@claude-plugins-official
claude plugin install figma@claude-plugins-official
claude plugin install chrome-devtools-mcp@claude-plugins-official
claude plugin install playwright@claude-plugins-official
```

`frontend-design` is one always-on skill for GUI tiers and adds no commands. `figma` and `chrome-devtools-mcp` bundle MCP servers, so confirm the server is reachable and its tools respond, the same check the code-intelligence layer gets. Claude Design is a hosted product rather than a plugin: nothing installs, the user works at `claude.com/product/design`, and what arrives here is a handoff bundle plus design system decisions, which go into `docs/design/` and the brief.

Record the choice, including a declined one, in `docs/DECISIONS.md` and in `docs/ENVIRONMENT.md`. Nothing in the build, the docs, or the tests may require any of them.

## Step 12: CI

Create `.github/workflows/ci.yml` running on every push to `main` and on every branch push:

- build
- tests, with the coverage report published
- lint
- API reference generation
- link check
- the docs drift gate, stubbed to always pass for now with a clear TODO, since Phase 3 implements it

CI must be green before any release tag. It runs after the pre-push hook, so it is the second line of defense, not the first.

## Step 13: State files

Copy the templates from this plugin's `templates/` directory and fill them in.

**`CLAUDE.md`** at the repository root:
- A RESUME PROTOCOL section, first and prominent: at session start, read `CONTINUE.md`, then `TODO.md`, then `docs/SRS.md` before anything else
- The project's build, test, run, release, and log-viewing commands, plus the command that runs the surface verification tooling (driver, screenshots, accessibility scan)
- The CodeGraph command and tool reference discovered in Step 10
- The typography rules written out in full rather than as a pointer: no em dashes or en dashes, no curly quotes, no ellipsis character, no non-breaking spaces, straight quotes only, and no `&&` in PowerShell. `CLAUDE.md` is always loaded for the project, so rules written here survive a skill-load miss
- A pointer to the `forge-standards` skill for the remaining engineering standards, and to `forge-design` for the design tier, the polish checklists, and how UX observations are filed

**`TODO.md`** (with its UX Debt section), **`docs/traceability.md`**, **`docs/docs-manifest.yml`**, and **`docs/images/MANIFEST.md`** from the templates.

`docs/DESIGN.md` already exists from Phase 1. Fill in the tooling it now has for each verification method, and leave the design decisions alone: changing one is an amendment, not bootstrap work.

`CONTINUE.md` already exists from Phase 1. Update its header rather than recreating it:

```
Phase: 2
Gate:  IN_PROGRESS   (then PASSED once every Phase 2 gate item is verified)
Mode:  FLOW
```

Commit all of this and push.

## Explain the workflow

Before finishing, explain the lifecycle to the user in plain language, once. They may not have used branch-per-slice, conventional commits, semver, or pre-push hooks before. A short paragraph per item:

- Why each slice gets its own branch, and that a bad slice gets deleted rather than reverted
- What the pre-push hook will do, that it will sometimes block them, and that `--no-verify` is off limits
- What protects `main` from being deleted or rewritten, which tier is in force here, and what that tier does not cover
- What conventional commit prefixes are for, and that the changelog is generated from them
- What `--no-ff` merges buy: one identifiable unit on main per slice
- What tags and releases mean here, and that tags never move
- That `CONTINUE.md` is what makes "please continue" work in a fresh chat, and that a SessionStart hook loads it automatically

Then offer, once, to walk through any of it in more detail.

## Deliverable

Write `docs/ENVIRONMENT.md`:

- Machine profile: OS build, shell versions
- Full tool table with exact installed versions
- What was already present versus what this session installed
- Every elevated command run
- Every manual step the user performed, so it can be reproduced
- Toolchain smoke test commands and output, **including the deliberate-failure verification**
- Pre-push hook verification evidence
- The default-branch protection section, from `node .forge/branch-protection.js report`. It carries the provider, the tier, the mechanism, the trust boundary, and the case-by-case evidence
- CodeGraph verbatim command list and MCP tool list
- Surface verification tooling: the driver, screenshot path, and accessibility scanner in force per design tier, with the command that proved each, and the `UX-nnn` methods that fall back to a task walkthrough because no driver exists
- Observability layer: logging library and format, the development log command, and what was deliberately not installed
- Known gaps, workarounds, anything needing revisiting

Append version choices to `docs/DECISIONS.md`.

## Gate

### Step 12a: Structured records

New projects start on the record set forge intends, rather than migrating onto it later. Copy `templates/forge-records-lib.js`, `templates/forge-index.js`, `templates/forge-views.js`, `templates/forge-records-lint.js`, and `templates/forge-records-migrate.js` into `.forge/`, create `docs/records/{decisions,tasks,requirements,uxd}/` and `docs/records/VOCABULARY.md` seeded with the ID prefixes the SRS actually uses, and commit them. The migration program ships alongside them because an existing project reaching this capability through backfill needs it; a new project never runs it.

Record `records: backfilled` in the `Capabilities:` line of `CONTINUE.md`.

The pre-push hook gains the two record gates from `templates/lefthook.yml`, `05_records` and `06_views`. Both pass `--if-present`, so they stay inert until `docs/records/` exists rather than blocking a project that has not reached this step.

Stop once the toolchain smoke test passes in both directions, the remote repo exists with an initial commit pushed, the pre-push hook is proven to block, **default-branch history protection is verified at either tier** (`node .forge/branch-protection.js gate` exits 0), CI is green, CodeGraph is verified, the tooling each `UX-nnn` verification method needs is installed and proven or its absence is recorded with the fallback method, and the state files are committed.

A host that withholds server-side protection behind a paid plan is not a failed gate. Verified local enforcement with its trust boundary recorded satisfies it.

### Atomic Phase 2 completion

Completing Phase 2 is one transition, not a series of edits: update every completion record before committing any of them. A record committed on its own contradicts the ones still stale, and the next session reads that as a record-versus-reality discrepancy and stops rather than building on it.

1. `CONTINUE.md`, describing the state that exists after the completion commit rather than during it:
   - `Phase: 2`
   - `Gate: PASSED`
   - `Current task: begin the Phase 3 build plan`
   - `Branch:` the branch that will carry the commit
   - `Working tree: clean`
   - Next action: invoke `/forge` to begin Phase 3 planning
2. `TODO.md`. It says `Phase 2 environment bootstrap is complete`, never `Phase 2 environment bootstrap is active`. Preserve existing blockers and permanent task IDs such as `T-ENV-001`: move finished environment work to Completed, and carry whatever still applies into the Phase 3 backlog without renumbering it.
3. `docs/ENVIRONMENT.md`, saying Phase 2 is complete, keeping its verification evidence and known gaps.
4. Commit those three together with any other completion-state file, in one conventional commit. Do not commit `pending commit` or similar transient wording; the committed record describes the resulting clean state.
5. After committing, confirm `CONTINUE.md`, `TODO.md`, `docs/ENVIRONMENT.md`, git HEAD, the current branch, and working-tree status all agree. If one disagrees, stop under the record-versus-reality discrepancy gate.

The completed record stays `Phase: 2` with `Gate: PASSED`. The passed gate is the handoff marker, not the phase number.

Print the summary table. Do not begin implementation. Tell the user to run `/forge` when ready; it will detect that bootstrap is complete and move to the build phase.
