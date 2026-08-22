---
name: forge-design
description: Design, UX, and polish discipline for the forge lifecycle. Covers the design tier, the design brief in docs/DESIGN.md, UX requirements and their verification methods, the per-slice design pass, the UX defect register, and the release polish pass. Load whenever work touches a user-facing surface (GUI, terminal, library API, or operated service), whenever a UX observation needs disposing of, and whenever a release is in reach.
---

> Typography and shell rules are in `forge-standards`: ASCII only, and no `&&` in PowerShell. They apply to every file this skill writes.

# Design, UX, and polish

This skill owns the question tests cannot answer: what is this like to use, and is it finished. Effort scales with the design tier. It never scales to zero, because every project has a surface and someone has to live on it.

## Design tier

Phase 1 fixes the tier and records it in `docs/SRS.md` and `docs/DESIGN.md`. A project can hold more than one; each gets its own brief section and its own polish checklist.

| Tier | Surface | The design work is |
|---|---|---|
| **GUI** | web, desktop, mobile | layout, interaction, visual language, accessibility |
| **CLI/TUI** | terminal | output shape, argument ergonomics, progress and failure legibility |
| **API** | code other developers consume | naming, defaults, error types, the examples that ship |
| **Service** | headless, operated | configuration, health output, whether a failure is diagnosable |

The tier decides which checklist applies, not whether design happens.

Record the **quality bar** as one sentence in the brief: "internal tool, five users, correctness over finish" or "client facing, first impression decides adoption". Hold the work to it in both directions. Do not gold plate an internal script, and do not ship a client-facing surface with dead-end errors.

## The brief: docs/DESIGN.md

Phase 1 writes it from the interview, sized to the tier, from `templates/DESIGN.md`. It holds:

- **Surface inventory.** Every screen, command, endpoint, or dialog, named. Slices that add a surface append to it.
- **Primary tasks.** The three to five things users do most, each with the intended path and its step count.
- **Design language.** GUI: type scale, spacing unit, colour roles (which role each colour plays, not a palette dump), component library or explicitly none, motion policy, icon set. Other tiers: the equivalent conventions, meaning output format, naming pattern, error shape.
- **Platform conventions to honour.** Where the target platform has an expectation (Windows dialog button order, macOS menu placement, POSIX flag conventions, web focus behaviour), name it here so it is not relitigated per slice.
- **Accessibility target.** A named standard and level plus the invariants actually checked: WCAG 2.2 AA, keyboard complete, focus always visible, nothing signalled by colour alone.
- **Copy and tone.** Case, person, tense, how errors are phrased, and a terminology table for anything the domain names inconsistently.
- **Quality bar.** The sentence above.
- **Polish log.** Appended at each release: date, version, checklists run, findings, what was fixed, what slipped and to which version.

Amend it the way `docs/SRS.md` is amended: append, dated, with reasoning. A change to a design language decision is a `docs/DECISIONS.md` entry, not a silent edit, because every surface built after it inherits it.

## UX requirements

Experience requirements live in `docs/SRS.md` beside the functional ones, numbered `UX-001`, under the same rules: permanent IDs, testable acceptance criteria, a row in `docs/traceability.md`.

Each names its verification method:

| Method | Settles |
|---|---|
| interaction test | what a driver can exercise: focus order, keyboard paths, disabled and error states |
| accessibility scan | contrast, labels, roles, tab order |
| visual check | layout and finish, against a screenshot captured into `docs/images/` |
| task walkthrough | step count and comprehension: perform the task as the user and record the steps taken |

Write criteria a method can settle. "The dashboard feels responsive" cannot be settled. "Every action acknowledges within 100ms, and any wait past 1s shows determinate progress" can.

## The design pass

Runs inside any slice that adds or changes a surface, after its tests pass and before it closes.

1. Run the real thing: the app in a browser, the binary in a terminal, the library in a scratch script
2. Walk the primary tasks the slice touches, and count the steps against what the brief claims
3. Exercise the states: empty, loading, partial, error, permission denied, success, and more data than fits. A state with no representation is a defect, not an omission
4. GUI tiers: keyboard only, then at 200 percent text size
5. Read what it says. Labels, empty-state text, and error messages are the surface most often shipped as placeholder prose
6. Compare against the brief and the platform conventions it names

