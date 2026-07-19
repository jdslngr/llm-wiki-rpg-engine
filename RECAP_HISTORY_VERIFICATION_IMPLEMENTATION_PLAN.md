# Recap History Verification Remediation Plan

## Purpose and scope

This plan fixes the confirmed correctness and data-integrity gaps in
`RECAP_HISTORY_VERIFICATION_FINDINGS.md`. It is a remediation plan for the
existing recap-history feature, not a rewrite. Do not manually repair player
archive data; make the code reject or preserve bad data safely, then add the
regressions described here.

### What was verified before this plan

| Finding | Result | Evidence in current source |
|---|---|---|
| Chapter-end lock permits B and C to overlap | Confirmed | `chapterEndLock.ts` deletes a key before waking its final waiter. |
| Valid-first duplicate archive row is accepted | Confirmed | `prepareChapterRecap()` uses `.find()` and therefore ignores a later invalid duplicate. |
| Archive facts validator is incomplete | Confirmed | It omits crew `trust`/`arc`, all nested `journey` fields, optional `notableFacts`, and cross-checks against entry metadata. |
| Legacy duplicate/non-increasing headings become entries | Confirmed | The parser accepts every regex match and uses the next raw heading as a boundary. |
| Legacy cards show `Invalid Date` | Confirmed | The server sends `createdAt: ''`; invalid `Date` formatting does not throw. |
| Append shares old raw archive objects | Confirmed | The writer shallow-copies raw entries before installing them in the new wiki. |
| Archive envelope has no schema version | Confirmed | The archive currently persists only `{ entries }`. |

Baseline re-run on 2026-07-19: server build, client build, archive verifier
(47 checks), Phase 3 verifier (22 checks), and client test suite (11 tests)
all passed. The existing tests do not cover the timings or malformed inputs
listed above.

## Non-negotiable rules

- Keep the archive append-only. Invalid historical rows must remain preserved
  as raw data; they must not be silently repaired, dropped, or rewritten.
- Treat persisted archive frontmatter as untrusted. A malformed current-chapter
  row is a retryable corruption failure, never a reason to regenerate a recap.
- Keep the existing one-process lock boundary. This plan does not make the lock
  safe across multiple Node processes; deployment must continue to run one app
  instance.
- Do not add a test framework or external dependency. Extend the existing
  TypeScript verifier scripts and the existing Vitest suite.
- `*_PLAN.md` is ignored by `.gitignore`. Before Phase 0 is committed, force
  add this file and confirm it is staged: `git add -f
  RECAP_HISTORY_VERIFICATION_IMPLEMENTATION_PLAN.md` followed by `git diff
  --cached -- RECAP_HISTORY_VERIFICATION_IMPLEMENTATION_PLAN.md`.

## Mandatory end-of-phase handoff — applies to every phase

After completing **each** phase, the coder must do all of the following before
starting another phase:

1. Update the **Phase log** in this file with the files changed, exact tests
   run and their results, the commit hash, deviations, and important context
   for the next coder.
2. Stage only that phase's intended files, including this force-tracked plan,
   inspect the staged diff, and commit it with a focused message.
3. Stop. Ask the user for confirmation before beginning the next phase.
4. In that stop message, state an estimated context-window remainder as a
   percentage, for example: `Estimated session context remaining: ~62%.`

Do not treat a passing test as permission to continue without that user
confirmation.

## Phase 0 — Baseline, scope guard, and test map

### Goal

Create a reproducible baseline and make this plan durable before code changes.

### Steps

1. Read this plan, the verification findings, `graphify-out/GRAPH_REPORT.md`,
   and the recap-history implementation files named in the phase map below.
   Graphify is routing information only; confirm all decisions in live source.
2. Record `git status --short`, current branch, Node version, and whether a
   `DATABASE_URL` points to a disposable Postgres database. Preserve unrelated
   untracked files.
