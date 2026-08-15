# Forge

A gated spec-to-ship lifecycle for Claude Code: one command works out where your project stands and does the next thing, from requirements discovery through toolchain bootstrap to test-driven implementation and a tagged release.

**You only need to remember one command:**

```
/forge
```

It detects the current phase, reconciles the recorded state against the repository, and either continues the work or starts the next phase. The phase commands exist as overrides, not as something you sequence by hand.

## Read the guide first

If you are not a developer, or you just want the tour before installing, read the illustrated guide:

**https://daileng.github.io/forge-workflow/**

It explains what Forge does, what each phase feels like, and what lands in your project, in plain language with no jargon.

## Install (marketplace)

Two commands. The first tells Claude Code where to find the catalog; the second installs the plugin.

```
claude plugin marketplace add DailenG/dailens-claude-toolbelt
claude plugin install forge-workflow@dailen
```

Confirm when prompted, then run `/reload-plugins` or restart Claude Code. Type `/` and you should see `forge` in the list. When a new version ships later, `claude plugin marketplace update dailen` pulls it down.

> Forge is distributed through the `dailen` marketplace catalog at `DailenG/dailens-claude-toolbelt`. Add the marketplace by that shorthand, which clones the catalog so the plugin resolves correctly. Do not add it by a direct link to the raw `marketplace.json` file: a URL-only marketplace downloads just that one file and cannot resolve the plugin source.

Installed an earlier version by adding `DailenG/forge-workflow` as the marketplace? Point Claude Code at the catalog instead:

```
claude plugin marketplace remove dailen
claude plugin marketplace add DailenG/dailens-claude-toolbelt
claude plugin install forge-workflow@dailen
```

## Install (manual)

