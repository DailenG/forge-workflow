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

## Record hygiene

Every artifact here is append-oriented, so without a ceiling the record set grows until it no longer fits a session, and then the reconcile step runs on a partial read while still reporting confidence. Size is a defect, not evidence of rigor.

- `CONTINUE.md` holds current state and the next action. Ceiling: 200 lines. The SessionStart hook injects it against a budget a file under the ceiling never reaches, so a capped injection means the file has taken on history. Over the ceiling, compacting it is part of the current slice.
- A closed slice's narrative does not live in `CONTINUE.md`. Write it once where it belongs: reasoning in `docs/DECISIONS.md`, test evidence in `docs/traceability.md`, disposition in `TODO.md`. A "what T-042 shipped" section is deleted when the next slice opens, not accumulated.
- **One fact, one owner.** `TODO.md` carries the disposition, `docs/DECISIONS.md` the reasoning, `docs/traceability.md` the test evidence, `docs/DESIGN.md` the surface, `CONTINUE.md` the next action. Cross-reference by ID; do not re-narrate. Restating one closure across four files is how the four come to disagree, and the disagreement is discovered by a reader who trusted whichever it read first.
- **Correct by superseding, not by layering.** A record that is now wrong is rewritten in place and marked superseded, dated. Appending the correction below a claim that stays put leaves both readable, and the stale one reads first.
- `TODO.md` Completed entries move to `docs/DONE-ARCHIVE.md` past 50 entries. A CLOSED item leaves the backlog in the same edit that closes it, so the backlog stays a list of work rather than a history of it.

The three rules above that name a specific file apply while the record set is monolithic. Under `records: backfilled` the same intent is enforced mechanically and those files no longer exist in that shape, so read the next section instead. `CONTINUE.md`'s ceiling holds either way.

## Structured records

A capability, recorded in the `Capabilities:` line as `records`. Under `skipped` or an unanswered offer, everything here is inert and Record hygiene above is the whole discipline. Do not re-litigate a recorded skip.

Under `backfilled`, `docs/records/` is the system of record and the monoliths are gone:

| Path | Authority |
|---|---|
| `docs/records/{decisions,tasks,requirements,uxd}/<id>.md` | Authoritative. One record, one file, one ID |
| `docs/records/VOCABULARY.md` | Authoritative. Declares every legal ID prefix |
| `docs/views/**` | **Generated. Never hand-edited.** A PreToolUse hook denies the write |
| `.forge/index.json` | Generated, gitignored, rebuildable. Authoritative about nothing |

- **Write the fact once, in the record that owns it, then regenerate.** A slice close edits its task record and adds one decision record. It does not restate the closure in four files, because the views derive it. This is the whole point: on the project that motivated this, one closed defect was narrated seventeen times across three files.
- **Supersession is the answer to "which is live now".** Set `supersedes` on the new record. `node .forge/forge-records-lint.js --fix` writes the reverse edge and the superseded record leaves every view. Never edit a superseded record's body to correct it.
- **Never invent an edge.** A missing edge surfaces as an orphan warning; a wrong one surfaces as nothing at all.
- After editing records: `node .forge/forge-records-lint.js`, then `node .forge/forge-index.js build`, then `node .forge/forge-views.js render`. Commit the records and the regenerated views together, or the next reader sees a view that disagrees with its own source.
- The linter and the view check run in the pre-push hook. A dangling edge, a duplicate ID, or a fork in supersession blocks the push. Fix the records; never bypass.

Migration onto this shape is `node .forge/forge-records-migrate.js` and is **always its own slice**, taken with the user's consent, never mid-slice. It refuses a dirty working tree, moves the originals to `docs/archive/pre-records/` rather than deleting them, and reports the decision entries it could not connect to anything for a human to resolve.

## Flow and strict mode

`CONTINUE.md` carries a `Mode:` field, defaulting to FLOW.

**FLOW**: proceed between units of work without asking. Report what you did after each slice, then continue.

**STRICT**: report, state what you propose, and wait.

STRICT engages automatically regardless of recorded mode when a release is in reach: the milestone backlog is empty, a version bump is proposed, a release gate fails, or the candidate version is v1.0.0. Stay strict through the release, then return to FLOW.