3. Confirm the source map:
   - Lock: `server/src/chapterEndLock.ts`
   - Archive validation/read/write/parser: `server/src/recapArchive.ts`
   - Archive-first preparation: `server/src/recapPreparation.ts`
   - History HTTP routes: `server/src/recapHistoryRoutes.ts`
   - Existing server checks: `server/src/verify-recap-history.ts` and
     `server/src/verify-recap-history-phase3.ts`
   - History display/types/tests: `client/src/RecapHistoryScreen.tsx`,
     `client/src/types.ts`, and `client/src/RecapHistoryScreen.test.tsx`
4. Run and record the baseline commands below. If a command is blocked by a
   local native dependency or the sandbox, record that separately from a
   product-code failure; rerun in the normal local developer environment.
5. Force-track this plan as described above. Do not force-add the unrelated
   untracked findings or other local handoffs.

### Baseline commands

```powershell
npm --prefix server run build
npm --prefix client run build
npm --prefix server exec -- tsx server/src/verify-recap-history.ts
npm --prefix server exec -- tsx server/src/verify-recap-history-phase3.ts
npm --prefix server exec -- tsx server/src/verify-recap-history-routes.ts
npm --prefix client run test
```

### Stopgate

The plan is force-tracked, the baseline outcome is recorded, and no application
source has changed.

## Phase 1 — Make the chapter-end lock genuinely exclusive

### Files

- `server/src/chapterEndLock.ts`
- `server/src/verify-recap-history-phase3.ts`

### Implementation

1. Keep one map record for a playthrough from its first acquisition until the
   final active holder releases. Do not delete the record while a newly woken
   holder is running, even if it has no waiters at that instant.
2. The smallest safe change to the present queue model is: remove the next
   callback; if one exists, wake it while retaining the map entry; delete the
   entry only when the releasing holder has no successor. Preserve idempotent
   release and FIFO ordering.
3. Do not change the lock's public API or broaden it to turn streaming,
   database locks, or multi-process coordination.
4. Add the regression that exposes the real race:
   - Acquire A.
   - Queue B and arrange B's critical section to signal that it has started,
     then wait on a test-controlled promise.
   - Release A and wait for B's start signal.
   - Acquire C for the same key.
   - Assert C has not entered while B remains blocked.
   - Release B and assert C enters exactly afterwards.
   Use an `active` counter and fail if it exceeds one. Include time-bounded
   waits so a broken lock fails clearly instead of hanging the verifier.
5. Retain and run the existing FIFO, cross-key, cleanup, idempotency, and
   `run()` error-path checks.

### Acceptance criteria

- The A/B/C timing regression fails against the original implementation and
  passes after the fix.
- Same-key critical sections never overlap in the test; different keys remain
  independent.
- No key remains in the map after its final holder releases.

### Stopgate

Phase 1 verifier coverage proves the timing window is closed.

## Phase 2 — Harden the archive envelope, validation, and copy isolation

### Files

- `server/src/recapArchive.ts`
- `server/src/recapPreparation.ts`
- `server/src/verify-recap-history.ts`
- `server/src/verify-recap-history-phase3.ts`
- `server/src/recapHistoryRoutes.ts` only if archive-envelope validation needs
  a narrow route error mapping

### Archive-envelope contract decision

Persist new archives as:

```ts
{ version: 1, entries: [...] }
```

Read compatibility is required:

- No archive file means no archive.
- Existing unversioned `{ entries: [...] }` archives are supported as legacy
  version 0 for reads; their entry validation is unchanged.
- On the next successful append to a version-0 archive, write version 1 while
  preserving every old raw entry exactly (including invalid rows).
- Version 1 is the only newly written schema.
- A non-integer, unsupported, or otherwise invalid declared `version` is
  archive corruption. It must not be mistaken for a clean archive hit or cause
  recap generation. Define and test one explicit status/error representation
  that lets current-chapter preparation fail safely and history reads return a
  controlled server error rather than fabricated data.

### Implementation

1. Centralize parsing of the archive file/envelope so `readArchive` and
   `appendArchivedRecap` use the same validated version decision. Do not
   silently treat `{ version: 99, entries: [...] }` as unversioned data.
