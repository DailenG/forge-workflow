# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.2] - 2026-08-03

The Phase 1 to 2 boundary, and the removal of one recorded field that could
never be true. Both are the defect family 1.1.1 addressed at the Phase 2 to 3
boundary: a record describing a state that either does not exist or cannot
exist.

### Fixed

- SRS approval is one transition. `forge-spec` no longer instructs a Phase 1
  `Gate: PASSED` state, and `forge` moves the record straight to `Phase: 2` with
  `Gate: IN_PROGRESS` in a single commit, clearing only the approval item from
  `Blocked on me` before invoking `forge-env`. Nothing read the intermediate
  state, and a session interrupted after it would have read Phase 1 while
  Phase 2 work was already underway. The approval gate itself is unchanged and
  still never self-approved.
- Detection ladder row 3 now keys the approved spec on `Phase: 2`, the record
  the transition actually writes.
- Removed the `Last commit:` field from `templates/CONTINUE.md`. Writing a SHA
  into a file and then committing that file changes the commit the field names,
  so the value was stale by exactly one commit every time it was recorded.
  Step 2 reconciled against it, manufacturing a discrepancy from a record that
  was working as designed. Reconciliation now reads the SessionStart git summary
  and `git log`. Legacy projects that carry the line are told to ignore and drop
  it, and its staleness is explicitly not a discrepancy.

### Added

- `tests/lifecycle-approval.test.js`, covering the approval transition contract
  and proving that injected commit identity comes from git rather than the
  record.

## [1.1.1] - 2026-08-03

Phase 2 completion is now one atomic state transition, so the handoff to Phase 3
cannot leave two records disagreeing about the same phase.

A completion wrote `CONTINUE.md` as `Phase: 2`, `Gate: PASSED` with Phase 3
planning next, but left `TODO.md` saying "No implementation task is in progress.
Phase 2 environment bootstrap is active." Both were committed, so the working
tree was clean and the contradiction lived entirely in the content. The next
session's reconciliation read it as a record-versus-reality discrepancy and
stopped. That stop is correct behaviour, and it is the reason the project could
not advance without a human untangling the two records by hand.

### Fixed

- Phase 2 completion in `forge-env` is one transition. `CONTINUE.md`, `TODO.md`,
  and `docs/ENVIRONMENT.md` are all updated before any of them is committed,
  committed together in one conventional commit, then reconciled against git
  HEAD, the current branch, and working-tree status.
- The completion record describes the state that exists after its own commit.
  Transient wording such as `pending commit` is prohibited, because the
  committed tree is already clean.
- `TODO.md` says `Phase 2 environment bootstrap is complete` at completion. The
  stale "is active" claim that caused the failure is named and prohibited.
- Existing blockers and permanent task IDs such as `T-ENV-001` survive the
  transition, with applicable work carried into the Phase 3 backlog without
  renumbering.
- The `forge` detection ladder recognises a completed Phase 2 record
  (`Phase: 2`, `Gate: PASSED`) as the Phase 3 handoff rather than stopping
  because the phase number is still 2.

### Added

- `tests/lifecycle-completion.test.js`, covering the transition's instruction
  contract and cold starting a real git repository holding the completed record
  through the SessionStart hook.

## [1.1.0] - 2026-08-02

Capability-based default-branch protection, so a free-tier account with a
private repository is no longer blocked at bootstrap.

Phase 2 previously required a GitHub ruleset on `main`. GitHub reserves that
for paid plans on private personal repositories and answers `Upgrade to GitHub
Pro or make this repository public to enable this feature`, which left a solo
developer on a free plan with a bootstrap gate they could only pass by paying
or by publishing a private repository. Neither is an acceptable price for a
lifecycle gate.

### Added

- `templates/branch-protection.js`: a provider-neutral protection tool.
  `detect`, `apply`, `verify`, `selftest`, `gate`, `migrate`, `report`, and
  `status` subcommands, with adapters for GitHub (rulesets, falling back to
  classic branch protection on older Enterprise Server), GitLab (protected
  branches), and an explicit fallback for self-hosted or unrecognised hosts. It
  takes the strongest tier the host and account actually support and records
  the provider, mechanism, and verification evidence in
  `.forge/protection.json`.
- `templates/history-guard.js`: a managed `pre-push` history-integrity guard.
  It reads the ref-update records git writes to a pre-push hook's stdin and
  refuses deletion of the protected branch and non-fast-forward updates to it,
  while allowing fast-forward pushes and initial branch creation. It fails
  closed, with a message naming the fix, when it cannot see the ref records.
- `branch-protection.js selftest`, which proves the guard end to end against
  disposable repositories in a temp directory. Every recursive delete goes
  through a check that refuses anything that is not a directory the tool itself
  created under the system temp directory with its own prefix.
- A test suite under `tests/`, run with `node --test tests/` and wired into CI.

### Changed

- Phase 2's protection step is now capability based. The gate item is
  "default-branch history protection verified", satisfied by either verified
  server-side enforcement or verified managed local enforcement with its
  narrower trust boundary recorded. An unavailable paid hosting feature is no
  longer a fatal bootstrap failure.
