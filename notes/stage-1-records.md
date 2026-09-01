# Stage 1: records as files, views generated

Design specification. Written 2026-09-01. This is an engineering record, not user
documentation and not yet an implementation.

`notes/token-efficiency.md` owns the measurements that motivate this work and the
Stage 0 delivery log. This file owns the design. Where the two touch, the
measurement is quoted here and lives there.

**Status: specified, not built.** Nothing in this document ships until it is
taken as a slice under the capability backfill mechanism described in section 10.

---

## 1. The problem this solves, in one paragraph

The lifecycle artifacts are append-oriented monoliths. On the project this was
measured against, `docs/DECISIONS.md` reached 1,156,058 B across 243 entries in
thirty days and `docs/traceability.md` reached 342,182 B across 317
hand-maintained rows. Neither has a ceiling and neither can be given one. The
cost is not mainly tokens: it is that a slice closure must be written by hand
into four or five files with no owner assigned per fact, so the files come to
disagree, and that a 1 MB append-only file cannot answer "which decision is live
now" because both the original and its correction are still in it, the stale one
first.

Stage 0 capped what gets *injected*. It did nothing about what gets *written*.
This is the write-side fix.

---

## 2. Layout, with authority stated per path

```
docs/records/                       AUTHORITATIVE, committed, small files
  decisions/D-0142.md
  tasks/T-115.md
  requirements/FR-ATS-004.md
  uxd/UXD-031.md
  VOCABULARY.md                     AUTHORITATIVE, hand-maintained, see section 4

docs/views/                         GENERATED, committed, never hand-edited
  traceability.md
  open-work.md
  DONE-ARCHIVE.md

.forge/index.json                   GENERATED, gitignored, rebuildable
CONTINUE.md                         AUTHORITATIVE, pointer file, IDs not prose
```

Three tiers, and the distinction is the whole design:

- **Authoritative** files are the system of record. A human reviews them in a
  pull request, they diff and merge in git, and losing one loses information.
- **Generated and committed** files exist so a reader who is not running forge
  can still read the project on GitHub. They are reproducible byte for byte from
  the authoritative tier. Losing them costs one command.
- **Generated and gitignored** is a cache. `.forge/index.json` is the live-state
  index the skills read instead of re-deriving. The precedent is `.codegraph/`:
  35 MB, gitignored, rebuildable, authoritative about nothing.

**Why not a database.** Rejected in the prior design round and the reasoning
holds. SRS approval is a human gate, so the record must be reviewable in a pull
request. Records must diff and merge in git, and two agents already edit the
measured project concurrently. Forge installs as prompt text plus node scripts,
and adding a native dependency changes what installing forge means.

**Why not vector or semantic retrieval.** Every fact already has a canonical key.
Deterministic ID lookup dominates similarity search on a corpus where the query
is almost always an ID that appeared in the last thing read, and a stale
embedding on a gated lifecycle is a correctness hazard rather than a slow path.
Grep across small files remains available for the case where the ID is genuinely
unknown.

**Why `docs/DECISIONS.md` does not survive as a hand-maintained summary index.**
This was the shape first proposed and it fails for a measurable reason. A one
line summary per decision is about 100 B. At 243 entries that is 24 KB today, and
at the measured rate of roughly 8 entries per day it passes 300 KB inside a year.
That is the same defect arriving more slowly. The rule that prevents it is in
section 5: **the index carries live state only, and history is addressable but
never enumerated.**

---

## 3. Record format

One record, one file, one ID. The filename is the ID plus `.md`.

```markdown
---
id: D-0142
type: decision
status: live
date: 2026-08-14
title: Dispose ordering reversed for the gateway client
closes: [T-108]
satisfies: []
supersedes: D-0097
superseded_by: null
decided_in: T-108
---

Body. Prose, as long as it needs to be, because nothing enumerates bodies.
```

**Closed field set.** A field not in this table is a lint error, so that a typo
does not become a silently ignored edge.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | always | Unique across the whole record set. Prefix declared in `VOCABULARY.md` |
| `type` | enum | always | `decision`, `task`, `requirement`, `uxd` |
| `status` | enum | always | See the status table below |
| `date` | ISO date | always | The date the record was created, never rewritten |
| `title` | string | always | One line. This is what a view renders |
| `closes` | list of IDs | no | Tasks or defects this record closes |
| `satisfies` | list of IDs | no | Requirements this record satisfies |
| `supersedes` | ID or null | no | The record this one replaces |
| `superseded_by` | ID or null | no | Set by the linter, not by hand. See section 6 |
| `decided_in` | ID or null | no | The task this record was produced under |
| `severity` | enum | uxd only | `blocks`, `degrades`, `finish` |

