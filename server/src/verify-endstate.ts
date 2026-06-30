// Smoke test for ChapterSpec.endState (AI-authoring + DB + UI support).
// Run: npx tsx src/verify-endstate.ts
//
// Covers: applyEndStateOps, defineChapter wiring, end-to-end parity with
// chapter3's hand-written pattern, validateChapterSpec guardrails, crash-safety
// regressions, gatherEndStateOps, and cross-chapter mismatch detection.

import {
  applyEndStateOps,
  defineChapter,
  validateChapterSpec,
  gatherEndStateOps,
  ENDSTATE_FIELD_PREFIX,
  type EndStateOp,
} from './chapters/defineChapter.js'
import { CHAPTER_END } from './chapters/types.js'
import type { WikiMap } from './types.js'

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

function emptyWiki(): WikiMap {
  return {}
}

// ---------------------------------------------------------------------------
// §1 — applyEndStateOps
// ---------------------------------------------------------------------------
console.log('\n§1 — applyEndStateOps')

check('set creates a new field', () => {
  const wiki = emptyWiki()
  applyEndStateOps([{ field: 'chapterend_foo', op: 'set', value: true }], wiki)
  if (wiki['world-state.md']?.frontmatter?.['chapterend_foo'] !== true) {
    throw new Error('expected chapterend_foo = true')
  }
})

check('set overwrites an existing field', () => {
  const wiki: WikiMap = { 'world-state.md': { frontmatter: { chapterend_foo: 'old' }, body: '' } }
  applyEndStateOps([{ field: 'chapterend_foo', op: 'set', value: 'new' }], wiki)
  if (wiki['world-state.md']?.frontmatter?.['chapterend_foo'] !== 'new') {
    throw new Error('expected overwrite')
  }
})

check('append with no prior value creates a singleton array', () => {
  const wiki = emptyWiki()
  applyEndStateOps([{ field: 'chapterend_list', op: 'append', value: 'first' }], wiki)
  const v = wiki['world-state.md']?.frontmatter?.['chapterend_list']
  if (!Array.isArray(v) || v.length !== 1 || v[0] !== 'first') {
    throw new Error(`expected ['first'], got ${JSON.stringify(v)}`)
  }
})

check('append onto an existing array preserves order', () => {
  const wiki: WikiMap = { 'world-state.md': { frontmatter: { chapterend_list: ['a'] }, body: '' } }
  applyEndStateOps([{ field: 'chapterend_list', op: 'append', value: 'b' }], wiki)
  const v = wiki['world-state.md']?.frontmatter?.['chapterend_list']
  if (!Array.isArray(v) || v.length !== 2 || v[0] !== 'a' || v[1] !== 'b') {
    throw new Error(`expected ['a','b'], got ${JSON.stringify(v)}`)
  }
})

check('append coercing a non-array prior value to []', () => {
  const wiki: WikiMap = { 'world-state.md': { frontmatter: { chapterend_list: 'not-an-array' }, body: '' } }
  applyEndStateOps([{ field: 'chapterend_list', op: 'append', value: 'x' }], wiki)
  const v = wiki['world-state.md']?.frontmatter?.['chapterend_list']
  if (!Array.isArray(v) || v.length !== 1 || v[0] !== 'x') {
    throw new Error(`expected ['x'] after coercion, got ${JSON.stringify(v)}`)
  }
})

check('set then append on same field — set value is discarded (documented behavior)', () => {
  const wiki: WikiMap = { 'world-state.md': { frontmatter: { chapterend_x: 'should-be-lost' }, body: '' } }
  applyEndStateOps([
    { field: 'chapterend_x', op: 'set', value: 'set-value' },
    { field: 'chapterend_x', op: 'append', value: 'appended' },
  ], wiki)
  const v = wiki['world-state.md']?.frontmatter?.['chapterend_x']
  // The set value ('set-value') is a string, not an array, so asArray coerces
  // it to []. Then append pushes 'appended' → ['appended'].
  if (Array.isArray(v) && v.length === 1 && v[0] === 'appended') {
    // Correct: set was discarded by append's array-coercion.
  } else {
    throw new Error(`expected ['appended'] (set discarded), got ${JSON.stringify(v)}`)
  }
})

