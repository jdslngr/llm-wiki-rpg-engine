// The authoring tool's AI step: expand a short author BRIEF (beats + plain-language
// conditions) into a full, structured ChapterSpec the engine can run. The model only ever
// produces DATA (forced to the schema); validateChapterSpec is the backstop, and nothing is
// written to disk until the author approves and the spec validates.

import { generateObject } from 'ai'
import { z } from 'zod'
import {
  getModel,
  structuredOutputProviderOptions,
  needsSystemAsUserWorkaround,
  JSON_MODE_REMINDER,
} from './llm.js'
import { WORLD_BIBLE } from './worldBible.js'
import type { ChapterSpec, EndStateOp } from './chapters/defineChapter.js'

export type ChapterBrief = {
  number: number
  title: string
  beats: { title: string; whatHappens: string; conditionPlain: string }[]
  guardrails?: string
  openingHint?: string
  /** Optional free-text revision notes when re-expanding a previous draft. */
  notes?: string
}

// Structured shape the model must answer in.
// Array .min() constraints are safe here: the AI SDK's generateObject sends these as
// JSON Schema via tool calling (OpenAI-compatible path), not as Anthropic native
// structured output. The Anthropic restriction on array bounds only applies to the
// native structured-output endpoint, which this call doesn't hit.
const zClause = z.object({
  field: z.string().describe('a world-state field name, snake_case'),
  op: z.enum(['flag', 'count_gte']).describe("'flag' = field is true; 'count_gte' = array has >= value entries"),
  value: z.number().optional().describe('required for count_gte: the minimum count'),
  hint: z.string().optional().describe('a short plain-language nudge shown if this is what still blocks the beat'),
})
const zEndStateOp = z.object({
  field: z.string().describe('a world-state field name, must start with "chapterend_"'),
  op: z.enum(['set', 'append']).describe("'set' = overwrite the field; 'append' = push onto an array"),
  value: z.union([z.string(), z.number(), z.boolean()]).describe('the value to set or append'),
})

const zEvent = z.object({
  token: z.string().describe('snake_case event the AI may report, e.g. entered_workshop'),
  anchor: z.string().describe('the anchor id this event belongs to'),
  fold: z.object({
    field: z.string().describe('the world-state field this event updates'),
    token: z.string().optional().describe(
      'present => push this string onto an array field (dedup); absent => set the field true. ' +
      'For a flag-type event, OMIT this key entirely — do NOT send an empty string ("").',
    ),
  }),
})
const zAnchor = z.object({
  id: z.string().describe('short id like A1, B2'),
  title: z.string().describe('short human title for the beat'),
  note: z.string().describe("director's note: what the AI should make happen while this beat is active"),
  advanceWhen: z.array(zClause).min(1).describe('the conditions that, all together, advance to the next beat'),
})
const zSpec = z.object({
  number: z.number(),
  title: z.string(),
  fragment: z.string().describe('the fixed chapter overview + guardrails block, appended to the world bible'),
  anchors: z.array(zAnchor).min(1).describe('the beats in play order — MUST have at least 1 anchor'),
  events: z.array(zEvent).min(1).describe('the closed vocabulary of events the narrator may report — MUST have at least 1 event'),
  opening: z.object({
    prose: z.string().describe('verbatim turn-0 opening prose, immersive second person'),
    actions: z.array(z.string()).min(1).describe('3 to 4 short starter actions'),
  }),
  softLockThreshold: z.number().int().min(1).max(20).optional().describe(
    'turns without progress before the engine nudges the player (default 5; lower = faster nudge, higher = more patient)',
  ),
  endState: z.array(zEndStateOp).optional().describe(
    'durable facts written into the wiki when this chapter ends (outlive this chapter). ' +
    'Use to establish permanent world changes: set a flag for something irreversible, ' +
    'or append to a list that accumulates across chapters. ' +
    'Contrast with fact_additions (freeform per-turn prose). ' +
    'Each field MUST start with "chapterend_". Never use "set" and "append" on the same field in one chapter — pick one per field.',
  ),
})

