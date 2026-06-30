// Smoke checks for FOLD_TOKEN_SOFTLOCK_FIX §5 acceptance criteria.
// Run with: npx tsx src/verify-chapter-fold.ts

import { defineChapter, validateChapterSpec } from './chapters/defineChapter.js'
import type { ChapterSpec } from './chapters/defineChapter.js'

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

// ---- §3.1: empty-string token normalized to absent (flag-type) ----

console.log('§3.1 — Engine-level normalization')

const specWithEmptyToken: ChapterSpec = {
  number: 99,
  title: 'Test Chapter',
  fragment: 'Test fragment.',
  anchors: [
    {
      id: 'A1',
      title: 'First Beat',
      note: 'Test beat note.',
      advanceWhen: [{ op: 'flag', field: 'test_field' }],
    },
  ],
  events: [
    {
      token: 'test_event',
      anchor: 'A1',
      fold: { field: 'test_field', token: '' }, // <-- the bug: empty string
    },
  ],
  opening: {
    prose: 'You awaken.',
    actions: ['look around'],
  },
}

const chapter = defineChapter(specWithEmptyToken)

// AC #1: scratchSeed should return false (boolean), not [] (array)
const seed = chapter.scratchSeed()
check(
  'scratchSeed returns test_field: false (not []) for empty-string token',
  seed.test_field === false,
)

// AC #2: foldMap should have no token (undefined), so engine treats it as flag
const fold = chapter.foldMap['test_event']
check(
  'foldMap token is undefined (flag fold) after normalization',
  fold?.token === undefined,
)

// AC #3: anchorConditionsMet returns true when the field is true
const fmWithTrue = { test_field: true, current_anchor: 'A1', current_chapter: 99 }
check(
  'anchorConditionsMet("A1", {test_field: true}) returns true',
  chapter.anchorConditionsMet('A1', fmWithTrue) === true,
)

// AC #4: anchorConditionsMet returns false when the field is false
const fmWithFalse = { test_field: false, current_anchor: 'A1', current_chapter: 99 }
check(
  'anchorConditionsMet("A1", {test_field: false}) returns false',
  chapter.anchorConditionsMet('A1', fmWithFalse) === false,
)

// AC #5: regression — a valid spec with a real (non-empty) token still works
const specWithRealToken: ChapterSpec = {
  number: 99,
  title: 'Test Chapter 2',
  fragment: 'Test fragment.',
  anchors: [
    {
      id: 'A1',
      title: 'First Beat',
      note: 'Test beat note.',
      advanceWhen: [{ op: 'count_gte', field: 'visited_places', value: 2 }],
    },
  ],
  events: [
    {
      token: 'visit_beach',
      anchor: 'A1',
      fold: { field: 'visited_places', token: 'beach' },
    },
    {
      token: 'visit_cave',
      anchor: 'A1',
      fold: { field: 'visited_places', token: 'cave' },
    },
  ],
  opening: {
    prose: 'You awaken.',
    actions: ['look around'],
  },
}

const chapter2 = defineChapter(specWithRealToken)
const seed2 = chapter2.scratchSeed()
check(
  'real-token scratchSeed returns array (not broken by normalization)',
  Array.isArray(seed2.visited_places) && seed2.visited_places.length === 0,
)

// ---- §3.2: validateChapterSpec hardening ----

console.log('\n§3.2 — Validation hardening')

// AC #6: validateChapterSpec catches flag condition on an array-only field
const specFlagOnArrayField = {
  number: 99,
  title: 'Test',
  fragment: 'Test.',
  anchors: [
    {
      id: 'A1',
      title: 'First Beat',
      note: 'Test note.',
      advanceWhen: [{ op: 'flag', field: 'items' }],
    },
  ],
  events: [
    {
      token: 'found_key',
      anchor: 'A1',
      fold: { field: 'items', token: 'key' }, // real non-empty token → array field
    },
  ],
  opening: {
    prose: 'You awaken.',
    actions: ['look'],
  },
}

const problems = validateChapterSpec(specFlagOnArrayField)
const flagProblem = problems.find((p) => p.includes('flag') && p.includes('items') && p.includes('soft-lock'))
check(
  'validateChapterSpec catches flag op on array-only field',
  flagProblem !== undefined,
)

// AC #7: validateChapterSpec on a valid spec returns zero problems
const validSpec = {
  number: 1,
  title: 'Valid Chapter',
  fragment: 'Valid fragment.',
  anchors: [
    {
      id: 'A1',
      title: 'First Beat',
      note: 'A valid beat note.',
      advanceWhen: [{ op: 'flag', field: 'found_hook' }],
    },
  ],
  events: [
    {
      token: 'find_hook',
      anchor: 'A1',
      fold: { field: 'found_hook' }, // no token → flag fold, correctly matches flag condition
    },
  ],
  opening: {
    prose: 'You awaken.',
    actions: ['look around'],
  },
}

const validProblems = validateChapterSpec(validSpec)
check(
  'validateChapterSpec on valid flag-based spec returns zero problems',
  validProblems.length === 0,
)

// AC #8: validateChapterSpec with the empty-string-token spec now classifies
// correctly as flag (no false positive from the new rule against flag-on-array)
// — the field goes in flagFields because the empty token is normalized away
const emptyTokenProblems = validateChapterSpec(specWithEmptyToken)
const emptyTokenFlagProblem = emptyTokenProblems.find((p) => p.includes('flag') && p.includes('soft-lock'))
check(
  'validateChapterSpec on empty-token spec does NOT false-positive the new flag-on-array check',
  emptyTokenFlagProblem === undefined && emptyTokenProblems.length === 0,
)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
