// Smoke test for recap-history archive primitives (Phase 2).
// Run: npx tsx src/verify-recap-history.ts
//
// Covers: validateArchiveEntry, readArchive sorted/valid/invalid/duplicate,
// appendArchivedRecap append-only/deep-copy/duplicate rejection,
// parseLegacyChapterLog, mergeArchiveAndLegacy, engine AI-write exclusion.

import {
  validateArchiveEntry,
  readArchive,
  validEntries,
  appendArchivedRecap,
  parseLegacyChapterLog,
  mergeArchiveAndLegacy,
  ARCHIVE_FILE,
  type ArchivedRecapEntry,
} from './recapArchive.js'
import { runWriteBack } from './engine.js'
import type { WikiMap } from './types.js'
import type { RecapFacts } from './recap.js'

let passed = 0
let failed = 0

function check(label: string, fn: () => void): void {
  try {
    fn()
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  } catch (e: any) {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${label}`)
    console.log(`    ${e.message}`)
  }
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg)
}

function emptyWiki(): WikiMap {
  return { 'world-state.md': { frontmatter: { current_chapter: 1, current_anchor: 'A1', turns_since_progress: 0 }, body: '' } }
}

const MINIMAL_FACTS: RecapFacts = {
  chapterNumber: 1,
  chapterTitle: 'Test Chapter',
  characterName: 'Kaspen',
  characterRole: 'Cleanup Crew Lead',
  isVisitor: false,
  beats: [{ id: 'A1', title: 'Start' }],
  crew: [{ id: 'kaspen', name: 'Kaspen', trust: 50, arc: 'open' }],
  journey: { zonesVisited: [], crewSpoken: [], shipAreasExplored: [], petInteracted: false },
  turnCount: 5,
}

function makeEntry(overrides: Partial<ArchivedRecapEntry> = {}): ArchivedRecapEntry {
  return {
    chapterNumber: 1,
    chapterTitle: 'Test Chapter',
    title: 'A Journey Begins',
    prose: 'You arrived and explored the lighthouse.',
    facts: { ...MINIMAL_FACTS, chapterNumber: overrides.chapterNumber ?? 1 },
    isFinal: false,
    createdAt: '2026-07-19T00:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// §1 — validateArchiveEntry
// ---------------------------------------------------------------------------
console.log('\n§1 — validateArchiveEntry')

check('valid entry passes', () => {
  const result = validateArchiveEntry(makeEntry())
  assert(typeof result !== 'string', `expected entry, got error: ${result}`)
})

check('rejects null', () => {
  assert(typeof validateArchiveEntry(null) === 'string', 'expected error for null')
})

check('rejects non-object', () => {
  assert(typeof validateArchiveEntry(42) === 'string', 'expected error for number')
})

check('rejects missing chapterNumber', () => {
  const e = makeEntry()
  delete (e as any).chapterNumber
  assert(typeof validateArchiveEntry(e) === 'string', 'expected error')
})

check('rejects negative chapterNumber', () => {
  assert(typeof validateArchiveEntry(makeEntry({ chapterNumber: -1 })) === 'string', 'expected error')
})

check('rejects zero chapterNumber', () => {
  assert(typeof validateArchiveEntry(makeEntry({ chapterNumber: 0 })) === 'string', 'expected error')
})

check('rejects float chapterNumber', () => {
  assert(typeof validateArchiveEntry(makeEntry({ chapterNumber: 1.5 })) === 'string', 'expected error')
})

check('rejects unsafe chapterNumber', () => {
  assert(typeof validateArchiveEntry(makeEntry({ chapterNumber: Number.MAX_SAFE_INTEGER + 1 })) === 'string', 'expected error')
})

check('rejects missing chapterTitle', () => {
  const e = makeEntry()
  delete (e as any).chapterTitle
  assert(typeof validateArchiveEntry(e) === 'string', 'expected error')
})

check('rejects empty chapterTitle', () => {
  assert(typeof validateArchiveEntry(makeEntry({ chapterTitle: '  ' })) === 'string', 'expected error')
})

check('rejects missing title', () => {
  const e = makeEntry()
  delete (e as any).title
  assert(typeof validateArchiveEntry(e) === 'string', 'expected error')
})

check('rejects missing prose', () => {
  const e = makeEntry()
  delete (e as any).prose
  assert(typeof validateArchiveEntry(e) === 'string', 'expected error')
})

check('rejects missing facts', () => {
  const e = makeEntry()
  delete (e as any).facts
  assert(typeof validateArchiveEntry(e) === 'string', 'expected error')
})

check('rejects non-boolean isFinal', () => {
  assert(typeof validateArchiveEntry(makeEntry({ isFinal: 'yes' as any })) === 'string', 'expected error')
})

check('rejects non-string epilogue', () => {
  assert(typeof validateArchiveEntry(makeEntry({ epilogue: 42 as any })) === 'string', 'expected error')
})

check('rejects non-string acknowledgment', () => {
  assert(typeof validateArchiveEntry(makeEntry({ acknowledgment: true as any })) === 'string', 'expected error')
})

check('rejects invalid createdAt', () => {
  assert(typeof validateArchiveEntry(makeEntry({ createdAt: 'yesterday' })) === 'string', 'expected error')
})

check('rejects missing createdAt', () => {
  const e = makeEntry()
  delete (e as any).createdAt
  assert(typeof validateArchiveEntry(e) === 'string', 'expected error')
})

// ---------------------------------------------------------------------------
// §2 — readArchive & validEntries
// ---------------------------------------------------------------------------
console.log('\n§2 — readArchive & validEntries')

check('empty wiki returns empty array', () => {
  assert(readArchive(emptyWiki()).length === 0, 'expected empty')
})

check('wiki without archive file returns empty', () => {
  const wiki = emptyWiki()
  wiki['other-file.md'] = { frontmatter: {}, body: '' }
  assert(readArchive(wiki).length === 0, 'expected empty')
})

check('valid entry round-trips through frontmatter', () => {
  const entry = makeEntry()
  const wiki = appendArchivedRecap(emptyWiki(), entry)
  const rows = readArchive(wiki)
  assert(rows.length === 1, `expected 1 row, got ${rows.length}`)
  assert(rows[0].status.valid === true, `expected valid, got ${JSON.stringify(rows[0].status)}`)
  assert(rows[0].entry.chapterNumber === 1, 'wrong chapterNumber')
  assert(rows[0].entry.title === 'A Journey Begins', 'wrong title')
  assert(rows[0].entry.isFinal === false, 'wrong isFinal')
})

check('entries sorted by chapterNumber ascending', () => {
  let wiki = emptyWiki()
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 3 }))
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 1 }))
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 2 }))
  const rows = readArchive(wiki)
  assert(rows.length === 3, `expected 3, got ${rows.length}`)
  assert(rows[0].entry.chapterNumber === 1, 'expected 1 first')
  assert(rows[1].entry.chapterNumber === 2, 'expected 2 second')
  assert(rows[2].entry.chapterNumber === 3, 'expected 3 third')
})

check('validEntries returns only valid rows', () => {
  let wiki = emptyWiki()
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 1 }))
  // Manually corrupt the archive by adding a bad entry.
  const clone = structuredClone(wiki)
  const entries = clone[ARCHIVE_FILE]!.frontmatter!.entries as unknown[]
  entries.push({ chapterNumber: 'bad' }) // malformed
  wiki = clone
  const valid = validEntries(wiki)
  assert(valid.length === 1, `expected 1 valid entry, got ${valid.length}`)
})

check('bad row preserves good rows', () => {
  let wiki = emptyWiki()
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 1 }))
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 3 }))
  // Insert a bad entry between them via raw manipulation.
  const clone = structuredClone(wiki)
  const entries = clone[ARCHIVE_FILE]!.frontmatter!.entries as unknown[]
  entries.push({ chapterNumber: 2, chapterTitle: '', title: '', prose: '', facts: null, isFinal: 'nope', createdAt: 'bad' })
  wiki = clone
  const valid = validEntries(wiki)
  assert(valid.length === 2, `expected 2 valid entries, got ${valid.length}`)
  assert(valid[0].chapterNumber === 1, 'ch1 preserved')
  assert(valid[1].chapterNumber === 3, 'ch3 preserved')
})

check('duplicate chapter numbers corrupt the later entry', () => {
  let wiki = emptyWiki()
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 1 }))
  // Manually add a duplicate
  const clone = structuredClone(wiki)
  const entries = clone[ARCHIVE_FILE]!.frontmatter!.entries as unknown[]
  entries.push(structuredClone(makeEntry({ chapterNumber: 1, title: 'Should be duplicate' })))
  wiki = clone
  const rows = readArchive(wiki)
  const valid = rows.filter((r) => r.status.valid)
  assert(valid.length === 1, `expected 1 valid, got ${valid.length}`)
  const dup = rows.find((r) => !r.status.valid)
  assert(dup !== undefined, 'expected a duplicate row')
  assert((dup!.status as any).reason.includes('duplicate'), `expected duplicate reason, got ${(dup!.status as any).reason}`)
})

// ---------------------------------------------------------------------------
// §3 — appendArchivedRecap (append-only, deep-copy, duplicate rejection)
// ---------------------------------------------------------------------------
console.log('\n§3 — appendArchivedRecap')

check('append returns new wiki (does not mutate input)', () => {
  const wiki = emptyWiki()
  const next = appendArchivedRecap(wiki, makeEntry())
  assert(wiki[ARCHIVE_FILE] === undefined, 'original wiki must not be mutated')
  assert(next[ARCHIVE_FILE] !== undefined, 'new wiki must have archive')
})

check('duplicate chapter number throws', () => {
  let wiki = emptyWiki()
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 1 }))
  let threw = false
  try {
    wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 1 }))
  } catch {
    threw = true
  }
  assert(threw, 'expected throw on duplicate')
})

check('append does not change existing entries (append-only)', () => {
  let wiki = emptyWiki()
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 1, title: 'First' }))
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 2, title: 'Second' }))
  const entries = validEntries(wiki)
  assert(entries[0].title === 'First', 'first entry unchanged')
  assert(entries[1].title === 'Second', 'second entry present')
})

check('deep copy: mutating returned entry does not change stored data', () => {
  let wiki = emptyWiki()
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 1 }))
  const first = validEntries(wiki)
  first[0].title = 'HACKED'
  const second = validEntries(wiki)
  assert(second[0].title === 'A Journey Begins', 'stored title must be unchanged')
})

check('deep copy: appendArchivedRecap clones input entry', () => {
  const entry = makeEntry({ chapterNumber: 1 })
  const wiki = appendArchivedRecap(emptyWiki(), entry)
  entry.title = 'HACKED'
  const stored = validEntries(wiki)
  assert(stored[0].title === 'A Journey Begins', 'stored entry must be a clone')
})

// ---------------------------------------------------------------------------
// §4 — parseLegacyChapterLog
// ---------------------------------------------------------------------------
console.log('\n§4 — parseLegacyChapterLog')

check('no chapter-log.md returns empty', () => {
  assert(parseLegacyChapterLog(emptyWiki()).length === 0, 'expected empty')
})

check('empty body returns empty', () => {
  const wiki = emptyWiki()
  wiki['chapter-log.md'] = { frontmatter: {}, body: '' }
  assert(parseLegacyChapterLog(wiki).length === 0, 'expected empty')
})

check('single heading parsed', () => {
  const wiki = emptyWiki()
  wiki['chapter-log.md'] = {
    frontmatter: {},
    body: '## Chapter 1: The Long Goodbye\nYou explored the lighthouse and made a vow.',
  }
  const entries = parseLegacyChapterLog(wiki)
  assert(entries.length === 1, `expected 1, got ${entries.length}`)
  assert(entries[0].chapterNumber === 1, 'wrong number')
  assert(entries[0].chapterTitle === 'The Long Goodbye', 'wrong title')
  assert(entries[0].legacy === true, 'must be legacy')
  assert(entries[0].prose.includes('explored'), 'prose preserved')
})

check('multiple headings parsed', () => {
  const wiki = emptyWiki()
  wiki['chapter-log.md'] = {
    frontmatter: {},
    body:
      '## Chapter 1: First\nProse one.\n\n## Chapter 2: Second\nProse two.',
  }
  const entries = parseLegacyChapterLog(wiki)
  assert(entries.length === 2, `expected 2, got ${entries.length}`)
  assert(entries[0].chapterNumber === 1, 'wrong first')
  assert(entries[1].chapterNumber === 2, 'wrong second')
})

check('malformed heading skipped', () => {
  const wiki = emptyWiki()
  wiki['chapter-log.md'] = {
    frontmatter: {},
    body: '## Chapter X: Bad\nShould be skipped.\n\n## Chapter 1: Good\nReal prose.',
  }
  const entries = parseLegacyChapterLog(wiki)
  assert(entries.length === 1, `expected 1, got ${entries.length}`)
  assert(entries[0].chapterNumber === 1, 'good entry preserved')
})

check('empty prose section skipped', () => {
  const wiki = emptyWiki()
  wiki['chapter-log.md'] = {
    frontmatter: {},
    body: '## Chapter 1: Empty\n\n## Chapter 2: Has Prose\nReal text here.',
  }
  const entries = parseLegacyChapterLog(wiki)
  assert(entries.length === 1, `expected 1, got ${entries.length}`)
  assert(entries[0].chapterNumber === 2, 'empty section skipped')
})

// ---------------------------------------------------------------------------
// §5 — mergeArchiveAndLegacy (archive precedence)
// ---------------------------------------------------------------------------
console.log('\n§5 — mergeArchiveAndLegacy')

check('archive only → all returned', () => {
  let wiki = emptyWiki()
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 1 }))
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 2 }))
  const merged = mergeArchiveAndLegacy(wiki)
  assert(merged.length === 2, `expected 2, got ${merged.length}`)
})

check('legacy only → all returned', () => {
  const wiki = emptyWiki()
  wiki['chapter-log.md'] = {
    frontmatter: {},
    body: '## Chapter 1: First\nLegacy prose.',
  }
  const merged = mergeArchiveAndLegacy(wiki)
  assert(merged.length === 1, `expected 1, got ${merged.length}`)
  assert('legacy' in merged[0], 'must be legacy')
})

check('archive wins over legacy for same chapter', () => {
  let wiki = emptyWiki()
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 1, title: 'Archive Title' }))
  wiki['chapter-log.md'] = {
    frontmatter: {},
    body: '## Chapter 1: Legacy Title\nLegacy prose here.',
  }
  const merged = mergeArchiveAndLegacy(wiki)
  assert(merged.length === 1, `expected 1, got ${merged.length}`)
  assert(!('legacy' in merged[0]), 'archive must win')
  assert((merged[0] as ArchivedRecapEntry).title === 'Archive Title', 'archive title preserved')
})

check('legacy fills gaps archive does not cover', () => {
  let wiki = emptyWiki()
  wiki = appendArchivedRecap(wiki, makeEntry({ chapterNumber: 2 }))
  wiki['chapter-log.md'] = {
    frontmatter: {},
    body: '## Chapter 1: Legacy Ch1\nLegacy ch1 prose.\n\n## Chapter 2: Legacy Ch2\nLegacy ch2 prose.',
  }
  const merged = mergeArchiveAndLegacy(wiki)
  assert(merged.length === 2, `expected 2, got ${merged.length}`)
  // Chapter 1 should be legacy, Chapter 2 should be archive.
  const ch1 = merged.find((m) => m.chapterNumber === 1)
  const ch2 = merged.find((m) => m.chapterNumber === 2)
  assert(ch1 && 'legacy' in ch1, 'ch1 must be legacy')
  assert(ch2 && !('legacy' in ch2), 'ch2 must be archive')
})

// ---------------------------------------------------------------------------
// §6 — AI-write exclusion (engine protects archive files)
// ---------------------------------------------------------------------------
console.log('\n§6 — Engine AI-write exclusion')

function wikiWithAllFiles(): WikiMap {
  return {
    'world-state.md': { frontmatter: { current_chapter: 1, current_anchor: 'A1', turns_since_progress: 0 }, body: '' },
    'recap.md': { frontmatter: { title: 'Old recap' }, body: 'Old recap body.' },
    'recap-history.md': { frontmatter: { entries: [] }, body: '' },
    'chapter-log.md': { frontmatter: {}, body: 'Old log.' },
    'kaspen.md': { frontmatter: { name: 'Kaspen', trust_score: 50 }, body: '' },
  }
}

check('wiki_update targeting recap.md is rejected', () => {
  const wiki = wikiWithAllFiles()
  const result = runWriteBack(wiki, [], [{ file: 'recap.md', field: 'title', value: 'Hacked' }])
  assert(result.wiki['recap.md']?.frontmatter?.title === 'Old recap', 'recap.md must be untouched')
})

check('wiki_update targeting recap-history.md is rejected', () => {
  const wiki = wikiWithAllFiles()
  const result = runWriteBack(wiki, [], [{ file: 'recap-history.md', field: 'entries', value: [] }])
  assert(Array.isArray(result.wiki['recap-history.md']?.frontmatter?.entries), 'recap-history entries untouched')
})

check('wiki_update targeting chapter-log.md is rejected', () => {
  const wiki = wikiWithAllFiles()
  const result = runWriteBack(wiki, [], [{ file: 'chapter-log.md', field: 'body', value: 'Hacked' }])
  // chapter-log.md body should remain unchanged (wiki_update can't change body anyway,
  // but the entire update to the excluded file is refused)
  const logFm = result.wiki['chapter-log.md']?.frontmatter
  assert(!('body' in (logFm ?? {})), 'chapter-log update rejected')
})

check('fact_addition targeting recap-history.md is rejected', () => {
  const wiki = wikiWithAllFiles()
  const result = runWriteBack(wiki, [], [], [{ file: 'recap-history.md', text: 'Injected fact' }])
  const facts = result.wiki['recap-history.md']?.frontmatter?.facts
  assert(!Array.isArray(facts) || facts.length === 0, 'no facts on recap-history.md')
})

check('fact_addition targeting recap.md is rejected', () => {
  const wiki = wikiWithAllFiles()
  const result = runWriteBack(wiki, [], [], [{ file: 'recap.md', text: 'Injected fact' }])
  const facts = result.wiki['recap.md']?.frontmatter?.facts
  assert(!Array.isArray(facts) || facts.length === 0, 'no facts on recap.md')
})

check('fact_addition targeting chapter-log.md is rejected', () => {
  const wiki = wikiWithAllFiles()
  const result = runWriteBack(wiki, [], [], [{ file: 'chapter-log.md', text: 'Injected fact' }])
  const facts = result.wiki['chapter-log.md']?.frontmatter?.facts
  assert(!Array.isArray(facts) || facts.length === 0, 'no facts on chapter-log.md')
})

check('fact_addition to normal file still works', () => {
  const wiki = wikiWithAllFiles()
  const result = runWriteBack(wiki, [], [], [{ file: 'kaspen.md', text: 'Kaspen is suspicious' }])
  const facts = result.wiki['kaspen.md']?.frontmatter?.facts as string[] | undefined
  assert(Array.isArray(facts) && facts.some((f) => f.includes('suspicious')), 'normal fact addition works')
})

// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
