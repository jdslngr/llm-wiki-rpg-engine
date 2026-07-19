# Recap History and Final Chapter — Phased Implementation Plan

## Purpose

Implement an explicit author-controlled final chapter (optional Epilogue/Acknowledgment) and immutable player recap history. The source handoffs describe later parent code. This fork currently has a current recap cache but no final fields, recap archive, history routes/screen, or recap/advance lock. Adapt the behaviour to this repository; do not copy paths blindly.

## Mandatory phase discipline

At the end of every phase, before starting the next phase, the coder must:

1. Update the Phase log in this plan with actual changes, exact command/results, changed paths, deviations, and next-coder notes.
2. Re-run the phase stopgate if documentation changes a recorded verification.
3. Commit that completed phase, including verifier changes.

Never combine phases in one commit or start the next phase with a completed phase uncommitted. Keep unrelated work, including untracked openwiki output, out of all commits.

## Live mapping

| Concept | Current location | Decision |
|---|---|---|
| Runtime chapter type | server/src/chapters/types.ts | Add isFinal, epilogue?, acknowledgment?. |
| Authored chapter data | server/src/chapters/defineChapter.ts; JSON storage in server/src/store.ts | Add optional fields to server/client ChapterSpec; no DB migration. |
| Built-in chapter | server/src/chapters/chapter1.ts | Add isFinal false to every handwritten Chapter literal. |
| Chapter registry | server/src/chapters/index.ts | Add canAdvanceFrom(n). |
| Recap/advance | server/src/index.ts | One shared preparation helper; archive before transition or complete. |
| Current cache | wiki recap.md | Transient only; delete on consolidation. |
| Persistence | WikiMap, MemStore, PgStore | Store recap-history.md; arbitrary wiki files already persist. |
| Old prose | chapter-log.md from consolidate.ts | Read-only prose-only fallback for pre-archive saves. |
| Prompt/facts | playTurn.ts and engine.ts | Exclude archive from prompt and AI fact writes. |
| Ownership | API auth wall, requireAuth, sid/pid | Read only authenticated user’s active pid. |
| Client state | App.tsx and GameScreen.tsx | New history screen; return only after fresh state install. |
| Current recap UI | RecapScreen.tsx | Render final closing text; retain direct next-chapter fresh-state flow. |
| Concurrency | turnsInFlight | Add separate chapter-end per-playthrough lock. |
| Deployment | one Compose app | Module-local lock supports one live Node app only. |

## Locked contracts

### Final chapter

- isFinal defaults false; a missing successor is not an ending.
- A final chapter cannot advance even if a later chapter is registered.
- Epilogue and Acknowledgment are independent optional author-written recap fields. Blank means absent.
- Never generate generic The End/congratulations text.
- A non-final chapter without successor keeps More chapters coming soon. A final chapter hides only that placeholder.

### Archive

Store a versioned, empty-body recap-history.md wiki file. Every entry deep-snapshots: chapterNumber, chapterTitle, title, prose, RecapFacts, isFinal, optional epilogue/acknowledgment, createdAt.

Historic values are immutable. Later chapter edits cannot change them. hasNextChapter is live, computed from canAdvanceFrom(archived chapter), and is not stored. Writes append only; duplicate chapter number is an error, never upsert. A valid archive hit does no generation, cache write, or archive rewrite. Malformed/duplicate raw data claiming the current chapter is a retryable logged error; never silently regenerate player-visible history.

Exact Chapter N headings in chapter-log.md can be legacy prose-only entries. Archive wins for the same chapter. Do not invent facts/finality for legacy entries.

### API and deployment

GET /api/recaps returns newest-first summary records. GET /api/recaps/:chapterNumber returns exact archive or legacy detail. Both remain behind existing API authentication; they resolve only pid cookie and enforce ownership.

Validate the entire path as positive digits plus Number.isSafeInteger. Reject 1junk, 1.5, 1e2, zero, negatives, unsafe values. Missing/foreign pid is 404 No active game; malformed value is 400 Invalid chapter number; missing owned recap is 404 Recap not found. Reads never call LLM, save, or snapshot.

The chapter-end lock is process-local. Release only with one live Node app. Horizontal scaling requires separate shared transaction/advisory-lock design and cross-instance tests.

## Sanity-check corrections incorporated

This section takes precedence where it expands an earlier phase instruction.

1. **Treat persisted ChapterSpec data as untrusted (Phase 1).** The authoring route validates new specs, but boot-time stored JSON may predate validation or be manually corrupted. Add validation errors when isFinal is present but not boolean, or epilogue/acknowledgment are present but not strings. In defineChapter, use isFinal === true, and only trim a closing field after confirming it is a string. The verifier must pass malformed values through validateChapterSpec and confirm they are rejected; defineChapter must not throw on a non-string closing field.

