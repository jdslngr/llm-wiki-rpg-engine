// Data-driven chapter builder. A chapter can be described entirely as JSON (a
// `ChapterSpec`) and turned into a `Chapter` (chapters/types.ts) by `defineChapter`. Because
// every list the engine reads is DERIVED from one spec, the "golden rule" (events ⇄ fold-map
// ⇄ scratch ⇄ conditions all line up) holds by construction — there are no separate lists to
// drift apart. This is what the authoring tool generates: a tiny `defineChapter({…})` module.
//
// `chapter1.ts` stays hand-written (it has six per-character openings); new chapters
// use this builder.

import type { Chapter, Fm } from './types.js'
import { CHAPTER_END } from './types.js'
import type { WikiMap } from '../types.js'

// A single advancement check. `flag` → fm[field] === true; `count_gte` → the array at
// fm[field] has at least `value` entries. `hint` is the plain-language nudge shown when this
// clause is the thing still blocking the beat.
export type Clause = { field: string; op: 'flag' | 'count_gte'; value?: number; hint?: string }

export type EndStateOp = { field: string; op: 'set' | 'append'; value: unknown }

export type ChapterSpec = {
  number: number
  title: string
  /** The fixed chapter overview + guardrails block, appended to the world bible. */
  fragment: string
  anchors: { id: string; title: string; note: string; advanceWhen: Clause[] }[]
  events: { token: string; anchor: string; fold: { field: string; token?: string } }[]
  /** v1: one shared turn-0 opening used for every playable character. */
  opening: { prose: string; actions: string[] }
  /** Turns without progress before the engine fires a nudge hint (default 5). */
  softLockThreshold?: number
  /** Durable facts to write into the wiki when this chapter ends. */
  endState?: EndStateOp[]
  /** Marks this as the final chapter of the whole story (default false — an ordinary chapter
   *  with no sequel authored yet is NOT final; the author opts in explicitly). */
  isFinal?: boolean
  /** Optional closing prose, shown on the recap screen only when isFinal and non-empty. */
  epilogue?: string
  /** Optional thank-you/credits text, independent of epilogue — shown under the same rule. */
  acknowledgment?: string
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function clauseMet(c: Clause, fm: Fm): boolean {
  if (c.op === 'count_gte') return asArray(fm[c.field]).length >= (c.value ?? 1)
  return fm[c.field] === true // 'flag'
}

export function applyEndStateOps(ops: EndStateOp[], wiki: WikiMap): void {
  const ws = (wiki['world-state.md'] ??= { frontmatter: {}, body: '' })
  const fm: Record<string, unknown> = { ...(ws.frontmatter ?? {}) }
  for (const op of ops) {
    fm[op.field] = op.op === 'append' ? [...asArray(fm[op.field]), op.value] : op.value
  }
  ws.frontmatter = fm
}

export const ENGINE_CONSTANT_FIELDS = ['current_chapter', 'current_anchor', 'turns_since_progress', 'chapter_history_start'] as const

export const ENDSTATE_FIELD_PREFIX = 'chapterend_'

/** Build the full Chapter from its data spec. */
export function defineChapter(spec: ChapterSpec): Chapter {
  // Normalize: treat empty-string fold tokens as absent (flag-type fold).
  // Structured-output models often emit "" instead of omitting an optional
  // string field; an empty string is never a meaningful token, so treat it
  // as absent — otherwise the event becomes an array fold instead of a flag,
  // and any 'flag' condition reading it can never be true.
  const events = spec.events.map((e) =>
    e.fold.token === '' ? { ...e, fold: { field: e.fold.field } } : e,
  )

  const anchorOrder = spec.anchors.map((a) => a.id)
  const anchorTitles: Record<string, string> = {}
  const beatNotes: Record<string, string> = {}
  const advanceWhen: Record<string, Clause[]> = {}
  for (const a of spec.anchors) {
    anchorTitles[a.id] = a.title
    beatNotes[a.id] = a.note
    advanceWhen[a.id] = a.advanceWhen
  }

  const eventAnchor: Record<string, string> = {}
  const foldMap: Record<string, { field: string; token?: string }> = {}
  for (const e of events) {
    eventAnchor[e.token] = e.anchor
    foldMap[e.token] = e.fold
  }
  const eventTokens = events.map((e) => e.token)

  const engineOwnedFields = new Set<string>([
    ...ENGINE_CONSTANT_FIELDS,
    ...events.map((e) => e.fold.field),
  ])

  // Scratch seed: a fold with a token accumulates an array (start []); without, it's a flag
  // (start false). If a field is ever used as an array, it stays an array.
  function scratchSeed(): Record<string, unknown> {
    const seed: Record<string, unknown> = {}
    for (const e of events) {
      const isArray = e.fold.token !== undefined
      if (isArray) seed[e.fold.field] = []
      else if (!(e.fold.field in seed)) seed[e.fold.field] = false
    }
    return seed
  }

  function allowedEvents(crewId: string | null, anchor: string): string[] {
    const selfToken = crewId ? `spoke_to_${crewId}` : null
    const curIdx = anchor === CHAPTER_END ? anchorOrder.length - 1 : anchorOrder.indexOf(anchor)
    return eventTokens.filter((e) => {
      if (e === selfToken) return false
      return anchorOrder.indexOf(eventAnchor[e]) <= curIdx
    })
  }

  function anchorConditionsMet(anchor: string, fm: Fm): boolean {
    const clauses = advanceWhen[anchor]
    if (!clauses || clauses.length === 0) return false
    return clauses.every((c) => clauseMet(c, fm))
  }

  function nextAnchor(anchor: string): string {
    const i = anchorOrder.indexOf(anchor)
    if (i < 0 || i === anchorOrder.length - 1) return CHAPTER_END
    return anchorOrder[i + 1]
  }

  function unmetHint(anchor: string, fm: Fm): string {
    const clauses = advanceWhen[anchor] ?? []
    return clauses
      .filter((c) => !clauseMet(c, fm))
      .map((c) => c.hint || `make progress toward this beat`)
      .join('; ')
  }

  function activeAnchorSection(
    anchor: string,
    opts: { justAdvanced?: boolean; nudge?: string } = {},
  ): string {
    if (anchor === CHAPTER_END) {
      return `ACTIVE ANCHOR: CHAPTER COMPLETE. Bring the scene to a gentle, satisfying close.
Do not start a new plot.`
    }
    const notes = beatNotes[anchor] ?? ''
    const transition = opts.justAdvanced
      ? `\nTRANSITION — the previous beat just resolved and the story has moved into the ACTIVE beat above.
THIS TURN MUST open it: briefly honor the small action the player just took (a sentence or two), then
make this beat's defining/inciting event HAPPEN NOW as the turn's main event — do not linger in the
prior beat's mood, and do not wait for the player to seek it out.`
      : ''
    const nudge = opts.nudge
      ? `\nGENTLE STEER — the scene has lingered. Without breaking immersion or railroading, give the
player a natural opening to: ${opts.nudge}. Let a crew member or the world invite it; never state it as a goal.`
      : ''
    return `ACTIVE ANCHOR\n${notes}${transition}${nudge}`
  }

  // Blank string → "not written", so an empty textarea never renders an empty section.
  // Only trim after confirming the value is a string (sanity check #1: malformed input
  // like {epilogue: 42} must not throw here — it's caught by validateChapterSpec).
  const epilogue = typeof spec.epilogue === 'string' ? spec.epilogue.trim() || undefined : undefined
  const acknowledgment = typeof spec.acknowledgment === 'string' ? spec.acknowledgment.trim() || undefined : undefined

  return {
    number: spec.number,
    title: spec.title,
    firstAnchor: anchorOrder[0],
    anchorOrder,
    anchorTitles,
    events: eventTokens,
    foldMap,
    engineOwnedFields,
    fragment: spec.fragment,
    beatNotes,
    allowedEvents,
    anchorConditionsMet,
    nextAnchor,
    unmetHint,
    activeAnchorSection,
    scratchSeed,
    openingFor: () => ({ prose: spec.opening.prose, actions: spec.opening.actions }),
    softLockThreshold: spec.softLockThreshold ?? 5,
    endState: spec.endState?.length ? (wiki) => applyEndStateOps(spec.endState!, wiki) : undefined,
    isFinal: spec.isFinal === true,
    epilogue,
    acknowledgment,
  }
}

/**
 * Golden-rule validation. Returns a list of human-readable problems ([] = valid). Used by the
 * generate endpoint (refuse to write an invalid chapter) and surfaced in the authoring UI.
 */
export function validateChapterSpec(
  spec: unknown,
  existingEndState?: Record<string, EndStateOp['op']>,
): string[] {
  const problems: string[] = []
  const s = spec as Partial<ChapterSpec>

  if (typeof s?.number !== 'number' || !Number.isInteger(s.number) || s.number < 1) {
    problems.push('Chapter "number" must be a positive integer.')
  }
  if (typeof s?.title !== 'string' || !s.title.trim()) problems.push('Chapter "title" is required.')
  if (typeof s?.fragment !== 'string' || !s.fragment.trim()) {
    problems.push('Chapter "fragment" (overview + guardrails) is required.')
  }
  if (!Array.isArray(s?.anchors) || s.anchors.length === 0) {
    problems.push('A chapter needs at least one anchor (beat).')
    return problems // can't check the rest meaningfully
  }
  if (!Array.isArray(s?.events)) {
    problems.push('A chapter needs an "events" list.')
    return problems
  }

  // Which fields can a condition legitimately read? Only fields some event folds into.
  const arrayFields = new Set<string>() // fed by a token-bearing fold
  const flagFields = new Set<string>() // fed by a flag fold
  const seenTokens = new Set<string>()
  // `a?.id` (not `a.id`): this function validates UNTRUSTED input — a malformed anchors
  // array (e.g. a null entry) must never throw here, or the caller's request hangs instead
  // of getting a 400. Anchors with no id are still flagged individually in the loop below.
  const anchorIds = new Set(s.anchors.map((a) => a?.id).filter(Boolean))

  for (const e of s.events) {
    if (!e?.token) { problems.push('An event is missing its "token".'); continue }
    if (seenTokens.has(e.token)) problems.push(`Duplicate event token "${e.token}".`)
    seenTokens.add(e.token)
    if (!anchorIds.has(e.anchor)) problems.push(`Event "${e.token}" points at unknown anchor "${e.anchor}".`)
    if (!e.fold?.field) { problems.push(`Event "${e.token}" has no fold field.`); continue }
    if (e.fold.field === 'facts') {
      problems.push(`Event "${e.token}" folds into "facts", which is reserved for AI-authored facts.`)
    }
    if (e.fold.field.startsWith(ENDSTATE_FIELD_PREFIX)) {
      problems.push(
        `Event "${e.token}" fold field "${e.fold.field}" starts with "${ENDSTATE_FIELD_PREFIX}", ` +
        `which is reserved for durable end-state facts.`,
      )
    }
    const tok = e.fold.token === '' ? undefined : e.fold.token
    if (tok !== undefined) arrayFields.add(e.fold.field)
    else flagFields.add(e.fold.field)
  }

  // chapterend_ fields fed by an `append` op (this spec's own endState, or another
  // already-saved chapter's, passed in via existingEndState) are real arrays — a
  // count_gte on them is legitimate.
  const appendedEndStateFields = new Set<string>()
  for (const raw of asArray(s.endState)) {
    const op = raw as EndStateOp
    if (op?.op === 'append' && op?.field) appendedEndStateFields.add(op.field)
  }
  for (const [field, op] of Object.entries(existingEndState ?? {})) {
    if (op === 'append') appendedEndStateFields.add(field)
  }

  // Validate endState ops (if present).
  for (const raw of asArray(s.endState)) {
    const op = raw as EndStateOp
    if (!op?.field) {
      problems.push('An end-state fact is missing its field.')
      continue
    }
    if (op.op !== 'set' && op.op !== 'append') {
      problems.push(`End-state fact "${op.field}" has unknown op "${op.op}" (must be "set" or "append").`)
    }
    if (!op.field.startsWith(ENDSTATE_FIELD_PREFIX)) {
      problems.push(
        `End-state fact "${op.field}" must start with "${ENDSTATE_FIELD_PREFIX}" ` +
        `(this keeps durable facts from colliding with chapter scratch fields).`,
      )
    }
    if (existingEndState?.[op.field] && existingEndState[op.field] !== op.op) {
      problems.push(
        `End-state fact "${op.field}" uses op "${op.op}" but another chapter already uses ` +
        `"${existingEndState[op.field]}" — reusing the same field with a different op ` +
        `would change its behavior (e.g. overwrite a list instead of appending).`,
      )
    }
  }

  for (const a of s.anchors) {
    if (!a?.id) { problems.push('An anchor is missing its "id".'); continue }
    if (!a.title?.trim()) problems.push(`Anchor "${a.id}" needs a title.`)
    if (!a.note?.trim()) problems.push(`Anchor "${a.id}" needs a beat note.`)
    if (!Array.isArray(a.advanceWhen) || a.advanceWhen.length === 0) {
      problems.push(`Anchor "${a.id}" has no advancement conditions — it could never advance.`)
      continue
    }
    for (const c of a.advanceWhen) {
      if (!c?.field) { problems.push(`A condition in "${a.id}" is missing its field.`); continue }
      const fed = arrayFields.has(c.field) || flagFields.has(c.field)
      if (!fed && !c.field.startsWith(ENDSTATE_FIELD_PREFIX)) {
        problems.push(
          `Anchor "${a.id}" checks "${c.field}", but no event ever sets it — that beat would soft-lock.`,
        )
      }
      if (c.op === 'count_gte' && !arrayFields.has(c.field) && !appendedEndStateFields.has(c.field)) {
        problems.push(`Anchor "${a.id}" uses count_gte on "${c.field}", which is not an array (token) field.`)
      }
      if (c.op === 'flag' && arrayFields.has(c.field) && !flagFields.has(c.field)) {
        problems.push(
          `Anchor "${a.id}" uses flag on "${c.field}", but every event feeding it pushes a token ` +
          `(array fold) — it can never equal true. That beat would soft-lock.`,
        )
      }
      if (c.op !== 'flag' && c.op !== 'count_gte') {
        problems.push(`Anchor "${a.id}" uses unknown condition op "${(c as Clause).op}".`)
      }
    }
  }

  // Validate final-chapter fields (sanity check #1: treat persisted data as untrusted).
  if (s.isFinal !== undefined && typeof s.isFinal !== 'boolean') {
    problems.push('"isFinal" must be a boolean if present.')
  }
  if (s.epilogue !== undefined && typeof s.epilogue !== 'string') {
    problems.push('"epilogue" must be a string if present.')
  }
  if (s.acknowledgment !== undefined && typeof s.acknowledgment !== 'string') {
    problems.push('"acknowledgment" must be a string if present.')
  }

  const op = s as { opening?: ChapterSpec['opening'] }
  if (!op.opening?.prose?.trim()) problems.push('The chapter needs an opening "prose".')
  if (!Array.isArray(op.opening?.actions) || op.opening!.actions.length === 0) {
    problems.push('The chapter needs at least one opening action.')
  }

  return problems
}

/**
 * Non-blocking authoring warnings (returned alongside — never instead of — the
 * blocking problems from validateChapterSpec). Currently one check: a `flag`
 * condition on an anchor is pre-satisfied if every event feeding its field belongs
 * to a strictly EARLIER anchor — scratch flags persist all chapter, so the gate is
 * an illusion (the upstream chapter2.ts `interacted_with_crew` bug).
 */
export function chapterSpecWarnings(spec: unknown): string[] {
  const warnings: string[] = []
  const s = spec as Partial<ChapterSpec>
  if (!Array.isArray(s?.anchors) || !Array.isArray(s?.events)) return warnings

  const anchorIndex = new Map<string, number>()
  s.anchors.forEach((a, i) => { if (a?.id) anchorIndex.set(a.id, i) })

  // field → indexes of the anchors whose events feed it
  const feedingAnchors = new Map<string, number[]>()
  for (const e of s.events) {
    if (!e?.fold?.field || !anchorIndex.has(e.anchor)) continue
    const list = feedingAnchors.get(e.fold.field) ?? []
    list.push(anchorIndex.get(e.anchor)!)
    feedingAnchors.set(e.fold.field, list)
  }

  for (const a of s.anchors) {
    if (!a?.id || !Array.isArray(a.advanceWhen)) continue
    const ai = anchorIndex.get(a.id)
    if (ai === undefined) continue
    for (const c of a.advanceWhen) {
      if (c?.op !== 'flag' || !c.field) continue
      const feeders = feedingAnchors.get(c.field)
      if (!feeders || feeders.length === 0) continue // "never set" is already a blocking problem
      if (feeders.every((fi) => fi < ai)) {
        warnings.push(
          `Anchor "${a.id}" gates on flag "${c.field}", but every event that sets it ` +
          `belongs to an earlier anchor — by the time "${a.id}" is active the flag is ` +
          `almost certainly already true, so this condition adds no real gate. ` +
          `Give this beat its own event/field if a real gate was intended.`,
        )
      }
    }
  }
  return warnings
}

export function gatherEndStateOps(
  specs: { number: number; endState?: EndStateOp[] }[],
  excludeNumber: number | undefined,
): Record<string, EndStateOp['op']> {
  const map: Record<string, EndStateOp['op']> = {}
  for (const s of specs) {
    if (s.number === excludeNumber) continue
    for (const op of asArray(s.endState)) map[(op as EndStateOp).field] = (op as EndStateOp).op
  }
  return map
}