check('append preserves other frontmatter fields', () => {
  const wiki: WikiMap = { 'world-state.md': { frontmatter: { other: 42 }, body: '' } }
  applyEndStateOps([{ field: 'chapterend_x', op: 'append', value: 'y' }], wiki)
  if (wiki['world-state.md']?.frontmatter?.['other'] !== 42) {
    throw new Error('other field was lost')
  }
})

// ---------------------------------------------------------------------------
// §2 — defineChapter wiring
// ---------------------------------------------------------------------------
console.log('\n§2 — defineChapter wiring')

const MINIMAL_SPEC = {
  number: 1,
  title: 'Test',
  fragment: 'Test fragment.',
  anchors: [{ id: 'a1', title: 'Beat', note: 'A beat.', advanceWhen: [{ field: 'done', op: 'flag' as const }] }],
  events: [{ token: 'go', anchor: 'a1', fold: { field: 'done' } }],
  opening: { prose: 'Go.', actions: ['go'] },
}

check('endState undefined when spec has no endState', () => {
  const ch = defineChapter(MINIMAL_SPEC)
  if (ch.endState !== undefined) throw new Error('expected undefined endState')
})

check('endState undefined when spec has empty endState array', () => {
  const ch = defineChapter({ ...MINIMAL_SPEC, endState: [] })
  if (ch.endState !== undefined) throw new Error('expected undefined for empty array')
})

check('calling the built endState matches calling applyEndStateOps directly', () => {
  const spec = {
    ...MINIMAL_SPEC,
    endState: [{ field: 'chapterend_test', op: 'set' as const, value: 'hello' }],
  }
  const ch = defineChapter(spec)

  const wiki1 = emptyWiki()
  ch.endState!(wiki1)

  const wiki2 = emptyWiki()
  applyEndStateOps(spec.endState, wiki2)

  const v1 = wiki1['world-state.md']?.frontmatter?.['chapterend_test']
  const v2 = wiki2['world-state.md']?.frontmatter?.['chapterend_test']
  if (v1 !== v2) throw new Error(`mismatch: ${JSON.stringify(v1)} vs ${JSON.stringify(v2)}`)
})

// ---------------------------------------------------------------------------
// §3 — End-to-end parity with chapter3.ts's hand-written pattern
// ---------------------------------------------------------------------------
console.log('\n§3 — End-to-end parity with chapter3 hand-written endState')

check('spec-driven endState matches chapter3 pattern (append + set)', () => {
  const spec = {
    ...MINIMAL_SPEC,
    endState: [
      { field: 'chapterend_spires_seeded', op: 'append' as const, value: 'taiwan' },
      { field: 'chapterend_artifact_hazard_to_gnomes', op: 'set' as const, value: true },
    ],
  }
  const wiki = emptyWiki()
  applyEndStateOps(spec.endState, wiki)
  const fm = wiki['world-state.md']?.frontmatter ?? {}
  if (fm['chapterend_artifact_hazard_to_gnomes'] !== true) throw new Error('set field missing/wrong')
  const ss = fm['chapterend_spires_seeded']
  if (!Array.isArray(ss) || !ss.includes('taiwan')) throw new Error(`append field wrong: ${JSON.stringify(ss)}`)
})

// ---------------------------------------------------------------------------
// §4 — validateChapterSpec guardrail rejections
// ---------------------------------------------------------------------------
console.log('\n§4 — validateChapterSpec guardrail rejections')

check('missing prefix on endState field is rejected', () => {
  const spec = { ...MINIMAL_SPEC, endState: [{ field: 'no_prefix', op: 'set', value: 1 }] }
  const problems = validateChapterSpec(spec)
  const match = problems.some((p) => p.includes('no_prefix') && p.includes(ENDSTATE_FIELD_PREFIX))
  if (!match) throw new Error(`expected prefix rejection, got: ${problems.join(' | ')}`)
})

check('event fold field with chapterend_ prefix is rejected', () => {
  const spec = {
    ...MINIMAL_SPEC,
    events: [{ token: 'go', anchor: 'a1', fold: { field: 'chapterend_bad' } }],
  }
  const problems = validateChapterSpec(spec)
  const match = problems.some((p) => p.includes('chapterend_bad') && p.includes('reserved'))
  if (!match) throw new Error(`expected fold-field rejection, got: ${problems.join(' | ')}`)
})