**Always-strict gates, in every mode.** These are the reason the phased design exists. Never pass one autonomously:

- SRS approval
- Whether the remote repository is public or private, including any later change to it
- Any command requiring elevation
- Discarding, stashing, or destroying uncommitted work
- Deleting a branch with unmerged commits
- Amending `docs/SRS.md` (a spec change is a decision)
- Tagging or publishing a release
- Anything the pre-push hook blocked. Report it, never bypass it
- Adding a dependency not named in the SRS
- Slipping a polish pass finding, or releasing with a `blocks` or `degrades` UX defect open on a surface the release claims
- Uploading repository contents, screenshots of real data, or user data to an external service the SRS did not name, including a hosted design tool
- Any discrepancy between recorded state and the repository

FLOW removes the confirmation prompt between units of work. It never skips a phase's own rules or an always-strict gate.

## Backlog dispositions

A backlog entry in `TODO.md` states why it is waiting, in one of three explicit dispositions, and the disposition is reflected back in one line the moment the item is captured, not only when reporting status later:

- **Ready** - queued to build, no open question. Proceeds under FLOW without asking.
- **Needs decision: <the question>** - a named design or scope question blocks starting it.
- **Deferred at your request** - the user said later or park it; do not raise it again until they do.

"Not for autonomous pickup" is not a disposition: it describes who acts, not why, and reads as deprioritized when it usually is not.

Opening a Ready item never gets a second confirmation. The go-ahead already happened when it was captured as Ready; asking again at pickup time is the FLOW-mode confirmation prompt FLOW exists to remove, and doing it anyway is the same failure the disposition rule fixes, just moved one step later.

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

## Design and UX

`forge-design` owns the design tier, the brief in `docs/DESIGN.md`, the UX requirement rules, and the polish checklists. Two of its rules are standards, because they are what stops experience work from evaporating under delivery pressure:

- **Every UX observation gets a disposition.** Fixed in the slice, or filed as `UXD-nnn` in the UX Debt section of `TODO.md` with a severity and what fixed would look like. Calling it subjective is not a disposition, and neither is mentioning it in a slice report.
- **A slice that changed a surface has been run and looked at**, in the browser, terminal, or application it ships in. Passing tests are not evidence about a surface.

`UX-nnn` requirements are traced like functional ones. The polish pass runs before every minor and major tag; slipping one of its findings is the user's decision, recorded in the row's `Slip target` column with the version it slips to.

A slip target is a live anchor, not an annotation, so it gets read again:

- **Before any tag**, every open row whose slip target is at or below the version being tagged is closed, or re-anchored forward with the user's agreement. A tag never passes silently over the debt that named it.
- **When the user overrides a proposed version** (choosing `0.4.0` over `0.4.0-rc1`, say), sweep everything anchored to the version being skipped at the moment the override is recorded. The skipped version will never arrive, so nothing later will look at those rows on its own.
- **A slip target naming a version already published is a discrepancy**, handled per `forge` Step 2, not stale prose to read past.

Version-anchored debt goes invisible exactly when the version series moves on: the rows stay open, stay recorded, and stop gating anything.

A project older than a capability is not in violation of it. The `Capabilities:` line in `CONTINUE.md` records what `/forge` Step 2a backfilled or skipped, and a recorded skip makes that capability's rules inert for that project. This applies to the observability section below too.

## Observability

Decided in Phase 1, provisioned in Phase 2, wired by the first slice that runs. A project whose answer is "stderr, structured off, nothing leaves the machine" has answered; an unrecorded answer means the first slice invents one.

- **Log at the boundaries:** process start with its effective configuration, outbound calls and their outcome, state changes worth reconstructing, handled failures, and every unhandled one. Not every function.
- **Levels mean things.** ERROR: someone must act. WARN: degraded but handled. INFO: lifecycle an operator reads. DEBUG: development only. The default runtime level is one a user or operator can read without a filter.
- **Redact at the logging boundary, not the call site**, so a new call site cannot leak. Secrets, tokens, and PII per the SRS data section. No secrets in log output, ever.
- **Anything leaving the machine is opt in**, off in development, named in the SRS, and documented where the user will see it. Crash reports, analytics, and usage telemetry alike.
- **An error a user sees is a surface.** It names what failed, what was being attempted, and the next action, and it carries an identifier that also appears in the log so a report can be traced back.
- **Read your own log output.** Run the slice's failure path and look at what it emits. Unread log output is unverified, and it is where both leaked secrets and useless messages hide.

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