2. Make `isValidRecapFacts` match `RecapFacts` completely:
   - `facts.chapterNumber` is a safe positive integer and exactly equals the
     parent entry's `chapterNumber`.
   - `facts.chapterTitle` is a non-empty string and exactly equals the parent
     entry's normalized `chapterTitle`.
   - Every beat has string `id` and `title`.
   - Every crew row has string `id`, string `name`, finite numeric `trust`, and
     string `arc`.
   - `journey` is an object with string arrays for `zonesVisited`,
     `crewSpoken`, and `shipAreasExplored`, plus boolean `petInteracted`.
   - `turnCount` is a non-negative integer.
   - If `notableFacts` is present, it is an array of objects with a non-empty
     string `file` and an array of strings in `facts`. Decide whether blank
     strings are valid and apply that choice consistently to generator data and
     tests; prefer rejecting them in persisted untrusted data.
3. Replace the single `.find()` in `prepareChapterRecap()` with collection of
   **all** archive rows whose parseable `chapterNumber` is the current chapter.
   If any matching row is invalid — including a later duplicate — throw
   `RecapCorruptionError` before facts, cache, chapter metadata, or generation
   are read. Return an archive hit only when the matching situation is clean.
4. Deep-clone the complete raw existing entries array before appending the new
   validated entry. A shallow array copy is insufficient. Preserve invalid rows
   byte-for-value as JavaScript data, but ensure no object or nested object is
   shared between input and output wiki.
5. Keep sorting deterministic and keep duplicate append rejection. A malformed
   existing entry still must not be rewritten merely because a later append
   occurs.

### Required regression coverage

Add named verifier cases for all of the following:

- Valid current row followed by duplicate current row: preparation throws
  `RecapCorruptionError` and generator-call count remains zero.
- Mismatched nested chapter number and title are invalid.
- Crew row missing `trust`, crew row with non-numeric/non-finite `trust`, and
  crew row missing `arc` are invalid.
- Missing/wrong-type `journey` members are invalid.
- Wrong-shaped optional `notableFacts` is invalid.
- Rows invalid for any of the above are omitted from ordinary history output
  and fail safely when they claim the current chapter.
- Unversioned archive reads successfully; a new append upgrades its envelope
  to version 1 without losing old raw entries.
- Invalid/unsupported declared version is controlled corruption, not an empty
  archive.
- After appending chapter 2, mutate a nested chapter-1 field in the returned
  wiki and prove the corresponding field in the chapter-1 input wiki is
  unchanged.

### Stopgate

The archive is versioned for future writes, safely compatible with existing
saves, internally consistent, and has no shared historic references.

## Phase 3 — Repair legacy parsing and legacy timestamp presentation

### Files

- `server/src/recapArchive.ts`
- `server/src/verify-recap-history.ts`
- `client/src/types.ts`
- `client/src/RecapHistoryScreen.tsx`
- `client/src/RecapHistoryScreen.test.tsx`

### Implementation

1. Parse all candidate exact `## Chapter N: Title` headings, then form sections
   only from headings accepted in strictly increasing chapter-number order.
   Track both a seen-number set and the last accepted number. A duplicate or
   lower chapter number is not a new section.
2. Compute each accepted section's end from the next **accepted** heading, not
   the next raw `## ` line. This preserves a rejected heading and its prose in
   the preceding accepted entry exactly as the legacy fallback promises.
3. Continue to require safe positive chapter numbers and non-empty accepted
   prose. Do not invent a recap from pre-heading text.
4. Change the API/type contract so legacy summaries do not claim to have a
   timestamp. Prefer `createdAt?: string` in the client/server summary type and
   omit it from legacy summary JSON instead of sending `''`.
5. In `RecapHistoryScreen`, render `Pre-archive save` for legacy rows. For a
   normal timestamp, first check `Number.isNaN(date.getTime())`; then format it.
   Retain a safe display fallback for unexpected malformed data.

### Required regression coverage

- Legacy `1`, duplicate `1`, then valid `2`: list has chapters 1 and 2 only;
  the rejected duplicate heading and its prose remain in chapter 1's prose.
