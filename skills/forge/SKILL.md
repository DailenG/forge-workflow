---
name: forge
description: Determine where a project stands in its lifecycle and do the next thing. Detects the current phase, reconciles recorded state against the repository, and either continues work or dispatches to the right phase. Use when the user says continue, resume, what's next, pick up where we left off, or invokes forge directly.
---

> Typography and shell rules are in `forge-standards`: ASCII only, and no `&&` in PowerShell. They apply to every file forge writes.

# Forge: lifecycle orchestrator

You are the entry point for this project. The user should never need to remember which phase they are in or which command comes next. Determine where things stand rather than asking.

## Step 0: Self-check

Confirm the plugin's own machinery is working, silently. Report only when something is wrong.

**The check:** if `CONTINUE.md` exists in the project but no `=== FORGE: PROJECT STATE ===` block appeared in this session's context, the SessionStart hook did not fire.

That single observation covers every cause: Node missing from PATH, `hooks/` changes not reloaded, a non-executable script on Unix-like systems, malformed `hooks.json`, or a wrong directory structure. Node being present does not prove the hook ran, so it is not a substitute check.

If `CONTINUE.md` does not exist yet, the hook is correctly silent. Skip to Step 1.

**When the hook did not fire**, diagnose before continuing. Run these directly rather than through a script, since a broken Node runtime would prevent a diagnostic script from running at all:

1. `node --version` and confirm it resolves
2. Confirm `hooks/hooks.json` exists at the plugin root and parses as JSON
3. Confirm `scripts/session-start.js` exists at the plugin root
4. On Linux or macOS, confirm both scripts under `scripts/` are executable

Then report concisely, name the likely cause, and state the consequence:

> The SessionStart hook is not firing, because Node is not on PATH. The workflow still works, but `CONTINUE.md` will no longer be loaded automatically at session start, so cold-start resumption depends on me remembering to read it rather than being guaranteed. Install Node, or say the word and I will convert the hooks to PowerShell.

Then continue with Step 1. Degraded hooks are a real regression but not a blocker. Report this once per session.

## Step 1: Establish actual state

The SessionStart hook may have already injected `CONTINUE.md` and a git summary. It reports what the files claim, not whether the claim is true, so gather the real state yourself.

Read, skipping anything absent:

- `CONTINUE.md` (phase, gate, mode, current task, next action)
- `TODO.md`
- `docs/SRS.md`
- `docs/DESIGN.md` (design tier, surfaces, polish log)
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

Compare the record against reality:

- Does the current branch match the claimed in-progress slice?
- Does the working tree state match what `CONTINUE.md` describes?
- Does the work `CONTINUE.md` describes as finished actually appear in `git log`?
- Does the test suite result match? A red suite the record does not mention changes everything
- Does `TODO.md` In Progress agree with the branch and the commits?
- Does any recorded gate, backlog item, or UX debt slip target name a version that has already been published?

Commit identity comes from git, never from the record. Older projects carry a `Last commit:` line in `CONTINUE.md`; it is stale by construction, since committing the file changes the commit the field names. Ignore it, reconcile against the SessionStart git summary and `git log`, and drop the line the next time you update the file. Its staleness is not a discrepancy.

**If the record and reality disagree, stop.** Report the discrepancy and ask how to reconcile. Do not trust either side, and do not build on an unexplained inconsistency. This override applies in FLOW mode too.

A recorded gate, backlog item, or slip target naming a version already published is a discrepancy of this kind. The version moved and the item did not, so the item is no longer gating anything: it reads as pending work behind a tag that has already shipped, or behind one the user chose to skip. Re-anchor it to the next real target, or close it, before continuing. Test counts and commits are not the only things that go stale; version anchors do, and they do it silently.

If `CONTINUE.md` is missing, badly stale, or contradicted by the tree, reconstructing accurate state IS the next action. Rebuild it from git history, the tests, and the code, report what you found, rewrite the file, then continue.

## Step 2a: Capability backfill

Forge itself gains capabilities over time, so a project started under an older version can be mid-Phase-3 with artifacts that its Phase 1 and Phase 2 never produced. **A missing capability is not a record-versus-reality discrepancy.** Do not stop under Step 2 for one, and do not treat it as damage: the project was correct under the version that built it.

Check for these, cheaply, from what you already read:

| Missing | Signal | Backfill |
|---|---|---|
| Design brief | no `docs/DESIGN.md` | `forge-design`, "Retrofitting a project already under way" |
| UX requirements | brief exists, no `UX-` IDs in `docs/SRS.md` | Same, from the surfaces that already exist. Amending the SRS is a gate |
| UX debt register | `TODO.md` has no UX Debt section | Add the section from `templates/TODO.md`, then seed it with one design pass per existing surface |
| Observability decisions | `docs/SRS.md` has no observability section, or it says nothing testable | Extract the decisions per `forge-spec` "Observability, in detail", amend the SRS, and file the wiring as a slice if the code does not already do it |
| Surface verification tooling | `docs/ENVIRONMENT.md` records none, and a `UX-` requirement needs it | `forge-env` Step 11a, for the tiers in play |
| External design tools | a GUI tier, and `docs/DECISIONS.md` records no choice about them | Offer the list from `forge-design` "External design tools" once, take "none" as an answer, and record it. Nothing installs without the user asking, and nothing is uploaded to a hosted service without a gate |

