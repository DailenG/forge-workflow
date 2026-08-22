# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.3.0] - 2026-08-21

### Fixed

- A slipped polish finding no longer goes orphaned when the version it slipped
  to publishes without it ([#4](https://github.com/DailenG/forge-workflow/issues/4)).
  The rule had a write side and no read side: a finding recorded as slipping to
  a version stayed open, stayed recorded, and stopped gating anything once that
  version shipped or was skipped. Now the anchor is read back in three places.
  The release checklist in `forge-standards`, the Phase 3 release order, and the
  `forge-design` polish pass all require every open UX debt row whose slip
  target is at or below the version being tagged to be closed or re-anchored
  forward before the tag. `forge` Step 2 treats an item anchored to an
  already published version as a discrepancy rather than stale prose. A user
  override of a proposed version sweeps whatever was anchored to the version
  being skipped, at the moment the override is recorded.

### Added

- Packaging is a decision Phase 1 makes and Phase 3 acts on
  ([#1](https://github.com/DailenG/forge-workflow/issues/1)). The distribution
  question was captured in the spec and never consumed, so no release ever
  produced an artifact. `forge-spec` now recommends the easiest packaging
  mechanism that fits the usage type and records it concretely in the SRS:
  versioned zip or tarball by default, a 7-Zip self-extracting exe, a WiX MSI
  as an explicit non-default upgrade, or a single binary release asset for a
  CLI or library with the natural registry named and handed to the user. A
  hosted service records "not applicable" and gets no artifact, because
  packaging there is deployment. Phase 3 builds that artifact at release time,
  smoke-tests it on a clean target outside the build tree, and attaches it to
  the GitHub Release, warning that any exe or MSI is unsigned and will trip
  SmartScreen or Gatekeeper. Signing, notarization, app stores, and auto-update
  stay user-owned; forge produces the easy artifact and names the rest.
- `scripts/package.js` builds this plugin's own manual-install zip, and the
  payload now includes `LICENSE`
  ([#3](https://github.com/DailenG/forge-workflow/issues/3)). Every release so
  far shipped MIT code in a bundle with no license text, because the artifact
  was assembled by hand. The payload is declared in one place, expands
  `skills/` and `templates/` against the real tree so a new file cannot be
  dropped, and the build refuses by name when a member is missing.
- `Slip target` column in the UX Debt register of `templates/TODO.md`, so the
  version a row waits on is recorded where the release gate can read it.
- `forge-standards` section "Defects in the workflow itself": a gap in forge is
  filed upstream against this repository rather than patched into the project
  that found it. The plugin resolves at runtime to a versioned plugin cache
  directory, so a local fix does not survive an update.

## [1.2.2] - 2026-08-17

### Added

- Phase 3 mirrors its build plan and the open slice's steps into Claude Code's
  own todo list as it works, instead of surfacing progress only in the
  end-of-run report. Watchable while it happens, not just after.

### Changed

- Opening a Ready backlog item never gets a second confirmation. The
  go-ahead already happened when it was captured as Ready; asking again at
  pickup time was the same failure the disposition rule fixed, just moved one
  step later.

## [1.2.1] - 2026-08-17

### Added

- Backlog dispositions in `forge-standards`: every `TODO.md` backlog entry
  states why it is waiting as Ready, Needs decision, or Deferred at your
  request, reflected back in one line at capture time. "Not for autonomous
  pickup" conflated who acts with why, and read as deprioritized when it
  usually was not.
- Guide freshness checks in `tests/repo-standards.test.js`: every edition stamp
  names the shipped version, the what-is-new banner tracks the current minor,
  every shipped command appears in the guide, every detection ladder row has a
  rung, and the design discipline is described. Stale documentation was the
  defect here, so it is now a failing test rather than a thing to remember.
- `CLAUDE.md` and `CONTRIBUTING.md` record updating the hosted guide as a
  release step.

### Changed

- Detection ladder row 7 opens the next Ready slice, surfaces a Needs-decision
  item's named question, and leaves Deferred items alone, instead of treating
  the whole backlog as one undifferentiated "open the next slice."
- The hosted guide catches up with 1.2.0. It announced 1.0.0 in three places
  while the plugin shipped 1.2.0, and said nothing about the design pass, the UX
  debt register, the polish pass before a release, the observability decisions,
  or the capability backfill offer an older project now gets. It also never
  mentioned that Phase 2 is written for Windows and PowerShell today, which is
  the one thing a reader on a Mac needs to know before starting.
- The guide's detection ladder shows all eleven rungs, including the two the
  1.2.0 ladder added, and the rungs are now `details` elements, so they open
  without JavaScript and drop the script that toggled them.
- The guide claimed its glossary terms were underlined throughout the page while
  carrying exactly one. It now defines repository, slice, and UX debt where those
  words first appear, and the glossary itself gained the vocabulary 1.2.0
  introduced: surface, design brief, design pass, UX debt, polish pass, gate,
  autopilot, backfill.
- The guide's blocked-by table covers the gates 1.2.0 added: a rough edge still
  open on something the release claims, a request that would amend the spec, an
  upload to an outside service the spec never named, and the capability backfill
  offer, which is explicitly not a block.
- The guide page declares a description, a canonical URL, and link-preview
  metadata, so a shared link is no longer a bare title.

## [1.2.0] - 2026-08-15

Design, UX, and observability become managed parts of the lifecycle instead of
things a slice was free to skip. The gap this closes: nothing owned the
experience, slices closed on green tests, and a UX observation could be
acknowledged and then evaporate. Now every observation carries a disposition,
and the last stretch before a release is explicitly polish.

### Added

- `forge-design` skill and `/forge-design` command: the design tier (GUI,
  CLI/TUI, API, Service), the design brief in `docs/DESIGN.md`, `UX-nnn`
  requirements with a named verification method each, the per-slice design pass,
  the `UXD-nnn` UX debt register with a blocks / degrades / finish severity
  scale, and a per-tier release polish checklist. It loads whenever work touches
  a surface rather than being a phase of its own.
- `templates/DESIGN.md`: surface inventory, primary tasks with step counts,
  design language decisions, platform conventions, accessibility target, copy
  and tone rules, UX requirement index, and the polish log appended at each
  release.
- Phase 1 gains an eleventh critical coverage area, experience and interaction
  design, so the confidence readout can no longer reach 95 with the experience
  unspecified. It also writes `docs/DESIGN.md`, commits it with the Phase 1
  safety net, and adds a design and accessibility story to the stack comparison.
- Phase 1 extracts explicit observability decisions: log destination and format,
  levels and the default, what is never logged, the error reporting route,
  whether telemetry exists and its consent model, metrics and health, and the
  audit trail with its retention. "Nothing leaves the machine" is an answer;
  unrecorded is not.
- Phase 2 Step 11a provisions what the verification methods need per design tier
  (browser driver, screenshot capture, accessibility scanner, CLI output
  harness, doc example runner) plus the logging layer the SRS asked for, and
  records both in `docs/ENVIRONMENT.md`. The Phase 2 gate now covers it.
- Phase 3 runs a design pass inside every slice that touches a surface, reads
  its own failure-path log output, and reports where each finding went.
- Detection ladder row 8, Polish due: a milestone with an empty backlog and no
  polish log entry runs the polish pass before a release can be proposed. Former
  rows 8 to 10 are now 9 to 11.
- `forge-standards` gains a Design and UX section and an Observability section,
  and the release checklist now requires the polish pass with its findings
  recorded.
- UX Debt section in `templates/TODO.md`, and an experience requirements table
  in `templates/traceability.md`.
- `/forge` Step 2a, capability backfill: a project started under an older forge
  version is detected as missing an artifact rather than treated as broken. A
  missing capability is explicitly not a record-versus-reality discrepancy, so it
  does not trip the reconcile stop. Forge raises the whole set once and offers
  three answers, recommending one: backfill now, backfill as its own slice, or
  skip for this project (not recommended). The answer is recorded in a new
  `Capabilities:` line in `CONTINUE.md` and in `docs/DECISIONS.md`, and a skip
  makes that capability's gates and ladder rows inert instead of nagging.
- `forge-design` "Retrofitting a project already under way": a short interview,
  a surface inventory read off the code, the de facto design language written
  down as it is, one `degrades`-and-above design pass per shipping surface, and
  `UX-nnn` requirements for what already ships as an SRS amendment.
- `forge-design` "External design tools": the options are named and offered rather
  than assumed. Claude Design (Anthropic Labs, `claude.com/product/design`) for
  exploration, prototypes, and a codebase-derived design system, whose handoff
  bundle lands in `docs/design/` with its decisions transcribed into the brief;
  the official-marketplace `frontend-design`, `figma`, `chrome-devtools-mcp`, and
  `playwright` plugins; and Claude Code's own Chrome connection or macOS computer
  use as the fallback for visual checks with no driver. Phase 1 raises the list
  while the design language is still open, `forge-env` Step 11a installs whichever
  was chosen, and "none" is a recorded answer. None of them may become a
  prerequisite: the brief stays authoritative, and a prototype is evidence rather
  than a requirement or an implementation.
- `tests/design-and-observability.test.js`, holding the contract: the discipline
  exists, every tier has a polish checklist, a slice cannot close over an
  unlooked-at surface, and the redaction rule is stated once.

### Changed

- Slipping a polish finding, or releasing with a `blocks` or `degrades` UX
  defect open on a surface the release claims, is an always-strict gate.
- Uploading repository contents, a screenshot of real data, or user data to an
  external service the SRS did not name, a hosted design tool included, is an
  always-strict gate.
- v1.0.0 now also requires every `UX-nnn` requirement verified by its named
  method.
- The log redaction rule moved out of Secrets and safety into the new
  Observability section, so it is stated once.

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

[Unreleased]: https://github.com/DailenG/forge-workflow/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/DailenG/forge-workflow/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/DailenG/forge-workflow/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/DailenG/forge-workflow/compare/v1.1.0...v1.1.2
[1.1.0]: https://github.com/DailenG/forge-workflow/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/DailenG/forge-workflow/compare/v0.1.0...v1.0.0
[0.1.0]: https://github.com/DailenG/forge-workflow/releases/tag/v0.1.0
