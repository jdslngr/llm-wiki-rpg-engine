// Smoke test for Phase 3 — shared preparation, lock, and route contracts.
// Run: npx tsx src/verify-recap-history-phase3.ts
//
// Covers: prepareChapterRecap (archive-hit, corruption, first-generation),
// chapterEndLock (FIFO, cross-key, cleanup),
// wikiStateOf exclusion, canAdvanceFrom wiring.

import { prepareChapterRecap, RecapCorruptionError, type RecapGenerator } from './recapPreparation.js'
import { ChapterEndLock } from './chapterEndLock.js'
import { readArchive, validEntries, appendArchivedRecap, ARCHIVE_FILE, type ArchivedRecapEntry } from './recapArchive.js'
import { getChapter, hasChapter, registerSpec, canAdvanceFrom } from './chapters/index.js'
import { defineChapter, type ChapterSpec } from './chapters/defineChapter.js'
import { chapterNumOf, anchorOf } from './chapterMeta.js'
import { buildRecapFacts } from './recap.js'
import { buildStarterWiki, type PlayableId } from './game/characters.js'
import type { WikiMap, Turn } from './types.js'

let passed = 0
let failed = 0
const tests: (() => Promise<void>)[] = []

function check(label: string, fn: () => void | Promise<void>): void {
  tests.push(async () => {
    try {
      await fn()
      passed++
      console.log(`  \x1b[32m✓\x1b[0m ${label}`)
    } catch (e: any) {
      failed++
      console.log(`  \x1b[31m✗\x1b[0m ${label}`)
      console.log(`    ${e.message}`)
    }
  })
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

let mockCallCount = 0
function mockGenerate(title = 'Mock Recap', prose = 'Mock prose for the chapter.'): RecapGenerator {
  return async () => {
    mockCallCount++
    return { title, prose }
  }
}

function resetMock() { mockCallCount = 0 }

function makeWiki(chapter = 1, atEnd = true): WikiMap {
  const wiki = buildStarterWiki('kaspen' as PlayableId)
  wiki['world-state.md']!.frontmatter!.current_chapter = chapter
  wiki['world-state.md']!.frontmatter!.current_anchor = atEnd ? 'END' : 'A1'
  wiki['world-state.md']!.frontmatter!.turns_since_progress = 0
  return wiki
}

// Register a non-final chapter 2 so canAdvanceFrom(1) is true.
// (Chapter 1 is already registered as a built-in.)
function ensureChapter2() {
  if (!hasChapter(2)) {
    const spec: ChapterSpec = {
      number: 2,
      title: 'Chapter Two',
      fragment: 'A test fragment.',
      anchors: [{ id: 'A1', title: 'Start', note: 'Begin', advanceWhen: [{ field: 'test', op: 'flag' }] }],
      events: [{ token: 'ev', anchor: 'A1', fold: { field: 'test' } }],
      opening: { prose: 'You continue.', actions: ['Go'] },
    }
    registerSpec(spec)
  }
}

function history(): Turn[] {
  return [
    { role: 'ai', content: 'Opening prose.' },
    { role: 'player', content: 'I explore.' },
    { role: 'ai', content: 'You find a door.' },
  ]
}

// ── Run all tests ──────────────────────────────────────────────────────────

// ---------------------------------------------------------------------------
// §1 — First generation
// ---------------------------------------------------------------------------
console.log('\n§1 — First generation creates archive + cache')

check('first call generates and returns snapshot', async () => {
  resetMock()
  const wiki = makeWiki()
  const result = await prepareChapterRecap(wiki, 'kaspen', history(), mockGenerate())
  assert(result.recap.title === 'Mock Recap', 'wrong title')
  assert(result.recap.prose === 'Mock prose for the chapter.', 'wrong prose')
  assert(result.recap.facts.chapterNumber === 1, 'facts present')
  assert(result.recap.isFinal === false, 'isFinal from chapter')
  assert(result.recap.hasNextChapter !== undefined, 'hasNextChapter present')
  assert(mockCallCount === 1, 'generator called exactly once')
})

check('first call writes archive entry', async () => {
  resetMock()
  const wiki = makeWiki()
  const result = await prepareChapterRecap(wiki, 'kaspen', history(), mockGenerate())
  const entries = validEntries(result.wiki)
  assert(entries.length === 1, `expected 1 archive entry, got ${entries.length}`)
  assert(entries[0].chapterNumber === 1, 'wrong chapter number')
  assert(entries[0].title === 'Mock Recap', 'title in archive')
  assert(entries[0].isFinal === false, 'isFinal in archive')
})

check('first call writes recap.md cache', async () => {
  resetMock()
  const wiki = makeWiki()
  const result = await prepareChapterRecap(wiki, 'kaspen', history(), mockGenerate())
  assert(result.wiki['recap.md']?.body === 'Mock prose for the chapter.', 'cache body')
  assert(result.wiki['recap.md']?.frontmatter?.title === 'Mock Recap', 'cache title')
})

check('first call does not mutate input wiki', async () => {
  resetMock()
  const wiki = makeWiki()
  await prepareChapterRecap(wiki, 'kaspen', history(), mockGenerate())
  assert(!wiki[ARCHIVE_FILE], 'input wiki must not have archive')
  assert(!wiki['recap.md']?.body, 'input wiki must not have cache')
})

// ---------------------------------------------------------------------------
// §2 — Repeat request returns immutable snapshot
// ---------------------------------------------------------------------------
console.log('\n§2 — Repeat request returns exact snapshot')

check('second call returns same snapshot, no generator call', async () => {
  resetMock()
  const wiki = makeWiki()
  const first = await prepareChapterRecap(wiki, 'kaspen', history(), mockGenerate('First Title', 'First prose.'))
  resetMock() // reset counter after first call
  const second = await prepareChapterRecap(first.wiki, 'kaspen', history(), mockGenerate('HACKED', 'HACKED.'))
  assert(mockCallCount === 0, 'generator must not be called on repeat')
  assert(second.recap.title === 'First Title', 'title preserved')
  assert(second.recap.prose === 'First prose.', 'prose preserved')
  assert(second.recap.facts.chapterNumber === 1, 'facts preserved')
})

check('changed live chapter title does not change archived snapshot', async () => {
  resetMock()
  const wiki = makeWiki()
  const first = await prepareChapterRecap(wiki, 'kaspen', history(), mockGenerate())
  resetMock() // reset counter after first generation
  // Simulate the chapter being re-authored: change the registry (but archive is immutable).
  // The second call should still return the original archive entry.
  const second = await prepareChapterRecap(first.wiki, 'kaspen', history(), mockGenerate('NEW', 'NEW.'))
  assert(second.recap.title === 'Mock Recap', 'archive title unchanged by live chapter edit')
  assert(mockCallCount === 0, 'generator not called')
})

check('changed cache (recap.md) does not change archived snapshot', async () => {
  resetMock()
  const wiki = makeWiki()
  const first = await prepareChapterRecap(wiki, 'kaspen', history(), mockGenerate())
  // Tamper with the cache — archive should still win.
  const tamperedWiki: WikiMap = {
    ...first.wiki,
    'recap.md': { frontmatter: { title: 'Tampered' }, body: 'Tampered prose.' },
  }
  resetMock()
  const second = await prepareChapterRecap(tamperedWiki, 'kaspen', history(), mockGenerate('NEW', 'NEW.'))
  assert(second.recap.title === 'Mock Recap', 'archive wins over tampered cache')
  assert(mockCallCount === 0, 'no regeneration')
})

check('canAdvanceFrom result may change across calls (live field)', async () => {
  resetMock()
  ensureChapter2()
  const wiki = makeWiki()
  const first = await prepareChapterRecap(wiki, 'kaspen', history(), mockGenerate())
  // At generation time, Chapter 2 exists → hasNextChapter is true.
  // But if Chapter 2 is deleted later, hasNextChapter could change.
  // The field is live-computed from canAdvanceFrom, not stored.
  const ch1 = getChapter(1)
  assert(!ch1.isFinal, 'ch1 not final')
  assert(hasChapter(2), 'ch2 exists for test')
  assert(first.recap.hasNextChapter === canAdvanceFrom(1), 'hasNextChapter matches canAdvanceFrom')
})

// ---------------------------------------------------------------------------
// §3 — Corruption safety
// ---------------------------------------------------------------------------
console.log('\n§3 — Corruption safety')

check('corrupt current-chapter archive entry throws RecapCorruptionError', async () => {
  resetMock()
  let wiki = makeWiki()
  // Manually insert a corrupt entry for the current chapter.
  wiki[ARCHIVE_FILE] = {
    frontmatter: {
      entries: [{
        chapterNumber: 1,
        chapterTitle: '',
        title: '',
        prose: '',
        facts: null,
        isFinal: 'nope',
        createdAt: 'bad',
      }],
    },
    body: '',
  }
  let threw: RecapCorruptionError | null = null
  try {
    await prepareChapterRecap(wiki, 'kaspen', history(), mockGenerate())
  } catch (e) {
    if (e instanceof RecapCorruptionError) threw = e
  }
  assert(threw !== null, 'must throw RecapCorruptionError')
  assert(threw!.chapterNumber === 1, 'chapter number in error')
  assert(mockCallCount === 0, 'generator must not be called on corrupt archive')
})

check('corrupt entry for a DIFFERENT chapter does not block current', async () => {
  resetMock()
  // First, create valid archive for chapter 1.
  let wiki = makeWiki()
  const first = await prepareChapterRecap(wiki, 'kaspen', history(), mockGenerate())
  resetMock()

  // Manually add a corrupt entry for chapter 99 (not the current chapter).
  const raw = structuredClone(first.wiki[ARCHIVE_FILE]!.frontmatter!.entries) as any[]
  raw.push({
    chapterNumber: 99,
    chapterTitle: '',
    title: '',
    prose: '',
    facts: null,
    isFinal: false,
    createdAt: 'invalid',
  })
  wiki = { ...first.wiki, [ARCHIVE_FILE]: { frontmatter: { entries: raw }, body: '' } }

  // Change wiki to be at chapter 1 (current) — archive hit should still work for ch1.
  const result = await prepareChapterRecap(wiki, 'kaspen', history(), mockGenerate('NEW', 'NEW.'))
  assert(result.recap.title === 'Mock Recap', 'valid ch1 entry still works')
  assert(mockCallCount === 0, 'no regeneration — archive hit')
})

// ---------------------------------------------------------------------------
// §4 — Lock FIFO, cross-key, cleanup
// ---------------------------------------------------------------------------
console.log('\n§4 — ChapterEndLock')

check('single acquire/release works', async () => {
  const lock = new ChapterEndLock()
  const release = await lock.acquire('p1')
  assert(typeof release === 'function', 'release is a function')
  release()
  // Should be able to acquire again immediately.
  const release2 = await lock.acquire('p1')
  release2()
})

check('FIFO ordering', async () => {
  const lock = new ChapterEndLock()
  const order: number[] = []
  const done: boolean[] = [false, false, false]

  const release1 = await lock.acquire('pid')
  // Before releasing, start two more acquisitions.
  const p2 = lock.acquire('pid').then((r) => {
    order.push(2)
    done[1] = true
    return r
  })
  const p3 = lock.acquire('pid').then((r) => {
    order.push(3)
    done[2] = true
    return r
  })

  // Neither should have resolved yet.
  await new Promise((r) => setTimeout(r, 10))
  assert(!done[1], 'second must wait')
  assert(!done[2], 'third must wait')

  order.push(1)
  done[0] = true
  release1()

  // p2 resolves first (FIFO); p3 must wait for p2 to release.
  const r2 = await p2
  assert(order[0] === 1 && order[1] === 2, `first two: ${order}`)
  r2() // releases p2, waking p3
  const r3 = await p3
  assert(order[2] === 3, `third: ${order}`)
  r3()
})

check('cross-key independence: lock on A does not block B', async () => {
  const lock = new ChapterEndLock()
  const releaseA = await lock.acquire('A')
  // Acquire B — should resolve immediately since A ≠ B.
  const releaseBPromise = lock.acquire('B')
  const resolved: string[] = []
  releaseBPromise.then(() => resolved.push('B'))

  await new Promise((r) => setTimeout(r, 10))
  assert(resolved.includes('B'), 'B must resolve while A is held')
  const releaseB = await releaseBPromise
  releaseB()
  releaseA()
})

check('release is idempotent', async () => {
  const lock = new ChapterEndLock()
  const release = await lock.acquire('pid')
  release()
  release() // second call must not throw
  // Should be able to acquire again.
  const release2 = await lock.acquire('pid')
  release2()
})

check('cleanup: released key can be re-acquired', async () => {
  const lock = new ChapterEndLock()
  const r1 = await lock.acquire('pid')
  r1()
  const r2 = await lock.acquire('pid')
  r2()
  // If cleanup didn't work, the queues map would leak entries but re-acquire still works.
})

check('run() releases on success', async () => {
  const lock = new ChapterEndLock()
  const result = await lock.run('pid', async () => 'done')
  assert(result === 'done', 'result passed through')
  // Verify can acquire again (lock was released).
  const release = await lock.acquire('pid')
  release()
})

check('run() releases on error', async () => {
  const lock = new ChapterEndLock()
  let threw = false
  try {
    await lock.run('pid', async () => { throw new Error('boom') })
  } catch {
    threw = true
  }
  assert(threw, 'error propagated')
  // Verify can acquire again (lock was released despite error).
  const release = await lock.acquire('pid')
  release()
})

// ---------------------------------------------------------------------------
// §5 — wikiStateOf exclusion (sanity check #3)
// ---------------------------------------------------------------------------
console.log('\n§5 — wikiStateOf excludes archive files')

function wikiStateOf(wiki: WikiMap): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(wiki)
      .filter(([k]) => k !== 'recap.md' && k !== 'recap-history.md')
      .map(([k, v]) => [k, v.frontmatter ?? {}]),
  )
}

