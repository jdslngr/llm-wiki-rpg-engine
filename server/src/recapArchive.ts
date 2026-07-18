// Recap-history archive primitives (Phase 2). The archive is an append-only,
// immutable store of every completed chapter recap, kept in the frontmatter of
// recap-history.md. Once written, an entry is never rewritten — later chapter
// edits cannot change historical recap data. The archive wins over any legacy
// prose-only chapter-log.md entry for the same chapter number.
//
// Exports:
//   - Type guards and validation for raw archive rows
//   - readArchive(wiki) → sorted entries with per-entry status
//   - appendArchivedRecap(wiki, entry) → validated, dedup'd, sorted new wiki
//   - parseLegacyChapterLog(wiki) → prose-only entries from chapter-log.md
//   - mergeArchiveAndLegacy(archive, legacy) → archive precedence, legacy fallback

import type { WikiMap } from './types.js'
import type { RecapFacts } from './recap.js'

// ── Types ────────────────────────────────────────────────────────────────────

export type ArchivedRecapEntry = {
  chapterNumber: number
  chapterTitle: string
  title: string
  prose: string
  facts: RecapFacts
  isFinal: boolean
  epilogue?: string
  acknowledgment?: string
  createdAt: string // ISO-8601
}

/** A legacy prose-only entry parsed from chapter-log.md. */
export type LegacyRecapEntry = {
  chapterNumber: number
  chapterTitle: string
  prose: string
  /** Always true — marks this as a pre-archive save with no structured data. */
  legacy: true
}

export type ArchiveEntryStatus =
  | { valid: true }
  | { valid: false; reason: string }

export type ArchiveRow = {
  entry: ArchivedRecapEntry
  status: ArchiveEntryStatus
}

export type RecapSummary = {
  chapterNumber: number
  chapterTitle: string
  title: string
  isFinal: boolean
  createdAt: string
  legacy?: true
}

// ── Constants ────────────────────────────────────────────────────────────────

export const ARCHIVE_FILE = 'recap-history.md'
const ENTRIES_KEY = 'entries'

// ── Validation ───────────────────────────────────────────────────────────────

function isSafePositiveInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && Number.isSafeInteger(n)
}

function isIsoTimestamp(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const d = new Date(s)
  return !isNaN(d.getTime()) && s === d.toISOString()
}

function isValidRecapFacts(f: unknown): f is RecapFacts {
  if (!f || typeof f !== 'object') return false
  const r = f as Record<string, unknown>
  return (
    isSafePositiveInteger(r.chapterNumber) &&
    typeof r.chapterTitle === 'string' && r.chapterTitle.trim().length > 0 &&
    typeof r.characterName === 'string' &&
    typeof r.characterRole === 'string' &&
    typeof r.isVisitor === 'boolean' &&
    Array.isArray(r.beats) &&
    r.beats.every((b) => b && typeof b === 'object' && typeof (b as any).id === 'string' && typeof (b as any).title === 'string') &&
    Array.isArray(r.crew) &&
    r.crew.every((c) => c && typeof c === 'object' && typeof (c as any).id === 'string' && typeof (c as any).name === 'string') &&
    typeof r.journey === 'object' && r.journey !== null &&
    typeof r.turnCount === 'number' && Number.isInteger(r.turnCount) && r.turnCount >= 0
  )
}

/** Validate a raw (untrusted) entry from persisted JSON. Returns the entry if
 *  valid, or a reason string if not. Does not throw. */
