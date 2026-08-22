# CLAUDE.md

Guidance for working in this repository. This file is committed and shared with
anyone who clones the repo. It is loaded as project memory only when Claude Code
runs in this directory. It is never loaded as part of the installed plugin (a
plugin's runtime reads `skills/`, `hooks/`, `scripts/`, and `.claude-plugin/`,
never a `CLAUDE.md`), so nothing written here can change how the shipped plugin
behaves for users.

For private notes that must never be committed, use `CLAUDE.local.md`. It loads
alongside this file and is already in `.gitignore`.

---

## What this repository is

This is the source of the **forge-workflow** Claude Code plugin.

- Plugin name: `forge-workflow` (see `.claude-plugin/plugin.json`)
- Published at: https://github.com/DailenG/forge-workflow
- Published marketplace: the `dailen` catalog lives in a SEPARATE repo,
  `DailenG/dailens-claude-toolbelt`, which references this plugin by an external
  https `url` source. This repo's own `.claude-plugin/marketplace.json` is named
  `dailen-dev` and exists only for local testing (see the development loop below).
- Users install with `claude plugin marketplace add DailenG/dailens-claude-toolbelt`
  then `claude plugin install forge-workflow@dailen`
- Hosted guide: https://daileng.github.io/forge-workflow/ (served from `docs/`)

The plugin ships five user commands (`/forge`, `/forge-spec`, `/forge-env`,
`/forge-code`, `/forge-design`), an always-loaded `forge-standards` skill, four
lifecycle hooks, their Node scripts, and project-file templates.

---

## Read this first: developing the plugin vs using the plugin

These are two different activities and they must not be confused.

**Developing the plugin (what you do in THIS repo).** This repo is the product's
source, not a forge-managed project. It has no root `CONTINUE.md`, `TODO.md`, or
`docs/SRS.md`, so the `forge-standards` skill does not auto-load here and the
`/forge` lifecycle does not apply. **Do not run `/forge` here to "develop" forge.**
If you did, its detection ladder would see no `docs/SRS.md` and try to start
requirements discovery for a brand-new product, which is not what this repo is.
Developing forge is an ordinary edit / validate / commit workflow, described
below.

**Using the plugin (what forge does for an end user).** When a user installs
forge and runs `/forge` inside *their own* project, forge drives a gated
spec-to-ship lifecycle for *that* project. How that works, and what a user has to
do when they want a change, is documented in the "How the plugin behaves for its
users" section near the end. Contributors should understand that contract because
edits to the skills must preserve it.

---

## Repository layout

```
.claude-plugin/
  plugin.json          plugin manifest (name, version, author)
  marketplace.json     LOCAL DEV marketplace (name "dailen-dev", plugin source "./")
skills/                the six skills (forge, forge-spec, forge-env, forge-code,
                       forge-standards, forge-design)
hooks/hooks.json       SessionStart, PreToolUse, PostToolUse, Stop wiring
scripts/*.js           the four Node hook scripts
templates/             project-file templates forge writes into user projects
                       (branch-protection.js and history-guard.js are real,
                       tested programs, not fill-in-the-blank scaffolds)
tests/                 node:test suites, run with `node --test`
docs/index.html        the hosted guide (GitHub Pages, main branch /docs)
.github/               CI workflow, issue and PR templates, CI helper scripts
```

Most of this repo is prompt text, which cannot be unit tested. Two shipped
programs are the exception: `templates/branch-protection.js` and
`templates/history-guard.js` run in the user's project rather than in Claude's
context, so they have real tests under `tests/`. Changing either without
running `node --test` is how a guard silently stops guarding.

---

## Local development loop

**Edit the git clone. Never edit the installed cache copy.** The installed plugin
lives under `~/.claude/plugins/cache/dailen/forge-workflow/<version>/` and is
overwritten on every update, so edits there are lost.

