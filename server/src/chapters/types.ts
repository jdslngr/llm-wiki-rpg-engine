// The shared shape every chapter implements (Multi-Chapter Upgrade §3.1). The generic
// engine (engine.ts, playTurn.ts, recap.ts) reads ONLY this interface via the registry
// (chapters/index.ts), so adding a chapter is writing a new data module — not editing the
// engine. Chapter 1 (chapter1.ts) is the first implementation.

import type { WikiMap } from '../types.js'

// A single fold rule: present `token` => push onto an array field (dedup'd);
// absent => set a boolean field true. (Mirrors the engine's foldEvents.)
export type Fold = { field: string; token?: string }

// Loose frontmatter bag (world-state.md's frontmatter, as the conditions see it).
export type Fm = Record<string, unknown>

// The sentinel anchor meaning "this chapter is over." Single shared constant — NOT
// per-chapter — so the engine and routes compare against one value.
export const CHAPTER_END = 'END'

export interface Chapter {
  number: number
  title: string
  firstAnchor: string                         // e.g. 'A1'
  anchorOrder: readonly string[]
  anchorTitles: Record<string, string>
  events: readonly string[]
  foldMap: Record<string, Fold>
  engineOwnedFields: Set<string>              // fields the AI's wiki_updates may not write
  fragment: string                            // the fixed chapter overview + guardrails block
  beatNotes: Record<string, string>
  softLockThreshold: number                   // turns without progress before a nudge fires

  /** Events the AI may emit this turn (drops the player's own spoke_to_self; withholds
   *  events scoped to a LATER anchor than `anchor`). */
  allowedEvents(crewId: string | null, anchor: string): string[]
  /** True if `anchor`'s advancement conditions are satisfied by the current frontmatter. */
  anchorConditionsMet(anchor: string, fm: Fm): boolean
  /** The anchor following `anchor`, or CHAPTER_END after the last. */
  nextAnchor(anchor: string): string
  /** A short human hint about what still has to happen for `anchor` to advance. */
  unmetHint(anchor: string, fm: Fm): string
  /** The ACTIVE-anchor prompt block injected each turn. */
  activeAnchorSection(anchor: string, opts: { justAdvanced?: boolean; nudge?: string }): string

  /** This chapter's scratch condition fields, seeded at chapter start (arrays [], flags false). */
  scratchSeed(): Record<string, unknown>
  /** Verbatim turn-0 opening for this chapter, per character. */
  openingFor(characterId: string): { prose: string; actions: string[] }
  /** Optional: durable writes to apply when this chapter ENDS (semantic state, thread flags). */
  endState?: (wiki: WikiMap) => void

  /** Author-declared final chapter — this is the deliberate ending of the story
   *  (default false; a missing successor alone is not an ending). */
  isFinal: boolean
  /** Optional author-written closing prose, shown on the recap screen only when
   *  isFinal and non-empty. Independent of acknowledgment. */
  epilogue?: string
  /** Optional author-written thank-you / credits text, shown on the recap screen
   *  only when isFinal and non-empty. Independent of epilogue. */
  acknowledgment?: string
}