export function validateArchiveEntry(raw: unknown): ArchivedRecapEntry | string {
  if (!raw || typeof raw !== 'object') return 'entry is not an object'
  const e = raw as Record<string, unknown>

  if (!isSafePositiveInteger(e.chapterNumber)) {
    return `invalid chapterNumber: ${String(e.chapterNumber)}`
  }
  if (typeof e.chapterTitle !== 'string' || !e.chapterTitle.trim()) {
    return 'missing or empty chapterTitle'
  }
  if (typeof e.title !== 'string' || !e.title.trim()) {
    return 'missing or empty title'
  }
  if (typeof e.prose !== 'string' || !e.prose.trim()) {
    return 'missing or empty prose'
  }
  if (!isValidRecapFacts(e.facts)) {
    return 'missing or invalid facts'
  }
  if (typeof e.isFinal !== 'boolean') {
    return 'isFinal must be a boolean'
  }
  if (e.epilogue !== undefined && typeof e.epilogue !== 'string') {
    return 'epilogue must be a string if present'
  }
  if (e.acknowledgment !== undefined && typeof e.acknowledgment !== 'string') {
    return 'acknowledgment must be a string if present'
  }
  if (!isIsoTimestamp(e.createdAt)) {
    return `invalid or missing createdAt: ${String(e.createdAt)}`
  }

  return {
    chapterNumber: e.chapterNumber as number,
    chapterTitle: (e.chapterTitle as string).trim(),
    title: (e.title as string).trim(),
    prose: (e.prose as string).trim(),
    facts: structuredClone(e.facts) as RecapFacts,
    isFinal: e.isFinal as boolean,
    epilogue: typeof e.epilogue === 'string' ? (e.epilogue as string).trim() || undefined : undefined,
    acknowledgment: typeof e.acknowledgment === 'string' ? (e.acknowledgment as string).trim() || undefined : undefined,
    createdAt: e.createdAt as string,
  }
}

// ── Raw access ───────────────────────────────────────────────────────────────

/** Read the raw entries array from the archive file. Returns null if the file
 *  or entries key is absent (not an error — the playthrough just has no archive
 *  yet). */
function rawEntries(wiki: WikiMap): unknown[] | null {
  const file = wiki[ARCHIVE_FILE]
  if (!file) return null
  const entries = file.frontmatter?.[ENTRIES_KEY]
  if (!Array.isArray(entries)) return null
  return entries
}

// ── Reader ───────────────────────────────────────────────────────────────────

/** Parse and validate every raw entry in the archive. Returns rows sorted by
 *  chapterNumber ascending. Invalid raw rows produce a status row with the
 *  reason — the caller decides whether to omit or surface them. Duplicate
 *  chapter numbers are flagged on the LATER row (the first is kept valid). */
export function readArchive(wiki: WikiMap): ArchiveRow[] {
  const raw = rawEntries(wiki)
  if (!raw) return []

  const rows: ArchiveRow[] = []
  const seen = new Set<number>()

  for (const r of raw) {
    const result = validateArchiveEntry(r)
    if (typeof result === 'string') {
      rows.push({ entry: null as any, status: { valid: false, reason: result } })
      // Try to extract a chapter number for the seen-set even from invalid rows
      // so a corrupt row doesn't let a later duplicate slip through.
      if (r && typeof r === 'object' && isSafePositiveInteger((r as any).chapterNumber)) {
        seen.add((r as any).chapterNumber)
      }
      continue
    }

    if (seen.has(result.chapterNumber)) {
      rows.push({ entry: result, status: { valid: false, reason: `duplicate chapter ${result.chapterNumber}` } })
      continue
    }
    seen.add(result.chapterNumber)

    rows.push({ entry: result, status: { valid: true } })
  }

  // Sort by chapterNumber (even invalid rows if they have one, but they won't
  // have an entry — the sort is stable for valid rows).
  return rows.sort((a, b) => {
    const an = a.entry?.chapterNumber ?? 0
    const bn = b.entry?.chapterNumber ?? 0
    return an - bn
  })
}

/** Convenience: valid entries from readArchive, sorted. */
export function validEntries(wiki: WikiMap): ArchivedRecapEntry[] {
  return readArchive(wiki)
    .filter((r) => r.status.valid)
    .map((r) => r.entry)
}

// ── Writer ───────────────────────────────────────────────────────────────────

/** Append a new recap entry to the archive. Validates the entry, rejects
 *  duplicates (same chapter number), deep-clones, sorts, and returns the
 *  new wiki. The original wiki is NOT mutated. */
