// Smoke test for final-chapter data model (Phase 1).
// Run: npx tsx src/verify-final-chapter.ts
//
// Covers: Chapter interface fields, ChapterSpec fields, defineChapter defaults and
// blank-normalization, canAdvanceFrom, validateChapterSpec guardrails for malformed
// final fields, and backward-compatible old-spec JSON.

import { defineChapter, validateChapterSpec, type ChapterSpec } from './chapters/defineChapter.js'
import { getChapter, hasChapter, registerSpec, canAdvanceFrom, CHAPTER_END } from './chapters/index.js'
import type { Chapter } from './chapters/types.js'

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

const BASE_SPEC: ChapterSpec = {
  number: 99,
  title: 'Test Chapter',
  fragment: 'A test chapter fragment.',
  anchors: [{ id: 'A1', title: 'Start', note: 'Begin', advanceWhen: [{ field: 'test_flag', op: 'flag' }] }],
  events: [{ token: 'test_event', anchor: 'A1', fold: { field: 'test_flag' } }],
  opening: { prose: 'You arrive.', actions: ['Look around'] },
}

// ---------------------------------------------------------------------------
// §1 — Chapter interface has the new fields (type-level check + runtime check)
// ---------------------------------------------------------------------------
console.log('\n§1 — Chapter interface')

check('CHAPTER_1 has isFinal === false', () => {
  const ch1 = getChapter(1)
  assert(ch1.isFinal === false, `expected isFinal === false, got ${ch1.isFinal}`)
  assert(ch1.epilogue === undefined, `expected epilogue undefined, got ${ch1.epilogue}`)
  assert(ch1.acknowledgment === undefined, `expected acknowledgment undefined, got ${ch1.acknowledgment}`)
})

// ---------------------------------------------------------------------------
// §2 — defineChapter defaults and blank-normalization
// ---------------------------------------------------------------------------
console.log('\n§2 — defineChapter defaults & normalization')

check('isFinal defaults to false when omitted', () => {
  const ch = defineChapter(BASE_SPEC)
  assert(ch.isFinal === false, `expected false, got ${ch.isFinal}`)
})

check('isFinal === true passes through', () => {
  const ch = defineChapter({ ...BASE_SPEC, isFinal: true })
  assert(ch.isFinal === true, `expected true, got ${ch.isFinal}`)
})

check('isFinal: false passes through', () => {
  const ch = defineChapter({ ...BASE_SPEC, isFinal: false })
  assert(ch.isFinal === false, `expected false, got ${ch.isFinal}`)
})

check('epilogue omitted → undefined', () => {
  const ch = defineChapter(BASE_SPEC)
  assert(ch.epilogue === undefined, `expected undefined, got ${ch.epilogue}`)
})

check('acknowledgment omitted → undefined', () => {
  const ch = defineChapter(BASE_SPEC)
  assert(ch.acknowledgment === undefined, `expected undefined, got ${ch.acknowledgment}`)
})

check('epilogue whitespace-only → undefined', () => {
  const ch = defineChapter({ ...BASE_SPEC, epilogue: '   \n  ' })
  assert(ch.epilogue === undefined, `expected undefined, got "${ch.epilogue}"`)
})

check('acknowledgment whitespace-only → undefined', () => {
  const ch = defineChapter({ ...BASE_SPEC, acknowledgment: '\t  ' })
  assert(ch.acknowledgment === undefined, `expected undefined, got "${ch.acknowledgment}"`)
})

check('epilogue non-empty → preserved', () => {
  const ch = defineChapter({ ...BASE_SPEC, epilogue: '  A fitting close.  ' })
  assert(ch.epilogue === 'A fitting close.', `expected trimmed, got "${ch.epilogue}"`)
})

check('acknowledgment non-empty → preserved', () => {
  const ch = defineChapter({ ...BASE_SPEC, acknowledgment: '  Thanks to all.  ' })
  assert(ch.acknowledgment === 'Thanks to all.', `expected trimmed, got "${ch.acknowledgment}"`)
})

check('epilogue only, no acknowledgment', () => {
  const ch = defineChapter({ ...BASE_SPEC, isFinal: true, epilogue: 'The end.' })
  assert(ch.epilogue === 'The end.', `expected epilogue, got ${ch.epilogue}`)
  assert(ch.acknowledgment === undefined, `expected undefined, got ${ch.acknowledgment}`)
})

check('acknowledgment only, no epilogue', () => {
  const ch = defineChapter({ ...BASE_SPEC, isFinal: true, acknowledgment: 'Credits here.' })
  assert(ch.acknowledgment === 'Credits here.', `expected acknowledgment, got ${ch.acknowledgment}`)
  assert(ch.epilogue === undefined, `expected undefined, got ${ch.epilogue}`)
})

// Sanity check #1: defineChapter must NOT throw on a non-string closing field.
check('defineChapter does not throw on non-string epilogue', () => {
  const ch = defineChapter({ ...BASE_SPEC, epilogue: 42 as any })
  // should not have thrown; epilogue should be undefined since typeof !== 'string'
  assert(ch.epilogue === undefined, `expected undefined for non-string epilogue, got ${ch.epilogue}`)
})

check('defineChapter does not throw on non-string acknowledgment', () => {
  const ch = defineChapter({ ...BASE_SPEC, acknowledgment: true as any })
  assert(ch.acknowledgment === undefined, `expected undefined, got ${ch.acknowledgment}`)
})

// Sanity check #1: isFinal uses strict === true, not truthy.
check('defineChapter treats isFinal: 1 as false (strict check)', () => {
  const ch = defineChapter({ ...BASE_SPEC, isFinal: 1 as any })
  assert(ch.isFinal === false, `expected false for isFinal: 1, got ${ch.isFinal}`)
})

