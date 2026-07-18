import { streamObject } from 'ai'
import { z } from 'zod'
import {
  getModel,
  buildModel,
  structuredOutputProviderOptions,
  needsSystemAsUserWorkaround,
  JSON_MODE_REMINDER,
} from './llm.js'
import { WORLD_BIBLE } from './worldBible.js'
import type { Chapter } from './chapters/types.js'
import { getChapter } from './chapters/index.js'
import { CHARACTERS } from './game/characters.js'
import { promptFlags } from './engine.js'
import { MAX_TURN_RETRIES, STREAM_TIMEOUT_MS, MODEL_WINDOW_TURNS } from './retry.js'
import type { WikiMap, WikiUpdate, Turn, FactAddition } from './types.js'

// The server now OWNS the wiki (Phase 2): it loads state for a playthrough, builds
// the prompt, calls the AI, then folds the result back in (see engine.ts). This file
// is just prompt assembly + the forced structured output.

export type PlayTurnRequest = {
  character: string
  wiki: WikiMap
  history: Turn[]
  playerInput: string
  // Phase 5 BYOK: if set, use these instead of the operator defaults.
  llm?: { provider: string; model: string; apiKey: string; baseUrl?: string }
}

function crewIdOf(character: string): string | null {
  return CHARACTERS[character as keyof typeof CHARACTERS]?.crewId ?? 'kaspen'
}

/** The active chapter module for a wiki, from its world-state.md current_chapter. */
function chapterOf(wiki: WikiMap): Chapter {
  return getChapter(Number(wiki['world-state.md']?.frontmatter?.current_chapter ?? 1))
}

function povFraming(character: string): string {
  const c = CHARACTERS[character as keyof typeof CHARACTERS] ?? CHARACTERS.kaspen
  const knows = c.knowsSecret
    ? 'They ALREADY privately know the secret of the Humming Spires.'
    : 'They do NOT yet know the secret of the Humming Spires.'
  const langGap = c.crewId === null
    ? `\nLANGUAGE BARRIER — this character is a modern human with NO shared language. On first contact, render crew speech as garbled, unintelligible sounds. Gnomish script is unreadable marks. A crew member must cast TRUE TRANSLATION (a spell — see the magic system) on them before speech and script become clear. Stage this handshake; do not skip it. After translation, everything is clear for the rest of the game.`
    : ''
  return `POV — THE PLAYER'S CHARACTER
The player inhabits ${c.povLabel}. ${knows}${langGap}
Never voice, decide for, or narrate this character's words, actions, or inner choices —
that is the player's alone. You voice every OTHER character and the world. When a beat
scripts this character as the actor, hand the moment to the player.`
}

// Internal engine bookkeeping the AI shouldn't see / fuss over.
const HIDDEN_FIELDS = new Set([
  'pending_transition',
  'turns_since_progress',
  'last_actions',
  'chapter_history_start',
])

function renderWiki(wiki: WikiMap): string {
  const parts: string[] = []
  for (const [name, file] of Object.entries(wiki ?? {})) {
    if (name === 'recap.md' || name === 'recap-history.md') continue // meta, never part of the game prompt

    const fm = file.frontmatter ?? {}
    const entries = Object.entries(fm).filter(([k]) => !HIDDEN_FIELDS.has(k) && k !== 'facts')
    const fmBlock = entries.length
      ? '---\n' + entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n') + '\n---\n'
      : ''
    const facts = Array.isArray(fm.facts) ? (fm.facts as string[]) : []
    const factsBlock = facts.length
      ? 'Known facts:\n' + facts.map((f) => `- ${f}`).join('\n') + '\n'
      : ''
    parts.push(`### ${name}\n${fmBlock}${factsBlock}${file.body ?? ''}`.trim())
  }
  return parts.join('\n\n')
}

type PromptFlags = ReturnType<typeof promptFlags>

// The stable part of the system prompt — world bible, chapter fragment, active-anchor
// notes, POV framing. Unchanged for an entire beat (anchor notes only shift at a
// transition or soft-lock nudge), unlike the wiki state below. Sent as its own
// cache_control-marked message (see streamPlayTurn) so it keeps getting cache reads
// across turns instead of being rewritten whenever the wiki state changes.
function buildStableSystemPrompt(character: string, wiki: WikiMap, flags: PromptFlags): string {
  const ch = chapterOf(wiki)
  return [
    WORLD_BIBLE,
    ch.fragment,
    ch.activeAnchorSection(flags.anchor, { justAdvanced: flags.justAdvanced, nudge: flags.nudge }),
    povFraming(character),
  ].join('\n\n')
}