### Default-branch protection

The requirement is behavioural, not a named product feature: **the default branch must not be deletable and must not accept a non-fast-forward update**, while ordinary fast-forward pushes and `--no-ff` merges keep working. Phase 2 satisfies it at the strongest tier the host and account actually support, and records which.

- **Tier 1, server side.** The host enforces it for every writer, including web UI and API writes. Preferred whenever available.
- **Tier 2, managed local.** A pre-push guard enforces the same two rules. Its trust boundary is narrower and must be written down where it is used: it protects configured clones only, and not an unconfigured clone, a host API or web UI write, a deleted or edited hook, or an attacker holding valid credentials.

Neither tier may be weakened or skipped, and neither may be traded for the other silently. Some hosts reserve tier 1 for paid plans on private repositories; that is a reason to use tier 2 and say so, never a reason to require a paid plan or to make a private repository public. Repository visibility changes only when the user asks for it.

## Secrets and safety

- No secrets in the repository, ever, including test fixtures and example configs. Ship `.env.example` with dummy values.
- Validate input at trust boundaries.
- Write `.gitignore` before the first commit. A secret committed once lives in history forever.

## Dependencies and tool substitution

- Never add a dependency without naming it, justifying it, and stating its license.
- **Do not substitute an already-installed tool for a specified one on capability grounds alone.** A named tool often encodes a non-capability constraint (license, supply chain, support). Check that constraint before swapping, and record the original choice, the substitute, and the reasoning in `docs/DECISIONS.md`.
- A repository with no LICENSE file is all rights reserved by default, not permissive.
- Prefer the standard library for anything trivial. Pin versions.

## Defects in the workflow itself

A defect or gap in forge itself is filed upstream against the forge-workflow repository, not patched into the project that found it. The plugin resolves at runtime to `~/.claude/plugins/cache/<owner>/forge-workflow/<version>/`, so a local fix does not survive an update and every other project keeps the defect. File it, record the issue in `docs/DECISIONS.md`, and carry a local workaround only until the upstream fix ships.

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
- v1.0.0 only when every functional requirement is closed with a passing mapped test, and every `UX-nnn` requirement is verified by its named method.
- Pre-1.0 means the interface may break; the README should say so.
- Never tag with CI red. Never move an existing tag.
- **A user override of a proposed version sweeps the version being skipped.** When the user picks a different version than the one proposed, every open row anchored to the skipped version is re-anchored or closed at that moment, while someone is looking. A skipped version never arrives, so nothing downstream will ever check it.

At each release: CI green, docs and API reference regenerated, no STALE or MISSING screenshots, traceability matrix complete for the requirements claimed, the `forge-design` polish pass run over every surface the milestone touched with its findings recorded in the polish log, no open `blocks` or `degrades` UX debt on those surfaces except what the user agreed to slip, no open UX debt whose recorded slip target is at or below this version (each such row is closed, or re-anchored forward with the user's agreement, before the tag), git-cliff run, annotated tag, GitHub Release published, the artifact the SRS distribution section names built, smoke-tested on a clean target, and attached to that release (or one line in the notes saying why none applies, plus the unsigned-binary warning whenever an exe or MSI is attached), and a plain-language MILESTONE paragraph at the top of the notes stating what this release proves the project can now do.

## Explaining the process

The person running this may be unfamiliar with branch-per-slice, conventional commits, semver, pre-push hooks, or traceability matrices. The first time you perform a lifecycle operation in a project, add one or two plain sentences on what you are doing and why, then continue without waiting. When a hook or gate blocks something, explain what triggered it, what it protects against, and the real options. Explain each thing once per project.

## Tone

Assume the user is technically strong. Be terse. Skip basic explanations of language features and standard tooling. When you make a non-obvious design choice, give the reasoning in one line.
