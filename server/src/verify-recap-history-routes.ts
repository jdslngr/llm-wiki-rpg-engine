// Live HTTP verifier for recap-history routes (Phase 4).
// Run: npx tsx src/verify-recap-history-routes.ts
//
// Spins up a real Express app with cookie-parser, the production requireAuth
// middleware, a memory-backed store, and the recapHistoryRoutes router.
// Sends real HTTP requests, then closes the server in finally.
//
// Covers: auth wall (no session → 401), ownership (no pid / foreign pid → 404),
// list/detail shapes, legacy fallback, malformed chapter numbers (400), missing
// recap (404), and read-only behavior (no save/snapshot/generation).

import express from 'express'
import cookieParser from 'cookie-parser'
import { createMemoryStore, type PlaythroughStore } from './store.js'
import { requireAuth, hashPassword } from './auth.js'
import { recapHistoryRoutes } from './recapHistoryRoutes.js'
import { appendArchivedRecap, ARCHIVE_FILE, type ArchivedRecapEntry } from './recapArchive.js'
import { buildStarterWiki, type PlayableId } from './game/characters.js'
import type { WikiMap, Turn } from './types.js'
import type { RecapFacts } from './recap.js'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'

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

// ── Fixture setup ────────────────────────────────────────────────────────────

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