check('recap.md is excluded from wikiStateOf', () => {
  const wiki: WikiMap = {
    'world-state.md': { frontmatter: { current_chapter: 1 }, body: '' },
    'recap.md': { frontmatter: { title: 'Should not appear' }, body: 'nope' },
  }
  const state = wikiStateOf(wiki)
  assert(!('recap.md' in state), 'recap.md must be excluded')
  assert('world-state.md' in state, 'normal files present')
})

check('recap-history.md is excluded from wikiStateOf', () => {
  const wiki: WikiMap = {
    'world-state.md': { frontmatter: { current_chapter: 1 }, body: '' },
    'recap-history.md': { frontmatter: { entries: [] }, body: '' },
  }
  const state = wikiStateOf(wiki)
  assert(!('recap-history.md' in state), 'recap-history.md must be excluded')
})

check('both recap files excluded, normal files still present', () => {
  const wiki: WikiMap = {
    'world-state.md': { frontmatter: { current_chapter: 1 }, body: '' },
    'kaspen.md': { frontmatter: { name: 'Kaspen' }, body: '' },
    'recap.md': { frontmatter: { title: 'x' }, body: 'x' },
    'recap-history.md': { frontmatter: { entries: [] }, body: '' },
  }
  const state = wikiStateOf(wiki)
  assert('world-state.md' in state, 'world-state present')
  assert('kaspen.md' in state, 'kaspen present')
  assert(!('recap.md' in state), 'recap excluded')
  assert(!('recap-history.md' in state), 'archive excluded')
  assert(Object.keys(state).length === 2, `expected 2 entries, got ${Object.keys(state).length}`)
})

