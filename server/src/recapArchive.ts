// Recap-history archive primitives (Phase 2). The archive is an append-only,
// immutable store of every completed chapter recap, kept in the frontmatter of
// recap-history.md. Once written, an entry is never rewritten — later chapter
// edits cannot change historical recap data. The archive wins over any legacy
// prose-only chapter-log.md entry for the same chapter number.
//
// Archive envelope (Phase 7 hardening):
//   v0 — legacy unversioned:  { entries: [...] }
//   v1 — current:             { version: 1, entries: [...] }
//
// Exports:
//   - Type guards and validation for raw archive rows
//   - archiveEnvelopeError(wiki) → corruption check before readArchive
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
  /** Chapter number — always set, even for invalid rows where the raw data had a
   *  parseable chapter number (so prepareChapterRecap can detect corrupt entries
   *  for the current chapter). null only when the raw row was completely
   *  unparseable. */
  chapterNumber: number | null
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
const VERSION_KEY = 'version'
const CURRENT_VERSION = 1

// ── Envelope ─────────────────────────────────────────────────────────────────

type ArchiveEnvelope =
  | { ok: true; version: 0 | 1; entries: unknown[] }
  | { ok: false; reason: string }

/** Central parser for the archive file envelope. Both readArchive and
 *  appendArchivedRecap use this to make the same version decision. */
function parseArchiveEnvelope(wiki: WikiMap): ArchiveEnvelope {
  const file = wiki[ARCHIVE_FILE]
  if (!file) return { ok: true, version: 0, entries: [] } // no archive yet — treated as empty v0

  const fm = file.frontmatter
  if (!fm || typeof fm !== 'object') {
    return { ok: false, reason: 'archive frontmatter is not an object' }
  }

  const entries = fm[ENTRIES_KEY]
  if (!Array.isArray(entries)) {
    return { ok: false, reason: 'archive entries key is not an array' }
  }

  // No version key → legacy v0.
  if (!(VERSION_KEY in fm)) {
    return { ok: true, version: 0, entries }
  }

  const version = fm[VERSION_KEY]
  if (version === 1) {
    return { ok: true, version: 1, entries }
  }

  return { ok: false, reason: `unsupported archive version: ${String(version)}` }
}

/** Returns an error string if the archive envelope is corrupt (bad version,
 *  missing entries key, etc.), or null if the archive is absent or valid.
 *  Callers use this before readArchive to distinguish "no archive" from
 *  "corrupt archive" — the former is a normal state; the latter must fail
 *  safely and never cause recap generation. */
export function archiveEnvelopeError(wiki: WikiMap): string | null {
  const envelope = parseArchiveEnvelope(wiki)
  return envelope.ok ? null : envelope.reason
}

// ── Validation ───────────────────────────────────────────────────────────────

function isSafePositiveInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n > 0 && Number.isSafeInteger(n)
}

