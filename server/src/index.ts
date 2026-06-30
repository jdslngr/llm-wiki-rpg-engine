import 'dotenv/config'
import express from 'express'
import cookieParser from 'cookie-parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { askLLM } from './llm.js'
import { validateCredentials } from './llm.js'
import { encryptKey, decryptKey } from './crypto.js'
import { streamPlayTurn, finalizeStructured, type PlayTurnRequest } from './playTurn.js'
import { FRIENDLY_TURN_ERROR } from './retry.js'
import { createStore, UserExistsError, type PlaythroughStore } from './store.js'
import { runWriteBack } from './engine.js'
import { consolidate, appendChapterLog } from './consolidate.js'
import { migrateWiki } from './migrate.js'
import { getChapter, hasChapter, registerSpec, unregisterChapter, loadAuthoredChapters, CHAPTER_END } from './chapters/index.js'
import { anchorOf, chapterNumOf, chapterMetaOf } from './chapterMeta.js'
import { buildRecapFacts, generateRecapProse } from './recap.js'
import { CHARACTERS, isPlayableId, buildStarterWiki, type PlayableId } from './game/characters.js'
import { openingFor } from './game/openings.js'
import { hashPassword, verifyPassword, validateUsername, validatePassword, requireAuth, requireAdmin, isAdminUsername, SID_COOKIE, SID_COOKIE_OPTS } from './auth.js'
import { validateChapterSpec, gatherEndStateOps } from './chapters/defineChapter.js'
import { expandChapterSpec, type ChapterBrief } from './expandChapter.js'
import type { Turn, WikiMap, UserSettingsUpdate } from './types.js'

// The store is chosen at boot: Postgres if DATABASE_URL is reachable, else in-memory.
const store = await createStore()

// Load any AI-authored chapters from the store into the registry so they're playable.
const loadedChapters = await loadAuthoredChapters(store)
if (loadedChapters) console.log(`[chapters] loaded ${loadedChapters} authored chapter(s)`)
// Admin list set via ADMIN_USERNAMES env var (comma-separated).

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

// The httpOnly cookie that identifies a playthrough — now gated behind auth (Phase 3).
const PID_COOKIE = 'pid'
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year
  path: '/',
}

// --- helpers ---------------------------------------------------------------

function dossierFor(character: string, displayName?: string) {
  const c = CHARACTERS[character as PlayableId] ?? CHARACTERS.kaspen
  const name = displayName?.trim() || c.name
  const povLabel = displayName?.trim()
    ? `a modern human named ${displayName.trim()}, transported into 100,000 BCE, to whom this world is utterly new`
    : c.povLabel
  return { id: c.id, name, role: c.role, knowsLabel: c.knowsLabel, dossier: c.dossier, povLabel }
}

function settingBody(wiki: WikiMap): string {
  return String(wiki['world-state.md']?.body ?? '')
}

// Map of filename -> frontmatter, for the client's debug panel.
function wikiStateOf(wiki: WikiMap): Record<string, unknown> {
  return Object.fromEntries(Object.entries(wiki).map(([k, v]) => [k, v.frontmatter ?? {}]))
}

function lastActionsOf(wiki: WikiMap): string[] {
  const v = wiki['world-state.md']?.frontmatter?.last_actions
  return Array.isArray(v) ? (v as string[]) : []
}

// Resolve a user's AI credentials: BYOK users bring their own (decrypted) key;
// everyone else returns undefined → the caller uses the operator defaults.
type StoredUser = Awaited<ReturnType<typeof store.getUserById>>
function resolveUserLlm(user: StoredUser): PlayTurnRequest['llm'] | undefined {
  if (!user || user.keyMode !== 'byok' || !user.llmKeyEnc) return undefined
  try {
    return {
      provider: user.llmProvider || process.env.LLM_PROVIDER || 'openrouter',
      model: user.llmModel || process.env.LLM_MODEL || 'anthropic/claude-sonnet-4.6',
      apiKey: decryptKey(user.llmKeyEnc),
      baseUrl: user.llmBaseUrl || undefined,
    }
  } catch (err) {
    // Decryption failed (e.g. APP_SECRET changed) — fall back to hosted defaults.
    console.error('[resolveUserLlm] BYOK key decryption failed:', err)
    return undefined
  }
}

// --- Public routes (no auth required) --------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, store: store.kind })
})

