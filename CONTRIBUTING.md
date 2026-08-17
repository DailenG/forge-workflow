# Contributing

Thanks for helping improve Forge. This is a Claude Code plugin (skills plus hooks), not a compiled application, so testing a change means loading it into Claude Code and exercising it.

## Test a change locally before opening a pull request

1. **Run the test suite.** The shipped scripts under `templates/` have real tests. No dependencies, no install step:

   ```
   node --test
   ```

   The disposable-remote tests create bare repositories under the system temp directory and push to them. They never touch a real remote, and every cleanup goes through a check that refuses any path that is not a directory the tool itself created with its own prefix. Git needs `user.name` and `user.email` set for them to pass.

2. **Validate the manifests.** From the repository root:

   ```
   claude plugin validate --strict .
   ```

   This checks `marketplace.json` and `plugin.json`, the skill frontmatter, and `hooks/hooks.json`. It must pass with no errors before you open a pull request.

3. **Load your working copy.** Point Claude Code at your checkout rather than the published marketplace so you test the exact files you edited. This repository's `marketplace.json` is named `dailen-dev` (the published catalog is the separate `dailen` marketplace), so install from `@dailen-dev`:

   ```
   claude plugin marketplace add ./
   claude plugin install forge-workflow@dailen-dev
   ```

   On Linux and macOS, make the hook scripts executable first: `chmod +x scripts/*.js`.

4. **Reload after hook or script changes.** Edits to `skills/**/SKILL.md` apply on the next turn, but anything under `hooks/` or `scripts/` needs a reload before it takes effect:

   ```
   /reload-plugins
   ```

   A full restart of Claude Code works too. If you only edited a `SKILL.md`, no reload is needed.

5. **Exercise the path you changed.** Run `/forge` (or the specific phase command) in a scratch project and confirm the behavior. For hook changes, confirm the SessionStart and Stop hooks still fire by watching for the injected `CONTINUE.md` state block.

## Bump the version on any behavior change

Claude Code treats the `version` string in `.claude-plugin/plugin.json` as a cache key. **If the version is set and you do not bump it, existing users never receive your change**, because Claude Code sees the same version string and keeps its cached copy.

So: any change to a skill, hook, script, or template must come with a version bump in `plugin.json`, following [semantic versioning](https://semver.org/). Do not set `version` in `marketplace.json` as well; `plugin.json` is the single source of truth and Claude Code silently prefers it. Documentation-only changes (README, this file, the guide) do not require a bump.

Add a matching entry to `CHANGELOG.md` under a new version heading.

A version bump also carries a duty in the other direction: `docs/index.html`, the hosted guide, is what a non-developer reads before installing, and it states its own edition version. Update its three version stamps (title block, edition table, footer), and for a minor or major release rewrite the what-is-new banner in the guide's own plain language. `tests/repo-standards.test.js` fails on a stale stamp, a banner left at an older minor, a shipped command the guide never mentions, or a detection ladder row with no rung.

## Typography

Forge enforces an ASCII-only typography rule on the projects it builds, so this repository obeys the same rule. Do not use em dashes, en dashes, curly quotes, ellipsis characters, non-breaking spaces, or the unicode minus sign in any file, including markdown and commit messages. Use plain hyphens and straight quotes. CI fails the build on any of these characters.

## Commits

Use [conventional commit](https://www.conventionalcommits.org/) format (`feat:`, `fix:`, `docs:`, `chore:`, and so on). The changelog is generated from commit messages.

## Pull requests

Fill out the checklist in the pull request template. CI runs on every pull request and must be green before merge.