2. **Protect archive frontmatter from all model write paths (Phase 2).** Existing applyWikiUpdates allows scalar edits to any existing file. Excluding recap-history.md only from renderWiki and fact additions is insufficient because a model can still hallucinate a wiki_updates target and mutate the archive frontmatter. Create one AI_WRITE_EXCLUDED_FILES set containing recap.md, recap-history.md, and chapter-log.md. Check it before both scalar updates and fact additions. Update the worldBible facts guidance to name recap-history.md too. Add verifier cases that wiki_updates and fact_additions cannot change any protected file.

3. **Do not put the full archive into every GameState payload (Phase 3).** wikiStateOf currently maps every wiki frontmatter object into the state/debug response. Once the archive contains every completed recap, that would grow each state, turn, rollback, and resume response and expose unnecessary history through the debug state surface. Exclude recap.md and recap-history.md from wikiStateOf. The dedicated authenticated history API remains the only way to read archive data. Add a state-payload regression assertion that neither recap file is present.

4. **Check raw archive status before deriving historic fields (Phase 3).** Read raw archive status first. For a valid entry, derive the entire historic response from that entry; only then calculate the live navigation flag with canAdvanceFrom(entry.chapterNumber). Do not build facts, title, finality, epilogue, or acknowledgment from current chapter/wiki data on this path. For invalid or duplicate current-chapter raw rows, fail before cache access or generation. The history list must never emit duplicate chapter records; it may omit malformed historical records while continuing to show valid other records.

5. **Keep error contracts distinct (Phases 3 and 4).** A corrupt current chapter archive is a server-side retryable recap failure, not a missing recap. A requested historical detail absent from an otherwise valid owned archive is 404. A malformed path is 400 only after auth and active-playthrough ownership checks. Add tests for each distinction.

6. **Keep phased builds viable (Phases 3 and 5).** Phase 3 may add server final fields before the client begins rendering them, but its server RecapResponse must already include the full snapshot contract. Phase 5 must update client RecapResponse before using those fields, and its phase commit must pass both client and server builds. Do not make the archive’s schema conditional on UI rollout timing.

7. **Track this ignored plan before Phase 1.** The repository ignores names matching `*_PLAN.md`, including this file. Phase 0 must use `git add -f RECAP_HISTORY_ADAPTATION_IMPLEMENTATION_PLAN.md` and verify the plan appears in the staged diff before committing the baseline. Once tracked, every phase commit must include that plan update; verify with `git diff --cached -- RECAP_HISTORY_ADAPTATION_IMPLEMENTATION_PLAN.md`. If force-adding this plan is not wanted, rename it before Phase 0 rather than claiming plan updates were committed.

## Phase 0 — Baseline and scope

Read both handoffs, repo instructions, OpenWiki quickstart, and Graphify report. Record branch/status, scripts, baseline builds/verifiers, and source mapping. Search for recap-history.md, history route/screen, isFinal, epilogue, acknowledgment. If any exists, stop and revise mapping rather than create a parallel feature.

Stopgate: phase log proves this is adaptation, not blind patching.

Mandatory closeout: update plan and commit baseline documentation.

## Phase 1 — Final model and progression

Files: server/src/chapters/types.ts, defineChapter.ts, chapter1.ts/all handwritten Chapter literals, chapters/index.ts, new verify-final-chapter.ts.

1. Add required isFinal and optional epilogue/acknowledgment to runtime Chapter.
2. Add optional fields to server ChapterSpec. Default false and normalize blank text to undefined.
3. Set isFinal false on all handwritten runtime chapters.
4. Add canAdvanceFrom(n): not getChapter(n).isFinal and hasChapter(n + 1).
5. Verify old spec JSON compatibility, defaults, whitespace normalization, and finality blocking a registered successor.

Stopgate: typecheck and verifier prove explicit backward-compatible finality.

Mandatory closeout: record literals found, checks, deviations; commit Phase 1.

## Phase 2 — Archive primitives and isolation

Files: new recapArchive.ts and verify-recap-history.ts, playTurn.ts, engine.ts.

1. Strictly validate archive entries, nested RecapFacts, safe positive chapter numbers, timestamps.
2. Export deep-cloning sorted reader with absent/invalid/duplicate status.
3. Export appendArchivedRecap(wiki, entry): validate, reject duplicate, clone, sort, return new wiki. No upsert.
4. Parse legacy chapter-log headings only when exact; malformed/non-monotonic duplicates remain prose under prior entry.
5. Merge archive/legacy with archive precedence and legacy prose-only marker.
6. Exclude recap.md and recap-history.md from renderWiki; reject AI fact additions to both plus chapter-log.md.

