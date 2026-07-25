# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/DailenG/forge-workflow/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/DailenG/forge-workflow/releases/tag/v0.1.0
