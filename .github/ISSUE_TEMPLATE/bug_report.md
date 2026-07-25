---
name: Bug report
about: Something in Forge did not behave as documented
title: "[bug] "
labels: bug
---

## What happened

A clear description of the problem, and what you expected instead.

## Which phase

Which phase or command were you in when it happened?

- [ ] `/forge` (detection or routing)
- [ ] Phase 1, spec (`/forge-spec`)
- [ ] Phase 2, env (`/forge-env`)
- [ ] Phase 3, code (`/forge-code`)
- [ ] A hook (SessionStart, PreToolUse, PostToolUse, or Stop)
- [ ] Other

## Environment

- Claude Code version (`claude --version`):
- Operating system and version:
- Node.js version (`node --version`):
- Forge version (from `.claude-plugin/plugin.json`, or `claude plugin list`):

## CONTINUE.md

Paste the relevant contents of `CONTINUE.md` from the affected project, especially the `Phase`, `Gate`, and `Mode` fields at the top. Redact anything private.

```
paste here
```

## Steps to reproduce

1.
2.
3.

## Anything else

Logs, screenshots, or other context.