Then dispose of every observation. There are exactly two dispositions:

- **Fix it in this slice**, when it blocks a task or when fixing is cheaper than filing
- **File it** as `UXD-nnn` in the UX Debt section of `TODO.md`, with the surface, the severity, and what fixed would look like

Calling an observation subjective is not a disposition, and neither is mentioning it in the slice report. An observation with no ID is an observation that is gone.

### Severity

| Severity | Meaning | Timing |
|---|---|---|
| **blocks** | the task cannot be completed, a failure is silent, or a state dead-ends with no way back | fix in the slice; it does not close over one |
| **degrades** | completable but misleading, slow to understand, or against a convention the brief names | before the next release |
| **finish** | spacing, alignment, wording, iconography, motion inconsistency | the polish pass |

Severity is about the user's task, not the size of the diff.

## The polish pass

As a release comes into reach the remaining work changes character: the milestone backlog is empty and what is left is finish. Run the polish pass before any minor or major tag, over every surface the milestone touched. A patch release polishes what it changed.

Run each tier's checklist, record the run in the polish log, and clear every `finish` and `degrades` item or get an explicit decision to slip it, naming the version it slips to in the row's `Slip target` column. Slipping is the user's call, not yours.

Then sweep what earlier passes slipped into this one: every open row whose slip target is at or below the version about to be tagged is closed here, or re-anchored forward with the user's agreement. A row anchored to a version that shipped without it, or to a version the user skipped, is gating nothing and will not surface again on its own.

**GUI**

- Every state from the design pass, on every surface the milestone added
- First run: empty account, no data, nothing configured
- Keyboard: complete paths, visible focus, no traps, escape closes what it opened
- Contrast and text scaling; nothing signalled by colour alone
- Window resize, the brief's breakpoints, and the smallest supported viewport
- Motion honours reduced-motion, and nothing animates for longer than it takes to read
- Copy: consistent case, tense, and terminology; every error names the next action
- Alignment and spacing on the declared unit; icon and label pairing consistent
- Perceived performance: acknowledgement under 100ms, determinate progress past 1s, no unexplained blocking wait
- Theme: dark mode if supported, including a system theme change at runtime
- Destructive actions confirmed or undoable, and the surface says which

**CLI/TUI**

- `--help` covers every command and flag, with an example per command
- Exit codes distinguish success, usage error, and runtime failure
- Diagnostics on stderr, data on stdout, so piping works
- 80 column terminal, `NO_COLOR`, and non-tty output all stay readable
- Long operations show progress, and Ctrl-C leaves nothing half written
- Errors name the offending input and the fix

**API**

- Names consistent in vocabulary, order, and tense across the surface
- Defaults correct for the common case; required arguments genuinely required
- Errors typed and carrying the context needed to act, not a formatted string
- Every shipped example runs as written against the released version
- Signatures typed to make misuse awkward

**Service**

- Configuration validated at startup, with messages naming the key and the fix
- Health output distinguishes starting, degraded, and failed
- Default log level readable by an operator, and failures diagnosable from logs alone
- Shutdown finishes work in flight or reports what it dropped

## External design tools

Design work does not have to happen in the terminal, and forge does not own the visual part of it. Offer these options once, at the point they would help, and record what the user chose, including "none". None of them is a prerequisite: the repository must stay buildable, documented, and verifiable with all of them absent, the same rule the code-intelligence layer follows.