Optional fields default to empty rather than absent, so a reader never has to
distinguish "no edges" from "field forgotten".

**Status enum, per type.**

| Type | Statuses |
|---|---|
| decision | `live`, `superseded` |
| task | `open`, `in-progress`, `closed`, `abandoned` |
| requirement | `proposed`, `approved`, `implemented`, `superseded` |
| uxd | `open`, `fixed`, `slipped`, `superseded` |

**Live means live.** The single question this design exists to answer is which
record is authoritative right now, and the answer is mechanical: a record is live
when `superseded_by` is null. Section 6 defines how that field is maintained.

---

## 4. The ID vocabulary is declared, not hardcoded

The prior design round listed eight prefixes: `T`, `FR`, `UX`, `UXD`, `OBS`,
`REL`, `USA`, `PERF`. Enumerated against the real project on 2026-09-01, the
actual vocabulary is **34 distinct prefixes** over 406 distinct non-task IDs plus
162 task IDs:

```
ENV     FR-AI   FR-APP  FR-ATS  FR-CAT  FR-CFG  FR-CTX  FR-DUR  FR-FBK
FR-GW   FR-MDV  FR-MTL  FR-MTS  FR-NEW  FR-NTE  FR-REM  FR-REV  FR-RMT
FR-SDN  FR-SES  FR-STA  FR-SWT  FR-TKT  FR-UPD  LOG     OBS     OPS
PERF    REL     SEC     SHA     USA     UX      UXD
```

Two things follow, and both are design constraints rather than trivia.

**A hardcoded prefix enum in the linter would reject most real records.**
Requirement IDs carry a per-domain subcode the plugin cannot know in advance:
`FR-GW` is the gateway, `FR-TKT` is ticketing. A project invents these as its
domains appear. The plugin must validate a shape and defer the vocabulary to the
project.

**A bare regex over prose finds things that are not IDs.** `SHA` appears in that
list because `SHA-256` matches `[A-Z]{2,5}-[0-9]{3}`. This is the argument for a
declared vocabulary rather than pattern matching alone: an undeclared prefix is a
warning, so `SHA-256` is reported once and then either declared or, as here,
recognized as prose and left alone.

`docs/records/VOCABULARY.md` is authoritative, hand-maintained, and small. One
row per prefix:

```markdown
| Prefix | Record type | Meaning |
|---|---|---|
| T | task | Backlog slice |
| FR-GW | requirement | Functional requirement, gateway |
| UXD | uxd | UX defect |
```

The linter validates every ID it encounters against this file. An ID whose prefix
is undeclared is a warning naming the prefix and the file it was found in, never
a hard failure, because the first run against an existing project will find
`SHA-256` and its relatives and must not be unusable on day one.

---

## 5. The index carries live state only

`.forge/index.json` exists so a skill can answer "where does this project stand"
without reading the record set. It is rebuilt from the records and never edited.

**The trap, stated so it is not walked into.** An index enumerating all 406
requirements plus 162 tasks plus the UXD register is about 42 KB, which recreates
the problem one level up and does it in a file nobody reviews. The index carries
what is *live*, and history is reached by ID.

Measured against the real project's actual live state, an index holding phase,
gate, mode, 6 open tasks, 12 open UXD rows and the gap requirement IDs came to
**3,017 B**, against a `CONTINUE.md` of 118,767 B at the time. 39x.

```json
{
  "generated": "2026-09-01T19:00:00Z",
  "records_hash": "sha256:...",
  "phase": 3,
  "gate": "PASSED",
  "mode": "FLOW",
  "capabilities": { "design": "backfilled", "records": "backfilled" },
  "open": {
    "tasks": ["T-160", "T-161"],
    "uxd": [{ "id": "UXD-044", "severity": "degrades" }]
  },
  "counts": { "requirements": 406, "implemented": 315, "tasks_closed": 156 },
  "next_action": "T-160"
}
```

`records_hash` is what lets a consumer detect a stale index without re-reading
the record set: it is the hash of the sorted list of record filenames plus their
front matter blocks, bodies excluded, so a body edit does not invalidate it.

---

## 6. Supersession, and who maintains `superseded_by`

`supersedes` is written by hand, because a human or the model knows what a new
decision replaces. `superseded_by` is the reverse edge and is written by the
linter under `--fix`, because a record cannot know its own future.

Resolution rules, all mechanical:

