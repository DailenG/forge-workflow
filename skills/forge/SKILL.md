---
name: forge
description: Determine where a project stands in its lifecycle and do the next thing. Detects the current phase, reconciles recorded state against the repository, and either continues work or dispatches to the right phase. Use when the user says continue, resume, what's next, pick up where we left off, or invokes forge directly.
---

> **Typography, enforced by hook.** Every file you write, including this phase's markdown deliverables: no em dashes or en dashes, no curly quotes, no ellipsis character, no non-breaking spaces. Plain hyphens and straight quotes only. In PowerShell never use `&&`. A PostToolUse hook reports violations; fix them immediately when it does.


# Forge: lifecycle orchestrator

You are the entry point for this project. The user should never need to remember which phase they are in or which command comes next. That is your job.

Do not ask the user where things stand. Determine it.

## Step 0: Self-check

Before anything else, confirm the plugin's own machinery is working. Do this silently and quickly. Report only when something is wrong.

**The check:** if `CONTINUE.md` exists in the project but no `=== FORGE: PROJECT STATE ===` block appeared in this session's context, the SessionStart hook did not fire.

That single observation covers every cause: Node missing from PATH, `hooks/` changes not reloaded, a non-executable script on Unix-like systems, malformed `hooks.json`, or a wrong directory structure. Do not check for Node directly as a substitute. Node being present does not prove the hook ran.

If `CONTINUE.md` does not exist yet, the hook is correctly silent and there is nothing to infer. Skip to Step 1.

**When the hook did not fire**, diagnose before continuing. Run these directly rather than through a script, since a broken Node runtime would prevent a diagnostic script from running at all:

1. `node --version` and confirm it resolves
2. Confirm `hooks/hooks.json` exists at the plugin root and parses as JSON
3. Confirm `scripts/session-start.js` exists at the plugin root
4. On Linux or macOS, confirm both scripts under `scripts/` are executable

Then report concisely, name the likely cause, and state the consequence plainly:

> The SessionStart hook is not firing, because Node is not on PATH. The workflow still works, but `CONTINUE.md` will no longer be loaded automatically at session start, so cold-start resumption depends on me remembering to read it rather than being guaranteed. Install Node, or say the word and I will convert the hooks to PowerShell.

Then continue with Step 1 regardless. Degraded hooks are a real regression but not a blocker, and stopping the user's work over it would be worse than the problem.

Report this once per session. Do not repeat it on later invocations.

## Step 1: Establish actual state

The SessionStart hook may have already injected `CONTINUE.md` and a git summary. **Verify anyway.** The hook reports what the files claim; it does not check whether the claim is true.

Read, skipping anything absent:

- `CONTINUE.md` (phase, gate, mode, current task, next action)
- `TODO.md`
- `docs/SRS.md`
- `docs/traceability.md`
- `CLAUDE.md` (project commands)

Observe:

- `git status --porcelain`
- `git log --oneline -10`
- `git branch --show-current`
- `git tag --sort=-v:refname`
- Whether a remote exists (`git remote -v`)
- The test suite result, if a test command exists in `CLAUDE.md`
- Latest CI conclusion, if `gh` is available

## Step 2: Reconcile before deciding

Compare the record against reality. Check:

- Does the current branch match the claimed in-progress slice?
- Does the working tree state match what `CONTINUE.md` describes?
- Does the last commit match what is recorded?
- Does the test suite result match? A red suite the record does not mention changes everything
- Does `TODO.md` In Progress agree with the branch and the commits?

**If the record and reality disagree, stop.** Report the discrepancy plainly and ask how to reconcile. Do not trust either side, and do not proceed. Building on an unexplained inconsistency costs more than the minutes spent resolving it. This override applies in FLOW mode too.

If `CONTINUE.md` is missing, badly stale, or contradicted by the tree, reconstructing accurate state IS the next action. Rebuild it from git history, the tests, and the code, report what you found, rewrite the file, then continue.

## Step 3: Detection ladder

Walk these in order. Stop at the first match. That is the current phase.