// Phase 0 throwaway endpoint — proves browser -> backend -> AI. Kept for diagnostics.
app.post('/api/ping', async (req, res) => {
  const prompt = String(req.body?.prompt ?? '').trim()
  if (!prompt) {
    res.status(400).json({ error: 'Missing "prompt".' })
    return
  }
  try {
    res.json({ reply: await askLLM(prompt) })
  } catch (err) {
    console.error('[/api/ping] error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI request failed' })
  }
})

// --- Auth routes (public — create account / log in) ------------------------

app.post('/api/auth/signup', async (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')

  const userErr = validateUsername(username)
  if (userErr) { res.status(400).json({ error: userErr }); return }

  const passErr = validatePassword(password)
  if (passErr) { res.status(400).json({ error: passErr }); return }

  try {
    const passwordHash = await hashPassword(password)
    const user = await store.createUser(username, passwordHash)
    const session = await store.createSession(user.id)

    res.cookie(SID_COOKIE, session.id, SID_COOKIE_OPTS)
    res.status(201).json({ user: { id: user.id, username: user.username } })
  } catch (err) {
    if (err instanceof UserExistsError) {
      res.status(409).json({ error: err.message })
      return
    }
    console.error('[/api/auth/signup] error:', err)
    res.status(500).json({ error: 'Could not create account.' })
  }
})

app.post('/api/auth/login', async (req, res) => {
  const username = String(req.body?.username ?? '').trim()
  const password = String(req.body?.password ?? '')

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required.' })
    return
  }

  try {
    const user = await store.getUserByUsername(username)
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      res.status(401).json({ error: 'Invalid username or password.' })
      return
    }
    const session = await store.createSession(user.id)
    res.cookie(SID_COOKIE, session.id, SID_COOKIE_OPTS)
    res.json({ user: { id: user.id, username: user.username } })
  } catch (err) {
    console.error('[/api/auth/login] error:', err)
    res.status(500).json({ error: 'Could not log in.' })
  }
})

// ── Auth wall: all routes below require a valid session ───────────────────
app.use('/api', requireAuth(store))

// --- Auth routes (protected) ------------------------------------------------

app.get('/api/auth/me', async (req, res) => {
  try {
    const user = await store.getUserById(req.userId!)
    if (!user) {
      res.status(401).json({ error: 'Account not found.' })
      return
    }
    res.json({
      user: {
        id: user.id,
        username: user.username,
        keyMode: user.keyMode,
        llmProvider: user.llmProvider,
        llmModel: user.llmModel,
        llmBaseUrl: user.llmBaseUrl,
        hostedCredits: user.hostedCredits,
        isAdmin: isAdminUsername(user.username),
        // NEVER return llmKeyEnc — the encrypted key stays server-side
      },
    })
  } catch (err) {
    console.error('[/api/auth/me] error:', err)
    res.status(500).json({ error: 'Could not load account.' })
  }
})

app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies?.[SID_COOKIE]
  if (token) {
    try { await store.deleteSession(token) } catch { /* best-effort */ }
  }
  res.clearCookie(SID_COOKIE, { path: '/' })
  res.json({ ok: true })
})

// --- Settings routes (Phase 5 — BYOK / cost controls) -----------------------

app.get('/api/auth/settings', async (req, res) => {
  try {
    const user = await store.getUserById(req.userId!)
    if (!user) {
      res.status(401).json({ error: 'Account not found.' })
      return
    }
    res.json({
      keyMode: user.keyMode,
      llmProvider: user.llmProvider,
      llmModel: user.llmModel,
      llmBaseUrl: user.llmBaseUrl,
      hostedCredits: user.hostedCredits,
      // NEVER return llmKeyEnc
    })
  } catch (err) {
    console.error('[/api/auth/settings] error:', err)
    res.status(500).json({ error: 'Could not load settings.' })
  }
})

