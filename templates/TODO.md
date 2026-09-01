# TODO

Task IDs are permanent. Never renumber. Requirement IDs refer to docs/SRS.md.

## In Progress

<At most ONE task.>

- **T-000** Description. Closes: FR-000. Branch: `slice/name`.

## Needed

<Backlog, ordered by build sequence. Riskiest and most load-bearing first.>

- **T-001** Description. Closes: FR-001, FR-002.
- **T-002** Description. Closes: FR-003.

## Blocked

<Tasks that cannot proceed, each with what is blocking and who owns it.>

## UX Debt

<Every UX observation the design pass did not fix in the slice. UXD IDs are
permanent. Severity per the forge-design skill: blocks (never lands here, it is
fixed in the slice), degrades (cleared before the next release), finish
(cleared in the release polish pass). An observation with no ID here was lost.
Slip target is the version an open row is waiting on, and it is read again at
that version: a tag never passes over an open row whose slip target is at or
below it. Blank means the next release.>

| ID | Surface | Observation | Severity | Fixed looks like | Slip target | Status |
|---|---|---|---|---|---|---|
| UXD-001 | | | finish | | v0.0.0 | open |

## Completed

<Newest first. One line each: what closed, when, and the merge commit. The
reasoning belongs in docs/DECISIONS.md and the test evidence in
docs/traceability.md; do not restate either here. Move entries to
docs/DONE-ARCHIVE.md once this passes 50, and evict a CLOSED task from Needed
in the same edit that closes it.>

- **T-000** Description. Closes: FR-000. Done: YYYY-MM-DD. Merge: `abc1234`.