1. `A.supersedes = B` implies `B.superseded_by = A` and `B.status = superseded`.
2. A record with `superseded_by` set is not live and never appears in a generated
   working view. It stays on disk, addressable, and its body is untouched.
3. A supersession chain must terminate. `A -> B -> C` is fine. A cycle is a hard
   failure.
4. Two live records may not both supersede the same record. That is a fork, and
   it is a hard failure naming both.

This is the rule that pays for the whole design. On the measured project,
`CONTINUE.md` asserted "thirteen criteria, six met" at line 17 and "the bar is
fourteen now, not thirteen, and eleven are met" at line 30. Both were readable,
the stale one first, and a top-down reader met the wrong number. Under these
rules the first record's `superseded_by` is set, it leaves every generated view,
and reading it requires asking for it by ID.

---

## 7. The three programs

They live in `templates/` and are copied into the project, on the precedent of
`branch-protection.js` and `history-guard.js`: real, tested programs that run in
the user's project rather than in the model's context. Node, no dependencies.

### 7.1 forge-index.js

```
forge-index.js build [--out .forge/index.json]
forge-index.js check
```

`build` reads `docs/records/**` and writes the index. `check` rebuilds in memory
and compares against the file on disk.

| Exit | Meaning |
|---|---|
| 0 | Index written, or `check` found it current |
| 1 | `check` found it stale. Stdout names the fields that differ |
| 2 | A record could not be parsed. Stdout names the file and the line |

### 7.2 forge-views.js

```
forge-views.js render [--only traceability|open-work|done-archive]
forge-views.js check
```

Renders `docs/views/**` from the records. Deterministic: same records in, same
bytes out, so `check` is a diff against what is on disk and `render` is
idempotent.

| Exit | Meaning |
|---|---|
| 0 | Views written, or `check` found them current |
| 1 | `check` found a view stale or hand-edited. Stdout names the file and a unified diff |
| 2 | Render failed on an unresolvable edge. Detail is deferred to the linter |

Every generated file opens with a line no reader can miss:

```markdown
<!-- GENERATED by forge-views.js from docs/records/. Do not edit. -->
```

### 7.3 forge-records-lint.js

```
forge-records-lint.js [--fix] [--warn-only]
```

Checks, in order:

1. Every filename matches the `id` in its own front matter
2. Every `id` is unique across the record set
3. Every front matter field is in the closed set of section 3
4. Every required field is present, and every `status` is legal for its `type`
5. Every ID referenced by `closes`, `satisfies`, `supersedes`, `decided_in`
   resolves to a record that exists
6. No supersession cycle, and no two live records superseding the same record
7. Every ID prefix is declared in `VOCABULARY.md` (warning, not failure)
8. No orphan: a decision naming no task and no requirement (warning, not failure)

`--fix` writes the reverse `superseded_by` edges and nothing else. It never
invents an edge, never deletes a record, and never edits a body.

| Exit | Meaning |
|---|---|
| 0 | Clean, or warnings only |
| 1 | One or more hard failures. Stdout names each with its file and field |
| 2 | The record set could not be read at all |

**The linter is a pre-push gate, not advisory.** This is the one contract with a
real choice in it, and it is settled here. Checks 1 through 6 are the class of
defect that makes the record set untrustworthy: a dangling edge, a duplicate ID,
a fork in supersession. A record set that cannot be trusted is worse than the
1 MB file it replaced, because the 1 MB file at least contained the answer
somewhere. Forge already treats the pre-push hook as the only automated gate
before the default branch and never uses `--no-verify`, so this belongs there,
alongside build, tests, lint and the secret scan. `--warn-only` exists for the
mid-slice case and for the first run of a migration, and it is not what the
pre-push hook invokes.

---

## 8. The views guard, and why it is PreToolUse

A generated file that anyone may edit becomes an unreliable hand-maintained file
within a week. That is not a prediction: `docs/traceability.md` on the measured
project is 342 KB with eight rows whose Status column holds narrative prose, and
it had its column boundaries destroyed once and was rebuilt cell by cell.

**The guard is `PreToolUse` matched on `Write|Edit`, and it denies.** The prior
design round said PostToolUse. That is wrong, and the correction matters:
PostToolUse fires after the write has landed, so it can only report. The existing
`scripts/ascii-check.js` says so in its own header, "warns rather than blocks",
and warning is exactly what let `traceability.md` rot. The precedent for a hook
that actually refuses is already in the tree: `scripts/shell-write-guard.js` is
PreToolUse on `Bash`.

So `hooks/hooks.json` gains a second PreToolUse matcher, alongside the existing
Bash one, pointing at a new `scripts/views-guard.js`.