app.put('/api/auth/settings', async (req, res) => {
  try {
    const user = await store.getUserById(req.userId!)
    if (!user) {
      res.status(401).json({ error: 'Account not found.' })
      return
    }

    const { keyMode, llmProvider, llmModel, llmKey, llmBaseUrl } = req.body ?? {}

    // Validate keyMode
    if (keyMode !== undefined && keyMode !== 'hosted' && keyMode !== 'byok') {
      res.status(400).json({ error: 'keyMode must be "hosted" or "byok".' })
      return
    }

    const updates: UserSettingsUpdate = {}

    if (keyMode !== undefined) updates.keyMode = keyMode
    if (llmProvider !== undefined) updates.llmProvider = String(llmProvider).trim() || null
    if (llmModel !== undefined) updates.llmModel = String(llmModel).trim() || null
    if (llmBaseUrl !== undefined) updates.llmBaseUrl = String(llmBaseUrl).trim() || null

    // If switching to BYOK and a new key was pasted, validate then encrypt.
    if (keyMode === 'byok' && typeof llmKey === 'string' && llmKey.trim()) {
      const provider = String(llmProvider || user.llmProvider || process.env.LLM_PROVIDER || 'openrouter').trim()
      const model = String(llmModel || user.llmModel || process.env.LLM_MODEL || 'anthropic/claude-sonnet-4.6').trim()
      const baseUrl = String(llmBaseUrl || user.llmBaseUrl || '').trim() || undefined

      const validation = await validateCredentials(provider, model, llmKey.trim(), baseUrl)
      if (!('ok' in validation)) {
        res.status(400).json({ error: `Key validation failed: ${validation.error}` })
        return
      }
      updates.llmKeyEnc = encryptKey(llmKey.trim())
    }

    // Switching to hosted clears the stored BYO key.
    if (keyMode === 'hosted') {
      updates.llmKeyEnc = null
    }

    const updated = await store.updateUserSettings(req.userId!, updates)
    res.json({
      keyMode: updated.keyMode,
      llmProvider: updated.llmProvider,
      llmModel: updated.llmModel,
      llmBaseUrl: updated.llmBaseUrl,
      hostedCredits: updated.hostedCredits,
    })
  } catch (err) {
    console.error('[/api/auth/settings] error:', err)
    res.status(500).json({ error: 'Could not save settings.' })
  }
})

app.post('/api/auth/settings/validate-key', async (req, res) => {
  const { provider, model, key, baseUrl } = req.body ?? {}
  if (typeof key !== 'string' || !key.trim()) {
    res.status(400).json({ error: 'API key is required.' })
    return
  }
  try {
    const validation = await validateCredentials(
      String(provider || process.env.LLM_PROVIDER || 'openrouter').trim(),
      String(model || process.env.LLM_MODEL || 'anthropic/claude-sonnet-4.6').trim(),
      key.trim(),
      typeof baseUrl === 'string' ? baseUrl.trim() || undefined : undefined,
    )
    if ('ok' in validation) {
      res.json({ ok: true })
    } else {
      res.status(400).json({ error: validation.error })
    }
  } catch (err) {
    console.error('[/api/auth/settings/validate-key] error:', err)
    res.status(500).json({ error: 'Key validation failed.' })
  }
})

// --- Saves routes -----------------------------------------------------------

app.get('/api/saves', async (req, res) => {
  try {
    const saves = await store.listByUser(req.userId!)
    res.json({ saves })
  } catch (err) {
    console.error('[/api/saves] error:', err)
    res.status(500).json({ error: 'Could not load saves.' })
  }
})

// Resume a specific playthrough: verify ownership, set the pid cookie, return state.
app.post('/api/saves/:id/resume', async (req, res) => {
  const id = req.params.id
  if (!id) {
    res.status(400).json({ error: 'Missing save ID.' })
    return
  }
  try {
    const pt = await store.get(id)
    if (!pt) {
      res.status(404).json({ error: 'Save not found.' })
      return
    }
    if (pt.userId !== req.userId) {
      // Don't leak that this playthrough exists — treat as not found.
      res.status(404).json({ error: 'Save not found.' })
      return
    }
    pt.wiki = migrateWiki(pt.wiki) // seed any fields a new chapter/version added
    res.cookie(PID_COOKIE, pt.id, COOKIE_OPTS)
    res.json({
      character: dossierFor(pt.character),
      anchor: anchorOf(pt.wiki),
      ...chapterMetaOf(pt.wiki),
      history: pt.history,
      actions: lastActionsOf(pt.wiki),
      wikiState: wikiStateOf(pt.wiki),
      setting: settingBody(pt.wiki),
    })
  } catch (err) {
    console.error('[/api/saves/:id/resume] error:', err)
    res.status(500).json({ error: 'Could not resume save.' })
  }
})

// --- Game routes (protected, ownership-checked) -----------------------------