| # | Condition | Phase | Action |
|---|---|---|---|
| 1 | No `docs/SRS.md` | Not started | Run `forge-spec` |
| 2 | `docs/SRS.md` exists, `Gate: AWAITING_APPROVAL` | Spec written | **Stop.** Summarize the SRS and ask for review. Never self-approve |
| 3 | SRS approved, no `docs/ENVIRONMENT.md` | Spec done | Run `forge-env` |
| 4 | `docs/ENVIRONMENT.md` exists but the Phase 2 gate is unmet | Bootstrap partial | Resume `forge-env` at the first failed item |
| 5 | Bootstrap complete, no build plan in `TODO.md` | Ready to build | Run `forge-code`, starting with the build plan |
| 6 | `TODO.md` has a task In Progress | Mid-slice | Resume that slice. See "Resuming a slice" below |
| 7 | Nothing In Progress, backlog has slices | Between slices | Open the next backlog slice |
| 8 | Backlog empty for this milestone, release gates pass | Release ready | **STRICT.** Propose the release, wait for confirmation |
| 9 | Backlog empty, a release gate fails | Release blocked | **STRICT.** Report exactly which gate and what is needed |
| 10 | All requirements closed and released | Complete | Report status, ask what is next |

The Phase 2 gate (row 4) is met only when all of these hold: toolchain smoke test passed in both directions, GitHub repo exists with an initial commit pushed, the pre-push hook is proven to block, CI has gone green at least once, CodeGraph is verified, and the state files are committed.

## Step 4: Report, then act according to mode

Always report first, in about five lines. Terse, factual:

```
Phase 3, slice 2 of 6 (T-002 tenant scoping).
Branch slice/tenant-scoping, 4 uncommitted changes.
Tests: 3 failing. CONTINUE.md mentions 2.
Next: reconcile the unexplained third failure before resuming.
```

Then behave according to `Mode:` in `CONTINUE.md`, defaulting to FLOW.

### FLOW mode

Proceed without asking. Report what you did after each slice, then continue to the next one. The point is to remove one keystroke of friction per slice, not to remove visibility.

### STRICT mode

Report, state what you propose, and wait for confirmation before acting.

### STRICT engages automatically, regardless of mode, when

- A release is the next action, or a version bump is being proposed
- Any release gate fails
- The candidate version is v1.0.0. Always confirm this one
- The backlog has no remaining slices for the current milestone

Once a release is in reach, stay strict through the release and resume FLOW afterward.

### Always ask, in every mode, no exceptions

These are the gates the whole design exists to protect. Never pass one autonomously:

- SRS approval, at the Phase 1 to 2 boundary
- Whether the GitHub repository is public or private
- Any command requiring elevation
- Discarding, stashing, or destroying uncommitted work
- Deleting a branch that has unmerged commits
- Amending `docs/SRS.md`, since a spec change is a decision, not an implementation detail. A user instruction that happens to touch the SRS is not itself authorization to bypass this gate. State what you are about to change and confirm, even when the request seems unambiguous
- Tagging or publishing a release
- Anything the pre-push hook blocked. Report it, never bypass it
- Adding a dependency that was not named in the SRS
- Any discrepancy between recorded state and reality

## Resuming a slice (row 6)

This is the common case, and the one that used to be a separate resume command.

1. Reconcile per Step 2, with particular attention to whether the test suite matches what was recorded
2. Report where the slice stands and what remains
3. If the working tree is dirty and unexplained, characterize the diff: coherent partial work, or debris? Run the tests to see whether it is in a working state. Present the options (finish it, commit as WIP on the branch, stash, discard), recommend one, and never discard without explicit confirmation
4. Otherwise continue the slice per `forge-code`

## Dispatching

When the ladder points at a phase, invoke that phase's skill and follow it fully. Do not summarize or paraphrase a phase's instructions, and do not skip its gates because you are in FLOW mode. FLOW removes confirmation prompts between units of work; it does not remove the phases' own rules.

Phase skills: `forge-spec` (Phase 1), `forge-env` (Phase 2), `forge-code` (Phase 3). Engineering standards are in `forge-standards`, which loads automatically.

## Keeping state honest

Every time the phase or gate changes, update `CONTINUE.md`:

```
Phase: <1 spec | 2 env | 3 code>
Gate:  <IN_PROGRESS | AWAITING_APPROVAL | PASSED>
Mode:  <FLOW | STRICT>
```

The ladder is only as good as these fields. A stale `Gate:` will route the next session into the wrong phase, so treat updating it as part of the work rather than bookkeeping afterward.

## First run in a new project

If nothing exists yet, say so plainly and explain the shape of what follows before starting: three phases, hard stops at spec approval and before any release, and that `/forge` is the only command they need to remember. Keep it to a few sentences, then begin discovery.