export function appendArchivedRecap(wiki: WikiMap, entry: ArchivedRecapEntry): WikiMap {
  // Validate the entry before writing — defensive, even though callers should
  // build valid entries.
  const validated = validateArchiveEntry(entry)
  if (typeof validated === 'string') {
    throw new Error(`Invalid archive entry: ${validated}`)
  }

  // Reject duplicate chapter number.
  for (const existing of validEntries(wiki)) {
    if (existing.chapterNumber === validated.chapterNumber) {
      throw new Error(`Archive already contains an entry for chapter ${validated.chapterNumber}`)
    }
  }

  // Deep-clone the existing entries, add the new one, sort.
  const existing: unknown[] = [...(rawEntries(wiki) ?? [])]
  const clone = structuredClone(validated)
  existing.push(clone)

  // Sort by chapterNumber.
  existing.sort((a, b) => {
    const an = (a as any).chapterNumber ?? 0
    const bn = (b as any).chapterNumber ?? 0
    return an - bn
  })

  const next: WikiMap = structuredClone(wiki)
  next[ARCHIVE_FILE] = {
    frontmatter: { [ENTRIES_KEY]: existing },
    body: '', // always empty — archive data lives in frontmatter
  }
  return next
}

// ── Legacy chapter-log parser ────────────────────────────────────────────────

const CHAPTER_LOG_HEADING_RE = /^## Chapter (\d+): (.+)$/gm

/** Parse chapter-log.md body for legacy prose-only entries. Only exact
 *  `## Chapter N: Title` headings are recognised. Malformed or non-monotonic
 *  duplicates remain as raw prose under the prior recognised entry (the regex
 *  simply won't match them). Returns entries in parse order (chapter-number
 *  ascending for a well-formed log). */
export function parseLegacyChapterLog(wiki: WikiMap): LegacyRecapEntry[] {
  const body = wiki['chapter-log.md']?.body
  if (!body) return []

  const entries: LegacyRecapEntry[] = []
  const re = new RegExp(CHAPTER_LOG_HEADING_RE, 'gm')
  let match: RegExpExecArray | null

  while ((match = re.exec(body)) !== null) {
    const chapterNumber = Number(match[1])
    if (!isSafePositiveInteger(chapterNumber)) continue

    const chapterTitle = match[2].trim()
    // Extract prose: everything from after this heading to the next heading or EOF.
    const proseStart = match.index + match[0].length
    const nextHeading = body.indexOf('\n## ', proseStart)
    const prose = body
      .slice(proseStart, nextHeading === -1 ? undefined : nextHeading)
      .trim()

    if (!prose) continue // empty section — skip

    entries.push({
      chapterNumber,
      chapterTitle,
      prose,
      legacy: true,
    })
  }

  return entries
}

// ── Merge ────────────────────────────────────────────────────────────────────

export type MergedRecapEntry = ArchivedRecapEntry | LegacyRecapEntry

/** Merge archive and legacy entries. For each chapter number, the archive wins.
 *  Legacy entries only appear for chapters without an archive entry. Sorted by
 *  chapter number ascending. */
export function mergeArchiveAndLegacy(wiki: WikiMap): MergedRecapEntry[] {
  const archive = validEntries(wiki)
  const legacy = parseLegacyChapterLog(wiki)

  const archiveNums = new Set(archive.map((e) => e.chapterNumber))
  const merged: MergedRecapEntry[] = [...archive]

  for (const leg of legacy) {
    if (!archiveNums.has(leg.chapterNumber)) {
      merged.push(leg)
    }
  }

  return merged.sort((a, b) => a.chapterNumber - b.chapterNumber)
}

// ── Summary helpers ──────────────────────────────────────────────────────────

export function toSummary(entry: ArchivedRecapEntry | LegacyRecapEntry): RecapSummary {
  if ('legacy' in entry) {
    return {
      chapterNumber: entry.chapterNumber,
      chapterTitle: entry.chapterTitle,
      title: `Chapter ${entry.chapterNumber}`,
      isFinal: false, // legacy entries cannot be known to be final
      createdAt: '', // legacy entries have no timestamp
      legacy: true,
    }
  }
  return {
    chapterNumber: entry.chapterNumber,
    chapterTitle: entry.chapterTitle,
    title: entry.title,
    isFinal: entry.isFinal,
    createdAt: entry.createdAt,
  }
}