check('defineChapter treats isFinal: "true" as false (strict check)', () => {
  const ch = defineChapter({ ...BASE_SPEC, isFinal: 'true' as any })
  assert(ch.isFinal === false, `expected false, got ${ch.isFinal}`)
})

// ---------------------------------------------------------------------------
// §3 — canAdvanceFrom
// ---------------------------------------------------------------------------
console.log('\n§3 — canAdvanceFrom')

check('canAdvanceFrom returns true when successor exists and not final', () => {
  // Chapter 1 is not final; Chapter 2 must be registered for this to pass.
  // If no authored chapters exist, Chapter 2 won't exist — skip the succession
  // check and just verify that finality blocks.
  if (hasChapter(2)) {
    assert(canAdvanceFrom(1) === true, 'expected true: ch1 not final, ch2 exists')
  } else {
    // Chapter 1 is not final but Chapter 2 doesn't exist → canAdvanceFrom should be false.
    assert(canAdvanceFrom(1) === false, 'expected false: ch1 not final but ch2 missing')
  }
})

check('canAdvanceFrom returns false when chapter is final even with successor', () => {
  // Register a final chapter at 98, then a non-final at 99.
  const finalSpec: ChapterSpec = { ...BASE_SPEC, number: 98, isFinal: true }
  registerSpec(finalSpec)
  const nextSpec: ChapterSpec = { ...BASE_SPEC, number: 99 }
  registerSpec(nextSpec)
  assert(canAdvanceFrom(98) === false, 'final chapter must not advance even with successor')
})

check('canAdvanceFrom returns false when no successor (non-final)', () => {
  // Chapter 99 has no Chapter 100 registered.
  assert(canAdvanceFrom(99) === false, 'expected false: no successor')
})

check('canAdvanceFrom with both final AND no successor → false', () => {
  // Register a final chapter with no successor.
  const spec: ChapterSpec = { ...BASE_SPEC, number: 97, isFinal: true }
  registerSpec(spec)
  assert(canAdvanceFrom(97) === false, 'final with no successor must be false')
})

// ---------------------------------------------------------------------------
// §4 — validateChapterSpec guardrails (sanity check #1)
// ---------------------------------------------------------------------------
console.log('\n§4 — validateChapterSpec malformed final fields')

check('validateChapterSpec passes for spec without isFinal', () => {
  const problems = validateChapterSpec(BASE_SPEC)
  assert(problems.length === 0, `expected 0 problems, got ${problems.length}: ${problems.join('; ')}`)
})

check('validateChapterSpec passes for spec with isFinal: true', () => {
  const spec = { ...BASE_SPEC, isFinal: true, epilogue: 'Done.', acknowledgment: 'Thanks.' }
  const problems = validateChapterSpec(spec)
  assert(problems.length === 0, `expected 0 problems, got ${problems.length}: ${problems.join('; ')}`)
})

check('validateChapterSpec rejects isFinal as number', () => {
  const problems = validateChapterSpec({ ...BASE_SPEC, isFinal: 1 })
  assert(problems.some((p) => p.includes('isFinal')), `expected isFinal complaint, got: ${problems.join('; ')}`)
})

check('validateChapterSpec rejects isFinal as string', () => {
  const problems = validateChapterSpec({ ...BASE_SPEC, isFinal: 'true' })
  assert(problems.some((p) => p.includes('isFinal')), `expected isFinal complaint, got: ${problems.join('; ')}`)
})

check('validateChapterSpec rejects epilogue as number', () => {
  const problems = validateChapterSpec({ ...BASE_SPEC, epilogue: 123 })
  assert(problems.some((p) => p.includes('epilogue')), `expected epilogue complaint, got: ${problems.join('; ')}`)
})

check('validateChapterSpec rejects acknowledgment as boolean', () => {
  const problems = validateChapterSpec({ ...BASE_SPEC, acknowledgment: false })
  assert(problems.some((p) => p.includes('acknowledgment')), `expected acknowledgment complaint, got: ${problems.join('; ')}`)
})

check('validateChapterSpec allows isFinal: false explicitly', () => {
  const problems = validateChapterSpec({ ...BASE_SPEC, isFinal: false })
  assert(problems.length === 0, `expected 0 problems, got ${problems.length}: ${problems.join('; ')}`)
})

// ---------------------------------------------------------------------------
// §5 — Backward compatibility: old persisted JSON without new fields
// ---------------------------------------------------------------------------
console.log('\n§5 — Backward compatibility')

check('defineChapter with pre-final-fields spec (no isFinal/epilogue/acknowledgment)', () => {
  // Simulates a ChapterSpec JSON blob persisted before this feature was added.
  const oldSpec = JSON.parse(JSON.stringify(BASE_SPEC)) as ChapterSpec
  // Ensure the JSON round-trip didn't add undefined keys.
  assert(!('isFinal' in oldSpec), 'old spec should not have isFinal')
  const ch = defineChapter(oldSpec)
  assert(ch.isFinal === false, 'default should be false')
  assert(ch.epilogue === undefined, 'default should be undefined')
  assert(ch.acknowledgment === undefined, 'default should be undefined')
})

check('validateChapterSpec on pre-final-fields spec passes', () => {
  const oldSpec = JSON.parse(JSON.stringify(BASE_SPEC))
  const problems = validateChapterSpec(oldSpec)
  assert(problems.length === 0, `old spec should pass validation, got: ${problems.join('; ')}`)
})

// ---------------------------------------------------------------------------
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
