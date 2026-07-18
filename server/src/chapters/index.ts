// The chapter registry. The engine and routes call getChapter(current_chapter) to load the
// active chapter — they never import a specific chapter directly. Two sources feed it:
//   - BUILTINS: hand-written code chapter (1), authoritative for its number.
//   - Authored chapters (2+): ChapterSpec data persisted in the store, loaded at boot and
//     registered live by the authoring tool. Held in a synchronous cache so getChapter stays
//     a plain lookup (the engine calls it on the hot path).

import type { Chapter } from './types.js'
import type { ChapterSpec } from './defineChapter.js'
import { defineChapter } from './defineChapter.js'
import { CHAPTER_1 } from './chapter1.js'

// Built-in code chapters win for their numbers.
const BUILTINS: Record<number, Chapter> = { 1: CHAPTER_1 }
const cache = new Map<number, Chapter>(Object.entries(BUILTINS).map(([n, c]) => [Number(n), c]))

/** The active chapter for a number; falls back to Chapter 1 for unknown numbers. */
export function getChapter(n: number): Chapter {
  return cache.get(n) ?? CHAPTER_1
}

/** Whether a chapter with this number is registered (built-in or authored). */
export function hasChapter(n: number): boolean {
  return cache.has(n)
}

/** The highest registered chapter number (used to detect "end of story"). */
export function lastChapter(): number {
  return Math.max(...cache.keys())
}

/** Whether the story can advance past chapter `n`. False when n is a declared final
 *  chapter OR when chapter n+1 simply isn't registered yet. This is the single
 *  authority for hasNextChapter — the recap route reads it instead of inferring
 *  finality from a missing successor. */
export function canAdvanceFrom(n: number): boolean {
  return !getChapter(n).isFinal && hasChapter(n + 1)
}

/** Register (or replace) an authored chapter from its spec. Built-in numbers are protected. */
export function registerSpec(spec: ChapterSpec): void {
  if (spec.number in BUILTINS) {
    console.warn(`[chapters] ignoring authored chapter ${spec.number}: a built-in exists`)
    return
  }
  cache.set(spec.number, defineChapter(spec))
}

/** Drop an authored chapter from the live cache (built-ins can't be removed). */
export function unregisterChapter(n: number): void {
  if (!(n in BUILTINS)) cache.delete(n)
}

/** Load every persisted authored chapter into the cache. Call once at boot. */
export async function loadAuthoredChapters(store: {
  listChapterSpecs(): Promise<{ number: number; spec: ChapterSpec }[]>
}): Promise<number> {
  let count = 0
  for (const row of await store.listChapterSpecs()) {
    try {
      registerSpec(row.spec)
      count++
    } catch (e) {
      console.error(`[chapters] failed to load authored chapter ${row.number}:`, e)
    }
  }
  return count
}

export { CHAPTER_END } from './types.js'