// Start a new playthrough: seed the wiki, set the turn-0 opening, set the pid cookie.
app.post('/api/new-game', async (req, res) => {
  const requested = String(req.body?.character ?? 'kaspen')
  if (!isPlayableId(requested)) {
    res.status(400).json({ error: `Unknown character "${requested}".` })
    return
  }
  const character = requested as PlayableId
  const visitorName = String(req.body?.visitorName ?? '')
  try {
    const wiki = buildStarterWiki(character, visitorName || undefined)
    const opening = openingFor(character)
    wiki['world-state.md'].frontmatter!.last_actions = opening.actions
    const history: Turn[] = [{ role: 'ai', content: opening.prose }]

    const pt = await store.create(character, wiki, history, req.userId!)
    res.cookie(PID_COOKIE, pt.id, COOKIE_OPTS)
    res.json({
      character: dossierFor(character, visitorName || undefined),
      anchor: anchorOf(wiki),
      ...chapterMetaOf(wiki),
      history,
      actions: opening.actions,
      wikiState: wikiStateOf(wiki),
      setting: settingBody(wiki),
    })
  } catch (err) {
    console.error('[/api/new-game] error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'Could not start a new game' })
  }
})

// Rehydrate the current playthrough (on refresh). Requires auth + ownership.
app.get('/api/debug/facts', async (req, res) => {
  const id = req.cookies?.[PID_COOKIE]
  const pt = id ? await store.get(id) : null
  if (!pt || pt.userId !== req.userId) {
    res.status(404).json({ error: 'No active game.' })
    return
  }
  const result: Record<string, string[]> = {}
  for (const [name, file] of Object.entries(pt.wiki)) {
    const facts = file?.frontmatter?.facts
    if (Array.isArray(facts) && facts.length > 0) result[name] = facts as string[]
  }
  res.json(result)
})

app.get('/api/state', async (req, res) => {
  const id = req.cookies?.[PID_COOKIE]
  const pt = id ? await store.get(id) : null
  if (!pt || pt.userId !== req.userId) {
    // No playthrough yet, or it belongs to someone else — treat as "no active game."
    res.status(404).json({ error: 'No active game.' })
    return
  }
  pt.wiki = migrateWiki(pt.wiki) // seed any fields a new chapter/version added
  res.json({
    character: dossierFor(pt.character),
    anchor: anchorOf(pt.wiki),
    ...chapterMetaOf(pt.wiki),
    history: pt.history,
    actions: lastActionsOf(pt.wiki),
    wikiState: wikiStateOf(pt.wiki),
    setting: settingBody(pt.wiki),
  })
})

// Phase 6: the chapter-end recap. Only valid once the chapter is complete (END).
// Facts come from the final wiki; the warm prose is one AI call, cached into the
// wiki so revisiting the recap doesn't re-bill the player.
app.get('/api/recap', async (req, res) => {
  const id = req.cookies?.[PID_COOKIE]
  const pt = id ? await store.get(id) : null
  if (!pt || pt.userId !== req.userId) {
    res.status(404).json({ error: 'No active game.' })
    return
  }
  if (anchorOf(pt.wiki) !== CHAPTER_END) {
    res.status(409).json({ error: 'This chapter is not complete yet.' })
    return
  }

  const facts = buildRecapFacts(pt.character as PlayableId, pt.wiki, pt.history)
  // Whether a "Continue to Chapter N" path exists, or this is the end of the story.
  const hasNextChapter = hasChapter(chapterNumOf(pt.wiki) + 1)

  // Serve cached prose if we already wrote it.
  const cached = pt.wiki['recap.md']
  if (cached?.body) {
    res.json({ facts, hasNextChapter, title: String(cached.frontmatter?.title ?? ''), prose: cached.body })
    return
  }

  try {
    const user = await store.getUserById(req.userId!)
    const llm = resolveUserLlm(user)
    const playerActions = pt.history.filter((t) => t.role === 'player').map((t) => t.content)
    const { title, prose } = await generateRecapProse(facts, playerActions, llm)

    // Cache into the wiki (chapter is over; no further turns mutate it).
    const wiki: WikiMap = { ...pt.wiki, 'recap.md': { frontmatter: { title }, body: prose } }
    await store.save(pt.id, wiki, pt.history)

    res.json({ facts, hasNextChapter, title, prose })
  } catch (err) {
    console.error('[/api/recap] error:', err)
    res.status(503).json({ error: 'Could not write the recap. Please try again.' })
  }
})

// Multi-chapter: advance a completed playthrough into the next chapter. Only valid once
// the current chapter is at END. Runs consolidation (drop spent scratch, keep durable
// state, seed the next chapter), appends the next chapter's opening as a fresh turn-0
// message, and returns the new game state (same shape as /api/state). If there's no next
// chapter, the story is fully complete — returns { complete: true }.
app.post('/api/next-chapter', async (req, res) => {
  const id = req.cookies?.[PID_COOKIE]
  const pt = id ? await store.get(id) : null
  if (!pt || pt.userId !== req.userId) {
    res.status(404).json({ error: 'No active game.' })
    return
  }
  if (anchorOf(pt.wiki) !== CHAPTER_END) {
    res.status(409).json({ error: 'This chapter is not complete yet.' })
    return
  }

  const from = chapterNumOf(pt.wiki)
  const to = from + 1
  if (!hasChapter(to)) {
    // No further chapters — the whole story is done. The frontend shows an end state.
    res.json({ complete: true })
    return
  }

  try {
    // Context Bounding Upgrade §3.2 — carry the outgoing chapter forward as a compact
    // entry in chapter-log.md instead of raw turns. Reuse the cached recap if the player
    // already viewed the recap screen (the normal flow); otherwise generate it fresh —
    // same facts + prose the recap screen itself would show.
    const facts = buildRecapFacts(pt.character as PlayableId, pt.wiki, pt.history)
    let recapProse = pt.wiki['recap.md']?.body
    if (!recapProse) {
      const user = await store.getUserById(req.userId!)
      const playerActions = pt.history.filter((t) => t.role === 'player').map((t) => t.content)
      recapProse = (await generateRecapProse(facts, playerActions, resolveUserLlm(user))).prose
    }

    const consolidated = consolidate(pt.wiki, from, to)
    const wiki = appendChapterLog(consolidated, from, facts.chapterTitle, recapProse)
    const opening = getChapter(to).openingFor(pt.character)
    wiki['world-state.md'].frontmatter!.last_actions = opening.actions
    // Context Bounding Upgrade §3.1 — the new chapter's window starts at the opening line
    // below (pt.history.length, BEFORE it's appended), so the model still sees how the
    // chapter opened on the very next turn instead of losing that context immediately.
    wiki['world-state.md'].frontmatter!.chapter_history_start = pt.history.length
    // Append the new chapter's opening as a fresh turn-0 AI message (mirrors /api/new-game,
    // but keeps the prior chapters' history so the story log is continuous).
    const history: Turn[] = [...pt.history, { role: 'ai', content: opening.prose }]

    await store.save(pt.id, wiki, history)
    res.json({
      character: dossierFor(pt.character),
      anchor: anchorOf(wiki),
      ...chapterMetaOf(wiki),
      history,
      actions: opening.actions,
      wikiState: wikiStateOf(wiki),
      setting: settingBody(wiki),
    })
  } catch (err) {
    console.error('[/api/next-chapter] error:', err)
    res.status(500).json({ error: 'Could not start the next chapter.' })
  }
})

// Phase 6: rollback — restore the wiki to before the last committed turn (an
// admin/debug recovery if state corrupts). Drops the snapshot it consumes and
// trims the last player/AI exchange from history. Returns the refreshed state.
app.post('/api/rollback', async (req, res) => {
  const id = req.cookies?.[PID_COOKIE]
  const pt = id ? await store.get(id) : null
  if (!pt || pt.userId !== req.userId) {
    res.status(404).json({ error: 'No active game.' })
    return
  }
  const prev = await store.getLastSnapshot(pt.id)
  if (!prev) {
    res.status(409).json({ error: 'Nothing to undo — no earlier turn was recorded.' })
    return
  }
  // Each committed turn appended [player, ai]; drop that last exchange.
  const newHistory = pt.history.slice(0, Math.max(0, pt.history.length - 2))
  await store.save(pt.id, prev, newHistory)
  await store.dropLastSnapshot(pt.id)
  res.json({
    character: dossierFor(pt.character),
    anchor: anchorOf(prev),
    ...chapterMetaOf(prev),
    history: newHistory,
    actions: lastActionsOf(prev),
    wikiState: wikiStateOf(prev),
    setting: settingBody(prev),
  })
})

// The core game loop. Loads server-owned state, STREAMS the narrative as NDJSON, then
// runs the write-back/anchor engine and persists. Requires auth + ownership.
// NDJSON frames:
//   {"type":"narrative","text":"…growing prose…"}   (many)
//   {"type":"done", narrative, suggested_actions, events, wiki_updates, anchor, advanced, wikiState}
//   {"type":"error","error":"…"}                     (only on failure mid-stream)
app.post('/api/play-turn', async (req, res) => {
  const playerInput = String(req.body?.playerInput ?? '').trim()
  if (!playerInput) {
    res.status(400).json({ error: 'Missing "playerInput".' })
    return
  }
  const id = req.cookies?.[PID_COOKIE]
  const pt = id ? await store.get(id) : null
  if (!pt || pt.userId !== req.userId) {
    res.status(409).json({ error: 'No active game — start a new one.' })
    return
  }
  pt.wiki = migrateWiki(pt.wiki) // seed any fields a new chapter/version added

  // Phase 5: resolve credentials. BYOK users bring their own key; hosted users
  // use the operator's defaults (credits decremented below, but NOT YET ENFORCED).
  const user = await store.getUserById(req.userId!)
  const llm = resolveUserLlm(user)

  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.flushHeaders()

  try {
    const request: PlayTurnRequest = {
      character: pt.character,
      wiki: pt.wiki,
      history: pt.history,
      playerInput,
      llm,
    }

    // The anchor BEFORE this turn — scopes the allowed events (no skipping ahead).
    const priorAnchor = anchorOf(pt.wiki)

    // Capture the AI SDK's error channel (provider/transport failures arrive here,
    // not by throwing from the stream below).
    let streamError: unknown = null
    const result = streamPlayTurn(request, (e) => { streamError = e })
    // The final-object promise is unused (we coerce from partials); observe its
    // rejection so a failed turn doesn't surface as an unhandled rejection.
    void Promise.resolve(result.object).catch(() => {})

    let last: Record<string, unknown> = {}
    for await (const partial of result.partialObjectStream) {
      last = partial as Record<string, unknown>
      if (typeof last.narrative === 'string') {
        res.write(JSON.stringify({ type: 'narrative', text: last.narrative }) + '\n')
      }
    }

    const narrative = typeof last.narrative === 'string' ? last.narrative : ''
    // A failed generation (bad key, timeout, provider error) ends the stream with
    // no narrative. Surface it as an error instead of committing a blank turn.
    if (!narrative.trim()) {
      throw streamError instanceof Error
        ? streamError
        : new Error('The model returned an empty turn.')
    }

    const structured = finalizeStructured(pt.character, getChapter(chapterNumOf(pt.wiki)), priorAnchor, last)

    // Code-gated write-back: validate/clamp/fold events, advance the anchor if its
    // conditions are now met, update the soft-lock counter.
    const turn = runWriteBack(pt.wiki, structured.events, structured.wiki_updates, structured.fact_additions)
    turn.wiki['world-state.md'].frontmatter!.last_actions = structured.suggested_actions

    const history: Turn[] = [
      ...pt.history,
      { role: 'player', content: playerInput },
      { role: 'ai', content: narrative },
    ]
    // Snapshot the PRE-turn wiki (pt.wiki is untouched — runWriteBack returns a new
    // wiki), tied to this committed turn so rollback maps 1:1 to turns. Snapshotting
    // here (not before the AI call) means a failed turn leaves no orphan snapshot.
    await store.snapshot(pt.id, pt.wiki)
    await store.save(pt.id, turn.wiki, history)

    // Phase 5: decrement hosted credits atomically (metering built, NOT YET ENFORCED).
    // When enforced, add a check BEFORE the turn: if credits <= 0, reject with a
    // friendly nudge to add a BYO key.
    if (user && user.keyMode === 'hosted') {
      try { await store.decrementHostedCredits(user.id) } catch { /* best-effort */ }
    }

    res.write(
      JSON.stringify({
        type: 'done',
        narrative,
        suggested_actions: structured.suggested_actions,
        events: structured.events,
        wiki_updates: structured.wiki_updates,
        fact_additions: structured.fact_additions,
        anchor: turn.toAnchor,
        fromAnchor: turn.fromAnchor,
        advanced: turn.advanced,
        ...chapterMetaOf(turn.wiki),
        wikiState: wikiStateOf(turn.wiki),
        setting: settingBody(turn.wiki),
      }) + '\n',
    )
    res.end()

    if (process.env.LOG_TOKEN_USAGE === 'true') {
      result.usage
        .then((u) => console.log('[play-turn] usage:', JSON.stringify(u)))
        .catch(() => {})
    }
  } catch (err) {
    // Log the real error for debugging; show the player a warm, generic message.
    console.error('[/api/play-turn] error:', err)
    if (!res.headersSent) res.status(503).json({ error: FRIENDLY_TURN_ERROR })
    else {
      res.write(JSON.stringify({ type: 'error', error: FRIENDLY_TURN_ERROR }) + '\n')
      res.end()
    }
  }
})

// --- Admin: chapter authoring (admin-gated) --------------------------------

// Expand a short author brief (beats + plain conditions) into a full ChapterSpec draft via
// the AI. Returns the draft plus any golden-rule problems so the UI can flag them for review.
app.post('/api/admin/expand-chapter', requireAdmin(store), async (req, res) => {
  const brief = req.body?.brief as ChapterBrief | undefined
  if (!brief || typeof brief.number !== 'number' || !Array.isArray(brief.beats) || brief.beats.length === 0) {
    res.status(400).json({ error: 'Provide a brief with a chapter number and at least one beat.' })
    return
  }
  try {
    const rows = await store.listChapterSpecs()
    const existingEndState = gatherEndStateOps(
      rows.map((r) => ({ number: r.number, endState: r.spec.endState })),
      brief.number,
    )
    const spec = await expandChapterSpec(brief, existingEndState)
    res.json({ spec, problems: validateChapterSpec(spec, existingEndState) })
  } catch (err) {
    console.error('[/api/admin/expand-chapter] error:', err)
    res.status(503).json({ error: 'The AI could not expand this brief. Please try again.' })
  }
})

// Save an approved ChapterSpec: validate (golden rule), persist, and register it live — no
// rebuild/redeploy. Built-in Chapter 1 is protected. Admin only.
//
// CAVEAT: saving replaces the chapter for EVERY player immediately, including anyone
// currently mid-playthrough on it — there's no migration for a player already partway
// through the old shape (e.g. on an anchor id the new spec removed). Avoid editing a
// chapter that has active players; this is a v1 trade-off, not a bug.
app.post('/api/admin/save-chapter', requireAdmin(store), async (req, res) => {
  const spec = req.body?.spec
  const rows = await store.listChapterSpecs()
  const existingEndState = gatherEndStateOps(
    rows.map((r) => ({ number: r.number, endState: r.spec.endState })),
    spec?.number,
  )
  const problems = validateChapterSpec(spec, existingEndState)
  if (problems.length) {
    res.status(400).json({ error: 'The chapter has problems that must be fixed first.', problems })
    return
  }
  if (spec.number === 1) {
    res.status(409).json({ error: `Chapter ${spec.number} is built-in and can't be overwritten.` })
    return
  }
  try {
    await store.upsertChapterSpec(spec.number, spec, req.userId!)
    registerSpec(spec) // live immediately
    res.json({ ok: true, number: spec.number, title: spec.title })
  } catch (err) {
    console.error('[/api/admin/save-chapter] error:', err)
    res.status(500).json({ error: 'Could not save the chapter.' })
  }
})

// List authored chapters (for the authoring screen's chapter list). Admin only.
app.get('/api/admin/chapters', requireAdmin(store), async (_req, res) => {
  res.json({ chapters: await store.listChapterSpecs() })
})

// Fetch one authored chapter's full spec (to load back into the editor). Admin only.
app.get('/api/admin/chapters/:n', requireAdmin(store), async (req, res) => {
  const row = (await store.listChapterSpecs()).find((r) => r.number === Number(req.params.n))
  if (row) res.json(row)
  else res.status(404).json({ error: 'Chapter not found.' })
})

// Delete an authored chapter (built-ins protected). Admin only. Same live-effect caveat as
// save-chapter above: a player mid-playthrough on a deleted chapter silently falls back to
// Chapter 1's rules (getChapter's fallback) while their save still says the old number.
app.delete('/api/admin/chapters/:n', requireAdmin(store), async (req, res) => {
  const n = Number(req.params.n)
  if (n === 1) {
    res.status(409).json({ error: 'Built-in chapters cannot be deleted.' })
    return
  }
  await store.deleteChapterSpec(n)
  unregisterChapter(n)
  res.json({ ok: true })
})

// --- Serve the built frontend (production) ---------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDist = process.env.CLIENT_DIST ?? path.resolve(__dirname, '../../client/dist')

app.use(express.static(clientDist))
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(clientDist, 'index.html'))
})

const port = Number(process.env.PORT ?? 3001)
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`)
})
