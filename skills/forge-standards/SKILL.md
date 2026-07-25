---
name: forge-standards
description: Engineering standards for the forge lifecycle, covering ASCII typography rules, testing discipline, git lifecycle, commit and release rules, documentation duties, and resumability. Load this at the start of any forge phase and whenever a project contains CONTINUE.md, TODO.md, or docs/SRS.md. Also load whenever writing or editing any file during a forge phase, including specifications and decision records, since the typography rules apply to prose as well as code.
---

# SRS Workflow Engineering Standards

These apply to every project built with this workflow. Follow them even where they feel like overhead. They exist because skipping them is expensive later, and because the person running this may not have hit the failure mode that motivates each one yet.

## The resumability invariant

If this machine lost power at any instant, `CONTINUE.md` plus the git history must be enough for a fresh session with zero context to pick up correctly.

- Rewrite `CONTINUE.md` whenever the answer to "what is the next action" changes. Not at session end. Whenever it changes.
- Before starting anything long or risky, write `CONTINUE.md` describing what you are about to attempt.
- Never end a turn with both a dirty working tree and a stale `CONTINUE.md`. If the tree is dirty, `CONTINUE.md` must say so and say why.
- "Next action" is an action, not an aspiration. "Implement auth" is useless. "Add the token refresh branch to `AuthClient.refresh`; tests exist at `tests/auth_test.ts:88` and currently fail" is useful.
- Commit `CONTINUE.md` and `TODO.md` updates alongside the code they describe.

## Flow and strict mode

`CONTINUE.md` carries a `Mode:` field, defaulting to FLOW.

**FLOW** means proceed between units of work without asking. Report what you did after each slice, then continue. This removes friction, not visibility.

**STRICT** means report, state what you propose, and wait.

STRICT engages automatically regardless of the recorded mode when a release is in reach: the milestone backlog is empty, a version bump is proposed, a release gate fails, or the candidate version is v1.0.0. Stay strict through the release, then return to FLOW.

**Some gates are always strict, in every mode.** These are the reason the phased design exists, so never pass one autonomously:

- SRS approval
- Whether the GitHub repository is public or private
- Any command requiring elevation
- Discarding, stashing, or destroying uncommitted work
- Deleting a branch with unmerged commits
- Amending `docs/SRS.md`, since a spec change is a decision
- Tagging or publishing a release
- Anything the pre-push hook blocked. Report it, never bypass it
- Adding a dependency not named in the SRS
- Any discrepancy between recorded state and the repository

FLOW never means skipping a phase's own rules. It only removes the confirmation prompt between units of work.

## Testing

Testing is not a phase and not a checkbox. A slice without tests is not a slice, it is a demo.

**Write the test first** for anything with defined acceptance criteria in the SRS. The acceptance criteria are already the test. Transcribe them.

**Watch every new test fail before you make it pass.** A test that has never failed has not been shown to test anything. This catches the most common silent defect: a test that passes because it asserts nothing, targets the wrong code path, or was never actually executed.

**Test taxonomy.** Be deliberate about which level you are writing:
- Unit: one behavior, no I/O, no network, no clock, no filesystem. Fast and deterministic.
- Integration: real boundaries between your own components, with external systems stubbed.
- Contract: your assumptions about an external API, run against a recorded or live sample so you find out when the vendor changes.
- End to end: the smallest number of these that prove the critical paths work. They are slow and brittle, so they earn their place or they go.

Default weighting is many unit, some integration, few end to end. Deviate only with a stated reason.

**Traceability is mandatory.** Every functional requirement maps to at least one test that proves its acceptance criteria. Maintain `docs/traceability.md` mapping requirement IDs to test names and file locations. A requirement with no mapped test is not implemented, regardless of whether the code exists. This is what makes "the tests cover it" a verifiable claim rather than a feeling.

**Determinism.** No `sleep` for synchronization. No dependence on wall clock time, timezone, locale, filesystem ordering, or map iteration order. No shared mutable state between tests. A test that fails one run in twenty is worse than no test, because it trains people to rerun until green.

**Bug fixes get regression tests** that fail before the fix and pass after. No exceptions.

**Never make CI green by weakening tests.** Do not delete, skip, mark as expected-failure, loosen an assertion, or increase a timeout to get past a red build. If a test is genuinely wrong, say so explicitly, explain why, and get agreement before changing it. Silently neutering a test is the single most damaging thing you can do to a test suite.

**Coverage is a floor, not a goal.** Use it to find untested code, never as evidence of quality. High coverage with weak assertions is worse than honest low coverage because it manufactures false confidence.

**Verify the harness itself.** A test runner that finds zero tests usually reports success. Before trusting a green build, confirm the harness fails when it should.

## Git lifecycle

The workflow is: branch per slice, commit freely on the branch, merge to main with `--no-ff`, tag releases. No pull requests, because there is no second reviewer.

- One short-lived branch per slice, named for the slice
- Commit freely while on the branch. Incremental commits are what make mid-slice crash recovery possible, so do not hold work back to make a tidy history
- Conventional commit format. git-cliff derives the changelog from it, so a nonconforming subject silently disappears from release notes
- Merge to main with `--no-ff` so each slice is one identifiable unit on main. This makes rollback and bisect operate per slice instead of per commit
- Delete the branch after merging
- A slice that goes wrong is deleted with `git branch -D`, not unwound with reverts. This is the main reason branches exist here
- Never force push main. Never move an existing tag. Tags are immutable
- Never use `--no-verify`. The pre-push hook is the only automated gate before code reaches main. If it blocks you, the correct response is to fix what it caught, or to tell the user it is blocking and why. It is never to bypass it
- Commit the lockfile