Raise the whole set once, in one message, ordered by what it would change about the work in front of you. For each: what it is, what backfilling costs now, and what shipping without it means. Then offer three answers, and say which you recommend:

1. **Backfill now**, before the current work continues. Recommended when a surface is still being built, or a release is in reach
2. **Backfill as its own slice**, scheduled next. Recommended mid-slice, so the current branch stays coherent
3. **Skip for this project.** Not recommended, and say why in one line rather than sermonizing: the gates that capability feeds go inert, so nothing will catch what it was there to catch

Record the answer immediately, in the `Capabilities:` line of `CONTINUE.md` and as a dated entry in `docs/DECISIONS.md`. Then honour it:

- **Backfilled** capabilities behave as though they had always been there
- **Skipped** capabilities are inert. Their gate items do not block a release, their ladder rows do not match, and you do not ask again. Note the skip in one line at each release report, so it stays visible without becoming nagging
- A capability with no recorded answer is unasked, not skipped. Ask it

Reversing a skip needs no ceremony: the user says so, you run the backfill, and you update the record.

## Step 3: Detection ladder

Walk these in order. Stop at the first match. That is the current phase.

| # | Condition | Phase | Action |
|---|---|---|---|
| 1 | No `docs/SRS.md` | Not started | Run `forge-spec` |
| 2 | `docs/SRS.md` exists, `Gate: AWAITING_APPROVAL` | Spec written | **Stop.** Summarize the SRS and ask for review. Never self-approve |
| 3 | SRS approved (`Phase: 2`), no `docs/ENVIRONMENT.md` | Spec done | Run `forge-env` |
| 4 | `docs/ENVIRONMENT.md` exists but the Phase 2 gate is unmet | Bootstrap partial | Resume `forge-env` at the first failed item |
| 5 | Bootstrap complete, no build plan in `TODO.md` | Ready to build | Run `forge-code`, starting with the build plan |
| 6 | `TODO.md` has a task In Progress | Mid-slice | Resume that slice. See "Resuming a slice" below |
| 7 | Nothing In Progress, backlog has slices | Between slices | Open the next Ready slice; surface a Needs-decision item's named question; leave Deferred items alone |
| 8 | Backlog empty for this milestone, polish pass not run over its surfaces | Polish due | **STRICT.** Run the `forge-design` polish pass, report the findings, then act on them |
| 9 | Backlog empty, polish pass done, release gates pass | Release ready | **STRICT.** Propose the release, wait for confirmation |
| 10 | Backlog empty, a release gate fails | Release blocked | **STRICT.** Report exactly which gate and what is needed |
| 11 | All requirements closed and released | Complete | Report status, ask what is next |

`degrades` severity UX debt due before this release is backlog, so row 7 opens it like any other slice. `finish` severity waits for the polish pass at row 8. The polish log in `docs/DESIGN.md` is what distinguishes row 8 from row 9: no entry for this milestone means the pass has not run. Row 8 does not match at all when `CONTINUE.md` records the design capability as skipped, and the same holds for the Phase 2 verification-tooling gate item; a skipped capability is inert, per Step 2a.

A completed Phase 2 record reads `Phase: 2`, `Gate: PASSED`, `Current task: begin the Phase 3 build plan`, a clean working tree, `docs/ENVIRONMENT.md` saying Phase 2 environment bootstrap is complete, and no active bootstrap claim left in `TODO.md`. That is row 5, not a discrepancy; the passed gate is the handoff marker, so do not stop merely because the phase number is still 2.

The Phase 2 gate (row 4) is met only when all of these hold: toolchain smoke test passed in both directions, the remote repo exists with an initial commit pushed, the pre-push hook is proven to block, **default-branch history protection verified**, CI has gone green at least once, CodeGraph is verified, the tooling behind each `UX-nnn` verification method is installed and proven or its absence recorded with the fallback, and the state files are committed.

**Default-branch history protection verified** is satisfied by either of two things, and `node .forge/branch-protection.js gate` decides which:

- verified server-side enforcement, or
- verified managed local enforcement, with its narrower trust boundary recorded

A host that reserves branch protection for paid plans is not a fatal bootstrap failure. Forge takes the local fallback, records what it does not cover, and moves on. Never resolve this by making a private repository public.

### Resuming a project blocked on a paid ruleset

Older forge runs treated a GitHub ruleset on `main` as mandatory, so a project on a free personal plan with a private repository could stall at Phase 2 with a blocker it could not clear. When the record shows that, run:

