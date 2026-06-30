// Chapter-end consolidation: turn a completed playthrough at CHAPTER_END into a fresh
// start of the next chapter. The rule (Multi-Chapter Upgrade §3.5):
//   - run the OUTGOING chapter's durable end-state writes (semantic flags, threads),
//   - DROP the outgoing chapter's scratch condition fields (so they don't accrete),
//   - KEEP everything else (relationship files, durable world-state, open threads),
//   - point the engine fields at the INCOMING chapter and seed its scratch fields.
// Pure: returns a new wiki, leaves the input untouched.

import type { WikiMap } from './types.js'
import { getChapter } from './chapters/index.js'

export function consolidate(wiki: WikiMap, fromN: number, toN: number): WikiMap {
  const next: WikiMap = structuredClone(wiki)
  const from = getChapter(fromN)
  const to = getChapter(toN)

  // 1) Durable end-of-chapter writes (semantic state, thread flags) onto the new wiki.
  from.endState?.(next)

  const ws = (next['world-state.md'] ??= { frontmatter: {}, body: '' })
  const fm: Record<string, unknown> = { ...(ws.frontmatter ?? {}) }

  // 2) Remove the outgoing chapter's scratch fields so they don't pile up chapter to chapter.
  for (const key of Object.keys(from.scratchSeed())) delete fm[key]

  // 3) Point the engine fields at the incoming chapter.
  fm.current_chapter = toN
  fm.current_anchor = to.firstAnchor
  fm.turns_since_progress = 0
  delete fm.pending_transition

  // 4) Seed the incoming chapter's scratch condition fields.
  Object.assign(fm, to.scratchSeed())

  ws.frontmatter = fm

  // 5) Drop the previous chapter's cached recap so the next chapter regenerates its own.
  delete next['recap.md']

  // 6) Facts already had their one chance to be folded into this chapter's recap prose
  //    (recap.ts's generateRecapProse, called before this function — see index.ts's
  //    /api/next-chapter) and are about to be durably captured in chapter-log.md
  //    (appendChapterLog, called right after this function returns). Clear the live
  //    per-file lists so the next chapter starts with the full 8-slot allowance instead of
  //    inheriting whatever FIFO hadn't evicted yet (§3.2's WIKI_FACTS_FOLD_UPGRADE design).
  for (const file of Object.values(next)) {
    if (file.frontmatter && 'facts' in file.frontmatter) {
      file.frontmatter = { ...file.frontmatter, facts: [] }
    }
  }

  return next
}

// Context Bounding Upgrade §3.2 — the running episodic summary. renderWiki (playTurn.ts)
// injects every wiki file except recap.md into the prompt, so this is automatically
// carried forward cheaply once a chapter's raw turns fall outside the model's window.
// Keep entries short; this is a summary, not a transcript. Pure: returns a new wiki.
const CHAPTER_LOG_FILE = 'chapter-log.md'

export function appendChapterLog(
  wiki: WikiMap,
  chapterNumber: number,
  chapterTitle: string,
  prose: string,
): WikiMap {
  const next: WikiMap = structuredClone(wiki)
  const existingBody = next[CHAPTER_LOG_FILE]?.body ?? ''
  const entry = `## Chapter ${chapterNumber}: ${chapterTitle}\n${prose.trim()}`
  next[CHAPTER_LOG_FILE] = {
    frontmatter: {},
    body: existingBody ? `${existingBody}\n\n${entry}` : entry,
  }
  return next
}
