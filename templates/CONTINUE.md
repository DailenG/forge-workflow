# Continue Here

<!-- Created in Phase 1 and maintained for the life of the project.
     The three fields below drive the /forge detection ladder. A stale Gate
     will route the next session into the wrong phase, so update them as part
     of the work, not as bookkeeping afterward.
     This file is injected at every session start against a budget, and a file
     kept under 200 lines is never capped: current state and the next action.
     A closed slice's story goes to docs/DECISIONS.md, not into a new section
     here. Correct a wrong line by rewriting it, never by appending a
     correction underneath it. -->

Phase: <1 spec | 2 env | 3 code>
Gate:  <IN_PROGRESS | AWAITING_APPROVAL | PASSED>
Mode:  <FLOW | STRICT>

<!-- Capability decisions from /forge Step 2a, for projects that predate a
     capability forge later gained. One entry per capability: backfilled or
     skipped, with the date. A skipped capability is inert, and is not asked
     about again. An absent entry means unasked, not skipped. -->

Capabilities: <none recorded | design=backfilled 2026-01-31, observability=skipped 2026-01-31>

Last updated: <ISO timestamp>
Current task: <TODO.md task ID and one line, or "none, awaiting next task">
Branch: <branch name, or main>
Working tree: <clean | exactly what is uncommitted and why>
Last release: <tag, or "none yet">
Test suite: <passing | failing, with which tests and whether that is expected>

## Next action

<ONE concrete action. Not a goal. Name the file, the function, the test.
Bad:  "Implement authentication"
Good: "Add the token refresh branch to AuthClient.refresh in src/auth/client.ts.
       Tests at tests/auth/refresh.test.ts:88 are written and currently failing
       with 'refresh is not a function', which is expected.">

## Verify current state

<A command to run, and the output that means things are healthy.
Example: "npm test -- --run auth  ->  3 passing, 2 failing (refresh suite)">

## In flight

<Anything half-done: partial edits, failing tests, an approach being trialled,
a refactor midway. Say explicitly if nothing is in flight.>

## Blocked on me

<Anything needed from the user: decisions, screenshots, credentials, access,
an elevated command to run. Say explicitly if nothing.>

## Notes for the next session

<Anything a cold start would not infer from the code. Approaches already tried
and rejected, gotchas discovered, why something looks wrong but is correct.>
