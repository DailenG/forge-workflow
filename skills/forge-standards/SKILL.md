---
name: forge-standards
description: Engineering standards for the forge lifecycle, covering ASCII typography rules, testing discipline, git lifecycle, commit and release rules, documentation duties, and resumability. Load this at the start of any forge phase and whenever a project contains CONTINUE.md, TODO.md, or docs/SRS.md. Also load whenever writing or editing any file during a forge phase, including specifications and decision records, since the typography rules apply to prose as well as code.
---

# SRS Workflow Engineering Standards

These apply to every project built with this workflow.

## Resumability invariant

If this machine lost power right now, `CONTINUE.md` plus git history must be enough for a fresh session to pick up correctly.

- Rewrite `CONTINUE.md` whenever the next action changes, not only at session end.
- Never end a turn with both a dirty working tree and a stale `CONTINUE.md`. A dirty tree means `CONTINUE.md` says so and why.
- "Next action" is a concrete action. "Implement auth" is useless; "Add the token refresh branch to `AuthClient.refresh`; tests at `tests/auth_test.ts:88` currently fail" is useful.
- Commit `CONTINUE.md` and `TODO.md` updates alongside the code they describe.

## Flow and strict mode

`CONTINUE.md` carries a `Mode:` field, defaulting to FLOW.

**FLOW**: proceed between units of work without asking. Report what you did after each slice, then continue.

**STRICT**: report, state what you propose, and wait.

STRICT engages automatically regardless of recorded mode when a release is in reach: the milestone backlog is empty, a version bump is proposed, a release gate fails, or the candidate version is v1.0.0. Stay strict through the release, then return to FLOW.

**Always-strict gates, in every mode.** These are the reason the phased design exists. Never pass one autonomously:

- SRS approval
- Whether the GitHub repository is public or private
- Any command requiring elevation
- Discarding, stashing, or destroying uncommitted work
- Deleting a branch with unmerged commits
- Amending `docs/SRS.md` (a spec change is a decision)
- Tagging or publishing a release
- Anything the pre-push hook blocked. Report it, never bypass it
- Adding a dependency not named in the SRS
- Any discrepancy between recorded state and the repository

FLOW removes the confirmation prompt between units of work. It never skips a phase's own rules or an always-strict gate.

## Testing

A slice without tests is not a slice.

- **Write the test first** for anything with SRS acceptance criteria. The acceptance criteria are the test; transcribe them, do not weaken them.
- **Watch every new test fail before making it pass.** A test that has never failed has not been shown to test anything. Confirm it fails for the expected reason, not a typo or wrong path.
- **Traceability is mandatory.** Maintain `docs/traceability.md` mapping each requirement ID to the tests that prove its acceptance criteria. A requirement with no mapped test is not implemented, regardless of whether code exists.
- **Bug fixes get a regression test** that fails before the fix and passes after. No exceptions.
- **Never make a build green by weakening tests.** Do not delete, skip, mark expected-failure, loosen an assertion, or raise a timeout to get past red. If a test is genuinely wrong, say so and get agreement before changing it.
- **Determinism.** No sleep-based synchronization; no dependence on wall clock, timezone, locale, filesystem ordering, or map iteration order; no shared mutable state between tests.
- **Coverage is a floor, not a goal.** Use it to find untested code, not as evidence of quality.
- **Verify the harness itself.** A runner that discovers zero tests usually reports success, so confirm the harness fails when it should before trusting a green build.

Test taxonomy, so you are deliberate about the level you write:
- Unit: one behavior, no I/O, network, clock, or filesystem. Fast and deterministic.
- Integration: real boundaries between your own components, external systems stubbed.
- Contract: your assumptions about an external API, run against a recorded or live sample.
- End to end: the smallest set that proves the critical paths. They are slow and brittle, so they earn their place.

Default weighting is many unit, some integration, few end to end. Deviate only with a stated reason.

## Git lifecycle

Branch per slice, commit freely on the branch, merge to main with `--no-ff`, tag releases. No pull requests, because there is no second reviewer.