```powershell
node .forge/branch-protection.js migrate
```

It re-detects provider capability, installs and verifies the fallback if server-side enforcement is still unavailable, and hands back exactly which recorded blocker to clear. Then, with the Edit tool: clear only that blocker from `CONTINUE.md`, leave every other blocker alone, append the decision to `docs/DECISIONS.md`, refresh the protection section of `docs/ENVIRONMENT.md`, and resume Phase 2 at the first remaining unmet gate item.

If `.forge/branch-protection.js` is not in the project (it predates this), copy it and `history-guard.js` from the plugin's `templates/` first.

## Step 4: Report, then act according to mode

Report first, in about five lines. Terse and factual:

```
Phase 3, slice 2 of 6 (T-002 tenant scoping).
Branch slice/tenant-scoping, 4 uncommitted changes.
Tests: 3 failing. CONTINUE.md mentions 2.
Next: reconcile the unexplained third failure before resuming.
```

Then behave according to `Mode:` in `CONTINUE.md`, defaulting to FLOW.

**FLOW**: proceed without asking. Report what you did after each slice, then continue to the next one.

**STRICT**: report, state what you propose, and wait for confirmation before acting.

**STRICT engages automatically, regardless of mode, when:**

- A release is the next action, or a version bump is being proposed
- Any release gate fails
- The candidate version is v1.0.0
- The backlog has no remaining slices for the current milestone

Once a release is in reach, stay strict through the release and resume FLOW afterward.

### Always ask, in every mode

These are the gates the whole design exists to protect. Never pass one autonomously:

- SRS approval, at the Phase 1 to 2 boundary
- Whether the remote repository is public or private. Changing it later is the same gate, and a hosting feature that is only available on public repositories is never a reason to change it
- Any command requiring elevation
- Discarding, stashing, or destroying uncommitted work
- Deleting a branch that has unmerged commits
- Amending `docs/SRS.md`. A user instruction that happens to touch the SRS is not itself authorization to bypass this gate: state what you are about to change and confirm, even when the request seems unambiguous
- Tagging or publishing a release
- Anything the pre-push hook blocked. Report it, never bypass it
- Adding a dependency that was not named in the SRS
- Slipping a polish pass finding to a later version, or releasing with a `blocks` or `degrades` UX defect open on a surface this release claims
- Uploading repository contents, a screenshot of real data, or user data to an external service the SRS did not name. A hosted design tool is one of these, however convenient
- Any discrepancy between recorded state and reality

## Approval is one transition (row 2 to row 3)

When the user explicitly approves the SRS, the approval and the phase change are the same act. Do not write a `Phase: 1`, `Gate: PASSED` state on the way through: nothing reads it, and a session interrupted afterwards would read Phase 1 while Phase 2 work was already underway.

1. Set `CONTINUE.md` to `Phase: 2` and `Gate: IN_PROGRESS`, preserving `Mode:` when it is already valid
2. Set `Current task:` to the Phase 2 environment inventory, and `Next action` to `forge-env` Step 1
3. Remove the SRS approval item from `Blocked on me`, leaving the other blockers alone
4. Commit it in one conventional commit, so `Working tree:` reads clean afterwards
5. Invoke `forge-env` and begin with its inventory

## Resuming a slice (row 6)

1. Reconcile per Step 2, with particular attention to whether the test suite matches what was recorded
2. Report where the slice stands and what remains
3. If the working tree is dirty and unexplained, characterize the diff: coherent partial work, or debris? Run the tests to see whether it is in a working state. Present the options (finish it, commit as WIP on the branch, stash, discard), recommend one, and never discard without explicit confirmation
4. Otherwise continue the slice per `forge-code`

## Dispatching

When the ladder points at a phase, invoke that phase's skill and follow it fully. Do not paraphrase a phase's instructions, and do not skip its gates because you are in FLOW mode.

Phase skills: `forge-spec` (Phase 1), `forge-env` (Phase 2), `forge-code` (Phase 3). Engineering standards are in `forge-standards`, which loads automatically. `forge-design` is the cross-cutting discipline for surfaces: the design tier, the brief in `docs/DESIGN.md`, UX requirements, the per-slice design pass, and the release polish pass. It applies inside every phase rather than being one, and a user who says the interface feels wrong is asking for it directly.

## Keeping state honest

Every time the phase or gate changes, update `CONTINUE.md`:

```
Phase: <1 spec | 2 env | 3 code>
Gate:  <IN_PROGRESS | AWAITING_APPROVAL | PASSED>
Mode:  <FLOW | STRICT>
```

The ladder is only as good as these fields. A stale `Gate:` will route the next session into the wrong phase, so treat updating it as part of the work.

## First run in a new project

If nothing exists yet, say so and explain the shape of what follows before starting: three phases, hard stops at spec approval and before any release, and that `/forge` is the only command they need to remember. A few sentences, then begin discovery.