| Tool | What it contributes | Where it lands in forge |
|---|---|---|
| **Claude Design** (Anthropic Labs, `claude.com/product/design`) | Exploration, interactive prototypes, and a team design system built from your codebase and design files. Exports to Canva, PDF, PPTX, or standalone HTML, and packages a handoff bundle for Claude Code | Phase 1, before or during the design language decisions. Transcribe its design system into the brief's Design language table and store the handoff bundle under `docs/design/` |
| **`frontend-design`** plugin (`/plugin install frontend-design@claude-plugins-official`) | One always-on Anthropic skill that raises the aesthetic quality of generated frontends and avoids the default AI look. No commands; it applies itself to frontend work | Phase 2, for GUI tiers. It is generation guidance, not verification, so it changes what the first draft looks like, not whether the design pass runs |
| **`figma`** plugin (`/plugin install figma@claude-plugins-official`) | Reads design files, components, and design tokens from an existing Figma system | Phase 1 and 2 when the design system already lives in Figma. The brief records which token set is in force and where it came from |
| **`chrome-devtools-mcp`** or **`playwright`** plugin | A live browser: screenshots, console, network, performance traces | Phase 2 Step 11a, as the verification tooling for web tiers. Performance traces also feed the observability decisions |
| Claude Code's own Chrome connection, or computer use on macOS | Driving a real browser or a native window when no test driver exists | The fallback for `visual check` and `task walkthrough` methods, and the way native-app screenshots get captured at all |

Three rules keep an external tool from quietly becoming load bearing:

- **The brief is authoritative, not the tool.** Import the decisions into `docs/DESIGN.md` rather than linking out to them. An account, a plan, or a research preview can go away; the repository has to still say what the spacing unit is
- **A prototype is not a requirement and not an implementation.** It is evidence about what to build. It becomes `UX-nnn` requirements with acceptance criteria, or it stays a picture
- **Sending the repository or its data to an external design service is the user's decision.** Uploading a codebase, a screenshot of real data, or a document to a hosted service is a disclosure. Ask before the first upload, name what would leave the machine, and record the answer in `docs/DECISIONS.md`. Claude Design is a paid-plan research preview, and Enterprise organizations have it off until an admin enables it, so treat access as something to confirm rather than assume

## Duty by phase

| Phase | Duty |
|---|---|
| 1 spec | Interview the experience areas, set the tier and quality bar, write `docs/DESIGN.md`, number the `UX-nnn` requirements |
| 2 env | Provide what the verification methods need: a way to run and look at the surface, screenshot capture, an accessibility scanner for GUI tiers |
| 3 code | Design pass per surface-touching slice, `UXD` register current, polish pass before each minor and major release |

## Retrofitting a project already under way

A project built before forge had this discipline reaches you mid-Phase-3 with working surfaces and no brief. `/forge` Step 2a decides whether to backfill; this is how, once it has been agreed. Do not restage Phase 1, and do not rewrite the design of what already ships.

1. **Interview short.** Four questions, not a round: the design tier of each existing surface, the quality bar in one sentence, the three to five primary tasks, and the accessibility obligation. That is the whole brief header
2. **Inventory what exists**, from the code rather than from memory: every screen, command, endpoint, or dialog that ships today, each mapped to the task it serves
3. **Read the design language back off the code.** The spacing, type, colour roles, and error shape already in use are the de facto decisions. Write them down as they are, then flag the inconsistencies you found as `UXD` entries rather than fixing them on the spot. Where the code disagrees with itself, ask which side wins; that answer is the decision
4. **One design pass per shipping surface**, at `degrades` and `blocks` severity only. Finish-level observations on old surfaces go straight to `finish` in the register without a walkthrough each. This is the step that pays for the retrofit, so do not skip it to save time
5. **Number `UX-nnn` requirements for what already ships**, with the acceptance criteria the current behaviour would have to meet, and mark whether it meets them today. Adding them to `docs/SRS.md` is an amendment, so it is a gate: state the list and confirm before editing
6. **Report the gap plainly.** How many surfaces, how much debt at each severity, and what the first polish pass will cost. A retrofit that finds nothing means the pass was not run

Then continue where the project was. The next release runs the polish pass over the surfaces its milestone touched, not over everything at once: a backlog of old `finish` debt is worked down over releases, and the register is what keeps it from being forgotten.

## Verification is looking

A design claim you did not observe is not a claim. Capture the screenshot, record it in `docs/images/MANIFEST.md`, and look at it. Where a surface cannot be captured automatically, write the capture steps, ask the user for the image, and mark it MISSING until it arrives rather than describing what you assume it looks like.