A secondary option if you would rather drop the folder into place by hand. Download `forge-workflow.zip` from the [releases page](https://github.com/DailenG/forge-workflow/releases), close Claude Code, and extract it so the folder lands here:

```
~/.claude/skills/forge-workflow/
```

On Windows that path is `%USERPROFILE%\.claude\skills\forge-workflow\`, and the `.claude` folder is hidden, so paste the path into the Explorer address bar. It loads on the next session as `forge-workflow@skills-dir`. Verify it:

```
claude plugin validate ~/.claude/skills/forge-workflow --strict
claude plugin list
```

On Linux and macOS, make the hook scripts executable: `chmod +x ~/.claude/skills/forge-workflow/scripts/*.js`. On Windows, skip that step.

`SKILL.md` edits apply immediately; changes under `hooks/` need `/reload-plugins` or a restart.

## Requirements

- **Claude Code.** Forge is a Claude Code plugin (skills plus hooks). It does nothing on its own.
- **Node.js on PATH.** The hook scripts are Node. Forge does not ask you to check for it: `/forge` verifies its own machinery and tells you if something is missing. Without working hooks the workflow still runs, but cold-start resumption becomes best-effort instead of guaranteed, because the SessionStart hook is what injects `CONTINUE.md` into a fresh chat. Phase 1 checks for Node before it creates the file the hooks depend on.

## Commands

| Command | What it does |
|---|---|
| **`/forge`** | Detect the phase, reconcile state against git, do the next thing. This is the one you use |
| `/forge-spec` | Phase 1 override: requirements to 95 percent confidence, produces `docs/SRS.md` |
| `/forge-env` | Phase 2 override: toolchain from zero, repos, code intelligence, testing, hooks, CI |
| `/forge-code` | Phase 3 override: test-driven implementation in vertical slices |
| `/forge-design` | Design and UX discipline: design tier, brief, UX requirements, per-slice design pass, release polish pass |

`forge-standards` loads automatically in any project containing `CONTINUE.md`, `TODO.md`, or `docs/SRS.md`, and `forge-design` loads whenever work touches a surface. The three phase skills are explicit-invocation only, so Claude cannot wander into a phase on its own. `/forge` also covers resuming: "where am I" and "what was I doing" get the same answer.

## The three phases and their gates

1. **Spec.** Requirements discovery. Claude asks questions in small batches and scores its understanding across eleven areas, reporting the lowest score rather than the average. It keeps going until the lowest reaches 95. One of those gating areas is what the thing should be like to use, so a surface cannot be specified by accident, and observability is settled explicitly: what gets logged, at which level, and whether anything is reported off the machine. The phase ends with a written `docs/SRS.md`, a design brief in `docs/DESIGN.md`, and a full stop: **Claude will not approve its own spec.** You read it and approve. This gate is always strict.
2. **Env.** Toolchain and repository bootstrap. It inventories the machine, installs only what is genuinely missing, sets up the repo, testing harness, git hooks, and CI, and proves the test runner actually reports failures rather than silently passing. It also installs what is needed to look at the thing later (browser driver, screenshot capture, accessibility scanner for visual surfaces) and the logging layer the spec asked for. Default-branch protection is capability based: server-side enforcement where the host and account provide it, a proven local `pre-push` history guard where they do not. That is why a free-tier account with a private repository is not blocked here, and **a private repository is never made public to satisfy a gate.**
3. **Code.** Test-driven implementation, one short-lived branch per vertical slice. Tests are written first and watched to fail before they pass. Any slice that touches a surface also gets a design pass: run the real thing, walk the common tasks, check the empty, loading, error, and success states, keyboard only, read the copy. Every rough edge is fixed there or filed in the UX debt register with a severity, so nothing is dismissed as a matter of taste. A pre-push hook runs build, tests, lint, and a secret scan, and it is the only automated gate before `main`, so `--no-verify` is prohibited. When the milestone backlog empties, Forge runs the polish pass over every surface the milestone touched before it will propose a tagged release.

Default mode is **FLOW** (proceed between slices without asking, report after each). **STRICT** engages automatically as a release comes into reach, and some gates are always strict regardless of mode: SRS approval, repository visibility, anything needing elevation, discarding uncommitted work, tagging or publishing, adding a dependency not named in the SRS, slipping a polish finding, uploading repository contents or real data to an external service the spec did not name, and any discrepancy between the record and the repository.

## Design tools, offered rather than assumed

Forge does not own the visual part of design, and it does not install anything about it behind your back. For a project with a real interface it names the options once and takes "none" as an answer:

| Option | What it is for |
|---|---|
| [Claude Design](https://claude.com/product/design) | Exploration, interactive prototypes, and a design system Claude builds from your codebase and design files. Its handoff bundle comes back into the repo under `docs/design/`, with the decisions transcribed into `docs/DESIGN.md` |
| `frontend-design@claude-plugins-official` | Anthropic's always-on skill for frontends that do not look like default AI output |
| `figma@claude-plugins-official` | Reads components and design tokens from an existing Figma system |
| `chrome-devtools-mcp` or `playwright` | A live browser for screenshots, console, network, and performance traces. Doubles as the verification tooling for web surfaces |
| Claude Code's Chrome connection, or macOS computer use | Looking at a real browser or a native window when no test driver exists |

Three rules keep them from becoming load bearing: the design brief in the repo is authoritative rather than the tool, a prototype is evidence rather than a requirement or an implementation, and uploading your repository or real data to a hosted service is a gate Forge stops at.

## What it creates in your project

| File | Purpose |
|---|---|
| `CONTINUE.md` | Phase, gate, mode, and where work stands. Drives the detection ladder |
| `TODO.md` | Work needed, in progress, completed, and the UX debt register |
| `docs/SRS.md` | The specification, including `UX-nnn` experience requirements. Living, amended by change log only |
| `docs/DESIGN.md` | Design brief: surfaces, primary tasks, design language, accessibility target, copy rules, and the polish log |
| `docs/design/` | Imported handoff bundles and exported prototypes, only when an external design tool is in use |
| `docs/DECISIONS.md` | Dated decision record |
| `docs/ENVIRONMENT.md` | Machine profile, tool versions, manual steps performed, and which default-branch protection tier is in force |
| `.forge/branch-protection.js` | Provider-neutral protection tool: detect, apply, verify, gate, migrate |
| `.forge/history-guard.js` | Managed `pre-push` guard refusing default-branch deletion and non-fast-forward pushes |
| `.forge/protection.json` | Recorded provider, tier, mechanism, trust boundary, and verification evidence |
| `docs/traceability.md` | Requirement to test mapping, functional and experience. v1.0.0 cannot be tagged until it is complete |
| `docs/docs-manifest.yml` | Doc page to symbol map, drives the CI drift gate |
| `docs/images/MANIFEST.md` | Screenshot inventory and capture state |
| `CHANGELOG.md` | Generated by git-cliff from conventional commits |

Templates live in `templates/`. Phase 1 creates `CONTINUE.md` and `docs/DESIGN.md`; Phase 2 creates the rest.

## Platform support

**Phase 2 is Windows and PowerShell specific today.** Its machine inventory and install steps assume PowerShell and Windows package managers. Everything else, Phases 1 and 3, the standards, the hooks, and the documents, is platform-neutral.

If you are on macOS or Linux, Forge still works, but you will need to translate Phase 2's install steps to your package manager (Homebrew, apt, pacman, and so on). The rest of the lifecycle needs no changes.

## Projects that started on an older version

Forge gains capabilities over time, so a project already deep in Phase 3 can be missing artifacts its Phase 1 and Phase 2 never produced (a design brief, UX requirements, the UX debt register, recorded observability decisions, verification tooling). That is not treated as a broken project and does not trip the record-versus-reality stop.

`/forge` raises the whole set once and offers three answers: backfill now, backfill as its own slice, or skip for this project (not recommended, because the gates that capability feeds go inert). The answer is recorded in a `Capabilities:` line in `CONTINUE.md`, so you are not asked again, and a skip can be reversed by saying so. The design retrofit is deliberately cheap: a four-question interview, a surface inventory read off the code, and one design pass per shipping surface to seed the debt register.

## Known limits

- Screenshots of anything that is not a web UI stay partly manual. The image manifest makes the gap visible rather than hiding it.
- The docs drift gate needs per-project tuning. Signature comparison is clean in typed languages and awkward in dynamic ones.
- The Stop hook warns rather than blocks, so a session can still end with unrecorded state. The SessionStart hook catches it next time.
- The detection ladder is only as good as the `Phase` and `Gate` fields in `CONTINUE.md`. A stale gate would route the next session into the wrong phase, which is why `/forge` reconciles against git rather than trusting the file alone.
- Forge is tuned for Claude 5 era models, whose instruction following and self-verification the prompts now assume. On older models the leaner prompts are less defensive; use `forge4-workflow` there instead.

## Two editions

Forge's prompts are written for the model generation they target, because the styles are not interchangeable.

| Edition | Command | For |
|---|---|---|
| **`forge-workflow`** (this one) | `/forge` | Claude 5 era models. Lean prompts, actively developed |
| `forge4-workflow` | `/forge4` | Claude 4 era models. Frozen Claude 4 snapshot with the original defensive prompting |

Both enforce the same gates and produce the same project files. If you are on a current Claude model, use this one.

## License and author

MIT. Copyright (c) 2026 Dailen Gunter.

Built by Dailen Gunter (me@dailen.net).