- Legacy `3`, descending `2`, then valid `4`: list has chapters 3 and 4 only;
  the rejected heading/prose remain in chapter 3.
- A well-formed sequence surrounding malformed headings still yields one entry
  per accepted chapter.
- `mergeArchiveAndLegacy` cannot create duplicate chapter numbers when legacy
  input is malformed.
- A legacy API response exactly as the server returns it renders the legacy
  label and never renders `Invalid Date`.
- A malformed non-legacy timestamp also never renders `Invalid Date`.

### Stopgate

Legacy saves remain readable without ambiguous chapter records or invalid date
text.

## Phase 4 — Integrate, document, and release-check

### Files

- `README.md`
- `Technical_Specifications.md`
- This plan's phase log
- Other files only where the Phase 1–3 implementations require them

### Steps

1. Run the full server/client build and recap verifier suite. Use the commands
   from Phase 0. From repository root, verifier paths must include `server/`:
   `npm --prefix server exec -- tsx server/src/<verifier>.ts`. Never document
   the broken `tsx src/<verifier>.ts` form at repository root.
2. Run existing non-recap verifiers too:

   ```powershell
   npm --prefix server exec -- tsx server/src/verify-final-chapter.ts
   npm --prefix server exec -- tsx server/src/verify-facts.ts
   npm --prefix server exec -- tsx server/src/verify-facts-recap.ts
   npm --prefix server exec -- tsx server/src/verify-endstate.ts
   ```

3. If a disposable Postgres database is available, run
   `verify-store-deletion.ts` against it and record the connection approach.
   Do not report an in-memory fallback as Postgres coverage. If no disposable
   database is available, mark release verification incomplete with that
   dependency clearly named.
4. Perform authenticated browser QA on a local or staging single-instance app:
   finish a chapter, call recap and advance rapidly, revisit history, restart
   the app, and retry a deliberate back-to-game history error. Confirm that
   archived content is unchanged after editing live chapter authoring metadata.
5. Update README and technical specifications with the version-1 archive
   envelope, legacy compatibility behavior, corruption behavior, single-process
   lock limitation, and corrected verifier commands. Do not claim browser or
   Postgres QA passed unless it actually ran.
6. Run `git diff --check`, inspect the final diff, and ensure unrelated local
   files remain uncommitted.

### Stopgate

All automated checks and applicable browser/Postgres checks are recorded. Any
missing external verification is called out as a release blocker rather than
silently waived.

## Phase log

| Phase | Commit | What changed | Verification/outcome | Next-coder notes/deviations |
|---|---|---|---|---|
| 0 | c5c2ca1 | Plan force-tracked; no source changes. | Server build ✓, client build ✓, verify-recap-history (47/47) ✓, verify-recap-history-phase3 (22/22) ✓, verify-recap-history-routes (22/22) ✓, client test suite (11/11) ✓ — 102 checks, 0 failures. Node v24.13.0, branch main, Docker db running (postgres://archipelago:archipelago@localhost:5432/archipelago). | Unrelated untracked files preserved: RECAP_HISTORY_VERIFICATION_FINDINGS.md, TO_ADAPT_FINAL_CHAPTER_FEATURE_IMPLEMENTATION.md, openwiki/. |
| 1 | 89ef6da | `server/src/chapterEndLock.ts`: release() retains map entry while waking successor; deletes only when no successor exists. `server/src/verify-recap-history-phase3.ts`: added A/B/C timing regression test with active concurrency counter. | Server build ✓, verify-recap-history (47/47) ✓, verify-recap-history-phase3 (23/23, +1 regression) ✓, verify-recap-history-routes (22/22) ✓, client test suite (11/11) ✓ — 103 checks, 0 failures. Regression proves C cannot enter while B is blocked after wake, and C enters after B releases. | The fix is 6 lines changed in release(); the regression is ~50 lines of async test. Existing FIFO, cross-key, cleanup, idempotency, and run() error-path tests all still pass. |
| 2 | pending |  |  |  |
| 3 | pending |  |  |  |
| 4 | pending |  |  |  |