function isNonNegativeInteger(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && Number.isSafeInteger(n)
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function isIsoTimestamp(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const d = new Date(s)
  return !isNaN(d.getTime()) && s === d.toISOString()
}

export function isValidRecapFacts(f: unknown): f is RecapFacts {
  if (!f || typeof f !== 'object') return false
  const r = f as Record<string, unknown>

  // Top-level scalars.
  if (!isSafePositiveInteger(r.chapterNumber)) return false
  if (typeof r.chapterTitle !== 'string' || !r.chapterTitle.trim()) return false
  if (typeof r.characterName !== 'string') return false
  if (typeof r.characterRole !== 'string') return false
  if (typeof r.isVisitor !== 'boolean') return false
  if (!isNonNegativeInteger(r.turnCount)) return false

  // Beats: array of { id: string, title: string }.
  if (!Array.isArray(r.beats)) return false
  if (!r.beats.every((b) =>
    b && typeof b === 'object' &&
    typeof (b as any).id === 'string' &&
    typeof (b as any).title === 'string'
  )) return false

  // Crew: array of { id: string, name: string, trust: finite number, arc: string }.
  if (!Array.isArray(r.crew)) return false
  if (!r.crew.every((c) =>
    c && typeof c === 'object' &&
    typeof (c as any).id === 'string' &&
    typeof (c as any).name === 'string' &&
    isFiniteNumber((c as any).trust) &&
    typeof (c as any).arc === 'string'
  )) return false

  // Journey: object with typed members.
  if (!r.journey || typeof r.journey !== 'object') return false
  const j = r.journey as Record<string, unknown>
  if (!Array.isArray(j.zonesVisited) || !j.zonesVisited.every((x: unknown) => typeof x === 'string')) return false
  if (!Array.isArray(j.crewSpoken) || !j.crewSpoken.every((x: unknown) => typeof x === 'string')) return false
  if (!Array.isArray(j.shipAreasExplored) || !j.shipAreasExplored.every((x: unknown) => typeof x === 'string')) return false
  if (typeof j.petInteracted !== 'boolean') return false

  // Optional notableFacts: array of { file: string, facts: string[] }.
  // Reject blank strings in persisted untrusted data.
  if (r.notableFacts !== undefined) {
    if (!Array.isArray(r.notableFacts)) return false
    if (!r.notableFacts.every((nf) =>
      nf && typeof nf === 'object' &&
      typeof (nf as any).file === 'string' && (nf as any).file.trim().length > 0 &&
      Array.isArray((nf as any).facts) &&
      ((nf as any).facts as unknown[]).every((f: unknown) => typeof f === 'string' && (f as string).trim().length > 0)
    )) return false
  }

  return true
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

  // Cross-checks: nested facts must agree with parent entry metadata.
  const facts = e.facts as Record<string, unknown>
  const entryChapterNumber = e.chapterNumber as number
  const entryChapterTitle = (e.chapterTitle as string).trim()

  if (facts.chapterNumber !== entryChapterNumber) {
    return `facts.chapterNumber (${String(facts.chapterNumber)}) does not match entry chapterNumber (${entryChapterNumber})`
  }
  if (typeof facts.chapterTitle === 'string' && (facts.chapterTitle as string).trim() !== entryChapterTitle) {
    return `facts.chapterTitle does not match entry chapterTitle`
  }

  return {
    chapterNumber: e.chapterNumber as number,
    chapterTitle: entryChapterTitle,
    title: (e.title as string).trim(),
    prose: (e.prose as string).trim(),
    facts: structuredClone(e.facts) as RecapFacts,
    isFinal: e.isFinal as boolean,
    epilogue: typeof e.epilogue === 'string' ? (e.epilogue as string).trim() || undefined : undefined,
    acknowledgment: typeof e.acknowledgment === 'string' ? (e.acknowledgment as string).trim() || undefined : undefined,
    createdAt: e.createdAt as string,
  }
}

// ── Reader ───────────────────────────────────────────────────────────────────

/** Parse and validate every raw entry in the archive. Returns rows sorted by
 *  chapterNumber ascending. Invalid raw rows produce a status row with the
 *  reason — the caller decides whether to omit or surface them. Duplicate
 *  chapter numbers are flagged on the LATER row (the first is kept valid).
 *
 *  Returns an empty array when no archive file exists. For corrupt envelopes
 *  (bad version, etc.) this also returns an empty array — callers must check
 *  archiveEnvelopeError() first to distinguish "absent" from "corrupt". */
export function readArchive(wiki: WikiMap): ArchiveRow[] {
  const envelope = parseArchiveEnvelope(wiki)
  if (!envelope.ok) return []
  if (envelope.entries.length === 0) return []

  const rows: ArchiveRow[] = []
  const seen = new Set<number>()

  for (const r of envelope.entries) {
    const rawNum: number | null =
      r && typeof r === 'object' && isSafePositiveInteger((r as any).chapterNumber)
        ? (r as any).chapterNumber
        : null

    const result = validateArchiveEntry(r)
    if (typeof result === 'string') {
      rows.push({ entry: null as any, chapterNumber: rawNum, status: { valid: false, reason: result } })
      // Track chapter number for the seen-set even from invalid rows so a corrupt
      // row doesn't let a later duplicate slip through.
      if (rawNum !== null) seen.add(rawNum)
      continue
    }

    if (seen.has(result.chapterNumber)) {
      rows.push({ entry: result, chapterNumber: result.chapterNumber, status: { valid: false, reason: `duplicate chapter ${result.chapterNumber}` } })
      continue
    }
    seen.add(result.chapterNumber)

    rows.push({ entry: result, chapterNumber: result.chapterNumber, status: { valid: true } })
  }

  // Sort by chapterNumber (nulls sort last).
  return rows.sort((a, b) => {
    const an = a.chapterNumber ?? Number.MAX_SAFE_INTEGER
    const bn = b.chapterNumber ?? Number.MAX_SAFE_INTEGER
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

/** Read the raw entries array for appending. Returns the array (may be empty)
 *  or null if the envelope is missing or corrupt. */
function rawEntriesForWrite(wiki: WikiMap): unknown[] | null {
  const envelope = parseArchiveEnvelope(wiki)
  if (!envelope.ok) return null
  return envelope.entries
}

/** Append a new recap entry to the archive. Validates the entry, rejects
 *  duplicates (same chapter number), deep-clones all raw rows, sorts, and
 *  returns the new wiki. The original wiki is NOT mutated.
 *
 *  If the existing archive is unversioned (v0), the new wiki is written as
 *  version 1 while preserving every old raw entry exactly (including invalid
 *  rows). Version 1 is always written for new appends. */
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

  // Deep-clone every existing raw row — no shared references between input
  // and output wiki (fixes finding #6).
  const raw = rawEntriesForWrite(wiki)
  const existing: unknown[] = raw !== null ? structuredClone(raw) : []
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
    frontmatter: { [VERSION_KEY]: CURRENT_VERSION, [ENTRIES_KEY]: existing },
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