This repo's `marketplace.json` is named `dailen-dev`, distinct from the published
`dailen` catalog, so registering it for local testing does NOT clobber your
installed `forge-workflow@dailen`. The published and local copies share the plugin
NAME (`forge-workflow`), and only one copy of a name loads at a time, so uninstall
the published one while testing local edits, then reinstall it when done.

```powershell
# register this clone as the dailen-dev marketplace and install from it
claude plugin marketplace add "C:/Syncs/Resilio/Code/GitHub/daileng/forge/forge-workflow"
claude plugin install forge-workflow@dailen-dev

# iterate:
#   - edits to skills/**/SKILL.md take effect on the next turn (hot)
#   - edits to hooks/ or scripts/ need a reload
/reload-plugins

# refresh the registered copy after edits, then reload if you touched hooks/scripts
claude plugin marketplace update dailen-dev

# when finished, switch back to the published catalog
claude plugin marketplace remove dailen-dev
claude plugin marketplace update dailen
claude plugin install forge-workflow@dailen
```

What is hot vs what needs a reload:

| Change | Refresh |
|---|---|
| `skills/**/SKILL.md` | takes effect on the next turn, no reload |
| `hooks/hooks.json`, `scripts/*.js`, MCP, agents | `/reload-plugins` or restart |

Validate before committing anything:

```powershell
node --test
claude plugin validate --strict .
```

The disposable-remote tests create bare repositories under the system temp
directory and push to them. They never touch a real remote, and every cleanup
is refused unless the path is a directory the tool itself created with its own
prefix.

---

## Publishing changes to users

1. **Bump the version** in `.claude-plugin/plugin.json` for any change to a skill,
   hook, script, or template. Claude Code uses `version` as a cache key: if it is
   set and you do not bump it, existing users never receive the change, because
   Claude Code sees the same string and keeps the cached copy. Do not also set
   `version` in `marketplace.json`; `plugin.json` wins silently. Documentation-only
   changes (this file, `README.md`, `docs/`, `CONTRIBUTING.md`, `CHANGELOG.md`) do
   not need a bump.
2. Add a `CHANGELOG.md` entry under a new version heading (Keep a Changelog format).
3. **Update the hosted guide**, `docs/index.html`. It carries three version stamps
   (title block, edition table, footer) and, for a minor or major release, a
   what-is-new banner describing the change in the guide's own plain language.
   `tests/repo-standards.test.js` fails on a stale stamp, on a banner left behind
   at an older minor, on a command the guide never mentions, and on a detection
   ladder that has grown a row the guide's ladder does not show.
4. Commit with a conventional-commit message, push to `main`. CI runs the validate
   workflow on push and pull request.
5. For a downloadable manual-install artifact, cut a release: annotated tag at the
   version, GitHub Release from the changelog section, attach the plugin zip built
   by `node scripts/package.js`. Never assemble that zip by hand. The payload list
   lives in that script, which refuses to build if any member is missing.
6. Users pull it with `claude plugin marketplace update dailen` then
   `claude plugin update forge-workflow`.

Full contributor detail is in `CONTRIBUTING.md`.

---

## Prompting style: lean, for Claude 5

As of 1.0.0 the skills are written for Claude 5 era models. That generation follows
instructions well and verifies its own work, so Claude 4 era defensive scaffolding
actively costs quality and tokens. Anthropic's guidance is in
[Prompting Claude Opus 5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5).

When editing a skill, do not reintroduce:

- Self-verification or re-check instructions. The model already does this, and telling
  it to compounds into over-verification.
- Speculative guards for failure modes nobody has actually observed.
- Absolute bans whose job is babysitting the model. Prefer adaptive, falsifiable
  guidance ("match the comment density of the surrounding code").
- The same rule restated in a second skill. Say it once, in the skill that owns it.
- "Be conservative" or "only report high-severity" hedges in a review or audit step.
  Claude 5 takes them literally and does less. Ask for everything and filter after.
