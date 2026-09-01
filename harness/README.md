# Other harnesses

forge is a Claude Code plugin. This directory carries the small amount of glue
needed to run it under a different agent harness, one subdirectory per harness.

Nothing here is loaded by Claude Code. It ships in the plugin so that a user who
works in another harness has the adapter to hand, and so that the adapter and the
scripts it drives are versioned together.

## What actually crosses a harness boundary

Measured rather than assumed, against `omp` v18.0.4:

| forge component | Portable | Why |
|---|---|---|
| `skills/**/SKILL.md` | yes | Markdown skills are a de facto standard, discovered from the Claude plugin cache |
| Slash commands | yes | Same discovery path |
| MCP servers | yes | Same discovery path |
| `PreToolUse` / `PostToolUse` hooks | yes | Modelled as `pre` and `post` tool hooks |
| **`SessionStart` hook** | **no** | No equivalent event in the hook capability |
| **`Stop` hook** | **no** | Same |
| `templates/*.js` | yes | Ordinary node programs run by the project, not by the harness |

The pattern generalises: **markdown and real programs travel; a hook manifest and
anything assuming a specific injection mechanism does not.** That is the reason
forge's enforcement keeps moving into `templates/` programs, and why the
`docs/views/` guard being a `PreToolUse` hook rather than a `PostToolUse` one
also happens to be the portable choice.

## omp (Oh My Pi)

`omp/forge-bridge.ts`. Copy to `~/.omp/agent/extensions/forge-bridge.ts` and
restart omp.

omp already loads forge's skills, commands, rules, MCP servers, and tool hooks
out of `~/.claude/plugins/cache/` unaided, so the bridge exists only to close the
`SessionStart` and `Stop` gap. It shells out to the same
`scripts/session-start.js` and `scripts/stop-check.js` the Claude Code hooks run,
so there is one copy of that logic and it lives in the plugin.

Install forge through Claude Code first (`claude plugin install
forge-workflow@dailen`). The bridge locates it by reading
`~/.claude/plugins/installed_plugins.json` rather than by listing the cache
directory, because the cache holds every version ever installed and the registry
is what says which one is live.