- `templates/lefthook.yml` runs the history check first, with `use_stdin: true`
  so lefthook forwards git's ref records to it, and `piped: true` so the secret
  scan, lint, build, and test commands do not run after it has already refused
  the push. The command is named `00_history` because lefthook orders commands
  by priority, then by the leading number in the name, then alphabetically,
  never by their position in the file.
- `verify` inspects rather than installs. An earlier form called the installer,
  which meant a hook the user had deleted was silently recreated and then
  reported as verified. It now also confirms the hook is somewhere git will
  actually run it, honouring `core.hooksPath`, and that `lefthook install` has
  been run rather than trusting `lefthook.yml` alone.
- The recorded `protections` list reflects what was verified rather than being
  written unconditionally, so the gate's coverage check is live.
- `forge-standards` states the protection policy once, behaviourally and
  without naming a host, alongside its trust boundary.
- The always-strict repository visibility gate now covers later changes to
  visibility as well as the initial choice. A hosting feature that is only
  available on public repositories is never a reason to change it, and the
  tool refuses to issue a visibility mutation at all.
- The hosted guide gains a "Which edition to install" section (new section 03, later
  sections renumbered) explaining the two editions and which Claude generation each
  targets, plus a version stamp in the title block. Readers landing on the install
  section are now told which edition those commands install.

### Migration

A project whose environment phase stalled on a paid-plan ruleset resumes with
`node .forge/branch-protection.js migrate`, which re-detects provider
capability, installs and verifies the fallback, and names exactly which
recorded blocker to clear. Unrelated blockers are preserved.

## [1.0.0] - 2026-07-27

Lean rewrite of every skill for Claude 5 era models.

The Claude 4 era prompting style this plugin was written in is counterproductive on
Claude 5: the model follows instructions well and self-verifies, so defensive
scaffolding costs quality and tokens instead of adding safety. Every skill was
rewritten against Anthropic's Claude 5 prompting guidance. The prompt corpus is about
26 percent smaller with no change to what the plugin does.

If you want the Claude 4 era edition, it is frozen and maintained separately as
`forge4-workflow` (command `/forge4`).

### Changed

- Removed self-verification and re-check instructions ("double-check before
  responding", "do not take it worked as proof"). Claude 5 verifies its own work, and
  these instructions caused over-verification rather than better results.
- Converted absolute bans that were babysitting the model into adaptive guidance,
  while keeping the bans that protect the user's repository.
- De-duplicated instructions across layers. Testing discipline, git lifecycle, release
  cadence, documentation duties, and typography are now stated once in
  `forge-standards`, and the phase skills point at it instead of restating it. The
  per-skill typography banner is now a one-line pointer.
- Trimmed generic engineering sermons and speculative guards for failure modes that
  were never actually observed.
- `forge-code` and `forge-standards` no longer disagree about where the release
  checklist lives: cadence and gates are in `forge-standards`, execution order is in
  `forge-code`.
- The `dailen` marketplace now lives in a dedicated catalog repository,
  `DailenG/dailens-claude-toolbelt`, which references this plugin by an external
  https source. Install is now `claude plugin marketplace add DailenG/dailens-claude-toolbelt`
  then `claude plugin install forge-workflow@dailen`. This repository's own
  `marketplace.json` is renamed to `dailen-dev` and is for local development only.
  Existing users who added the old `DailenG/forge-workflow` marketplace should
  re-point to the catalog (see README).

### Unchanged (deliberately)

Every gate and safety behavior survives the rewrite: the detection ladder and its
`=== FORGE: PROJECT STATE ===` check, SRS approval as an always-strict gate that
Claude never self-approves, record-versus-reality reconciliation stopping on a
discrepancy, the full always-confirmed action list, the pre-push gate with
`--no-verify` prohibited, failing regression tests before bug fixes, harness
failure verification, the code-intelligence license gate, and ASCII-only typography.

### Fixed

- Version bumped from `0.1.0`, which was also the cache key, so installed copies now
  receive the rewrite.

## [0.1.0] - 2026-07-25

Initial public release.

### Added

- `/forge` orchestrator command: detects the current phase, reconciles the recorded state against the repository, and does the next thing.
- Phase 1 (`/forge-spec`): requirements discovery to 95 percent confidence, producing `docs/SRS.md` behind a mandatory approval gate.
- Phase 2 (`/forge-env`): toolchain and repository bootstrap, testing harness, git hooks, and CI. Windows and PowerShell specific today.
- Phase 3 (`/forge-code`): test-driven implementation in vertical slices, branch per slice, with a pre-push gate running build, tests, lint, and a secret scan.
- `forge-standards`: always-loaded engineering standards covering typography, testing discipline, git lifecycle, and resumability.
- SessionStart, PreToolUse, PostToolUse, and Stop hooks for state injection and drift detection, backed by four Node scripts.
- Project file templates for `CONTINUE.md`, `TODO.md`, traceability, docs and image manifests, CI, and release tooling.
- Illustrated user guide hosted on GitHub Pages.
- Marketplace distribution via the `dailen` marketplace, plus a manual skills-directory install path.

[Unreleased]: https://github.com/DailenG/forge-workflow/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/DailenG/forge-workflow/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/DailenG/forge-workflow/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/DailenG/forge-workflow/releases/tag/v0.1.0
