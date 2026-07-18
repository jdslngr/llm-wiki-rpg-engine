// Recap-history HTTP routes (Phase 4). Read-only; mounted below the existing
// auth wall at /api/recaps. Resolves the active playthrough from the pid cookie
// and enforces ownership — no caller-selected playthrough id.
//
//   GET /api/recaps                    → newest-first summary list
//   GET /api/recaps/:chapterNumber     → exact archive or legacy detail
//
// Chapter numbers are validated strictly: the entire path segment must be a
// string of digits that parses to a positive safe integer. Inputs like "1junk",
// "1.5", "1e2", "0", and values above Number.MAX_SAFE_INTEGER are all rejected
// as malformed.
//
// These routes never call the LLM, save state, or snapshot. They are pure reads
// of existing persisted data.

import { Router } from 'express'
import type { PlaythroughStore } from './store.js'
import {
  mergeArchiveAndLegacy,
  toSummary,
  readArchive,
  parseLegacyChapterLog,
  type MergedRecapEntry,
  type RecapSummary,
} from './recapArchive.js'

// ── Path parsing ─────────────────────────────────────────────────────────────

/** Strict chapter-number parser. Only accepts strings consisting entirely of
 *  digits that parse to a positive safe integer. Rejects scientific notation,
 *  decimal points, negative signs, leading "+", zero, and unsafe values. */
function parseChapterNumberParam(raw: string): number | null {
  // Must be all digits — rejects "1.5", "1e2", "1junk", "-1", "+1", " 1 ".
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  // Guard against values that exceed safe integer range (e.g. 9999999999999999
  // passes the digit check but is > MAX_SAFE_INTEGER).
  if (!Number.isSafeInteger(n) || n === 0) return null
  return n
}

// ── Router ───────────────────────────────────────────────────────────────────

export function recapHistoryRoutes(store: PlaythroughStore): Router {
  const router = Router()

  // GET /api/recaps — newest-first summary list.
  router.get('/', async (req, res) => {
    try {
      const pid = req.cookies?.pid
      if (!pid) {
        res.status(404).json({ error: 'No active game.' })
        return
      }

      const pt = await store.get(pid)
      if (!pt || pt.userId !== req.userId) {
        res.status(404).json({ error: 'No active game.' })
        return
      }

      const merged = mergeArchiveAndLegacy(pt.wiki)
      const summaries: RecapSummary[] = merged.map(toSummary).reverse() // newest first

      res.json({ recaps: summaries })
    } catch (err) {
      console.error('[/api/recaps] error:', err)
      res.status(500).json({ error: 'Could not load recap history.' })
    }
  })

  // GET /api/recaps/:chapterNumber — exact archive or legacy detail.
  router.get('/:chapterNumber', async (req, res) => {
    try {
      const chapterNumber = parseChapterNumberParam(req.params.chapterNumber)
      if (chapterNumber === null) {
        res.status(400).json({ error: 'Invalid chapter number.' })
        return
      }

      const pid = req.cookies?.pid
      if (!pid) {
        res.status(404).json({ error: 'No active game.' })
        return
      }

      const pt = await store.get(pid)
      if (!pt || pt.userId !== req.userId) {
        res.status(404).json({ error: 'No active game.' })
        return
      }

      // Check archive first (wins over legacy).
      const archiveRows = readArchive(pt.wiki)
      const archiveHit = archiveRows.find(
        (r) => r.status.valid && r.chapterNumber === chapterNumber,
      )
      if (archiveHit) {
        res.json({ recap: archiveHit.entry, legacy: false })
        return
      }

      // Fall back to legacy chapter-log.
      const legacyEntries = parseLegacyChapterLog(pt.wiki)
      const legacyHit = legacyEntries.find((e) => e.chapterNumber === chapterNumber)
      if (legacyHit) {
        res.json({ recap: legacyHit, legacy: true })
        return
      }

      // Owned playthrough, valid chapter number, but no recap for it.
      res.status(404).json({ error: 'Recap not found.' })
    } catch (err) {
      console.error('[/api/recaps/:chapterNumber] error:', err)
      res.status(500).json({ error: 'Could not load recap.' })
    }
  })

  return router
}