- One short-lived branch per slice, named for the slice.
- Commit freely on the branch. Incremental commits make mid-slice crash recovery possible.
- Conventional commit format. git-cliff derives the changelog from it, so a nonconforming subject disappears from release notes.
- Merge to main with `--no-ff` so each slice is one identifiable unit, making rollback and bisect operate per slice.
- Delete the branch after merging. A slice that went wrong is deleted with `git branch -D`, not unwound with reverts. This is the main reason branches exist here.
- Never force push main. Never move an existing tag.
- Never use `--no-verify`. The pre-push hook is the only automated gate before main; if it blocks you, fix what it caught or tell the user why it is blocking.
- Commit the lockfile.

## Secrets and safety

- No secrets in the repository, ever, including test fixtures and example configs. Ship `.env.example` with dummy values.
- No secrets in log output. Redact at the logging boundary.
- Validate input at trust boundaries.
- Write `.gitignore` before the first commit. A secret committed once lives in history forever.

## Dependencies and tool substitution

- Never add a dependency without naming it, justifying it, and stating its license.
- **Do not substitute an already-installed tool for a specified one on capability grounds alone.** A named tool often encodes a non-capability constraint (license, supply chain, support). Check that constraint before swapping, and record the original choice, the substitute, and the reasoning in `docs/DECISIONS.md`.
- A repository with no LICENSE file is all rights reserved by default, not permissive.
- Prefer the standard library for anything trivial. Pin versions.

## Modifying files

Use the Edit tool to change existing files, not shell redirection or `Set-Content`. Shell rewrites bypass the typography hook, collapse CRLF on Windows, and have no undo. Confirm before destructive commands (recursive deletes, `git reset --hard`, `git clean -f`, `git checkout --`); these are on the always-strict list.

## Typography

Applies to every file you write, including specifications, decision records, and commit messages, not only source code. In code these are defects, not style: a curly quote in a string literal or an em dash in an identifier breaks the build.

- No em dashes or en dashes. Plain hyphen only.
- No curly quotes. Straight quotes only.
- No ellipsis character. Use three periods.
- No non-breaking spaces.
- In PowerShell, never use `&&`. Use `;` or separate lines.

A PostToolUse hook reports violations; fix the affected lines when it does.

## Code

- No dead code, commented-out blocks, or TODO comments without a matching `TODO.md` entry.
- Errors are handled, not swallowed. An empty catch block is a defect.
- No placeholders and no "for now". If you are about to write one, raise it instead.
- Match existing repository conventions. If none exist, state the convention in `docs/DECISIONS.md` before adopting it.

## Documentation

Documentation ships in the same commit as the code it describes.

- API reference is generated by the stack's native tool, never hand-written.
- Architecture docs live in `docs/architecture/`, authored from CodeGraph queries, in Mermaid so they render on GitHub and stay diffable.
- `README.md` must work from a cold clone on a fresh machine.
- `docs/docs-manifest.yml` maps doc pages to the code symbols they describe. CI fails when a documented symbol changed but its page did not.
- `docs/images/MANIFEST.md` tracks every screenshot: filename, what it shows, precondition, and status (CURRENT, STALE, MISSING). Never describe a screenshot you have not seen; mark it MISSING and surface it in `CONTINUE.md`.

## Releases

- v0.1.0 at the first slice that does something demonstrable end to end.
- Minor bump per completed feature group, patch for fixes between them.
- v1.0.0 only when every functional requirement is closed and every one has a passing mapped test.
- Pre-1.0 means the interface may break; the README should say so.
- Never tag with CI red. Never move an existing tag.

At each release: CI green, docs and API reference regenerated, no STALE or MISSING screenshots, traceability matrix complete for the requirements claimed, git-cliff run, annotated tag, GitHub Release published, and a plain-language MILESTONE paragraph at the top of the notes stating what this release proves the project can now do.

## Explaining the process

The person running this may be unfamiliar with branch-per-slice, conventional commits, semver, pre-push hooks, or traceability matrices. The first time you perform a lifecycle operation in a project, add one or two plain sentences on what you are doing and why, then continue without waiting. When a hook or gate blocks something, explain what triggered it, what it protects against, and the real options. Explain each thing once per project.

## Tone

Assume the user is technically strong. Be terse. Skip basic explanations of language features and standard tooling. When you make a non-obvious design choice, give the reasoning in one line.
