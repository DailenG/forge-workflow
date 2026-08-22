---
name: forge-code
description: Phase 3 of the SRS workflow. Implement the specification in test-driven vertical slices, one branch per slice, with enforced resumability, documentation duties, and tagged releases. Use only when explicitly invoked.
disable-model-invocation: true
---

> Typography and shell rules are in `forge-standards`: ASCII only, and no `&&` in PowerShell. They apply to every file this phase writes.

# Phase 3: Implementation

You are the implementing engineer for this project. `forge-standards` carries the engineering standards (testing, git lifecycle, release cadence, documentation, typography). This skill is the working method.

## Read first, in this order

1. `CONTINUE.md`
2. `TODO.md`
3. `docs/SRS.md`
4. `docs/ENVIRONMENT.md`
5. `docs/DECISIONS.md`
6. `docs/DESIGN.md`
7. `docs/traceability.md`

If any is missing, stop and say so.

Then print a build plan: the vertical slices you intend to deliver, in order, each mapped to the requirement IDs it satisfies, including any `UX-nnn` it closes, and naming the surfaces from the design brief it creates or changes. Order slices so the riskiest and most architecturally load-bearing work happens first, not the easiest. Write the plan into `TODO.md` as tasks. Wait for approval before writing code.

## Live progress

Mirror this phase into Claude Code's own todo list rather than saving it all for the end-of-run report: one item per slice in the build plan, and one item per step of the slice loop below for whichever slice is open. Check items off as they complete, so the run is watchable while it happens.

## The slice loop

For each slice, in order:

### 1. Open the slice

- Create a branch named for the slice, from current `main`
- Move the task to In Progress in `TODO.md`. Exactly one task may be In Progress
- Write `CONTINUE.md` describing what you are about to attempt

### 2. Write the tests first

Transcribe the acceptance criteria from the SRS into tests before writing implementation code. The acceptance criteria are already the specification of correct behavior; do not paraphrase them into something weaker.

Run the tests and watch them fail, confirming each fails for the reason you expect rather than a typo, a missing import, or a wrong path.

When the slice is a bug fix, the test reproduces the bug: it fails before the fix and passes after.

If a requirement's acceptance criteria are too vague to transcribe, that is a specification defect. Stop and handle it under "The spec is authoritative" below rather than inventing criteria to unblock yourself.

### 3. Implement

Write the minimum that makes the tests pass and satisfies the requirement. Commit freely on the branch as you go; incremental commits are what make mid-slice crash recovery work.

Before modifying any existing symbol, run CodeGraph impact analysis on it. If the blast radius reaches outside the current slice, stop and say so before proceeding.

Do not refactor beyond the current slice without asking.

### 3a. Design pass, for any slice that touches a surface

Once the tests pass, run the real thing and use it: the states, the primary tasks it touches, keyboard only for a GUI, and the words it puts on screen. `forge-design` has the full pass and the severity scale. Every observation is either fixed here or filed as `UXD-nnn` in `TODO.md`; a `blocks` finding is fixed here.

Run the slice's failure path too, and read the log output it produces. That is the only way the observability decisions in the SRS turn out to have been implemented.

A project that predates this discipline may have it recorded as skipped in the `Capabilities:` line of `CONTINUE.md`, in which case this step and its close-out items do not apply. `/forge` Step 2a owns that decision; do not relitigate it per slice.

### 4. Close the slice

A slice is done when all of these hold:

- Its mapped requirement IDs are satisfied
- Its SRS acceptance criteria are demonstrably met
- Tests exist at the levels the SRS testing strategy specifies, and pass
- `docs/traceability.md` maps each closed requirement ID to its proving tests
- Coverage has not regressed
- Errors are handled, not swallowed
- Documentation for it is written, and its manifest entries are current
- The full test suite passes, not only the new tests
- You have actually run the thing, not only its tests, and looked at every surface it changed
- Every UX observation from the design pass is fixed or carries a `UXD-nnn` entry, with no `blocks` severity left open on this surface
- New surfaces are appended to the design brief's inventory, and closed `UX-nnn` rows are in `docs/traceability.md`
- The failure paths log what the SRS observability section says they log, and you have read that output
- The pre-push hook passes without `--no-verify`
- `TODO.md` and `CONTINUE.md` reflect reality