// The volatile tail — live wiki state (trust scores, zones visited, etc.), which can
// change on every turn. Kept OUT of the stable message above and sent uncached: it's
// small relative to the world bible/chapter fragment, and caching it would never hit
// anyway given how often it changes.
function volatileSystemPrompt(wiki: WikiMap): string {
  return (
    'CURRENT WIKI STATE (the live game state for this playthrough — read it, honor it):\n' +
    renderWiki(wiki)
  )
}

// A scene direction delivered as the LAST message (strongest steering weight) when the
// engine needs the beat to move. The system-prompt beat notes give the detail; this
// makes the model act on it now even when the player's own line points elsewhere.
function sceneDirection(flags: PromptFlags): string | null {
  if (flags.justAdvanced) {
    return `[SCENE DIRECTION — this is not spoken by the player. The story has just reached a new beat (see the ACTIVE ANCHOR in your instructions). Briefly carry the player's last action, then make THIS beat's defining/inciting event happen now, as the main event of your reply. It intrudes on its own — do not wait for the player to seek it, and do not linger in the previous beat's mood.]`
  }
  if (flags.nudge) {
    return `[SCENE DIRECTION — this is not spoken by the player. The scene has lingered. Give the player a natural, in-world opening to: ${flags.nudge}. Let a character or the world invite it; do not railroad or state it as a goal.]`
  }
  return null
}

// The forced structured shape — Game Plan §4's submit_turn, via the AI SDK's object
// mode. NOTE: no minItems/maxItems here — Anthropic's structured-output mode rejects
// array bounds other than 0/1. We require "3–4" via the description and clamp in code.
function buildSchema(character: string, ch: Chapter, anchor: string) {
  const events = ch.allowedEvents(crewIdOf(character), anchor) as [string, ...string[]]
  return z.object({
    narrative: z
      .string()
      .describe('The prose shown to the player this turn (immersive second person).'),
    suggested_actions: z
      .array(z.string())
      .describe('EXACTLY 3 to 4 short suggested next actions for the player. Never fewer than 3, never more than 4.'),
    events: z
      .array(z.enum(events))
      .describe('What happened this turn, from the allowed list ONLY. Empty array if nothing applies.'),
    wiki_updates: z
      .array(
        z.object({
          file: z.string(),
          field: z.string(),
          value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]),
        }),
      )
      .describe('Small scalar state changes. Empty array if nothing changed.'),
    fact_additions: z
      .array(z.object({ file: z.string(), text: z.string() }))
      .describe(
        'New durable facts worth remembering about a file — short (<=30 words), specific, ' +
          'non-redundant. Use for backstory, motivations, or notable past events that should ' +
          'persist (e.g. why a character did something, how a choice was made). Do NOT use ' +
          'for simple flags/numbers/state — use wiki_updates for those. Empty array if nothing new.',
      ),
  })
}

// Context Bounding Upgrade §3.1 — the MODEL's view of the conversation, bounded to the
// current chapter's tail. `history` itself (persisted + returned to the client) stays
// full; this only shapes what gets sent to the LLM. Earlier chapters are carried via
// chapter-log.md (§3.2, injected through renderWiki), not raw turns, so this stays flat
// regardless of how long the chapter or the overall save runs.
export function buildModelMessages(
  history: Turn[],
  wiki: WikiMap,
): { role: 'user' | 'assistant'; content: string }[] {
  const start = Number(wiki['world-state.md']?.frontmatter?.chapter_history_start ?? 0)
  const thisChapter = history.slice(Math.max(0, start))
  const windowed = thisChapter.slice(-MODEL_WINDOW_TURNS * 2)
  return windowed.map((t) => ({
    role: t.role === 'player' ? ('user' as const) : ('assistant' as const),
    content: t.content,
  }))
}

