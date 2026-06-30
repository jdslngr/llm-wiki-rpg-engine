// Cheap save-migration insurance: when a playthrough loads, seed any of the ACTIVE
// chapter's scratch condition fields that are missing from world-state.md (e.g. an old
// save made before a field was added, or before the multi-chapter upgrade). Never
// overwrites existing values, so it can't corrupt in-progress state. Returns the same
// object if nothing was missing.

import type { WikiMap } from './types.js'
import { getChapter } from './chapters/index.js'

export function migrateWiki(wiki: WikiMap): WikiMap {
  const ws = wiki['world-state.md']
  if (!ws) return wiki
  const fm = ws.frontmatter ?? {}
  const seed = getChapter(Number(fm.current_chapter ?? 1)).scratchSeed()

  let changed = false
  const nextFm: Record<string, unknown> = { ...fm }
  for (const [key, value] of Object.entries(seed)) {
    if (!(key in nextFm)) {
      nextFm[key] = value
      changed = true
    }
  }
  if (!changed) return wiki
  return { ...wiki, 'world-state.md': { ...ws, frontmatter: nextFm } }
}
