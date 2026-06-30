// Smoke checks for WIKI_FACTS_FOLD_UPGRADE.md §4.5 acceptance criteria.
// Run with: npx tsx src/verify-facts-recap.ts

import { buildRecapFacts, buildNotableFactsBlock } from './recap.js'
import { consolidate } from './consolidate.js'
import type { WikiMap, Turn } from './types.js'

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
    'player-character.md': {
      frontmatter: { name: 'Kaspen', role: 'Captain' },
      body: '',
    },
    'pan.md': {
      frontmatter: {},
      body: 'Pan character dossier.',
    },
    'character.md': {
      frontmatter: {},
      body: 'A character dossier.',
    },
  }
}

// ── buildRecapFacts: notableFacts populated ────────────────────────

console.log('\nbuildRecapFacts — notableFacts populated')

const wikiWithFacts: WikiMap = {
  ...minimalWiki(),
  'pan.md': {
    frontmatter: { name: 'Pan', trust_score: 65, arc_status: 'open', facts: ['Pan owes Kaspen a debt', 'Pan is learning magic'] },
    body: 'Pan dossier.',
  },
  'world-state.md': {
    frontmatter: { current_chapter: 1, current_anchor: 'A1', facts: ['The northern cliffs were chosen for the first Spire'] },
    body: '',
  },
  'character.md': {
    frontmatter: { facts: [] },
    body: 'A character dossier.',
  },
}
const history: Turn[] = [
  { role: 'player', content: 'I explore the lighthouse.' },
  { role: 'ai', content: 'You find a dusty room.' },
  { role: 'player', content: 'I talk to Pan.' },
]

const facts = buildRecapFacts('kaspen', wikiWithFacts, history)

check(
  'notableFacts includes pan.md with its 2 facts',
  (() => {
    const nf = facts.notableFacts?.find((n) => n.file === 'pan.md')
    return !!(nf && nf.facts.length === 2 && nf.facts.includes('Pan owes Kaspen a debt'))
  })(),
)

check(
  'notableFacts includes world-state.md with its 1 fact',
  (() => {
    const nf = facts.notableFacts?.find((n) => n.file === 'world-state.md')
    return !!(nf && nf.facts.length === 1 && nf.facts[0] === 'The northern cliffs were chosen for the first Spire')
  })(),
)

check(
  'notableFacts omits character.md (facts array present but empty)',
  !facts.notableFacts?.some((n) => n.file === 'character.md'),
)

// ── buildRecapFacts: no facts case ─────────────────────────────────

console.log('\nbuildRecapFacts — no facts anywhere')

const wikiNoFacts = minimalWiki()
const factsNoFacts = buildRecapFacts('kaspen', wikiNoFacts, history)

check(
  'notableFacts is an empty array when no file has facts',
  Array.isArray(factsNoFacts.notableFacts) && factsNoFacts.notableFacts.length === 0,
)

// ── buildNotableFactsBlock: empty list ─────────────────────────────

console.log('\nbuildNotableFactsBlock — empty list')

check(
  'buildNotableFactsBlock([]) returns empty string',
  buildNotableFactsBlock([]) === '',
)

// ── buildNotableFactsBlock: single entry ───────────────────────────

console.log('\nbuildNotableFactsBlock — single entry')

const singleBlock = buildNotableFactsBlock([
  { file: 'pan.md', facts: ['Pan owes Kaspen a debt'] },
])

check(
  'single entry block contains file name',
  singleBlock.includes('pan.md'),
)
check(
  'single entry block contains fact text',
  singleBlock.includes('Pan owes Kaspen a debt'),
)

// ── buildNotableFactsBlock: multiple entries ───────────────────────

console.log('\nbuildNotableFactsBlock — multiple entries')

const multiBlock = buildNotableFactsBlock([
  { file: 'pan.md', facts: ['Pan owes Kaspen a debt', 'Pan is learning magic'] },
  { file: 'world-state.md', facts: ['The northern cliffs were chosen'] },
])

check(
  'multi-entry block contains first file name',
  multiBlock.includes('pan.md'),
)
check(
  'multi-entry block contains second file name',
  multiBlock.includes('world-state.md'),
)
check(
  'multi-entry block contains first file facts',
  multiBlock.includes('Pan owes Kaspen a debt') && multiBlock.includes('Pan is learning magic'),
)
check(
  'multi-entry block contains second file fact',
  multiBlock.includes('The northern cliffs were chosen'),
)

// ── consolidate: clears existing facts ─────────────────────────────

console.log('\nconsolidate — clears existing facts')

const wikiForConsolidate: WikiMap = {
  'world-state.md': {
    frontmatter: { current_chapter: 1, current_anchor: 'A1' },
    body: '',
  },
  'player-character.md': {
    frontmatter: { name: 'Kaspen', role: 'Captain' },
    body: '',
  },
  'pan.md': {
    frontmatter: {
      name: 'Pan',
      trust_score: 70,
      arc_status: 'open',
      facts: ['Pan shared his backstory', 'Pan decided to join the crew'],
    },
    body: 'Pan dossier.',
  },
  'kaelen.md': {
    frontmatter: {
      name: 'Kaelen',
      trust_score: 50,
      // No facts field — should stay that way after consolidate
    },
    body: 'Kaelen dossier.',
  },
}
// Use a structured clone so the original is untouched
const wikiClone = JSON.parse(JSON.stringify(wikiForConsolidate)) as WikiMap
const consolidated = consolidate(wikiClone, 1, 2)

check(
  'pan.md facts cleared to empty array after consolidate',
  (() => {
    const fm = consolidated['pan.md']?.frontmatter
    return !!(fm && Array.isArray(fm.facts) && fm.facts.length === 0)
  })(),
)

check(
  'pan.md other frontmatter fields preserved (trust_score)',
  consolidated['pan.md']?.frontmatter?.trust_score === 70,
)

check(
  'pan.md other frontmatter fields preserved (name)',
  consolidated['pan.md']?.frontmatter?.name === 'Pan',
)

check(
  'kaelen.md does NOT gain a facts field (never had one)',
  !('facts' in (consolidated['kaelen.md']?.frontmatter ?? {})),
)

check(
  'kaelen.md other frontmatter fields preserved (trust_score)',
  consolidated['kaelen.md']?.frontmatter?.trust_score === 50,
)

// For comparison, check that consolidate does NOT add facts to a file with no frontmatter at all
const wikiWithBareFile: WikiMap = {
  'world-state.md': {
    frontmatter: { current_chapter: 1, current_anchor: 'A1' },
    body: '',
  },
  'player-character.md': {
    frontmatter: { name: 'Kaspen', role: 'Captain' },
    body: '',
  },
  'bare.md': {
    body: 'Just body, no frontmatter.',
  },
}
const consolidatedBare = consolidate(JSON.parse(JSON.stringify(wikiWithBareFile)) as WikiMap, 1, 2)

check(
  'file with no frontmatter does not gain facts after consolidate',
  !consolidatedBare['bare.md']?.frontmatter ||
  !('facts' in (consolidatedBare['bare.md']?.frontmatter ?? {})),
)

// ── Results ──────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