check('unknown endState op is rejected', () => {
  const spec = {
    ...MINIMAL_SPEC,
    endState: [{ field: 'chapterend_x', op: 'delete', value: null }],
  }
  const problems = validateChapterSpec(spec)
  const match = problems.some((p) => p.includes('delete') && p.includes('unknown op'))
  if (!match) throw new Error(`expected unknown-op rejection, got: ${problems.join(' | ')}`)
})

check('endState with missing field produces clean problem', () => {
  const spec = {
    ...MINIMAL_SPEC,
    endState: [{ op: 'set', value: 1 }],
  }
  const problems = validateChapterSpec(spec)
  const match = problems.some((p) => p.includes('missing its field'))
  if (!match) throw new Error(`expected missing-field problem, got: ${problems.join(' | ')}`)
})

check('valid spec with proper endState passes clean', () => {
  const spec = {
    ...MINIMAL_SPEC,
    endState: [{ field: 'chapterend_ok', op: 'set', value: 'done' }],
  }
  const problems = validateChapterSpec(spec)
  if (problems.length !== 0) throw new Error(`expected clean, got: ${problems.join(' | ')}`)
})

// ---------------------------------------------------------------------------
// §5 — Crash-safety regressions (bugs caught in review)
// ---------------------------------------------------------------------------
console.log('\n§5 — Crash-safety regressions')

check('endState entry with no field at all does not throw', () => {
  const spec = {
    ...MINIMAL_SPEC,
    endState: [{ op: 'set', value: 1 }],
  }
  let threw = false
  try {
    validateChapterSpec(spec)
  } catch {
    threw = true
  }
  if (threw) throw new Error('validateChapterSpec threw on missing field — should return a problem instead')
})

check('spec.endState as a non-array value (string) does not throw', () => {
  const spec = {
    ...MINIMAL_SPEC,
    endState: 'oops',
  }
  let threw = false
  let result: string[] = []
  try {
    result = validateChapterSpec(spec)
  } catch {
    threw = true
  }
  if (threw) throw new Error('validateChapterSpec threw on string endState')
  // Should not character-iterate — a string of length 4 would produce 4 loop
  // iterations if we'd used ?? [] instead of asArray.
})

check('spec.endState as null does not throw', () => {
  const spec = {
    ...MINIMAL_SPEC,
    endState: null,
  }
  let threw = false
  try {
    validateChapterSpec(spec)
  } catch {
    threw = true
  }
  if (threw) throw new Error('validateChapterSpec threw on null endState')
})

// ---------------------------------------------------------------------------
// §6 — Golden-rule exemption for chapterend_ fields
// ---------------------------------------------------------------------------
console.log('\n§6 — Golden-rule exemption')

check('condition reading a chapterend_-prefixed unfed field is NOT flagged', () => {
  const spec = {
    ...MINIMAL_SPEC,
    anchors: [{
      id: 'a1', title: 'Beat', note: 'A beat.',
      advanceWhen: [{ field: 'chapterend_from_prior', op: 'flag' as const }],
    }],
  }
  const problems = validateChapterSpec(spec)
  const softLock = problems.filter((p) => p.includes('soft-lock'))
  if (softLock.length > 0) {
    throw new Error(`chapterend_ field should be exempt, got: ${softLock.join(' | ')}`)
  }
})

check('condition reading a non-prefixed, genuinely unfed field IS still flagged', () => {
  const spec = {
    ...MINIMAL_SPEC,
    anchors: [{
      id: 'a1', title: 'Beat', note: 'A beat.',
      advanceWhen: [{ field: 'nobody_sets_this', op: 'flag' as const }],
    }],
  }
  const problems = validateChapterSpec(spec)
  const softLock = problems.filter((p) => p.includes('soft-lock') && p.includes('nobody_sets_this'))
  if (softLock.length === 0) {
    throw new Error('non-prefixed unfed field should still be flagged')
  }
})

// ---------------------------------------------------------------------------
// §7 — gatherEndStateOps
// ---------------------------------------------------------------------------
console.log('\n§7 — gatherEndStateOps')

check('builds the right map from a list of specs', () => {
  const specs = [
    { number: 1, endState: [{ field: 'chapterend_a', op: 'set' as const, value: 1 }] },
    { number: 2, endState: [{ field: 'chapterend_b', op: 'append' as const, value: 'x' }] },
  ]
  const map = gatherEndStateOps(specs, undefined)
  if (map['chapterend_a'] !== 'set') throw new Error(`expected set, got ${map['chapterend_a']}`)
  if (map['chapterend_b'] !== 'append') throw new Error(`expected append, got ${map['chapterend_b']}`)
})

