// Shared chapter/anchor resolution helpers. Reads a playthrough's wiki frontmatter and
// resolves it against the chapter registry (chapters/index.ts) for human-readable labels.
// Used by both index.ts (every state-shaped response) and store.ts (the saves list) — lives
// here, rather than in either, to avoid index.ts <-> store.ts importing each other.

import type { WikiMap } from './types.js'
import { getChapter, CHAPTER_END } from './chapters/index.js'

export function anchorOf(wiki: WikiMap): string {
  return String(wiki['world-state.md']?.frontmatter?.current_anchor ?? 'A1')
}

export function chapterNumOf(wiki: WikiMap): number {
  return Number(wiki['world-state.md']?.frontmatter?.current_chapter ?? 1)
}

// Human-readable chapter/beat labels for the client header (the engine owns the codes;
// the client just displays these). Bundled into every state-shaped response.
export function chapterMetaOf(wiki: WikiMap): { chapterNumber: number; chapterTitle: string; anchorTitle: string } {
  const ch = getChapter(chapterNumOf(wiki))
  const anchor = anchorOf(wiki)
  return {
    chapterNumber: ch.number,
    chapterTitle: ch.title,
    anchorTitle: anchor === CHAPTER_END ? 'Chapter complete' : (ch.anchorTitles[anchor] ?? anchor),
  }
}