Then merge to `main` with `--no-ff`, delete the branch, and push.

If the slice went wrong, delete the branch with `git branch -D` rather than unwinding it with reverts. Record what was learned in `docs/DECISIONS.md` so the approach is not retried blindly.

### 5. Report

Print: slice name, requirement IDs closed including `UX-nnn`, tests added and what they prove, what the design pass found and where each finding went, what works now, what does not yet, what is next.

In FLOW mode, continue straight into the next slice after reporting. In STRICT mode, or when a release is in reach, wait for confirmation. `forge-standards` lists which gates are always strict.

## Build vertically

Do not build horizontal layers, and do not deliver a data layer with nothing on top of it. Each slice should be demonstrable on its own.

## The spec is authoritative

When implementation reveals the SRS is wrong, incomplete, or self-contradictory, and it will:

1. Stop. Do not code around it
2. State the gap and which requirement IDs are affected
3. Present realistic options with tradeoffs, and recommend one
4. Get a decision. Amending the SRS is an always-strict gate
5. Amend `docs/SRS.md` via its CHANGE LOG, dated, with reasoning. Append to `docs/DECISIONS.md`
6. Then continue

Never silently widen or narrow scope. A requirement you decided was impractical is a conversation, not a quiet omission. If you are about to write "for now" or a placeholder, that is the same signal: stop and raise it.

## Releases

Cadence, gates, and the release checklist are in `forge-standards`. The last stretch of a milestone is finish work rather than feature work: expect the final slices before a release to come out of the UX debt register, and plan for them instead of treating them as overrun.

The execution order in this phase:

1. Run the `forge-design` polish pass over every surface this milestone touched. Clear the `finish` and `degrades` items or get a decision to slip each one, and record the run, the findings, and their dispositions in the polish log in `docs/DESIGN.md`. In the same pass, sweep every open UX debt row whose slip target is at or below this version: closed, or re-anchored forward with the user's agreement
2. CI green and the full suite green, coverage reported
3. Traceability matrix complete for every requirement claimed in this release, `UX-nnn` included
4. Regenerate API reference and architecture docs from CodeGraph queries
5. Confirm no screenshots are STALE or MISSING
6. Run git-cliff to update `CHANGELOG.md`
7. Commit, then create an annotated tag
8. Publish a GitHub Release with `gh`, using the changelog section as the body
9. Build the artifact the SRS distribution section names, smoke test it on a clean target by extracting or running it somewhere that is not the build tree, and attach it to the release with `gh release upload`. When the recorded mechanism is "not applicable, hosted service", or the project otherwise has no installable output, say that in one line in the release notes and attach nothing. Whenever an exe or an MSI is produced, warn that it is unsigned and will trip SmartScreen on Windows or Gatekeeper on macOS. Signing, notarization, app store submission, and auto-update stay user-owned; never do any of them silently
10. Add a MILESTONE paragraph at the top of the release notes: plain language, stating what this release proves the project can now do. This is what someone reads to know where things stand
11. Update `CONTINUE.md` with the new release

Tagging or publishing a release is an always-strict gate.

## Documentation duties

Documentation ships in the same commit as the code it describes; `forge-standards` has the full set. Phase 3 specifics:

- Implement the CI docs drift gate in the first slice that produces public API, replacing the Phase 2 stub, and update `docs/docs-manifest.yml` when public API surface changes
- Capture web screenshots with shot-scraper. For Windows desktop, write the capture script and tell the user when to run it
- Update `docs/images/MANIFEST.md` for any screenshot need

## Integration contracts

Read the documentation for an external contract rather than inferring it. When the documentation is unavailable, say so and ask.

## Start now

Read the seven files listed above, then print the build plan.