- Few-shot examples that only teach tool usage. A schema or enum is shorter and clearer.

The distinction that matters: **a rule protecting the user's repository, money, or
safety stays; a rule babysitting the model goes.** "SRS approval is an always-strict
gate" is the former. "Always double-check your work" is the latter. When unsure, keep
it and note why.

The Claude 4 era style is preserved deliberately in the separate frozen
`forge4-workflow` repo (`/forge4`). Do not port changes between the two editions
without deciding which style the target expects.

## Hard rules when editing this repo

- **ASCII typography only.** No em dashes, en dashes, curly quotes, ellipsis
  characters, non-breaking spaces, or the unicode minus sign, in any file or in
  commit messages. Plain hyphens and straight quotes. The plugin enforces this on
  the projects it builds, so its own repo obeys it, and CI fails the build on any
  occurrence. The checker is `.github/scripts/typography-check.js`.
- **In PowerShell never use `&&`.** Use `;` or separate lines.
- **Conventional commits.** The changelog is derived from commit messages.
- **`claude plugin validate --strict .` must pass** before a commit or PR.
- **Keep the plugin at the repo root.** Do not move it under `plugins/`. The
  manual install (extract to `~/.claude/skills/forge-workflow/`) depends on the
  current layout, and `marketplace.json` uses `source: "./"`.

---

## How the plugin behaves for its users (the contract to preserve)

This is what forge does inside an end user's project. It is written here so
contributors do not accidentally break it, and so future sessions understand how a
user "molds" a scaffolded project.

**The user drives everything through `/forge`.** They should never have to
remember which phase they are in or edit the state files by hand. `/forge` detects
the phase from `CONTINUE.md`, `docs/SRS.md`, `TODO.md`, and git, reconciles the
record against reality, and does the next thing. So the short answer to "do I need
to do anything special to report a bug or ask for a feature" is: **mostly just say
it to forge.** Forge is responsible for turning it into the right lifecycle action.
The important nuances:

**A new feature is a spec change, and that is a gate.** Forge treats `docs/SRS.md`
as the living, authoritative source of scope. When a user asks for a feature,
forge does not silently start coding it. It routes the request into an SRS
amendment: it states what it intends to add, and **amending the SRS is an
always-strict gate**, so it pauses and asks the user to confirm before editing the
spec. Requirement IDs are permanent (superseded, never renumbered), and the change
is recorded in the SRS CHANGE LOG (dated, with reasoning) and in
`docs/DECISIONS.md`. The feature then becomes backlog slices, built test-first, and
shipped as a minor version bump. So a user asking for a feature should expect one
deliberate confirmation about the spec change; that friction is the point.

**A bug gets a regression test first.** A bug fix is required to come with a test
that fails before the fix and passes after. So when a user reports a bug, the
scaffolded workflow "catches" it by reproducing it as a failing test, then fixing
it, shipped as a patch bump. A user who can give reproduction steps makes this
faster, but the discipline holds either way.

**Non-goals are scope guards.** Phase 1 pushes hard on an explicit non-goals list.
If a user later wants something previously listed as a non-goal, they have to say
so explicitly; forge treats the non-goals list as a deliberate boundary, not an
oversight.

**A UX observation gets a disposition, never a shrug.** Design is a managed
dimension of the lifecycle as of 1.2.0, owned by `forge-design`. Phase 1 gates on
an experience coverage area and writes `docs/DESIGN.md`; every slice that touches
a surface runs a design pass (run the real thing, walk the primary tasks, check
the states, keyboard only, read the copy); and every finding is either fixed in
that slice or filed as `UXD-nnn` in the UX Debt section of `TODO.md` with a
severity. Calling a finding subjective is explicitly not a disposition. Before any
minor or major tag, the polish pass runs the tier's checklist over every surface
the milestone touched and records it in the polish log, and slipping a finding is
an always-strict gate. Contributors leaning these prompts must keep the
disposition rule and the polish gate: without them experience work evaporates
under delivery pressure, which is the defect 1.2.0 exists to fix.