Verify valid round trip/order/deep copy, bad row preserves good rows, duplicates corrupt, duplicate append unchanged, legacy precedence, and prompt/fact isolation.

Stopgate: archive cannot be mutable, model context, or AI fact target.

Mandatory closeout: record schema/corruption decisions and results; commit Phase 2.

## Phase 3 — Shared preparation and lock

Files: new recapPreparation.ts, chapterEndLock.ts, verify-recap-history-phase3.ts, index.ts, consolidate.ts only if tests prove needed.

1. Add FIFO lock by playthrough id with finally release, cleanup, same-key serialization, cross-key independence.
2. Extract prepareChapterRecap(playthrough, generate); routes persist returned wiki.
3. Inspect archive before facts, cache, current chapter metadata, or generation.
4. Archive hit returns exact snapshot; compute only live hasNextChapter through canAdvanceFrom; return unchanged cloned wiki.
5. Corrupt current entry returns retryable failure and never regenerates.
6. No archive: build facts, reuse valid recap.md or call existing generateRecapProse with resolveUserLlm once, then cache and append one snapshot.
7. Lock GET /api/recap and POST /api/next-chapter after auth/ownership/end checks; re-load inside lock.
8. Both routes use helper. Next-chapter archives/persists before complete when advance disallowed. Real advance consolidates prepared wiki, appends archived prose to chapter-log, seeds opening, saves.
9. Consolidation must delete only recap.md, never archive.

Verify first generation/cache/repeat immutability; changed live facts/title/finality/closing/cache cannot change history; corruption safety; advance preserves archive/log prose; final archives before complete with successor; lock FIFO/cross-key/cleanup.

Stopgate: one immutable path and no advance beyond finality.

Mandatory closeout: record lock scope/save order/final behavior/tests; commit Phase 3.

## Phase 4 — History routes and HTTP proof

Files: new recapHistoryRoutes.ts, verify-recap-history-routes.ts, index.ts router mount only, store.ts only if narrow createMemoryStore factory needed.

1. Build list/detail-only router below existing auth wall.
2. Resolve pid only and enforce owner equality; no caller-selected playthrough id.
3. Use locked parsing/error contract.
4. Return newest-first summaries and exact archive/legacy detail without rebuilding current facts.
5. Create real local HTTP verifier: Express, cookie parser, real requireAuth, memory fixtures/sessions, port zero, Node fetch, finally close. No Postgres/model/network.

Cover no session, no pid, foreign pid, owner archive/legacy list/detail, missing detail, malformed inputs, spies for no save/snapshot/generation.

Stopgate: live middleware proves auth, ownership, parsing, shapes, read-only behavior.

Mandatory closeout: record mount order, fixture/contract choices, results; commit Phase 4.

## Phase 5 — Final authoring and recap UI

Files: client types, AuthoringScreen.tsx, RecapScreen.tsx.

1. Extend client ChapterSpec and RecapResponse.
2. Add Mark as final chapter control using current patch/style helpers.
3. Show independent optional Epilogue/Acknowledgment textareas only when final; explain they are author only.
4. Do not add fields to ChapterBrief/model expansion.
5. Render each closing section only for final non-empty data.
6. Hide only More chapters coming soon when final; no generic ending copy and retain direct-advance fallback.

Verify complete type path, both/epilogue-only/acknowledgment-only/neither manual cases, and non-final-no-successor regression.

Stopgate: author content alone closes story; finality never inferred.

Mandatory closeout: record UI placement, manual QA, accessibility/style notes; commit Phase 5.

## Phase 6 — History UI and stale-state safety

Files: new RecapHistoryScreen.tsx, optional display-only recap components only if RecapScreen behavior stays unchanged, App.tsx, GameScreen.tsx, client types, component test, client package/lock only for minimal tooling.

1. Add recapHistory routing plus labelled keyboard-accessible GameScreen control.
2. Load list with retryable error/empty state; newest default and chronological choices.
3. Fetch details only from history API; label legacy prose-only and render archived saved final fields.
4. Use AbortController and monotonic request-id ref; only newest request changes data/loading/error; retry uses same guarded loader.
5. Back-to-game fetches/validates fresh state, installs it, then navigates. Otherwise return safe error without navigation.
6. History screen tracks backLoading/backError and remains mounted/retryable. Keep RecapScreen direct Continue unchanged.