check('excludes the named chapter', () => {
  const specs = [
    { number: 1, endState: [{ field: 'chapterend_a', op: 'set' as const, value: 1 }] },
    { number: 2, endState: [{ field: 'chapterend_b', op: 'append' as const, value: 'x' }] },
  ]
  const map = gatherEndStateOps(specs, 1)
  if ('chapterend_a' in map) throw new Error('chapter 1 should be excluded')
  if (map['chapterend_b'] !== 'append') throw new Error('chapter 2 should still be present')
})

check('tolerates excludeNumber: undefined without throwing', () => {
  const specs = [
    { number: 1, endState: [{ field: 'chapterend_a', op: 'set' as const, value: 1 }] },
  ]
  let threw = false
  try {
    gatherEndStateOps(specs, undefined)
  } catch {
    threw = true
  }
  if (threw) throw new Error('should not throw on undefined excludeNumber')
})

check('later entries win on same-field disagreement (edge case)', () => {
  const specs = [
    { number: 1, endState: [{ field: 'chapterend_x', op: 'set' as const, value: 1 }] },
    { number: 2, endState: [{ field: 'chapterend_x', op: 'append' as const, value: 'y' }] },
  ]
  const map = gatherEndStateOps(specs, undefined)
  if (map['chapterend_x'] !== 'append') throw new Error(`later should win, got ${map['chapterend_x']}`)
})

check('specs with no endState are handled gracefully', () => {
  const specs = [
    { number: 1 },
    { number: 2, endState: [{ field: 'chapterend_b', op: 'set' as const, value: 1 }] },
  ]
  const map = gatherEndStateOps(specs, undefined)
  if (map['chapterend_b'] !== 'set') throw new Error('chapter 2 field missing')
})

// ---------------------------------------------------------------------------
// §8 — Cross-chapter mismatch in validateChapterSpec
// ---------------------------------------------------------------------------
console.log('\n§8 — Cross-chapter mismatch detection')

check('mismatched op on same field is rejected', () => {
  const spec = {
    ...MINIMAL_SPEC,
    endState: [{ field: 'chapterend_spires', op: 'append' as const, value: 'x' }],
  }
  const problems = validateChapterSpec(spec, { chapterend_spires: 'set' })
  const match = problems.some((p) => p.includes('chapterend_spires') && p.includes('different op'))
  if (!match) throw new Error(`expected cross-chapter rejection, got: ${problems.join(' | ')}`)
})

check('same field + same op is clean', () => {
  const spec = {
    ...MINIMAL_SPEC,
    endState: [{ field: 'chapterend_spires', op: 'append' as const, value: 'x' }],
  }
  const problems = validateChapterSpec(spec, { chapterend_spires: 'append' })
  if (problems.length !== 0) throw new Error(`expected clean, got: ${problems.join(' | ')}`)
})

check('field not present in existingEndState map at all is clean', () => {
  const spec = {
    ...MINIMAL_SPEC,
    endState: [{ field: 'chapterend_new', op: 'set' as const, value: 1 }],
  }
  const problems = validateChapterSpec(spec, { chapterend_other: 'set' })
  if (problems.length !== 0) throw new Error(`expected clean, got: ${problems.join(' | ')}`)
})

// ---------------------------------------------------------------------------
// §9 — Regression: verify-facts and verify-chapter-fold still pass
// ---------------------------------------------------------------------------
console.log('\n§9 — Regression: existing smoke tests')

import { execSync } from 'child_process'

function runSmokeTest(label: string, file: string): void {
  try {
    execSync(`npx tsx ${file}`, { stdio: 'pipe', encoding: 'utf-8', timeout: 30_000 })
    passed++
    console.log(`  \x1b[32m✓\x1b[0m ${label}`)
  } catch (e: any) {
    failed++
    console.log(`  \x1b[31m✗\x1b[0m ${label}`)
    console.log(`    ${e.message?.split('\n').slice(0, 3).join('\n    ') ?? e}`)
  }
}

runSmokeTest('verify-facts.ts', 'src/verify-facts.ts')
runSmokeTest('verify-chapter-fold.ts', 'src/verify-chapter-fold.ts')

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