**Observability is decided, not improvised.** Phase 1 extracts explicit logging,
error reporting, telemetry, metrics, and audit decisions, including the answer
"nothing leaves the machine". Anything leaving the machine is opt in and named in
the SRS. Phase 2 provisions the layer; each slice reads its own failure-path log
output.

**External design tools are offered, never assumed, and never load bearing.**
`forge-design` names Claude Design, the official-marketplace `frontend-design`,
`figma`, `chrome-devtools-mcp`, and `playwright` plugins, and Claude Code's Chrome
connection or macOS computer use, with what each contributes and where its output
lands. Phase 1 raises the list while the design language is open, Phase 2 Step 11a
installs whichever was chosen, and "none" is a recorded answer. Three invariants
contributors must preserve, mirroring the code-intelligence layer's "it stays
optional" rule: the repo's own brief is authoritative rather than the tool, a
prototype is evidence rather than a requirement or an implementation, and
uploading repository contents or real data to a hosted service is an
always-strict gate.

**An older project is not a broken project.** `/forge` Step 2a detects artifacts a
project's earlier phases never produced, raises the whole set once, and offers
backfill now, backfill as a slice, or skip for this project (marked not
recommended). The answer lands in the `Capabilities:` line of `CONTINUE.md` and in
`docs/DECISIONS.md`; a recorded skip makes that capability's gates and ladder rows
inert and stops the asking. Two things contributors must not break: a missing
capability is explicitly NOT a record-versus-reality discrepancy (otherwise every
pre-1.2.0 project would halt on resume), and a skip is honoured rather than
re-litigated per slice.

**The safety nets that make "just say it" work without the user managing state:**

- The SessionStart hook injects `CONTINUE.md` plus real git state at the start of
  a session, so "please continue" works in a fresh chat.
- Before acting, forge reconciles the recorded state against actual git and test
  results, and **stops if they disagree** rather than building on a false premise.
  This is the one behavior a user most benefits from and contributors must not
  weaken.
- Several actions are always confirmed regardless of FLOW or STRICT mode: SRS
  approval, repository visibility, elevation, discarding uncommitted work, deleting
  a branch with unmerged commits, amending the SRS, tagging or publishing a
  release, adding a dependency not named in the SRS, slipping a polish pass
  finding or releasing over an open blocks or degrades UX defect, and any
  record-versus-reality discrepancy.
- The pre-push hook (build, tests, lint, secret scan) is the only automated gate
  before `main`. Forge never bypasses it and never uses `--no-verify`; it reports a
  block rather than working around it.

**The one thing a user must not do:** work around forge by editing code and
committing without letting forge update the state files. Forge reconciles against
git, so out-of-band work shows up as a discrepancy and forge will stop to sort it
out. The clean path is to route changes through `/forge` and let it keep
`CONTINUE.md`, `TODO.md`, the SRS, and traceability honest.

---

## Facts worth remembering (verified against Claude Code docs)

- A `CLAUDE.md` at a plugin root is never loaded as plugin behavior. It only loads
  as project memory when someone opens that directory as a working project. So a
  committed `CLAUDE.md` here cannot taint what is distributed.
- `CLAUDE.local.md` is the supported, current (not deprecated) way to keep
  personal, non-committed project instructions. It loads alongside `CLAUDE.md` and
  belongs in `.gitignore` (it is already there).
- `version` in `plugin.json` is the cache key. Set it, and you must bump it for
  users to get changes. Omit it, and the git commit SHA versions each commit
  automatically. This repo pins an explicit version on purpose.
- For a git or GitHub marketplace source, only committed files ship; ignored and
  untracked files never reach users. That is the boundary that keeps
  `CLAUDE.local.md` and other local files off users' machines.