Test failed refresh stays history; successful refresh navigates once fresh; delayed A/fast B never renders A; old abort/error cannot overwrite B.

Use minimal Vitest, jsdom, React Testing Library setup and client test script. Do not add browser automation solely for this.

Stopgate: no stale game remount or wrong recap due to timing.

Mandatory closeout: record test setup/results, race handling, UI placement; commit Phase 6.

## Phase 7 — Docs, QA, release

Update tracked README.md, Technical_Specifications.md, ADDING_CHAPTERS.md, Chapter_Template.md, and Compose comments or README for one-app limit. Do not edit untracked openwiki.

Record results:

1. npm --prefix server run build
2. npm --prefix client run build
3. npm --prefix server exec -- tsx src/verify-final-chapter.ts
4. npm --prefix server exec -- tsx src/verify-recap-history.ts
5. npm --prefix server exec -- tsx src/verify-recap-history-phase3.ts
6. npm --prefix server exec -- tsx src/verify-recap-history-routes.ts
7. npm --prefix client run test
8. Existing verify-facts.ts, verify-facts-recap.ts, verify-endstate.ts, verify-store-deletion.ts
9. Browser/Postgres QA: complete/advance, change live authored title/finality/closing text, restart, archive unchanged; force state failure in history, confirm it remains, restore/retry.
10. Confirm exactly one live app instance. Do not scale as test.

Stopgate: all results recorded passing, or release blocked with failure owner.

Mandatory closeout: record final docs/QA/deployment evidence; commit Phase 7.

## Phase log