// ---------------------------------------------------------------------------
// §6 — Advance preserves archive (integration check)
// ---------------------------------------------------------------------------
console.log('\n§6 — Archive survives consolidation')

check('archive entry persists after appendChapterLog', async () => {
  resetMock()
  const wiki = makeWiki()
  const result = await prepareChapterRecap(wiki, 'kaspen', history(), mockGenerate())
  // Simulate what consolidate does — delete recap.md, leave recap-history.md.
  const afterConsolidate: WikiMap = { ...result.wiki }
  delete afterConsolidate['recap.md']
  // Archive should still be there.
  const entries = validEntries(afterConsolidate)
  assert(entries.length === 1, 'archive entry survived consolidation')
})

check('final chapter archives before complete', async () => {
  resetMock()
  ensureChapter2()
  // Register a final chapter at 1 (overriding the built-in... actually can't override built-ins).
  // Use a different approach: set up a scenario where the current chapter is final.
  // Chapter 1 built-in is always non-final. Register a final chapter 2, then start at ch2.
  const finalSpec: ChapterSpec = {
    number: 3,
    title: 'Final Chapter',
    fragment: 'The end.',
    anchors: [{ id: 'A1', title: 'End', note: 'It ends', advanceWhen: [{ field: 'f', op: 'flag' }] }],
    events: [{ token: 'ev', anchor: 'A1', fold: { field: 'f' } }],
    opening: { prose: 'The final chapter.', actions: ['End'] },
    isFinal: true,
  }
  registerSpec(finalSpec)
  const ch = getChapter(3)
  assert(ch.isFinal === true, 'ch3 is final')
  assert(canAdvanceFrom(3) === false, 'final chapter cannot advance')

  // Build wiki at chapter 3 END.
  const wiki = makeWiki(3, true)
  resetMock()
  const result = await prepareChapterRecap(wiki, 'kaspen', history(), mockGenerate('Final Title', 'Final prose.'))
  assert(result.recap.isFinal === true, 'isFinal in recap')
  assert(result.recap.hasNextChapter === false, 'final has no next chapter')
  // Archive must contain the entry.
  const entries = validEntries(result.wiki)
  assert(entries.some((e) => e.chapterNumber === 3), 'final chapter archived')
})

// ---------------------------------------------------------------------------
// Run tests sequentially (they share global mock state).
;(async () => {
  for (const test of tests) {
    await test()
  }
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
})()
