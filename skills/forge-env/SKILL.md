---
name: forge-env
description: Phase 2 of the SRS workflow. Verify and provision the Windows toolchain from zero, create the local and GitHub repositories, wire up CodeGraph, testing, documentation, and the git lifecycle guards. Use only when explicitly invoked.
disable-model-invocation: true
---

> **Typography, enforced by hook.** Every file you write, including this phase's markdown deliverables: no em dashes or en dashes, no curly quotes, no ellipsis character, no non-breaking spaces. Plain hyphens and straight quotes only. In PowerShell never use `&&`. A PostToolUse hook reports violations; fix them immediately when it does.


# Phase 2: Workstation, Repository, and Toolchain Bootstrap

You are a build environment engineer preparing a Windows development workstation and standing up a new project repository.

## Read first

Read `docs/SRS.md`, particularly the selected technology stack, the testing strategy, and the documentation plan. If it does not exist or names no stack, stop and say so. Do not guess.

## Core principle

Assume nothing on this machine is ready. Verify everything empirically. Never rely on what is typically installed, what you would expect, or what was true in a previous session. A tool exists only if a command you ran in **this** session proved it.

But only install what is actually missing. Do not reinstall, upgrade, or refresh anything already meeting the version requirement. Do not ask permission for individual detection commands. Detect broadly and quietly, then report once.

## Shell rules

- The shell is PowerShell. Never use the `&&` operator, it is invalid in Windows PowerShell. Use `;` or separate lines
- Never use em dashes in any command, script, config, or file you produce. This is not stylistic, it breaks things downstream
- Straight quotes only
- Prefer commands that fail quietly. Test with `Get-Command` and check for null rather than invoking a binary that may not exist

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

Print a table: Tool, Required Version, Found Version, Status (OK, MISSING, TOO OLD, UNKNOWN). Then list exactly what you intend to install. Then proceed.

Do not wait for approval on routine installs. Do stop and ask before anything that changes system-wide configuration, modifies the registry, disables a security control, or touches an existing installation of a different version.

## Step 3: Install what is missing

Preference order:

1. winget, non-elevated user scope where supported
2. Chocolatey, if already present or winget lacks the package
3. Language-native version managers (nvm, pyenv-win, rustup) where the SRS implies multiple versions
4. Direct vendor installer as a last resort, with a link and published checksum if available

Pin to versions the SRS requires. Where it is silent, choose current stable, not latest preview, and record the choice in `docs/DECISIONS.md`.

## Step 4: Elevation handoff

You cannot elevate yourself. When a step needs administrator rights:

1. State plainly which step needs elevation and why
2. Give exact steps to open an elevated PowerShell: press Win + X then A and approve the UAC prompt, or press Start, type PowerShell, and press Ctrl + Shift + Enter
3. Give one copy-paste block with only that step's commands. No commentary inside the block. No `&&`
4. Give a separate one line verification command, and say what correct output looks like
5. Wait. Do not continue until the user pastes back the result
6. Verify the result yourself. Do not take "it worked" as proof

Batch elevated work. If three steps need admin, hand over one block, not three.

## Step 5: PATH staleness

After installing anything that modifies PATH, the current session will not see it. Either refresh the environment within the session or tell the user a new shell is needed and re-verify. Do not conclude an install failed when the real problem is a stale PATH.

## Step 6: Smoke test the toolchain

The environment is not ready until proven. Create a throwaway minimal project in a temp directory, then build it, run it, and run its test harness. All three must pass.

**Then verify the harness reports failures.** Add a deliberately failing test to the throwaway project and confirm the runner exits non-zero and names the failing test. A misconfigured runner that discovers zero tests usually reports success, and that silent failure will invalidate every green build afterward. Do not skip this.

If the stack targets mobile, confirm the SDK plus an emulator or simulator target is functional.

Clean up the temp project. Report the exact commands and their output.

## Step 7: Local repository

Only after the toolchain smoke test passes:

- Create the project directory if needed and run `git init`
- Configure `user.name` and `user.email` if unset. Ask for the values, do not guess
- Write `.gitignore` **before the first commit**. Cover the stack, IDE files, OS files, build output, `.env`, coverage output, and `.codegraph/`. A secret committed once lives in history forever, so this ordering is not negotiable
- Write `.gitattributes` with sane line ending handling
- Create the directory skeleton the SRS implies, including the test directory layout
- Do not scaffold application code, that is Phase 3

## Step 8: GitHub repository

- Confirm `gh` is installed and authenticated. If not, walk the user through `gh auth login`
- Confirm the repository name
- **Ask explicitly whether the repository should be public or private.** Do not assume. Do not default. Wait for the answer
- Create the repo, set the remote, push the initial commit
- Record the answer and repo URL in `docs/DECISIONS.md`

## Step 9: Git lifecycle guards

Set up the guards that make the branch-per-slice workflow safe, then explain it (see "Explain the workflow" below).

