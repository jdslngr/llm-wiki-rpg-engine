// Shared chapter-recap preparation (Phase 3). Extracted from the two routes
// that need it — GET /api/recap and POST /api/next-chapter — so the archive-
// first, cache-second, generate-last logic is a single code path.
//
// Rules (in order):
//   1. Inspect archive BEFORE facts, cache, current chapter metadata, or generation.
//   2. Valid archive hit → return exact snapshot; compute only live hasNextChapter.
//   3. Corrupt current-chapter archive entry → retryable failure, never regenerate.
//   4. No archive entry → build facts, reuse valid recap.md cache if present,
//      otherwise call the generator once; then cache AND append one archive snapshot.
//
// The caller (index.ts) owns persistence — this function returns the modified wiki
// and the caller decides when to save it.

import { getChapter, canAdvanceFrom } from './chapters/index.js'
import { chapterNumOf } from './chapterMeta.js'
import { buildRecapFacts, type RecapFacts } from './recap.js'
import { readArchive, appendArchivedRecap, type ArchivedRecapEntry } from './recapArchive.js'
import type { WikiMap, Turn } from './types.js'
import type { PlayableId } from './game/characters.js'

// ── Types ────────────────────────────────────────────────────────────────────

/** The full recap shape returned by the API. Phase 5 adds client rendering;
 *  the server ships the complete contract now (sanity check #6). */
export type RecapSnapshot = {
  facts: RecapFacts
  hasNextChapter: boolean
  title: string
  prose: string
  isFinal: boolean
  epilogue?: string
  acknowledgment?: string
}

/** Generator callback — routes wire this to the real generateRecapProse (or a
 *  mock in tests). Must never be called when an archive hit is available. */
export type RecapGenerator = (
  facts: RecapFacts,
  playerActions: string[],
) => Promise<{ title: string; prose: string }>

/** Result: the possibly-modified wiki (with new archive + cache entries) and
 *  the recap snapshot to return to the client. */
export type PreparationResult = {
  wiki: WikiMap
  recap: RecapSnapshot
}

// ── Error ────────────────────────────────────────────────────────────────────

/** Distinct error so the route can map retryable archive corruption to 503
 *  vs. a missing recap to 404 (sanity check #5). */
export class RecapCorruptionError extends Error {
  constructor(
    public readonly chapterNumber: number,
    public readonly reason: string,
  ) {
    super(`Recap data for chapter ${chapterNumber} is corrupted: ${reason}`)
    this.name = 'RecapCorruptionError'
  }
}

// ── Preparation ──────────────────────────────────────────────────────────────

export async function prepareChapterRecap(
  wiki: WikiMap,
  character: string,
  history: Turn[],
  generate: RecapGenerator,
): Promise<PreparationResult> {
  const currentChapter = chapterNumOf(wiki)

  // ── Step 1: Inspect archive before anything else ────────────────────────
  const archiveRows = readArchive(wiki)
  // Find any row (valid or corrupt) matching the current chapter. The chapterNumber
  // field is set even on invalid rows when the raw data had a parseable chapter number.
  const currentRow = archiveRows.find(
    (r) => r.chapterNumber === currentChapter,
  )

  if (currentRow) {
    if (!currentRow.status.valid) {
      // Corrupt current-chapter entry — retryable failure, never regenerate.
      throw new RecapCorruptionError(
        currentChapter,
        (currentRow.status as { valid: false; reason: string }).reason,
      )
    }

    // Valid archive hit — return exact snapshot. hasNextChapter is the only
    // live-computed field; everything else comes from the immutable archive.
    const entry = currentRow.entry
    return {
      wiki, // wiki is unchanged — the archive already has the entry
      recap: {
        facts: entry.facts,
        hasNextChapter: canAdvanceFrom(entry.chapterNumber),
        title: entry.title,
        prose: entry.prose,
        isFinal: entry.isFinal,
        epilogue: entry.epilogue,
        acknowledgment: entry.acknowledgment,
      },
    }
  }

  // ── Step 2: No archive entry — build facts, check cache, generate ───────
  const facts = buildRecapFacts(character as PlayableId, wiki, history)
  const finishedChapter = getChapter(currentChapter)

  let title: string
  let prose: string

  // Check the transient recap cache first.
  const cached = wiki['recap.md']
  if (cached?.body && typeof cached.frontmatter?.title === 'string') {
    title = cached.frontmatter.title
    prose = cached.body
  } else {
    // Generate fresh — one AI call.
    const playerActions = history
      .filter((t) => t.role === 'player')
      .map((t) => t.content)
    const generated = await generate(facts, playerActions)
    title = generated.title
    prose = generated.prose
  }

  // ── Step 3: Cache into wiki + append to archive ─────────────────────────
  let next: WikiMap = {
    ...wiki,
    'recap.md': { frontmatter: { title }, body: prose },
  }

  const entry: ArchivedRecapEntry = {
    chapterNumber: currentChapter,
    chapterTitle: finishedChapter.title,
    title,
    prose,
    facts,
    isFinal: finishedChapter.isFinal,
    epilogue: finishedChapter.epilogue,
    acknowledgment: finishedChapter.acknowledgment,
    createdAt: new Date().toISOString(),
  }
  next = appendArchivedRecap(next, entry)

  return {
    wiki: next,
    recap: {
      facts,
      hasNextChapter: canAdvanceFrom(currentChapter),
      title,
      prose,
      isFinal: finishedChapter.isFinal,
      epilogue: finishedChapter.epilogue,
      acknowledgment: finishedChapter.acknowledgment,
    },
  }
}