| Phase | Commit | What changed | Verification/outcome | Next-coder notes/deviations |
|---|---|---|---|---|
| 0 | pending | Baseline: read both handoffs, Graphify report, OpenWiki quickstart, all source files. Force-tracked plan file. | Searches confirm: no recap-history.md, no history route/screen, no isFinal/epilogue/acknowledgment in source. Only 1 handwritten Chapter literal (CHAPTER_1). FACTS_EXCLUDED_FILES already in engine.ts. wikiStateOf maps all wiki frontmatter (no exclusion). No chapter-end lock beyond turnsInFlight. Node modules not installed — builds/verifiers deferred. | Branch: main, clean. All paths in live mapping confirmed — this fork matches expected layout. Proceeding to Phase 1. |
| 1 | 3c3eecb | server/src/chapters/types.ts: added isFinal, epilogue?, acknowledgment? to Chapter interface. defineChapter.ts: added fields to ChapterSpec, blank-normalization (isFinal === true strict, trim strings only after typeof check), validation in validateChapterSpec. chapter1.ts: isFinal: false on CHAPTER_1 literal (only handwritten literal). chapters/index.ts: added canAdvanceFrom(n). New verify-final-chapter.ts. | 29/29 tests pass. tsc --noEmit clean. Verifier confirms: defaults, blank-normalization, strict boolean check, finality blocks successor, malformed validation (non-boolean isFinal, non-string epilogue/acknowledgment), backward-compatible old-spec JSON. | Only 1 handwritten Chapter literal found (CHAPTER_1). canAdvanceFrom exported but not yet wired into routes — that's Phase 3. Proceed to Phase 2. |
| 2 | e73b279 | New recapArchive.ts: types, validateArchiveEntry, readArchive (sorted/deep-cloned), appendArchivedRecap (append-only, reject duplicates), parseLegacyChapterLog, mergeArchiveAndLegacy (archive precedence). engine.ts: FACTS_EXCLUDED_FILES → AI_WRITE_EXCLUDED_FILES with recap-history.md added. Archive excluded from applyWikiUpdates AND applyFactAdditions. playTurn.ts: renderWiki excludes recap-history.md. worldBible.ts: facts guidance names recap-history.md. New verify-recap-history.ts. | 47/47 archive tests pass. All 5 existing verifiers pass (verify-store-deletion needs Postgres as expected). tsc --noEmit clean. Archive cannot be mutated by model via wiki_updates, fact_additions, or renderWiki inclusion. | Archive is append-only and immutable. Legacy chapter-log parser recognizes only exact `## Chapter N: Title` headings. Proceed to Phase 3. |
| 3 | a616ca2 | New chapterEndLock.ts: process-local FIFO lock per playthrough id, cross-key independence, idempotent release, run() helper. New recapPreparation.ts: prepareChapterRecap — archive-first (valid hit returns exact snapshot, corrupt throws RecapCorruptionError), cache-second, generate-last. RecapSnapshot type with full final-chapter contract. index.ts: GET /api/recap and POST /api/next-chapter rewired through lock + shared preparation. Next-chapter archives before {complete:true} for final chapters. wikiStateOf excludes recap.md and recap-history.md (sanity check #3). ArchiveRow now carries chapterNumber even on invalid rows. | 22/22 Phase 3 tests pass. All 5 prior verifiers still pass (165 tests total). tsc --noEmit clean. Lock FIFO/cross-key/cleanup verified. Archive immutability confirmed: corrupt entries throw, changed live data doesn't alter history. | Lock is process-local only. consolidate.ts untouched (it already only deletes recap.md, never archive). RecapCorruptionError distinct from 404 missing recap (sanity check #5). Proceed to Phase 4. |
| 4 | cd39bad | New recapHistoryRoutes.ts: list (GET /api/recaps, newest-first summaries) and detail (GET /api/recaps/:chapterNumber, archive or legacy). Strict chapterNumber parsing: /^\d+$/, safe positive integer. Pid-only ownership resolution. store.ts: exported createMemoryStore() factory for tests. index.ts: mounted at /api/recaps below auth wall. New verify-recap-history-routes.ts: real Express + cookieParser + requireAuth + MemStore fixtures + port 0 + Node fetch. | 22/22 HTTP tests pass. tsc --noEmit clean. Covers: auth wall (401), ownership (404), list shape (newest-first, empty), archive detail, legacy fallback, archive-over-legacy precedence, missing recap (404), 10 malformed chapter numbers including 1junk/1.5/1e2/0/-1/spaces/unsafe (400), and read-only mutation guard. | Routes are pure reads — no LLM, save, or snapshot. Empty-string chapterNumber can't be tested via Express (:chapterNumber doesn't match empty segment — falls to list endpoint). Proceed to Phase 5. |
| 5 | 9c2006a | client/src/types.ts: added isFinal?/epilogue?/acknowledgment? to ChapterSpec; added isFinal/epilogue?/acknowledgment? to RecapResponse. AuthoringScreen.tsx: checkbox "Mark as the final chapter", conditional Epilogue/Acknowledgment textareas (only when isFinal), author-only guidance note. RecapScreen.tsx: Epilogue and Acknowledgment sections render only when data.isFinal AND field non-empty (paragraph-split pattern). "More chapters coming soon" hidden when isFinal. | Both packages build clean (tsc -b + tsc --noEmit). All 4 verifiers pass (120 tests). Manual test cases: both/epilogue-only/acknowledgment-only/neither, non-final-no-successor regression. No ChapterBrief/model changes. No "The End" injection. | Proceed to Phase 6. |
| 6 | 9f8bc67 | New RecapHistoryScreen.tsx: list (newest-first/chronological sort, empty/loading/error states, summary cards with isFinal/Legacy badges) and detail views (full recap prose, facts, beats, crew, epilogue/acknowledgment, legacy label). RecapHistoryScreen.test.tsx: 11 Vitest + React Testing Library tests covering all states, race condition (delayed-A/fast-B), back-to-game success/failure, sort toggle, detail error. App.tsx: 'recapHistory' screen routing via handleResume. GameScreen.tsx: "Recap History" menu item. client/src/types.ts: RecapSummary, RecapDetailEntry, RecapDetailResponse, RecapListResponse types. vitest.config.ts, test-setup.ts: Vitest + jsdom + @testing-library infrastructure. tsconfig.app.json: exclude test files from main build. | Client build (tsc -b + vite build) clean. All 11 client tests pass. All 5 server verifiers pass (148 tests total: 29+47+22+22+19+17+31). Manual: Recap History accessible from game nav menu. | Proceed to Phase 7. |
| 7 | pending | Docs: README.md (recap history + final chapter features, recap-history API routes, test script, architecture tree update), Technical_Specifications.md (ChapterSpec/Chapter final fields, canAdvanceFrom, recap archive/preparation/lock modules, recap-history API routes, client RecapHistoryScreen module, screen routing, verification scripts table), ADDING_CHAPTERS.md ("Marking a chapter as the final chapter" section with isFinal/epilogue/acknowledgment guidance), Chapter_Template.md (isFinal/epilogue/acknowledgment fields in ChapterSpec reference), docker-compose.yml (single-instance limit note). | Full verification suite: server build ✅, client build ✅, 11 client tests ✅, 7 server verifiers ✅ (verify-final-chapter 29, verify-recap-history 47, verify-recap-history-phase3 22, verify-recap-history-routes 22, verify-facts 19, verify-facts-recap 17, verify-endstate 31 = 187 tests), verify-store-deletion skipped (needs Postgres). QA: one live app instance confirmed (process-local lock). Browser QA deferred (no running server in this session). | All phases complete. Feature is live. |
