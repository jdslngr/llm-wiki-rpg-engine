// Phase 6 — the chapter-end recap (hybrid: engine facts + one AI prose call).
//
// Chapter 1 is linear: reaching CHAPTER_END means all six beats were completed,
// so the "hard facts" are fully derivable from the final wiki — no running log
// needed yet. The AI then weaves those facts (plus the player's own actions) into
// a short, warm narrative summary. When a branching chapter exists, add a running
// decisions-log then.

import { generateObject } from 'ai'
import { z } from 'zod'
import { getModel, buildModel } from './llm.js'
import { getChapter } from './chapters/index.js'
import { CHARACTERS, type PlayableId } from './game/characters.js'
import type { WikiMap, Turn } from './types.js'

export type RecapCrew = { id: string; name: string; trust: number; arc: string }

export type RecapFacts = {
  chapterNumber: number
  chapterTitle: string
  characterName: string
  characterRole: string
  isVisitor: boolean
  beats: { id: string; title: string }[]
  crew: RecapCrew[]
  journey: {
    zonesVisited: string[]
    crewSpoken: string[]
    shipAreasExplored: string[]
    petInteracted: boolean
  }
  turnCount: number
  /** Every wiki file's live `facts` array (WIKI_FACTS_UPGRADE.md §3.1) at the moment the
   *  chapter ended, snapshotted here so generateRecapProse can fold anything durable into
   *  the permanent recap before consolidate() clears the live arrays (§3.3). Omits files
   *  with no facts. Optional, not required: `buildRecapFacts()` below always sets it, but
   *  marking it optional costs nothing and protects any future code that constructs a
   *  partial `RecapFacts` — checked both `client/src` and `server/src` for existing
   *  hand-built literals of this shape before writing this spec; there are none today, but
   *  optional is the safer default regardless. */
  notableFacts?: { file: string; facts: string[] }[]
}

const arr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** Compute the hard facts of a completed playthrough from its final wiki. */
export function buildRecapFacts(character: PlayableId, wiki: WikiMap, history: Turn[]): RecapFacts {
  const ws = wiki['world-state.md']?.frontmatter ?? {}
  const pc = wiki['player-character.md']?.frontmatter ?? {}
  const def = CHARACTERS[character] ?? CHARACTERS.kaspen
  const ch = getChapter(Number(ws.current_chapter ?? 1))

  // Final relationship state for each OTHER crew member present in the wiki.
  const crew: RecapCrew[] = []
  for (const id of ['kaspen', 'kaelen', 'pan', 'tariel', 'rulan'] as const) {
    const fm = wiki[`${id}.md`]?.frontmatter
    if (!fm) continue
    crew.push({
      id,
      name: String(fm.name ?? CHARACTERS[id]?.name ?? id),
      trust: typeof fm.trust_score === 'number' ? fm.trust_score : 0,
      arc: String(fm.arc_status ?? 'open'),
    })
  }

  // Snapshot every file's live `facts` array before consolidate() clears it (§3.3) — this
  // is its only chance to survive past this chapter (WIKI_FACTS_UPGRADE.md §3.1's FIFO cap).
  const notableFacts: { file: string; facts: string[] }[] = []
  for (const [name, file] of Object.entries(wiki)) {
    const fl = arr(file.frontmatter?.facts)
    if (fl.length) notableFacts.push({ file: name, facts: fl })
  }

  return {
    chapterNumber: ch.number,
    chapterTitle: ch.title,
    characterName: String(pc.name ?? def.name),
    characterRole: String(pc.role ?? def.role),
    isVisitor: def.crewId === null,
    beats: ch.anchorOrder.map((a) => ({ id: a, title: ch.anchorTitles[a] })),
    crew,
    journey: {
      zonesVisited: arr(ws.zones_visited),
      crewSpoken: arr(ws.crew_spoken),
      shipAreasExplored: arr(ws.ship_areas_explored),
      petInteracted: ws.pet_interacted === true,
    },
    turnCount: history.filter((t) => t.role === 'player').length,
    notableFacts,
  }
}

const recapSchema = z.object({
  title: z.string().describe('A short, evocative title for this player\'s journey (3–6 words).'),
  prose: z
    .string()
    .describe(
      'A warm, second-person recap of the player\'s Chapter 1 journey: 2–3 short paragraphs, roughly 120–180 words.',
    ),
})

export type RecapProse = z.infer<typeof recapSchema>

/** Pure: turns a facts snapshot into a prompt block, or '' if there's nothing to fold forward.
 *  Exported so verify-facts-recap.ts can check its shape without hitting the network. Param
 *  destructures to `fileFacts` (not `facts`) deliberately — this file already uses `facts` as
 *  the conventional name for a whole `RecapFacts` struct (see generateRecapProse's own
 *  parameter); reusing it here for one file's `string[]` would read as a different thing with
 *  the same name two lines apart. */
export function buildNotableFactsBlock(notableFacts: { file: string; facts: string[] }[]): string {
  if (!notableFacts.length) return ''
  const lists = notableFacts
    .map(({ file, facts: fileFacts }) => `${file}:\n${fileFacts.map((f) => `- ${f}`).join('\n')}`)
    .join('\n\n')
  return (
    `\n\nNotable facts recorded this chapter (each file's memory list, about to be cleared ` +
    `to make room for the next chapter — weave in anything still worth remembering long-term; ` +
    `fine to leave out anything trivial or already covered above):\n${lists}`
  )
}

/** One AI call: turn the facts + the player's own actions into a warm recap. */
export async function generateRecapProse(
  facts: RecapFacts,
  playerActions: string[],
  llm?: { provider: string; model: string; apiKey: string; baseUrl?: string },
): Promise<RecapProse> {
  const model = llm ? buildModel(llm.provider, llm.model, llm.apiKey, llm.baseUrl) : getModel()

  const who = facts.isVisitor
    ? `${facts.characterName}, a modern human transported into 100,000 BCE`
    : `${facts.characterName}, ${facts.characterRole}`

  const trustLine = facts.crew
    .map((c) => `${c.name} (trust ${c.trust}/100)`)
    .join(', ')

  const actionsList = playerActions.length
    ? playerActions.map((a) => `- ${a}`).join('\n')
    : '(few explicit actions recorded)'

  const prompt = `Write a recap of a player's completed Chapter ${facts.chapterNumber} of a cozy-fantasy
text RPG, "Archipelago Lighthouse." The chapter is titled "${facts.chapterTitle}".

The player played as ${who}.

The chapter's beats (all completed): ${facts.beats.map((b) => b.title).join(' → ')}.

Final bonds with the crew: ${trustLine || 'unknown'}.

The player's own actions along the way:
${actionsList}${buildNotableFactsBlock(facts.notableFacts ?? [])}

Write a warm, reflective, second-person recap ("You woke to a lighthouse morning…").
2–3 short paragraphs, ~120–180 words. Celebrate THIS player's particular journey and the
bonds they formed, folding forward anything from the notable facts above that deserves to
be remembered. Keep the tone cozy and a little wistful (it is a long goodbye). Do NOT invent
plot that didn't happen, do NOT explain the secret beyond what the vow revealed, and do NOT
foreshadow specific future chapters. Also give a short evocative title.`

  const { object } = await generateObject({
    model,
    schema: recapSchema,
    prompt,
    maxOutputTokens: 500,
  })
  return object
}