function makeArchiveEntry(chapterNumber: number, overrides: Partial<ArchivedRecapEntry> = {}): ArchivedRecapEntry {
  return {
    chapterNumber,
    chapterTitle: `Chapter ${chapterNumber}`,
    title: `Recap Title ${chapterNumber}`,
    prose: `Recap prose for chapter ${chapterNumber}.`,
    facts: { ...MINIMAL_FACTS, chapterNumber },
    isFinal: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeWikiWithArchive(entries: ArchivedRecapEntry[]): WikiMap {
  const wiki = buildStarterWiki('kaspen' as PlayableId)
  wiki['world-state.md']!.frontmatter!.current_chapter = 1
  wiki['world-state.md']!.frontmatter!.current_anchor = 'A1'
  let w = wiki
  for (const entry of entries) {
    w = appendArchivedRecap(w, entry)
  }
  return w
}

function makeWikiWithLegacyLog(legacyBody: string): WikiMap {
  const wiki = buildStarterWiki('kaspen' as PlayableId)
  wiki['world-state.md']!.frontmatter!.current_chapter = 1
  wiki['world-state.md']!.frontmatter!.current_anchor = 'A1'
  wiki['chapter-log.md'] = { frontmatter: {}, body: legacyBody }
  return wiki
}

async function createTestFixture(store: PlaythroughStore): Promise<{
  userId: string
  sessionToken: string
  playthroughId: string
}> {
  const passwordHash = await hashPassword('testpass')
  const user = await store.createUser('tester', passwordHash)
  const session = await store.createSession(user.id)
  const wiki = makeWikiWithArchive([makeArchiveEntry(1), makeArchiveEntry(2)])
  const pt = await store.create('kaspen', wiki, [], user.id)
  return {
    userId: user.id,
    sessionToken: session.id,
    playthroughId: pt.id,
  }
}

// ── App factory ──────────────────────────────────────────────────────────────

function createApp(store: PlaythroughStore): express.Application {
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.use(cookieParser())
  app.use('/api', requireAuth(store))
  app.use('/api/recaps', recapHistoryRoutes(store))
  return app
}

async function listen(app: express.Application): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address() as AddressInfo
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` })
    })
    server.on('error', reject)
  })
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchJson(url: string, opts: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { ...opts, redirect: 'manual' })
  const body = await res.json().catch(() => null)
  return { status: res.status, body }
}

function cookieHeader(sid: string, pid?: string): string {
  const cookies = [`sid=${sid}`]
  if (pid) cookies.push(`pid=${pid}`)
  return cookies.join('; ')
}

// ── Tests ────────────────────────────────────────────────────────────────────

let store: PlaythroughStore
let app: express.Application
let server: Server | null = null
let baseUrl: string
let fixture: { userId: string; sessionToken: string; playthroughId: string }

// Set up before each test. Closes the previous server if one exists.
const setup = async () => {
  server?.close(); server = null
  store = createMemoryStore()
  fixture = await createTestFixture(store)
  app = createApp(store)
  const result = await listen(app)
  server = result.server
  baseUrl = result.baseUrl
}

// ── §1 — Auth wall ───────────────────────────────────────────────────────────
const setupThen = (fn: () => void | Promise<void>) => async () => {
  await setup()
  await fn()
}

check('no session cookie → 401', setupThen(async () => {
  const { status } = await fetchJson(`${baseUrl}/api/recaps`)
  assert(status === 401, `expected 401, got ${status}`)
}))

check('invalid session cookie → 401', setupThen(async () => {
  const { status } = await fetchJson(`${baseUrl}/api/recaps`, {
    headers: { Cookie: 'sid=invalid-session' },
  })
  assert(status === 401, `expected 401, got ${status}`)
}))

// ── §2 — Ownership (no pid / foreign pid) ────────────────────────────────────
check('valid session, no pid cookie → 404', setupThen(async () => {
  const { status, body } = await fetchJson(`${baseUrl}/api/recaps`, {
    headers: { Cookie: cookieHeader(fixture.sessionToken) },
  })
  assert(status === 404, `expected 404, got ${status}`)
  assert(body?.error === 'No active game.', `wrong error: ${JSON.stringify(body)}`)
}))

check('valid session, foreign pid → 404', setupThen(async () => {
  const foreignId = randomUUID()
  const { status, body } = await fetchJson(`${baseUrl}/api/recaps`, {
    headers: { Cookie: cookieHeader(fixture.sessionToken, foreignId) },
  })
  assert(status === 404, `expected 404, got ${status}`)
  assert(body?.error === 'No active game.', `wrong error: ${JSON.stringify(body)}`)
}))

// ── §3 — List endpoint ───────────────────────────────────────────────────────
check('GET /api/recaps returns newest-first summaries', setupThen(async () => {
  const { status, body } = await fetchJson(`${baseUrl}/api/recaps`, {
    headers: { Cookie: cookieHeader(fixture.sessionToken, fixture.playthroughId) },
  })
  assert(status === 200, `expected 200, got ${status}`)
  assert(Array.isArray(body?.recaps), 'recaps must be an array')
  assert(body.recaps.length === 2, `expected 2 recaps, got ${body.recaps.length}`)
  // Newest first: chapter 2 then 1.
  assert(body.recaps[0].chapterNumber === 2, 'first should be ch2')
  assert(body.recaps[1].chapterNumber === 1, 'second should be ch1')
  assert(body.recaps[0].title === 'Recap Title 2', 'title preserved')
  assert(body.recaps[0].isFinal === false, 'isFinal preserved')
  assert(typeof body.recaps[0].createdAt === 'string', 'createdAt present')
}))

check('GET /api/recaps with no archive returns empty list', setupThen(async () => {
  // Create a separate store + playthrough with no archive.
  const s = createMemoryStore()
  const pwHash = await hashPassword('testpass2')
  const u = await s.createUser('tester2', pwHash)
  const session = await s.createSession(u.id)
  const wiki = buildStarterWiki('kaspen' as PlayableId)
  wiki['world-state.md']!.frontmatter!.current_chapter = 1
  const pt = await s.create('kaspen', wiki, [], u.id)

  const a = createApp(s)
  const { server: srv, baseUrl: url } = await listen(a)
  try {
    const { status, body } = await fetchJson(`${url}/api/recaps`, {
      headers: { Cookie: cookieHeader(session.id, pt.id) },
    })
    assert(status === 200, `expected 200, got ${status}`)
    assert(Array.isArray(body?.recaps), 'recaps must be array')
    assert(body.recaps.length === 0, `expected 0 recaps, got ${body.recaps.length}`)
  } finally {
    srv.close()
  }
}))

// ── §4 — Detail endpoint (archive) ───────────────────────────────────────────
check('GET /api/recaps/1 returns exact archive entry', setupThen(async () => {
  const { status, body } = await fetchJson(`${baseUrl}/api/recaps/1`, {
    headers: { Cookie: cookieHeader(fixture.sessionToken, fixture.playthroughId) },
  })
  assert(status === 200, `expected 200, got ${status}`)
  assert(body?.legacy === false, 'must not be legacy')
  assert(body?.recap?.chapterNumber === 1, 'chapter number')
  assert(body?.recap?.title === 'Recap Title 1', 'title')
  assert(body?.recap?.prose === 'Recap prose for chapter 1.', 'prose')
  assert(body?.recap?.facts?.chapterTitle === 'Test Chapter', 'facts chapterTitle')
  assert(body?.recap?.isFinal === false, 'isFinal')
  assert(typeof body?.recap?.createdAt === 'string', 'createdAt')
}))

check('GET /api/recaps/2 returns exact archive entry', setupThen(async () => {
  const { status, body } = await fetchJson(`${baseUrl}/api/recaps/2`, {
    headers: { Cookie: cookieHeader(fixture.sessionToken, fixture.playthroughId) },
  })
  assert(status === 200, `expected 200, got ${status}`)
  assert(body?.recap?.chapterNumber === 2, 'ch2 detail')
}))

// ── §5 — Detail endpoint (legacy fallback) ───────────────────────────────────
check('GET /api/recaps/1 returns legacy entry when no archive', setupThen(async () => {
  const s = createMemoryStore()
  const pwHash = await hashPassword('testpass3')
  const u = await s.createUser('tester3', pwHash)
  const session = await s.createSession(u.id)
  const wiki = makeWikiWithLegacyLog('## Chapter 1: The Long Goodbye\nLegacy prose here.')
  const pt = await s.create('kaspen', wiki, [], u.id)

  const a = createApp(s)
  const { server: srv, baseUrl: url } = await listen(a)
  try {
    const { status, body } = await fetchJson(`${url}/api/recaps/1`, {
      headers: { Cookie: cookieHeader(session.id, pt.id) },
    })
    assert(status === 200, `expected 200, got ${status}`)
    assert(body?.legacy === true, 'must be legacy')
    assert(body?.recap?.chapterNumber === 1, 'chapter number')
    assert(body?.recap?.chapterTitle === 'The Long Goodbye', 'chapter title')
    assert(body?.recap?.prose === 'Legacy prose here.', 'prose')
    assert(body?.recap?.legacy === true, 'legacy flag')
  } finally {
    srv.close()
  }
}))

check('archive wins over legacy for same chapter', setupThen(async () => {
  // Create playthrough with BOTH an archive entry AND a legacy entry for ch1.
  const s = createMemoryStore()
  const pwHash = await hashPassword('testpass4')
  const u = await s.createUser('tester4', pwHash)
  const session = await s.createSession(u.id)
  let wiki = makeWikiWithArchive([makeArchiveEntry(1, { title: 'Archive Wins' })])
  wiki['chapter-log.md'] = {
    frontmatter: {},
    body: '## Chapter 1: Legacy Version\nLegacy prose here.',
  }
  const pt = await s.create('kaspen', wiki, [], u.id)

  const a = createApp(s)
  const { server: srv, baseUrl: url } = await listen(a)
  try {
    const { status, body } = await fetchJson(`${url}/api/recaps/1`, {
      headers: { Cookie: cookieHeader(session.id, pt.id) },
    })
    assert(status === 200, `expected 200, got ${status}`)
    assert(body?.legacy === false, 'archive must win — not legacy')
    assert(body?.recap?.title === 'Archive Wins', 'archive title')
  } finally {
    srv.close()
  }
}))

// ── §6 — Missing recap ───────────────────────────────────────────────────────
check('GET /api/recaps/99 returns 404 when no recap', setupThen(async () => {
  const { status, body } = await fetchJson(`${baseUrl}/api/recaps/99`, {
    headers: { Cookie: cookieHeader(fixture.sessionToken, fixture.playthroughId) },
  })
  assert(status === 404, `expected 404, got ${status}`)
  assert(body?.error === 'Recap not found.', `wrong error: ${JSON.stringify(body)}`)
}))

// ── §7 — Malformed chapter numbers (400) ─────────────────────────────────────
const MALFORMED_CASES: [string, string][] = [
  ['1junk', 'letters after digits'],
  ['1.5', 'decimal'],
  ['1e2', 'scientific notation'],
  ['0', 'zero'],
  ['-1', 'negative'],
  [' 1', 'leading space'],
  ['1 ', 'trailing space'],
  ['9999999999999999', 'exceeds MAX_SAFE_INTEGER'],
  ['chapter1', 'no digits at start'],
  // ['', 'empty string'], — Express doesn't route empty path segments to named params;
  // an empty :chapterNumber falls through to the list endpoint, which returns 200.
]

for (const [input, label] of MALFORMED_CASES) {
  check(`malformed chapter number "${input}" (${label}) → 400`, setupThen(async () => {
    const { status, body } = await fetchJson(`${baseUrl}/api/recaps/${encodeURIComponent(input)}`, {
      headers: { Cookie: cookieHeader(fixture.sessionToken, fixture.playthroughId) },
    })
    assert(status === 400, `expected 400 for "${input}", got ${status}`)
    assert(body?.error === 'Invalid chapter number.', `wrong error: ${JSON.stringify(body)}`)
  }))
}

// ── §8 — Read-only behavior (no save/snapshot/generation) ────────────────────
check('GET /api/recaps does not mutate playthrough state', setupThen(async () => {
  const before = await store.get(fixture.playthroughId)
  await fetchJson(`${baseUrl}/api/recaps`, {
    headers: { Cookie: cookieHeader(fixture.sessionToken, fixture.playthroughId) },
  })
  const after = await store.get(fixture.playthroughId)
  assert(JSON.stringify(before?.wiki) === JSON.stringify(after?.wiki), 'wiki unchanged')
  assert(JSON.stringify(before?.history) === JSON.stringify(after?.history), 'history unchanged')
}))

check('GET /api/recaps/1 does not mutate playthrough state', setupThen(async () => {
  const before = await store.get(fixture.playthroughId)
  await fetchJson(`${baseUrl}/api/recaps/1`, {
    headers: { Cookie: cookieHeader(fixture.sessionToken, fixture.playthroughId) },
  })
  const after = await store.get(fixture.playthroughId)
  assert(JSON.stringify(before?.wiki) === JSON.stringify(after?.wiki), 'wiki unchanged')
}))

// ── Run all tests sequentially ───────────────────────────────────────────────

;(async () => {
  for (const test of tests) {
    await test()
  }
  ;(server as Server | null)?.close()
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
})()