`views-guard.js` denies a write whose path is under `docs/views/`, and the denial
names the record to edit instead and the command to regenerate. It does not
consult the record set and reads no file contents, so it stays cheap on a path
that runs on every edit in the project.

**This guard is portable and the SessionStart hook is not.** `PreToolUse` and
`PostToolUse` are exactly the two events OMP models, discovered from `hooks/pre/`
and `hooks/post/`; `SessionStart` and `Stop` have no equivalent in its hook
capability. So the enforcement that matters most here crosses to another harness
unchanged, which is the concrete case for the claim in
`notes/token-efficiency.md` section 8.5 that making forge lean and making forge
portable are the same work.

---

## 9. Migration

**Feasibility, measured rather than assumed.** Re-run against the grown record
set on 2026-09-01, over 243 decision entries: 91 percent already name a `T-id`,
69 percent name a requirement ID, 7 percent are orphans, average 4,757 B per
entry. Edge inference from the existing prose is mechanical for better than nine
entries in ten.

`templates/forge-records-migrate.js`, run once per project:

1. Split `docs/DECISIONS.md` on its dated entry headings. Each becomes
   `docs/records/decisions/D-nnnn.md`, numbered in date order, `date` taken from
   the heading and `title` from its first line.
2. Extract IDs from each body. A `T-nnn` becomes `decided_in` when the entry
   reads as work done under it, and `closes` when the entry closes it. That
   distinction is not always inferable, so the script writes `decided_in` and
   leaves `closes` empty: a wrong edge is worse than a missing one, and the
   linter reports neither.
3. Split `TODO.md` into task records and UXD records, `status` from the existing
   disposition and `severity` from the existing UX Debt severity.
4. Split the SRS requirement sections into requirement records. **Section 34, the
   Change Log, becomes supersession edges rather than records**, which is where
   51,577 B of the 174 KB SRS goes.
5. Parse `docs/traceability.md` rows into `satisfies` edges. The eight rows whose
   Status column holds prose cannot be parsed and are listed for a human.
6. Run the linter under `--warn-only` and print the full report.
7. Write nothing over the originals. The monoliths move to
   `docs/archive/pre-records/` and stay in git history regardless.

**The orphans.** About 17 of 243 entries name no ID at all. They are not dropped
and they are not guessed at. Each becomes a decision record with empty edges and
is listed in the migration report under a heading that says so, for a human to
either connect or leave connected to nothing. A decision that genuinely relates
to no task is a legitimate record, which is why check 8 in section 7.3 is a
warning.

**Migration is its own slice, taken with the working agent's consent, never
mid-slice.** It rewrites every artifact the lifecycle reads. Running it across an
open branch would collide with whatever that branch is editing, and the collision
would surface as a record-versus-reality discrepancy at the worst moment.

---

## 10. How it ships

As a versioned capability with a backfill offer, using the mechanism forge
already has and `CLAUDE.md` already describes: an older project is not a broken
project, the answer lands in the `Capabilities:` line of `CONTINUE.md` and in
`docs/DECISIONS.md`, and a recorded skip is honoured rather than re-litigated per
slice.

The `Capabilities:` value is **`records`**, with the three answers the mechanism
already defines:

| Answer | Effect |
|---|---|
| `backfilled` | Migration has run. The linter is a pre-push gate, the views guard denies, and the skills read `.forge/index.json` |
| `slice` | Migration is scheduled as its own backlog item. Until it runs, behave as `skipped` |
| `skipped` | The record set stays as monoliths. The linter, the views guard and the index are all inert, and Stage 0's caps are the whole of the record discipline. Do not ask again |

It needs a new row in the `/forge` Step 2a capability table:

| Missing | Signal | Backfill |
|---|---|---|
| Structured records | no `docs/records/` directory | Run `forge-records-migrate.js` as its own slice, then the linter under `--warn-only`, and review the orphan list with the user |

**A missing capability is not a record-versus-reality discrepancy.** Every
project predating this ships with no `docs/records/`, and none of them may halt
on resume because of it.

---

## 11. What this does not do

- It does not bound the record set's growth in *bytes*. It still grows by roughly
  one 4.7 KB file per decision. What it bounds is what any reader must load to
  answer a question, which was the actual defect.
- It does not make the record set queryable beyond ID lookup and grep. A query
  layer is Stage 2 and is not justified until a question appears that IDs and
  grep cannot answer. There is no evidence one exists.
- It does not remove a human gate anywhere. SRS approval, amendment and slip
  remain always-strict gates, and moving requirements into files does not make
  them cheaper to change.