## Secrets and safety

- No secrets in the repository, ever, including test fixtures and example configs
- Ship `.env.example` with keys and dummy values, never real ones
- No secrets in log output. Redact at the logging boundary, not at each call site
- Validate input at trust boundaries, not deep inside
- `.gitignore` is written before the first commit. A secret committed once lives in history forever

## Dependencies and tool substitution

- Never add one without naming it, justifying it, and stating its license
- **Do not substitute an already-installed tool for a specified one on capability grounds alone.** A named tool often encodes a non-capability constraint such as license, supply chain, or support posture. "Only install what is missing" reasons about capability and will happily accept a tool that is forbidden for this project. Check the constraint that motivated the original choice before swapping
- A repository with no LICENSE file is all rights reserved by default, not permissive
- When a substitution is justified, record the original choice, the substitute, and the reasoning in `docs/DECISIONS.md`
- Prefer the standard library for anything trivial
- Pin versions

## Modifying files safely

Learned from an incident that truncated two specification files to zero bytes.

**Use the Edit tool to change existing files.** Not shell redirection, not `Set-Content`, not `WriteAllText`. Shell rewrites bypass the typography hook, collapse CRLF on Windows, and have no undo.

**Any PowerShell run through Bash starts with both of these:**

```
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
```

Without them a script continues past a throw. The incident was exactly this: a `.Replace()` overload threw, the target variable was never assigned, execution continued, and `WriteAllText($file, $null)` emptied the file.

**Never write a variable that could be null or empty over an existing file.** Before any read-modify-write, assert the new content is non-empty and within a sane proportion of the original size. Abort otherwise.

**Verify positively, never by absence.** "Zero bad characters remain" is trivially true of an empty file, which is why the incident's own verification step reported success on destroyed data. Always assert that expected content is still present: line count, byte size in range, or a known string near the end of the file. A check that can pass on a destroyed file is worse than no check, because it converts a visible failure into a silent one.

**Confirm before destructive commands** regardless of FLOW mode: recursive deletes, `git reset --hard`, `git clean -f`, `git checkout --`. These are on the always-strict list.

## Typography, non-negotiable

Applies to every file you write, including specifications, decision records, and commit messages, not only source code.

- No em dashes or en dashes. Use a plain hyphen
- No curly quotes, single or double. Straight quotes only
- No ellipsis character. Use three periods
- No non-breaking spaces
- In PowerShell, never use the `&&` operator. Use `;` or separate lines

In code these are defects, not style: a curly quote inside a string literal or an em dash in an identifier breaks the build or corrupts output. A PostToolUse hook checks every file written and reports violations. When it does, fix the affected lines immediately rather than continuing.

## Code

- No dead code, no commented-out blocks, no TODO comments without a matching `TODO.md` entry
- Errors are handled, not swallowed. An empty catch block is a defect
- No placeholders and no "for now". If you are about to write one, stop and raise it instead
- Match existing repository conventions. If none exist, state the convention in `docs/DECISIONS.md` before adopting it

## Documentation

Documentation ships in the same commit as the code it describes, never in a later cleanup pass.

- API reference is generated by the stack's native tool. Never hand-write what a generator produces
- Architecture docs live in `docs/architecture/`, are authored from CodeGraph queries, and use Mermaid so they render on GitHub and stay diffable
- `README.md` must work from a cold clone on a fresh machine
- `docs/docs-manifest.yml` maps doc pages to the code symbols they describe. CI fails when a documented symbol changed but its page did not
- `docs/images/MANIFEST.md` tracks every screenshot: filename, what it shows, required precondition, and status (CURRENT, STALE, MISSING)
- Never describe a screenshot you have not seen. Mark it MISSING and surface it in `CONTINUE.md`

## Releases

- v0.1.0 at the first slice that does something demonstrable end to end
- Minor bump per completed feature group, patch for fixes between them
- v1.0.0 only when every functional requirement is closed and every one has a passing mapped test
- Pre-1.0 means the interface may break, and the README should say so
- Never tag with CI red

At each release: CI green, docs and API reference regenerated, no STALE or MISSING screenshots, traceability matrix complete for the requirements claimed, git-cliff run, annotated tag, GitHub Release published, and a plain-language MILESTONE paragraph at the top of the notes saying what this release proves the project can now do.

## Explaining the process

The person running this may not be familiar with branch-per-slice workflows, conventional commits, semver, pre-push hooks, or traceability matrices. Do not assume they are, and do not assume they are not.

The first time in a project that you perform a lifecycle operation, add one or two plain sentences explaining what you are doing and why, then continue without waiting. When a hook or gate blocks something, explain what triggered it, what it is protecting against, and the real options, rather than reporting an error and stopping.

Explain each thing once per project. Do not repeat it, and do not condescend. Assume high technical aptitude in general and unfamiliarity with this specific process.

## Tone

Assume the user is technically strong. Skip basic explanations of language features and standard tooling. Be terse. When you make a non-obvious design choice, give the reasoning in one line. When it involves a real tradeoff, add a brief offer to go deeper, once per topic, without withholding what you actually did while you wait.
