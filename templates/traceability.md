# Requirement Traceability Matrix

Every functional requirement maps to at least one automated test proving its
acceptance criteria. A requirement with no passing mapped test is NOT
implemented, regardless of whether the code exists.

v1.0.0 cannot be tagged until every FR row below is COVERED and green.

Status values:
- COVERED   test exists, maps to the acceptance criteria, and passes
- PARTIAL   test exists but does not prove all acceptance criteria. Note the gap
- MANUAL    verified manually by agreement in the SRS testing strategy. Note who and when
- NONE      no test. The requirement is not done

| Req ID | Requirement | Test file and name | Level | Status | Notes |
|---|---|---|---|---|---|
| FR-001 | <short description> | `tests/...::test_name` | unit | NONE | |
| FR-002 | | | | NONE | |

## Non-functional requirements

Performance, security, and reliability requirements need tests too, even where
the test is a benchmark, a load run, or a scripted check rather than a unit test.

| Req ID | Requirement | How verified | Status | Last verified | Notes |
|---|---|---|---|---|---|
| NFR-001 | <short description> | | NONE | | |

## Manual verification log

For anything marked MANUAL, record each verification so the claim is auditable.

| Req ID | Verified by | Date | Result | Evidence |
|---|---|---|---|---|
