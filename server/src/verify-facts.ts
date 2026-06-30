// Smoke checks for §5 acceptance criteria #2–6. Run with: npx tsx src/verify-facts.ts

import { runWriteBack } from './engine.js'
import { validateChapterSpec } from './chapters/defineChapter.js'
import type { WikiMap } from './types.js'

let passed = 0
let failed = 0

function check(label: string, condition: boolean) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`)
    passed++
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}`)
    failed++
  }
}

function minimalWiki(): WikiMap {
  return {
    'world-state.md': {
      frontmatter: { current_chapter: 1, current_anchor: 'A1' },
      body: '',
    },
    'character.md': {
      frontmatter: {},
      body: 'A character dossier.',
    },
  }
}

// ── #2: Invalid/excluded file rejection ──────────────────────────

console.log('\n#2 — Invalid/excluded file rejection')

// Nonexistent file
const r1 = runWriteBack(minimalWiki(), [], [], [
  { file: 'nonexistent.md', text: 'This file does not exist' },
])
check(
  'Fact targeting nonexistent file is dropped',
  !(r1.wiki['nonexistent.md']?.frontmatter?.facts as string[])?.length,
)

// recap.md excluded
const r2 = runWriteBack(minimalWiki(), [], [], [
  { file: 'recap.md', text: 'Should be dropped' },
])
check(
  'Fact targeting recap.md is dropped',
  !r2.wiki['recap.md']?.frontmatter?.facts,
)

// chapter-log.md excluded
const r3 = runWriteBack(minimalWiki(), [], [], [
  { file: 'chapter-log.md', text: 'Should be dropped' },
])
check(
  'Fact targeting chapter-log.md is dropped',
  !r3.wiki['chapter-log.md']?.frontmatter?.facts,
)

// Valid file accepted
const r4 = runWriteBack(minimalWiki(), [], [], [
  { file: 'character.md', text: 'A valid fact about the character' },
])
check(
  'Fact targeting existing file is accepted',
  (r4.wiki['character.md']?.frontmatter?.facts as string[])?.length === 1,
)

// ── #3: Oversized fact rejection ─────────────────────────────────

console.log('\n#3 — Oversized fact rejection')

// Exactly at limit: 30 words
const words30 = Array(30).fill('word').join(' ')
check('30-word fact length', words30.split(' ').length === 30)
const r5 = runWriteBack(minimalWiki(), [], [], [
  { file: 'character.md', text: words30 },
])
check(
  'Fact at exactly 30 words is accepted',
  (r5.wiki['character.md']?.frontmatter?.facts as string[])?.length === 1,
)

// Over 30 words → dropped
const words31 = Array(31).fill('word').join(' ')
const r6 = runWriteBack(minimalWiki(), [], [], [
  { file: 'character.md', text: words31 },
])
check(
  'Fact over 30 words is dropped',
  !(r6.wiki['character.md']?.frontmatter?.facts as string[])?.length,
)

// At/under 220 chars, but exactly at limit
const chars220 = 'x'.repeat(220)
check('220-char fact length', chars220.length === 220)
const r7 = runWriteBack(minimalWiki(), [], [], [
  { file: 'character.md', text: chars220 },
])
check(
  'Fact at exactly 220 characters is accepted',
  (r7.wiki['character.md']?.frontmatter?.facts as string[])?.length === 1,
)

// Over 220 chars → dropped
const chars221 = 'x'.repeat(221)
const r8 = runWriteBack(minimalWiki(), [], [], [
  { file: 'character.md', text: chars221 },
])
check(
  'Fact over 220 characters is dropped',
  !(r8.wiki['character.md']?.frontmatter?.facts as string[])?.length,
)

// Empty/whitespace-only fact → dropped
const r9 = runWriteBack(minimalWiki(), [], [], [
  { file: 'character.md', text: '   ' },
])
check(
  'Whitespace-only fact is dropped',
  !(r9.wiki['character.md']?.frontmatter?.facts as string[])?.length,
)

// ── #4: FIFO eviction ────────────────────────────────────────────

console.log('\n#4 — FIFO eviction')

// Add 9 facts to the same file, check oldest dropped, exactly 8 remain
const nineFacts = [
  { file: 'character.md' as const, text: 'First fact one' },
  { file: 'character.md' as const, text: 'Second fact two' },
  { file: 'character.md' as const, text: 'Third fact three' },
  { file: 'character.md' as const, text: 'Fourth fact four' },
  { file: 'character.md' as const, text: 'Fifth fact five' },
  { file: 'character.md' as const, text: 'Sixth fact six' },
  { file: 'character.md' as const, text: 'Seventh fact seven' },
  { file: 'character.md' as const, text: 'Eighth fact eight' },
  { file: 'character.md' as const, text: 'Ninth fact nine' },
]
const r10 = runWriteBack(minimalWiki(), [], [], nineFacts)
const facts = (r10.wiki['character.md']?.frontmatter?.facts as string[]) ?? []
check('Exactly 8 facts retained', facts.length === 8)
check(
  'Oldest fact (First fact one) evicted',
  !facts.includes('First fact one'),
)
check(
  'Most recent fact (Ninth fact nine) present',
  facts.includes('Ninth fact nine'),
)

// ── #5: wiki_updates field:"facts" guard ─────────────────────────

console.log('\n#5 — wiki_updates field:"facts" guard')

// First, add a fact via factAdditions to establish a facts array
const r11 = runWriteBack(minimalWiki(), [], [], [
  { file: 'character.md', text: 'Genuine fact via fact_additions' },
])
check(
  'Setup: fact_additions created the facts array',
  (r11.wiki['character.md']?.frontmatter?.facts as string[])?.length === 1,
)

// Now try to clobber it via wiki_updates with field:"facts"
const r12 = runWriteBack(r11.wiki, [], [
  { file: 'character.md', field: 'facts', value: 'should be ignored' },
], [])
const factsAfter = (r12.wiki['character.md']?.frontmatter?.facts as string[]) ?? []
check(
  'facts array still intact after wiki_updates field:"facts" write',
  factsAfter.length === 1 && factsAfter[0] === 'Genuine fact via fact_additions',
)
check(
  'facts was not overwritten with a scalar string',
  Array.isArray(factsAfter),
)

// ── #6: validateChapterSpec reserved name ────────────────────────

console.log('\n#6 — validateChapterSpec reserved name')

// A minimal valid spec (without the reserved name). Every anchor needs at
// least one advancement condition, and every condition field must be fed by
// some event's fold — otherwise validateChapterSpec flags a soft-lock risk.
const goodSpec = {
  number: 2,
  title: 'Test Chapter',
  fragment: 'Test fragment.',
  anchors: [
    {
      id: 'B1',
      title: 'Start',
      note: 'Opening beat',
      advanceWhen: [{ field: 'test_field', op: 'flag' as const }],
    },
  ],
  events: [{ token: 'test_event', anchor: 'B1', fold: { field: 'test_field' } }],
  opening: { prose: 'Welcome.', actions: ['Go on'] },
}
const goodProblems = validateChapterSpec(goodSpec)
check(
  'Valid spec without facts field passes validation',
  goodProblems.length === 0,
)

// Same spec but with an event that folds into "facts"
const badSpec = {
  ...goodSpec,
  events: [{ token: 'bad_event', anchor: 'B1', fold: { field: 'facts' } }],
}
const badProblems = validateChapterSpec(badSpec)
check(
  'Spec with fold.field="facts" is rejected',
  badProblems.some((p) => p.includes('facts') && p.includes('reserved')),
)

// ── Results ──────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