- Install lefthook, or the stack's equivalent hook manager
- Configure a **pre-push** hook that runs build, tests, lint, and a secret scan. The push is refused if any fail. This is the only automated gate before code reaches main, since there is no pull request review
- Add gitleaks or equivalent to the pre-push hook
- Verify the hook actually fires and actually blocks. Make a deliberate failure, attempt a push, and confirm it is refused. A hook that silently does not run is worse than no hook
- Configure a GitHub ruleset on `main` blocking force pushes and deletions. This costs nothing and prevents the one irreversible mistake
- Record in `docs/DECISIONS.md` that `--no-verify` is prohibited

## Step 10: Code intelligence layer

The workflow uses a local code-intelligence layer for impact analysis before edits and as the source for architecture documentation. **CodeGraph (colbymchenry) is the default because it is MIT licensed**, not because it is uniquely capable.

### License gate, before anything else

Read the licensing posture recorded in `docs/SRS.md`. If the project is commercial, internal business tooling, or client work, the layer must be licensed for that use.

**If a code-intelligence tool is already installed and MCP-registered, do not substitute it in automatically.** Capability equivalence is not license equivalence. "Only install what is missing" reasons about capability, and it will happily accept a tool whose license forbids this project's use.

Check the installed tool's actual license before adopting it. Two known cases:

- **CodeGraph** is MIT. Fine for any use
- **GitNexus** is PolyForm Noncommercial. Fine for personal and non-commercial projects. **Not** usable for commercial or internal business tooling without a separate commercial agreement from the author

If an installed tool's license does not cover this project's use, say so plainly, do not adopt it, and install CodeGraph alongside it. Two tools coexisting is the correct outcome, not redundancy to be optimized away. If the license is unclear, ask rather than assume, and note that a repository with no LICENSE file is all rights reserved by default rather than permissive.

Record the tool chosen, its license, and the reasoning in `docs/DECISIONS.md`. A later session must be able to see why this tool and not another.

### Setup

- Install the chosen tool using its non-interactive path so optional upsell prompts never appear
- Run its agent-wiring step so the MCP server is registered with Claude Code. Installing a CLI alone usually does not do this
- Run per-project index initialization from the repository root
- Confirm the index directory is gitignored
- Verify the MCP server is reachable and its tools respond

**Do not assume command names or tool names from memory.** These tools are young and moving fast. Run the help output, enumerate the real subcommands, and enumerate the actual MCP tools exposed to you. Record both lists verbatim in `docs/ENVIRONMENT.md` so later sessions do not rediscover them. If a command named here does not exist, use the real equivalent and note the discrepancy.

Pin the version. Record it. Do not enable auto-update.

### It stays optional

Nothing in the workflow may depend on this layer existing. The SRS, the documentation, and the build must all remain correct if it were removed tomorrow. Use it for structural questions and impact analysis; never make it a prerequisite.

## Step 11: Testing, documentation, and release tooling

Sized to the SRS testing strategy and documentation plan:

- The stack's test framework and runner, if not already present from the smoke test
- Coverage tooling, reporting in a format CI can consume
- A test fixture or factory approach appropriate to the stack, if the SRS calls for one
- The stack's native API reference generator (TypeDoc, Sphinx autodoc, rustdoc, godoc, DocFX, platyPS)
- git-cliff, with a `cliff.toml` configured for conventional commits
- lychee or equivalent for dead link checking
- If the documentation plan calls for web screenshots: Playwright plus shot-scraper, with a `shots.yml` stub
- Do not install a docs site generator yet. Plain markdown under `docs/` rendered by GitHub is the starting point. MkDocs Material is the upgrade path when navigation and search are actually needed

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
- The project's build, test, run, and release commands
- The CodeGraph command and tool reference discovered in Step 10
- The typography rules written out in full, not a pointer to them: no em dashes or en dashes, no curly quotes, no ellipsis character, no non-breaking spaces, straight quotes only, and no `&&` in PowerShell. `CLAUDE.md` is always loaded for the project, so rules written here survive a skill-load miss
- A pointer to the `forge-standards` skill for the remaining engineering standards

**`TODO.md`**, **`docs/traceability.md`**, **`docs/docs-manifest.yml`**, and **`docs/images/MANIFEST.md`** from the templates.

`CONTINUE.md` already exists from Phase 1. Update its header rather than recreating it:

```
Phase: 2
Gate:  IN_PROGRESS   (then PASSED once every Phase 2 gate item is verified)
Mode:  FLOW
```

Commit all of this and push.

## Explain the workflow

Before finishing, explain the lifecycle to the user in plain language, once. They may not have used branch-per-slice, conventional commits, semver, or pre-push hooks before. Keep it to a short paragraph per item and do not condescend:

- Why each slice gets its own branch, and that a bad slice gets deleted rather than reverted
- What the pre-push hook will do, that it will sometimes block them, and that `--no-verify` is off limits
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
- CodeGraph verbatim command list and MCP tool list
- Known gaps, workarounds, anything needing revisiting

Append version choices to `docs/DECISIONS.md`.

## Gate

Stop once the toolchain smoke test passes in both directions, the GitHub repo exists with an initial commit pushed, the pre-push hook is proven to block, CI is green, CodeGraph is verified, and the state files are committed.

Print the summary table. Do not begin implementation. Tell the user to run `/forge` when ready. It will detect that bootstrap is complete and move to the build phase.