// Stream the turn: the narrative streams to the client as it's generated; the
// structured fields finish at the end of the same generation.
//
// `onError` captures the AI SDK's error channel. Provider/transport failures
// (bad key, timeout, 5xx) are delivered HERE, not by throwing from
// `partialObjectStream` — without this they'd be swallowed and we'd commit a
// blank turn. See the caller in index.ts, which throws on a captured error.
export function streamPlayTurn(req: PlayTurnRequest, onError?: (error: unknown) => void) {
  const flags = promptFlags(req.wiki)
  const schema = buildSchema(req.character, chapterOf(req.wiki), flags.anchor)
  const messages = [
    ...buildModelMessages(req.history ?? [], req.wiki),
    { role: 'user' as const, content: req.playerInput },
  ]
  // When the engine needs the beat to move, append the scene direction LAST.
  const direction = sceneDirection(flags)
  if (direction) messages.push({ role: 'user' as const, content: direction })

  const model = req.llm
    ? buildModel(req.llm.provider, req.llm.model, req.llm.apiKey, req.llm.baseUrl)
    : getModel()

  // Two system messages, not one: a stable, cache_control-marked prefix and an
  // uncached volatile tail. Anthropic prompt caching matches on exact block content,
  // so when the wiki state lived in the SAME string as the world bible/chapter
  // fragment, any wiki edit (which happens almost every turn) invalidated the whole
  // block and forced a full rewrite — even though the bulk of it (world bible +
  // chapter fragment) hadn't changed. Splitting them into separate blocks lets the
  // stable one keep getting cache reads while only the small volatile one gets
  // rewritten each turn. See @openrouter/ai-sdk-provider's README "Anthropic Prompt
  // Caching" section for the providerOptions.openrouter.cacheControl pattern.
  const systemBlocks = [
    {
      role: 'system' as const,
      content: buildStableSystemPrompt(req.character, req.wiki, flags),
      providerOptions: { openrouter: { cacheControl: { type: 'ephemeral', ttl: '1h' } } },
    },
    {
      role: 'system' as const,
      content: volatileSystemPrompt(req.wiki),
    },
  ]
  // See llm.ts's needsSystemAsUserWorkaround — direct/BYOK providers outside
  // OpenRouter get the system role silently rewritten to "developer" by the AI
  // SDK, which they reject. Fold it into a leading user message instead.
  const foldSystem = needsSystemAsUserWorkaround(req.llm?.provider)

  return streamObject({
    model,
    schema,
    providerOptions: structuredOutputProviderOptions(req.llm?.provider),
    system: foldSystem ? undefined : systemBlocks,
    messages: foldSystem
      ? [
          {
            role: 'user' as const,
            content: `${systemBlocks.map((b) => b.content).join('\n\n')}\n\n${JSON_MODE_REMINDER}`,
          },
          ...messages,
        ]
      : messages,
    maxOutputTokens: 1200,
    // Phase 6 resilience: explicit retry count for transient provider errors
    // (rate limits / "overloaded"), and a hard timeout so a hung provider fails
    // cleanly instead of hanging the turn forever.
    maxRetries: MAX_TURN_RETRIES,
    abortSignal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
    onError: ({ error }) => onError?.(error),
  })
}

export type FinalStructured = {
  suggested_actions: string[]
  events: string[]
  wiki_updates: WikiUpdate[]
  fact_additions: FactAddition[]
}

// Last-resort suggestions when the model returns none and no previous turn exists.
const GENERIC_FALLBACK_ACTIONS = [
  'Look around and take in your surroundings.',
  'Talk to someone nearby.',
  'Consider your next move carefully.',
]

// Defensively coerce the final (possibly schema-loose) object into clean fields:
// at most 4 actions, events filtered to this character's allowed set, well-formed
// wiki_updates only. Avoids a late validation throw killing the turn.
export function finalizeStructured(
  character: string,
  ch: Chapter,
  anchor: string,
  obj: unknown,
  previousActions?: string[],
): FinalStructured {
  const o = (obj ?? {}) as Record<string, unknown>
  const allowed = new Set(ch.allowedEvents(crewIdOf(character), anchor))

  const rawActions = Array.isArray(o.suggested_actions)
    ? (o.suggested_actions.filter((s) => typeof s === 'string') as string[]).slice(0, 4)
    : []
  // The schema asks for 3–4 in prose only; if the model returned zero, fall back to
  // the previous turn's actions (still in world-state until this turn overwrites
  // them), or a generic set on turn 1.
  const suggested_actions = rawActions.length > 0
    ? rawActions
    : (previousActions?.length ? previousActions.slice(0, 4) : GENERIC_FALLBACK_ACTIONS)
  const events = Array.isArray(o.events)
    ? (o.events.filter((e) => typeof e === 'string' && allowed.has(e)) as string[])
    : []
  const wiki_updates = Array.isArray(o.wiki_updates)
    ? (o.wiki_updates.filter(
        (u): u is WikiUpdate =>
          !!u && typeof (u as WikiUpdate).file === 'string' && typeof (u as WikiUpdate).field === 'string',
      ) as WikiUpdate[])
    : []
  const fact_additions = Array.isArray(o.fact_additions)
    ? (o.fact_additions.filter(
        (f): f is FactAddition =>
          !!f && typeof (f as FactAddition).file === 'string' && typeof (f as FactAddition).text === 'string',
      ) as FactAddition[])
    : []

  return { suggested_actions, events, wiki_updates, fact_additions }
}
