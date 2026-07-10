// Smoke test for BUG_AUDIT §1.1: PgStore.save must DELETE wiki files that the new map
// no longer contains (e.g. recap.md dropped at a chapter transition), matching MemStore
// which replaces the whole map. Regression guard for the "stale recap resurrects" bug.
//
// Run:  DATABASE_URL=postgres://user:pass@host:5432/db npx tsx src/verify-store-deletion.ts
// Requires a reachable Postgres. Creates ONE throwaway playthrough (random UUID, null
// user) and deletes it in a finally block, so it never touches real saves.

import 'dotenv/config'
import pg from 'pg'
import { createStore } from './store.js'
import type { WikiMap } from './types.js'

const fail = (msg: string) => { console.error(`FAIL: ${msg}`); process.exit(1) }

const store = await createStore()
if (store.kind !== 'postgres') {
  fail('No Postgres — set DATABASE_URL to a reachable database to run this check.')
}

const withRecap: WikiMap = {
  'world-state.md': { frontmatter: { current_chapter: 1 }, body: 'ws' },
  'recap.md': { frontmatter: { title: 'Old recap' }, body: 'stale prose' },
}
const withoutRecap: WikiMap = {
  'world-state.md': { frontmatter: { current_chapter: 2 }, body: 'ws2' },
}

const pt = await store.create('kaspen', withRecap, [], null as unknown as string)
try {
  const before = await store.get(pt.id)
  if (!before?.wiki['recap.md']) fail('setup: recap.md was not persisted by create()')

  // Re-save WITHOUT recap.md (mirrors consolidate() dropping it at a chapter boundary).
  await store.save(pt.id, withoutRecap, [])

  const after = await store.get(pt.id)
  if (!after) fail('playthrough vanished after save')
  if (after!.wiki['recap.md']) fail('recap.md still present after a save that omitted it (the bug)')
  if (!after!.wiki['world-state.md']) fail('world-state.md was wrongly deleted')
  if (String(after!.wiki['world-state.md'].body) !== 'ws2') fail('world-state.md not updated')

  console.log('PASS: removed wiki files are deleted on save; kept files survive and update.')
} finally {
  // Clean up the throwaway playthrough (cascades to wiki_files / wiki_history) via a raw
  // connection, so the store interface stays test-free.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
  await pool.query('DELETE FROM playthroughs WHERE id = $1', [pt.id])
  await pool.end()
  process.exit(0)
}
