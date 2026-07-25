# Screenshot Manifest

Every image the documentation references. A doc page is not complete while it
references an image that is MISSING or STALE.

Never describe a screenshot you have not seen. Mark it MISSING and surface it in
CONTINUE.md under "Blocked on me".

Status values:
- CURRENT   matches the current build
- STALE     UI changed since capture, needs retaking
- MISSING   referenced by docs but does not exist yet

## Automated (web, via shot-scraper)

Regenerate all: `shot-scraper multi shots.yml`

| File | Shows | Precondition / URL | Status | Captured |
|---|---|---|---|---|
| docs/images/login.png | Login form, empty state | `/login` | MISSING | |

## Semi-automated (Windows desktop, via capture script)

Run: `pwsh ./scripts/Capture-Screenshot.ps1 -Name <name>`

| File | Shows | Precondition | Status | Captured |
|---|---|---|---|---|
| docs/images/settings.png | Settings dialog, defaults | App open, File > Settings | MISSING | |

## Manual (user must capture)

| File | Shows | Precondition | Status | Requested |
|---|---|---|---|---|
