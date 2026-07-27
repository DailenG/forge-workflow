# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/DailenG/forge-workflow/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/DailenG/forge-workflow/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/DailenG/forge-workflow/releases/tag/v0.1.0