const RULES = `You are designing a chapter for "Archipelago Lighthouse", an AI-narrated text RPG. Output a
ChapterSpec as structured data. The engine — not the AI narrator — decides progression by folding
reported EVENTS into world-state fields and advancing a beat when its conditions are met. Follow
these rules exactly:

- EVENTS are a small closed vocabulary of snake_case tokens the narrator may report (e.g.
  entered_workshop, spoke_to_pan, found_clue). Each event FOLDS into one world-state field:
  with a fold.token => it pushes that token onto an array field (collect a set); without a
  token => it sets a boolean field true (something happened at least once). For a flag-type
  event, OMIT fold.token entirely — never send an empty string. An empty string is treated
  as a real (if blank) token, turning the field into an array that a 'flag' condition can
  never satisfy, which soft-locks the beat.
- CONDITIONS (advanceWhen) may ONLY read fields that some event folds into. Two ops:
  'flag' (field === true) and 'count_gte' (array length >= value). count_gte may ONLY be used
  on array fields (fields fed by a token-bearing fold). Every beat needs at least one condition.
- THE GOLDEN RULE: every field a condition reads must be set by some event; every event must
  belong to a real anchor. If a condition reads a field no event feeds, the beat can never
  advance. Keep events ⇄ folds ⇄ conditions perfectly consistent.
- Give each blocking clause a short 'hint' (used to gently steer a stalled player).
- BEAT NOTES are director's guidance (mood, who's present, the inciting event) — not verbatim prose.
  Always name the current location, even if unchanged from the previous beat. Always make clear
  that later beats' content has NOT happened yet — the narrator must not resolve a future beat's
  events, locations, or decisions early just because the fragment previews where the arc is headed.
- FRAGMENT is a short chapter overview plus this chapter's "never do" guardrails. Keep it to the
  overall shape and stakes — don't spell out each beat's concrete events so plainly that the
  narrator could mistake the arc summary for things already in progress.
- FRAGMENT must end with this exact closing block, verbatim (only reword the bracketed part with
  this chapter's own event examples — the rest of the wording must not change):
  "EVENTS — report an event ONLY if it is literally and explicitly depicted in the narrative text
  you just wrote THIS turn, choosing ONLY from the allowed list provided to you. If you are not
  certain the event is clearly shown in what you wrote, leave it out — a missed event costs
  nothing, but a false one silently corrupts the story's state and can advance the chapter before
  its beat actually happened. [1-3 short chapter-specific examples in the same style as: the
  player goes down to the workshop -> entered_workshop]. Emit nothing for a turn where none of the
  allowed events occurred (an empty events array is correct and expected — this is the common
  case, not an exception). Never invent tokens outside the list, and never report an event as a
  shortcut to move the story along faster.

  WIKI_UPDATES — do NOT write the chapter's progress/condition fields (the engine derives those
  from your events). Use wiki_updates ONLY for other durable changes — e.g. a relationship note or
  trust shift on a crew member's file. When nothing else changed, return an empty array."
- OPENING is verbatim turn-0 prose in immersive second person, plus 3 to 4 starter actions.
- softLockThreshold is how many turns without progress before the engine gives the narrator
  a gentle steer (1–20, default 5). Pick lower for tight/tense beats, higher for slow exploration.
- Use anchor ids that sort in play order (e.g. ${''}A1, A2 … or B1, B2 …).
- ENDSTATE (optional): durable, structured facts written into the wiki when this chapter ends.
  They outlive the chapter — unlike scratch fields, which are deleted on chapter transition.
  Use 'set' to store a permanent flag/value (e.g. a character died, a location was destroyed);
  use 'append' to add to a list that accumulates across chapters (e.g. seeded spires across
  multiple chapters). Never use both 'set' and 'append' on the same field in one chapter's
  endState — pick one per field. Every endState field name MUST start with "chapterend_".
  No event's fold field may ever start with "chapterend_".
- Keep it tight: usually 3 to 6 beats. Honor the author's intent; expand, don't replace it.`


function briefText(b: ChapterBrief): string {
  const beats = b.beats
    .map((x, i) => `${i + 1}. ${x.title}\n   What happens: ${x.whatHappens}\n   Advances when: ${x.conditionPlain}`)
    .join('\n')
  return [
    `CHAPTER NUMBER: ${b.number}`,
    `CHAPTER TITLE: ${b.title}`,
    `BEATS (in order):\n${beats}`,
    b.guardrails ? `GUARDRAILS / NEVER-DO: ${b.guardrails}` : '',
    b.openingHint ? `OPENING DIRECTION: ${b.openingHint}` : '',
    b.notes ? `REVISION NOTES (apply these to your previous draft): ${b.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Call the model to expand a brief into a structured ChapterSpec draft. */
export async function expandChapterSpec(
  brief: ChapterBrief,
  existingEndState?: Record<string, EndStateOp['op']>,
): Promise<ChapterSpec> {
  const systemText = `${WORLD_BIBLE}\n\n${RULES}`
  const existingBlock =
    existingEndState && Object.keys(existingEndState).length > 0
      ? `\n\nEXISTING END-STATE FACTS (from other chapters — reuse the exact name and op if this chapter continues one of these; otherwise invent a new, different name):\n` +
        Object.entries(existingEndState)
          .map(([field, op]) => `  ${field} (${op})`)
          .join('\n')
      : ''
  const promptText = `Expand this author brief into a complete ChapterSpec.\n\n${briefText(brief)}${existingBlock}`
  // See llm.ts's needsSystemAsUserWorkaround — direct/BYOK providers outside
  // OpenRouter get the system role silently rewritten to "developer" by the AI
  // SDK, which they reject. Fold it into the prompt instead.
  const foldSystem = needsSystemAsUserWorkaround()

  const { object } = await generateObject({
    model: getModel(),
    schema: zSpec,
    providerOptions: structuredOutputProviderOptions(),
    system: foldSystem ? undefined : systemText,
    prompt: foldSystem ? `${systemText}\n\n${JSON_MODE_REMINDER}\n\n${promptText}` : promptText,
    maxOutputTokens: 32000,
    maxRetries: 3,
  })
  // Force the chapter number to the author's choice regardless of what the model echoed.
  return { ...(object as ChapterSpec), number: brief.number }
}
