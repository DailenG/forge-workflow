# Design Brief

<!-- Written in Phase 1 from the discovery interview, sized to the design tier.
     Maintained for the life of the project: slices append surfaces, releases
     append polish log entries. Amend by appending, dated, the way docs/SRS.md
     is amended. A change to a design language decision also goes in
     docs/DECISIONS.md, because every surface built afterward inherits it. -->

Design tier: <GUI | CLI/TUI | API | Service, one or more>
Quality bar: <one sentence, e.g. "internal tool, five users, correctness over
finish" or "client facing, first impression decides adoption">
Accessibility target: <named standard and level, or "none, and why">

## Surface inventory

<Every screen, command, endpoint, or dialog. Slices that add one append here.>

| Surface | Tier | What it is for | Primary task it serves | Added in |
|---|---|---|---|---|
| <name> | GUI | | | T-000 |

## Primary tasks

<The three to five things users do most. The step count is a claim the design
pass checks by walking it.>

| # | Task | Who | Intended path | Steps | Notes |
|---|---|---|---|---|---|
| 1 | | | | | |

## Design language

<GUI: type scale, spacing unit, colour roles, component library or explicitly
none, motion policy, icon set. Other tiers: output format, naming pattern,
error shape, the conventions that keep the surface coherent.>

| Decision | Value | Why | Date |
|---|---|---|---|
| Spacing unit | | | |
| Type scale | | | |
| Colour roles | | | |
| Component library | | | |
| Motion policy | | | |

## Platform conventions to honour

<Expectations of the target platform, named once here so they are not
relitigated per slice. Windows dialog button order, macOS menu placement, POSIX
flag conventions, web focus behaviour.>

## Copy and tone

<Case, person, tense, how errors are phrased. Then the terminology table for
anything the domain names inconsistently: one term wins, the others are banned
from the interface.>

| Use | Never | Why |
|---|---|---|

## UX requirements

<UX-nnn requirements live in docs/SRS.md with the functional ones and are
mapped in docs/traceability.md. This is the index, not the source.>

| Req ID | Surface | Verification method | Status |
|---|---|---|---|
| UX-001 | | interaction test | |

## Polish log

<One entry per release, appended. The findings list is the evidence that the
pass happened; an entry with no findings on a real milestone is not credible.>

### <version> - <date>

Checklists run: <GUI | CLI/TUI | API | Service>
Surfaces covered: <list>

| Finding | Severity | Disposition |
|---|---|---|
| | finish | fixed in `abc1234` |
| | degrades | slipped to <version>, approved by user <date> |

## Amendments

<Date, what changed, why. Design language changes also go in docs/DECISIONS.md.>
