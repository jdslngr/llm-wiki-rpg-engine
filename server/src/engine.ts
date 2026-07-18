// The generic story engine: it takes a turn's reported events + proposed wiki
// edits and produces the next authoritative wiki — folding events into world-state,
// advancing the anchor when its conditions are met, and tracking the anti-soft-lock
// counter. Story gating lives HERE, in code, never in the AI (Build Plan §3).
//
// Chapter-specific knowledge (fold-map, conditions, beat notes) lives in the chapter
// module; this file stays generic so more chapters slot in without engine changes.

import type { WikiMap, WikiUpdate, FactAddition } from './types.js'
import type { Fold } from './chapters/types.js'
import { getChapter, CHAPTER_END } from './chapters/index.js'
import { ENDSTATE_FIELD_PREFIX } from './chapters/defineChapter.js'

// The anti-soft-lock threshold is now per-chapter (Chapter.softLockThreshold). The
// constant lives in chapter1.ts (5 turns) and authored chapters pick their own via
// ChapterSpec.softLockThreshold (defaults to 5). This file no longer owns a default.

type Fm = Record<string, unknown>

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const MAX_FACTS_PER_FILE = 8
const MAX_FACT_WORDS = 30
const MAX_FACT_CHARS = 220 // backstop for the word-count check's blind spot (see §3.1)

const MAX_WIKI_UPDATE_STRING_CHARS = 500
const MAX_WIKI_UPDATE_ARRAY_ITEMS = 20

/** Accept only string | finite number | boolean | small string[]; cap strings;
 *  anything else (objects, null, oversized/mixed arrays) → undefined = drop. */
function sanitizeWikiUpdateValue(v: unknown): unknown {
  if (typeof v === 'string') return v.slice(0, MAX_WIKI_UPDATE_STRING_CHARS)
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'boolean') return v
  if (Array.isArray(v)) {
    if (v.length > MAX_WIKI_UPDATE_ARRAY_ITEMS) return undefined
    if (!v.every((x) => typeof x === 'string')) return undefined
    return v
  }
  return undefined
}

// recap.md is never rendered into the prompt at all (renderWiki skips it); chapter-log.md
// gets its `frontmatter` unconditionally reset to {} on every chapter transition
// (consolidate.ts's appendChapterLog ~L58-61) — any facts stored there would be silently
// wiped at the next chapter boundary. recap-history.md is the immutable archive — the model
// must never read or write it. All three are protected from every model write path.
const AI_WRITE_EXCLUDED_FILES = new Set(['recap.md', 'recap-history.md', 'chapter-log.md'])

/** Normalize for dedup comparison ONLY — facts are stored verbatim. */
function normalizeForDedup(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
}

// world-state fields the AI may never write via wiki_updates, on top of the
// chapter's own engine-owned set: engine transition state, plus durable
// cross-chapter facts (chapter 1's vow_made; all chapterend_* end-state fields).
// If a future chapter adds its own out-of-band durable field, list it here.
const ALWAYS_REFUSED_WORLD_STATE_FIELDS = new Set(['pending_transition', 'vow_made'])

/** Fold reported events into world-state condition fields (deterministic, dedup'd). */
function foldEvents(
  fm: Fm,
  events: string[],
  foldMap: Record<string, Fold>,
): { fm: Fm; changed: boolean } {
  const next: Fm = { ...fm }
  let changed = false
  for (const e of events) {
    const fold = foldMap[e]
    if (!fold) continue
    if (fold.token === undefined) {
      if (next[fold.field] !== true) {
        next[fold.field] = true
        changed = true
      }
    } else {
      const cur = asArray(next[fold.field])
      if (!cur.includes(fold.token)) {
        next[fold.field] = [...cur, fold.token]
        changed = true
      }
    }
  }
  return { fm: next, changed }
}

/** Apply the AI's proposed scalar edits — validated and range-clamped. Refuses
 *  engine-owned world-state fields and edits to files that don't exist. */
function applyWikiUpdates(
  wiki: WikiMap,
  updates: WikiUpdate[],
  engineOwnedFields: Set<string>,
): WikiMap {
  const next: WikiMap = structuredClone(wiki)
  for (const u of updates) {
    if (!u || typeof u.file !== 'string' || typeof u.field !== 'string') continue
    // The engine owns world-state's progress fields — the AI may not write them.
    if (u.file === 'world-state.md' && engineOwnedFields.has(u.field)) continue
    if (
      u.file === 'world-state.md' &&
      (ALWAYS_REFUSED_WORLD_STATE_FIELDS.has(u.field) || u.field.startsWith(ENDSTATE_FIELD_PREFIX))
    ) continue
    // `facts` is owned by applyFactAdditions' append-only path — a scalar write
    // through wiki_updates here would silently wipe the array.
    if (u.field === 'facts') continue
    // Don't let the AI invent or mutate protected files (recap.md, recap-history.md,
    // chapter-log.md) — these are engine-managed.
    if (AI_WRITE_EXCLUDED_FILES.has(u.file)) continue
    // Don't let the AI invent files; only edit ones that already exist.
    const file = next[u.file]
    if (!file) continue
    let value = sanitizeWikiUpdateValue(u.value)
    if (value === undefined) continue
    // Range-clamp known numeric fields (trust_score: 0–100).
    if (u.field === 'trust_score' && typeof value === 'number') {
      value = Math.max(0, Math.min(100, value))
    }
    file.frontmatter = { ...(file.frontmatter ?? {}), [u.field]: value }
  }
  return next
}

