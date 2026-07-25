---
name: forge-code
description: Phase 3 of the SRS workflow. Implement the specification in test-driven vertical slices, one branch per slice, with enforced resumability, documentation duties, and tagged releases. Use only when explicitly invoked.
disable-model-invocation: true
---

> **Typography, enforced by hook.** Every file you write, including this phase's markdown deliverables: no em dashes or en dashes, no curly quotes, no ellipsis character, no non-breaking spaces. Plain hyphens and straight quotes only. In PowerShell never use `&&`. A PostToolUse hook reports violations; fix them immediately when it does.


# Phase 3: Implementation

You are the implementing engineer for this project. The `forge-standards` skill carries the full engineering standards. This skill is the working method.

## Read first, in this order

1. `CONTINUE.md`
2. `TODO.md`
3. `docs/SRS.md`
4. `docs/ENVIRONMENT.md`
5. `docs/DECISIONS.md`
6. `docs/traceability.md`

If any is missing, stop and say so.

Then print a build plan: the vertical slices you intend to deliver, in order, each mapped to the requirement IDs it satisfies. Order slices so the riskiest and most architecturally load-bearing work happens first, not the easiest. Write the plan into `TODO.md` as tasks. Wait for approval before writing code.

## The slice loop

For each slice, in order:

### 1. Open the slice

- Create a branch named for the slice, from current `main`
- Move the task to In Progress in `TODO.md`. Exactly one task may be In Progress
- Write `CONTINUE.md` describing what you are about to attempt

The first time you do this in a project, explain in one or two sentences why the work happens on a branch. Then carry on without waiting.

### 2. Write the tests first

Transcribe the acceptance criteria from the SRS into tests before writing implementation code. The acceptance criteria are already the specification of correct behavior; do not paraphrase them into something weaker.

**Run the tests and watch them fail.** Confirm each fails for the reason you expect, not because of a typo, a missing import, or a wrong path. A test that has never failed has not been shown to test anything.

If a requirement's acceptance criteria turn out to be too vague to transcribe, that is a specification defect. Stop and handle it under "The spec is authoritative" below. Do not invent criteria to unblock yourself.

### 3. Implement

Write the minimum that makes the tests pass and satisfies the requirement. Commit freely on the branch as you go. Incremental commits are what make mid-slice crash recovery work, so do not hold work back for a tidy history.

Before modifying any existing symbol, run CodeGraph impact analysis on it. If the blast radius reaches outside the current slice, stop and say so before proceeding.

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
- Pre-push hook passes without `--no-verify`
- `TODO.md` and `CONTINUE.md` reflect reality

Then merge to `main` with `--no-ff`, delete the branch, and push.

If the slice went wrong, delete the branch with `git branch -D` rather than unwinding it with reverts. That is the main reason branches exist here. Record what was learned in `docs/DECISIONS.md` so the approach is not retried blindly.

### 5. Report

Print: slice name, requirement IDs closed, tests added and what they prove, what works now, what does not yet, what is next.

In FLOW mode, continue straight into the next slice after reporting. In STRICT mode, or when a release is in reach, wait for confirmation. See `forge-standards` for which gates are always strict.

## Build vertically

Do not build horizontal layers. Do not deliver a data layer with nothing on top of it. Each slice should be demonstrable on its own.

## Testing rules that bite most often

The full set is in `forge-standards`. These are the ones that get violated under pressure:

- **Never make CI or the pre-push hook green by weakening a test.** No deleting, skipping, marking expected-failure, loosening assertions, or raising timeouts to get past red. If a test is genuinely wrong, say so explicitly and get agreement before touching it
- **Never use `--no-verify`.** If the hook blocks you, fix what it caught or tell the user it is blocking and why
- **A bug fix gets a regression test** that fails before the fix and passes after
- **No flaky tests.** No sleep-based synchronization, no wall clock dependence, no shared mutable state. A test failing one run in twenty trains people to rerun until green, which destroys the suite's value
- **Coverage is a floor, not a goal.** Use it to find untested code, never as evidence of quality

## The spec is authoritative

When implementation reveals the SRS is wrong, incomplete, or self-contradictory, and it will:

1. Stop. Do not code around it
2. State the gap and which requirement IDs are affected
3. Present realistic options with tradeoffs, and recommend one
4. Get a decision
5. Amend `docs/SRS.md` via its CHANGE LOG, dated, with reasoning. Append to `docs/DECISIONS.md`
6. Then continue

Never silently widen scope. Never silently narrow it. A requirement you decided was impractical is a conversation, not a quiet omission.

If you are about to write "for now" or a placeholder, that is the same signal. Stop and raise it.

## Releases

Cadence: v0.1.0 at the first slice that does something demonstrable end to end. Minor bump per completed feature group. Patch for fixes between them. v1.0.0 only when every functional requirement is closed **and** every one has a passing mapped test in the traceability matrix.

At each release:

1. CI green
2. Full test suite green, coverage reported
3. Traceability matrix complete for every requirement claimed in this release
4. Regenerate API reference and architecture docs from CodeGraph queries
5. Verify no screenshots are STALE or MISSING
6. Run git-cliff to update `CHANGELOG.md`
7. Commit, then create an annotated tag
8. Publish a GitHub Release with `gh`, using the changelog section as the body
9. Add a MILESTONE paragraph at the top of the release notes: plain language, stating what this release proves the project can now do. This is what someone reads to know where things stand
10. Update `CONTINUE.md` with the new release

Never tag with CI red. Never move an existing tag.

## Documentation duties

Documentation ships in the same commit as the code it describes.

- API reference is generated, never hand-written
- Architecture docs in `docs/architecture/`, authored from CodeGraph queries, rendered as Mermaid
- Update `docs/docs-manifest.yml` when public API surface changes. Implement the CI drift gate in the first slice that produces public API, replacing the Phase 2 stub
- Update `docs/images/MANIFEST.md` for any screenshot need. Capture web screenshots with shot-scraper. For Windows desktop, write the capture script and tell the user when to run it. Never describe a screenshot you have not seen: mark it MISSING and surface it in `CONTINUE.md`
- `README.md` must work from a cold clone

## Explaining as you go

The user may not be familiar with branch-per-slice, conventional commits, semver, pre-push hooks, or traceability matrices. The first time you perform each lifecycle operation in a project, add one or two plain sentences saying what you are doing and why, then continue without waiting for a response.

When a hook or gate blocks something, explain what triggered it, what it protects against, and the real options. Do not just report the error.

Explain each thing once per project. Do not repeat, and do not condescend.

## Guardrails

- Do not guess at an integration contract. Read the documentation or ask
- Do not fabricate an API surface. If unsure a method exists, verify it
- Do not mark a slice complete without running it
- Do not refactor beyond the current slice without asking
- Do not add a dependency without naming it, justifying it, and stating its license
- Do not tag a release with CI red

## Start now

Read the six files listed above, then print the build plan.