/** Apply the AI's proposed fact additions — short, durable notes appended to a file's
 *  `facts` array. Capped per-fact (oversized text dropped) and per-file (oldest dropped
 *  first), since this array is resent in full every turn (it lives in the uncached
 *  volatile prompt, not the cached stable block — see playTurn.ts's volatileSystemPrompt)
 *  and isn't bounded by chapter length the way chapter-log.md is. Refuses files that don't
 *  exist or are on the excluded list, same spirit as applyWikiUpdates. Pure: returns a new wiki. */
function applyFactAdditions(wiki: WikiMap, additions: FactAddition[]): WikiMap {
  const next: WikiMap = structuredClone(wiki)
  for (const a of additions) {
    if (!a || typeof a.file !== 'string' || typeof a.text !== 'string') continue
    if (AI_WRITE_EXCLUDED_FILES.has(a.file)) continue
    // Collapse all internal whitespace (incl. newlines) so a fact never breaks the
    // rendered bullet list (§3.7) and the word count below isn't skewed by stray newlines.
    const text = a.text.trim().replace(/\s+/g, ' ')
    if (!text || text.length > MAX_FACT_CHARS || text.split(' ').length > MAX_FACT_WORDS) continue
    const file = next[a.file]
    if (!file) continue
    const cur = asArray(file.frontmatter?.facts) as string[]
    const normalized = normalizeForDedup(text)
    if (cur.some((f) => normalizeForDedup(f) === normalized)) continue
    file.frontmatter = { ...(file.frontmatter ?? {}), facts: [...cur, text].slice(-MAX_FACTS_PER_FILE) }
  }
  return next
}

export type TurnResult = {
  wiki: WikiMap
  /** The anchor before this turn (e.g. 'A1'). */
  fromAnchor: string
  /** The anchor after this turn — may equal fromAnchor, or CHAPTER_END. */
  toAnchor: string
  advanced: boolean
  /** Whether the player made progress toward the active anchor this turn. */
  progressed: boolean
  /** The new soft-lock counter (turns since last progress). */
  turnsSinceProgress: number
}

/**
 * The core write-back. Order matters: consume any pending transition, apply the AI's
 * scalar edits, fold events (events are authoritative over edits), then check whether
 * the active anchor's conditions are now met and advance if so. Pure: returns a new wiki.
 */
export function runWriteBack(
  prior: WikiMap,
  events: string[],
  updates: WikiUpdate[],
  factAdditions: FactAddition[] = [],
): TurnResult {
  // The active chapter drives the fold-map, owned fields, and anchor gating.
  const ch = getChapter(Number(prior['world-state.md']?.frontmatter?.current_chapter ?? 1))

  // 1) Apply validated scalar edits.
  const afterEdits = applyWikiUpdates(prior, updates, ch.engineOwnedFields)

  // 1b) Apply validated fact additions (capped, append-only).
  const afterFacts = applyFactAdditions(afterEdits, factAdditions)

  // 2) Fold events into world-state.
  const ws = (afterFacts['world-state.md'] ??= { frontmatter: {}, body: '' })
  const startFm: Fm = { ...(ws.frontmatter ?? {}) }
  // Consume any transition flag set by the previous turn (it's being narrated now).
  delete startFm.pending_transition
  const fromAnchor = String(startFm.current_anchor ?? ch.firstAnchor)

  const { fm: foldedFm, changed } = foldEvents(startFm, events, ch.foldMap)
  let fm = foldedFm

  // 3) Anchor gate: if the active anchor's conditions are met, advance ONE beat.
  let toAnchor = fromAnchor
  let advanced = false
  if (fromAnchor !== CHAPTER_END && ch.anchorConditionsMet(fromAnchor, fm)) {
    toAnchor = ch.nextAnchor(fromAnchor)
    advanced = true
    fm.current_anchor = toAnchor
    if (toAnchor !== CHAPTER_END) fm.pending_transition = true
  }

  // 4) Anti-soft-lock counter: reset on progress, else increment.
  const progressed = changed || advanced
  const turnsSinceProgress = progressed ? 0 : Number(startFm.turns_since_progress ?? 0) + 1
  fm.turns_since_progress = turnsSinceProgress

  ws.frontmatter = fm
  return { wiki: afterFacts, fromAnchor, toAnchor, advanced, progressed, turnsSinceProgress }
}

/** Prompt flags derived from the CURRENT wiki, used when building a turn's system prompt. */
export function promptFlags(wiki: WikiMap): {
  anchor: string
  justAdvanced: boolean
  nudge?: string
} {
  const fm: Fm = wiki['world-state.md']?.frontmatter ?? {}
  const ch = getChapter(Number(fm.current_chapter ?? 1))
  const anchor = String(fm.current_anchor ?? ch.firstAnchor)
  const justAdvanced = fm.pending_transition === true
  const stalled = Number(fm.turns_since_progress ?? 0) >= ch.softLockThreshold
  const hint = stalled ? ch.unmetHint(anchor, fm) : ''
  return { anchor, justAdvanced, nudge: hint || undefined }
}
