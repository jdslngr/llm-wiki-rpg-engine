import 'dotenv/config'
import express from 'express'
import multer from 'multer'
import { fileTypeFromBuffer } from 'file-type'
import cookieParser from 'cookie-parser'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { askLLM } from './llm.js'
import { validateCredentials } from './llm.js'
import { encryptKey, decryptKey } from './crypto.js'
import { streamPlayTurn, finalizeStructured, type PlayTurnRequest } from './playTurn.js'
import { FRIENDLY_TURN_ERROR } from './retry.js'
import { createStore, UserExistsError } from './store.js'
import { artStore, type ArtAsset, type ArtMimeType } from './artStore.js'
import { runWriteBack } from './engine.js'
import { consolidate, appendChapterLog } from './consolidate.js'
import { migrateWiki } from './migrate.js'
import { getChapter, hasChapter, registerSpec, unregisterChapter, loadAuthoredChapters, CHAPTER_END, canAdvanceFrom } from './chapters/index.js'
import { anchorOf, chapterNumOf, chapterMetaOf } from './chapterMeta.js'
import { buildRecapFacts, generateRecapProse } from './recap.js'
import { CHARACTERS, isPlayableId, buildStarterWiki, type PlayableId } from './game/characters.js'
import { openingFor } from './game/openings.js'
import { hashPassword, verifyPassword, validateUsername, validatePassword, requireAuth, requireAdmin, isAdminUsername, SID_COOKIE, SID_COOKIE_OPTS } from './auth.js'
import {
  validateChapterSpec,
  gatherEndStateOps,
  chapterSpecWarnings,
} from './chapters/defineChapter.js'
import { expandChapterSpec, type ChapterBrief } from './expandChapter.js'
import { ChapterEndLock } from './chapterEndLock.js'
import { prepareChapterRecap, type RecapSnapshot, RecapCorruptionError } from './recapPreparation.js'
import type { Playthrough, Turn, WikiMap, UserSettingsUpdate } from './types.js'

// The store is chosen at boot: Postgres if DATABASE_URL is reachable, else in-memory.
const store = await createStore()

// Load any AI-authored chapters from the store into the registry so they're playable.
const loadedChapters = await loadAuthoredChapters(store)
if (loadedChapters) console.log(`[chapters] loaded ${loadedChapters} authored chapter(s)`)

// Purge expired sessions at boot and hourly. .unref() so the interval never
// keeps the process alive on its own.
setInterval(() => store.deleteExpiredSessions().catch(() => {}), 1000 * 60 * 60).unref()
store.deleteExpiredSessions().catch(() => {})

// Per-playthrough turn lock: one /api/play-turn in flight per playthrough.
// In-memory Set is correct for this single-process server; replace with a DB
// advisory lock if this ever runs multi-instance.
const turnsInFlight = new Set<string>()

// Per-playthrough chapter-end lock: serialises recap generation and chapter
// advance so concurrent /api/recap + /api/next-chapter calls can't race.
const chapterEndLock = new ChapterEndLock()

// Admin list set via ADMIN_USERNAMES env var (comma-separated).

const app = express()
app.set('trust proxy', 1)
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())

// The httpOnly cookie that identifies a playthrough — now gated behind auth (Phase 3).
const PID_COOKIE = 'pid'
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  maxAge: 1000 * 60 * 60 * 24 * 365, // 1 year
  path: '/',
  secure: process.env.COOKIE_SECURE === 'true',
}
const ART_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
const ALLOWED_ART_MIME_TYPES: readonly ArtMimeType[] = [
  'video/mp4',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]
const ALLOWED_ART_MIME_SET = new Set<string>(ALLOWED_ART_MIME_TYPES)
const artUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ART_UPLOAD_MAX_BYTES },
})

// --- helpers ---------------------------------------------------------------

function dossierFor(character: string, wiki?: WikiMap) {
  const c = CHARACTERS[character as PlayableId] ?? CHARACTERS.kaspen
  // The player-chosen display name lives in player-character.md frontmatter (seeded
  // by buildStarterWiki). Only treat it as a custom name when it differs from the
  // character's default — for non-Visitor characters the stored name IS the default
  // (e.g. "Kaspen"), and they must NOT get the "modern human named X" POV label.
  const stored = wiki?.['player-character.md']?.frontmatter?.name
  const storedName = typeof stored === 'string' ? stored.trim() : ''
  const displayName = storedName && storedName !== c.name ? storedName : undefined
  const name = displayName || c.name
  const povLabel = displayName
    ? `a modern human named ${displayName}, transported into 100,000 BCE, to whom this world is utterly new`
    : c.povLabel
  return { id: c.id, name, role: c.role, knowsLabel: c.knowsLabel, dossier: c.dossier, povLabel }
}

function settingBody(wiki: WikiMap): string {
  return String(wiki['world-state.md']?.body ?? '')
}

// Map of filename -> frontmatter, for the client's debug panel. Excludes engine-
// managed meta files so the archive doesn't bloat every state/debug response
// (sanity check #3).
function wikiStateOf(wiki: WikiMap): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(wiki)
      .filter(([k]) => k !== 'recap.md' && k !== 'recap-history.md')
      .map(([k, v]) => [k, v.frontmatter ?? {}]),
  )
}

function lastActionsOf(wiki: WikiMap): string[] {
  const v = wiki['world-state.md']?.frontmatter?.last_actions
  return Array.isArray(v) ? (v as string[]) : []
}

// Blank / null / whitespace → real null. Also rejects the literal string "null"
// (the pre-fix bug stored String(null); don't let a client resend it).
const asOptString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t && t !== 'null' ? t : null
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
function statePayload(pt: Playthrough, wiki = pt.wiki, history = pt.history) {
  return {
    playthroughId: pt.id,
    character: dossierFor(pt.character, wiki),
    anchor: anchorOf(wiki),
    ...chapterMetaOf(wiki),
    history,
    actions: lastActionsOf(wiki),
    wikiState: wikiStateOf(wiki),
    setting: settingBody(wiki),
  }
}

function parseChapterNumber(raw: unknown): number | null {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : null
}

function withPlayerArtUrl(asset: ArtAsset, playthroughId: string): ArtAsset {
  const params = new URLSearchParams({ playthroughId, v: asset.updatedAt })
  return { ...asset, url: `/api/art/media/${encodeURIComponent(asset.id)}?${params.toString()}` }
}

function withAdminArtUrl(asset: ArtAsset): ArtAsset {
  return { ...asset, url: `/api/admin/art/media/${encodeURIComponent(asset.id)}` }
}

function artListResponse(assets: ArtAsset[], urlFor: (asset: ArtAsset) => ArtAsset) {
  const chapterAsset = assets.find((asset) => asset.kind === 'chapter') ?? null
  const beatArt: Record<string, ArtAsset> = {}
  for (const asset of assets) {
    if (asset.kind === 'beat' && asset.anchor) beatArt[asset.anchor] = urlFor(asset)
  }
  return {
    chapterArt: chapterAsset ? urlFor(chapterAsset) : null,
    beatArt,
  }
}

async function requirePlaythroughOwnership(playthroughId: string, userId: string): Promise<Playthrough | null> {
  const pt = await store.get(playthroughId)
  if (!pt || pt.userId !== userId) return null
  return pt
}

function getReachedAnchors(pt: Playthrough, chapterNumber: number): string[] | null {
  if (!hasChapter(chapterNumber)) return null
  const currentChapter = chapterNumOf(pt.wiki)
  if (chapterNumber > currentChapter) return null

  const chapter = getChapter(chapterNumber)
  const anchors = [...chapter.anchorOrder]
  if (chapterNumber < currentChapter) return anchors

  const currentAnchor = anchorOf(pt.wiki)
  if (currentAnchor === CHAPTER_END) return anchors

  // If the current anchor isn't in this chapter's anchor list (e.g. the chapter
  // was re-authored and the anchor renamed), return all anchors — the player has
  // already earned their art and shouldn't lose it.
  const idx = anchors.indexOf(currentAnchor)
  return idx === -1 ? anchors : anchors.slice(0, idx + 1)
}

function isArtUnlocked(pt: Playthrough, asset: ArtAsset): boolean {
  const reached = getReachedAnchors(pt, asset.chapterNumber)
  if (reached === null) return false
  return asset.kind === 'chapter' || (!!asset.anchor && reached.includes(asset.anchor))
}

async function sniffArtMime(buffer: Buffer): Promise<ArtMimeType | null> {
  const sniffed = await fileTypeFromBuffer(buffer)
  const mime = sniffed?.mime
  return mime && ALLOWED_ART_MIME_SET.has(mime) ? (mime as ArtMimeType) : null
}

function jsonUploadError(err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400
    res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Art file is too large.' : err.message })
    return
  }
  next(err)
}

// --- Public routes (no auth required) --------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, store: store.kind })
})

// Simple in-memory per-IP rate limiter for the two public auth endpoints.
const authAttempts = new Map<string, { count: number; windowStart: number }>()
const AUTH_RATE_LIMIT = 10 // attempts
const AUTH_RATE_WINDOW_MS = 15 * 60 * 1000

function authRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown'
  const now = Date.now()
  const entry = authAttempts.get(ip)
  if (entry && now - entry.windowStart < AUTH_RATE_WINDOW_MS) {
    if (entry.count >= AUTH_RATE_LIMIT) {
      res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' })
      return
    }
    entry.count++
  } else {
    authAttempts.set(ip, { count: 1, windowStart: now })
  }
  next()
}
// Sweep stale entries so the map can't grow forever.
setInterval(() => {
  const cutoff = Date.now() - AUTH_RATE_WINDOW_MS
  for (const [ip, entry] of authAttempts) {
    if (entry.windowStart < cutoff) authAttempts.delete(ip)
  }
}, AUTH_RATE_WINDOW_MS).unref()

// --- Auth routes (public — create account / log in) ------------------------

app.post('/api/auth/signup', authRateLimit, async (req, res) => {
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

app.post('/api/auth/login', authRateLimit, async (req, res) => {
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
    if (llmProvider !== undefined) updates.llmProvider = asOptString(llmProvider)
    if (llmModel !== undefined) updates.llmModel = asOptString(llmModel)
    if (llmBaseUrl !== undefined) updates.llmBaseUrl = asOptString(llmBaseUrl)

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
    res.json(statePayload(pt))
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
    res.json(statePayload(pt, wiki, history))
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
  res.json(statePayload(pt))
})

// Phase 6: the chapter-end recap. Only valid once the chapter is complete (END).
// Runs under the chapter-end lock to serialise with next-chapter; checks the
// immutable archive first so repeat visits don't regenerate or re-bill.
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

  try {
    await chapterEndLock.run(pt.id, async () => {
      // Re-load inside the lock so we see state after any concurrent advance.
      const fresh = await store.get(pt.id)
      if (!fresh || fresh.userId !== req.userId) {
        if (!res.headersSent) res.status(404).json({ error: 'No active game.' })
        return
      }
      if (anchorOf(fresh.wiki) !== CHAPTER_END) {
        if (!res.headersSent) res.status(409).json({ error: 'This chapter is not complete yet.' })
        return
      }

      const user = await store.getUserById(req.userId!)
      const result = await prepareChapterRecap(
        fresh.wiki,
        fresh.character,
        fresh.history,
        async (facts, playerActions) => {
          return generateRecapProse(facts, playerActions, resolveUserLlm(user))
        },
      )

      // Persist if the wiki changed (new archive entry and/or cache).
      if (result.wiki !== fresh.wiki) {
        await store.save(fresh.id, result.wiki, fresh.history)
      }

      res.json(result.recap)
    })
  } catch (err) {
    if (err instanceof RecapCorruptionError) {
      console.error('[/api/recap] archive corruption:', err.message)
      if (!res.headersSent) {
        res.status(503).json({ error: 'Recap data is corrupted. Please try again.' })
      }
      return
    }
    console.error('[/api/recap] error:', err)
    if (!res.headersSent) {
      res.status(503).json({ error: 'Could not write the recap. Please try again.' })
    }
  }
})

// Multi-chapter: advance a completed playthrough into the next chapter. Only valid once
// the current chapter is at END. Archives the completed chapter's recap before advancing
// (or before returning {complete:true} for a final chapter). Runs under the chapter-end
// lock to serialise with recap generation.
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

  try {
    await chapterEndLock.run(pt.id, async () => {
      // Re-load inside the lock.
      const fresh = await store.get(pt.id)
      if (!fresh || fresh.userId !== req.userId) {
        if (!res.headersSent) res.status(404).json({ error: 'No active game.' })
        return
      }
      if (anchorOf(fresh.wiki) !== CHAPTER_END) {
        if (!res.headersSent) res.status(409).json({ error: 'This chapter is not complete yet.' })
        return
      }

      // Prepare recap (archives if this is the first completion; no-op archive hit
      // on repeat). This ensures the archive is durably written before we decide
      // whether to advance or declare the story complete.
      const user = await store.getUserById(req.userId!)
      const result = await prepareChapterRecap(
        fresh.wiki,
        fresh.character,
        fresh.history,
        async (facts, playerActions) => {
          return generateRecapProse(facts, playerActions, resolveUserLlm(user))
        },
      )

      // Persist the archive + cache if this was the first completion.
      if (result.wiki !== fresh.wiki) {
        await store.save(fresh.id, result.wiki, fresh.history)
      }

      const currentChapter = chapterNumOf(result.wiki)

      // Final chapter or no successor — story is complete. The archive was saved above.
      if (!canAdvanceFrom(currentChapter)) {
        res.json({ complete: true })
        return
      }

      // Advance into the next chapter.
      const from = currentChapter
      const to = from + 1
      const consolidated = consolidate(result.wiki, from, to)
      const wiki = appendChapterLog(consolidated, from, result.recap.facts.chapterTitle, result.recap.prose)
      const opening = getChapter(to).openingFor(fresh.character)
      wiki['world-state.md'].frontmatter!.last_actions = opening.actions
      wiki['world-state.md'].frontmatter!.chapter_history_start = fresh.history.length
      const history: Turn[] = [...fresh.history, { role: 'ai', content: opening.prose }]

      await store.save(fresh.id, wiki, history)
      res.json(statePayload(fresh, wiki, history))
    })
  } catch (err) {
    if (err instanceof RecapCorruptionError) {
      console.error('[/api/next-chapter] archive corruption:', err.message)
      if (!res.headersSent) {
        res.status(503).json({ error: 'Recap data is corrupted. Please try again.' })
      }
      return
    }
    console.error('[/api/next-chapter] error:', err)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Could not start the next chapter.' })
    }
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
  res.json(statePayload(pt, prev, newHistory))
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

  if (turnsInFlight.has(pt.id)) {
    res.status(409).json({ error: 'A turn is already in progress for this playthrough.' })
    return
  }
  turnsInFlight.add(pt.id)
  try {
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

      const structured = finalizeStructured(
        pt.character,
        getChapter(chapterNumOf(pt.wiki)),
        priorAnchor,
        last,
        lastActionsOf(pt.wiki),
      )

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
  } finally {
    turnsInFlight.delete(pt.id)
  }
})
// --- Art routes (protected, ownership-checked) -----------------------------
// Route order matters: literal /media and /gallery routes must be registered before
// generic :chapterNumber routes, or Express can route media/gallery requests into
// the chapterNumber handlers.

app.get('/api/art/media/:artId', async (req, res) => {
  const playthroughId = String(req.query.playthroughId ?? '').trim()
  if (!playthroughId) {
    res.status(400).json({ error: 'Missing playthroughId.' })
    return
  }

  try {
    const pt = await requirePlaythroughOwnership(playthroughId, req.userId!)
    if (!pt) { res.status(404).json({ error: 'Not found.' }); return }

    const asset = await artStore.getArtById(String(req.params.artId ?? ''))
    if (!asset || !isArtUnlocked(pt, asset)) {
      res.status(404).json({ error: 'Not found.' })
      return
    }

    const filePath = artStore.filePathFor(asset)
    try { await stat(filePath) } catch {
      res.status(404).json({ error: 'Not found.' })
      return
    }

    res.setHeader('Content-Type', asset.mimeType)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, max-age=3600')
    createReadStream(filePath).pipe(res)
  } catch (err) {
    console.error('[/api/art/media/:artId] error:', err)
    if (!res.headersSent) res.status(500).json({ error: 'Could not serve art.' })
  }
})

app.get('/api/art/gallery/:playthroughId', async (req, res) => {
  const playthroughId = String(req.params.playthroughId ?? '')

  try {
    const pt = await requirePlaythroughOwnership(playthroughId, req.userId!)
    if (!pt) { res.status(404).json({ error: 'Not found.' }); return }

    const currentChapter = chapterNumOf(pt.wiki)
    const currentAnchor = anchorOf(pt.wiki)
    const chapters = []

    for (let chapterNumber = 1; chapterNumber <= currentChapter; chapterNumber++) {
      if (!hasChapter(chapterNumber)) continue
      const reachedAnchors = getReachedAnchors(pt, chapterNumber)
      if (reachedAnchors === null) continue

      const chapter = getChapter(chapterNumber)
      const assets = await artStore.listChapterArt(chapterNumber)
      const chapterAsset = assets.find((asset) => asset.kind === 'chapter') ?? null
      const beatArts = reachedAnchors.map((anchor) => {
        const art = assets.find((asset) => asset.kind === 'beat' && asset.anchor === anchor) ?? null
        return {
          anchor,
          anchorTitle: chapter.anchorTitles[anchor] ?? anchor,
          art: art ? withPlayerArtUrl(art, playthroughId) : null,
        }
      })

      chapters.push({
        chapterNumber,
        chapterTitle: chapter.title,
        state: chapterNumber < currentChapter || currentAnchor === CHAPTER_END ? 'completed' : 'current',
        chapterArt: chapterAsset ? withPlayerArtUrl(chapterAsset, playthroughId) : null,
        beatArts,
      })
    }

    res.json({ chapters })
  } catch (err) {
    console.error('[/api/art/gallery/:playthroughId] error:', err)
    res.status(500).json({ error: 'Could not load gallery.' })
  }
})

app.get('/api/art/:chapterNumber', async (req, res) => {
  const chapterNumber = parseChapterNumber(req.params.chapterNumber)
  const playthroughId = String(req.query.playthroughId ?? '').trim()
  if (!chapterNumber || !playthroughId) {
    res.status(400).json({ error: 'Invalid chapterNumber or missing playthroughId.' })
    return
  }

  try {
    const pt = await requirePlaythroughOwnership(playthroughId, req.userId!)
    if (!pt) { res.status(404).json({ error: 'Not found.' }); return }

    const reachedAnchors = getReachedAnchors(pt, chapterNumber)
    if (reachedAnchors === null) { res.status(404).json({ error: 'Not found.' }); return }

    const assets = await artStore.listChapterArt(chapterNumber)
    const visibleAssets = assets.filter(
      (asset) => asset.kind === 'chapter' || (!!asset.anchor && reachedAnchors.includes(asset.anchor)),
    )
    res.json(artListResponse(visibleAssets, (asset) => withPlayerArtUrl(asset, playthroughId)))
  } catch (err) {
    console.error('[/api/art/:chapterNumber] error:', err)
    res.status(500).json({ error: 'Could not load art.' })
  }
})

app.get('/api/art/:chapterNumber/:anchor', async (req, res) => {
  const chapterNumber = parseChapterNumber(req.params.chapterNumber)
  const anchor = String(req.params.anchor ?? '')
  const playthroughId = String(req.query.playthroughId ?? '').trim()
  if (!chapterNumber || !anchor || !playthroughId) {
    res.status(400).json({ error: 'Invalid request.' })
    return
  }

  try {
    const pt = await requirePlaythroughOwnership(playthroughId, req.userId!)
    if (!pt) { res.status(404).json({ error: 'Not found.' }); return }

    const reachedAnchors = getReachedAnchors(pt, chapterNumber)
    if (reachedAnchors === null || !reachedAnchors.includes(anchor)) {
      res.status(404).json({ error: 'Not found.' })
      return
    }

    const art = await artStore.getBeatArt(chapterNumber, anchor)
    res.json({ art: art ? withPlayerArtUrl(art, playthroughId) : null })
  } catch (err) {
    console.error('[/api/art/:chapterNumber/:anchor] error:', err)
    res.status(500).json({ error: 'Could not load art.' })
  }
})

// Admin art routes. Keep literal routes before parameter routes.
app.get('/api/admin/art/chapters', requireAdmin(store), async (_req, res) => {
  try {
    const authored = await store.listChapterSpecs()
    const numbers = [...new Set([1, ...authored.map((row) => row.number)])]
      .filter((number) => hasChapter(number))
      .sort((a, b) => a - b)

    res.json({
      chapters: numbers.map((number) => {
        const chapter = getChapter(number)
        return {
          number,
          title: chapter.title,
          anchors: chapter.anchorOrder.map((id) => ({ id, title: chapter.anchorTitles[id] ?? id })),
        }
      }),
    })
  } catch (err) {
    console.error('[/api/admin/art/chapters] error:', err)
    res.status(500).json({ error: 'Could not load chapters.' })
  }
})

app.post('/api/admin/art/upload', requireAdmin(store), artUpload.single('file'), async (req, res) => {
  const chapterNumber = parseChapterNumber(req.body?.chapterNumber)
  const anchor = typeof req.body?.anchor === 'string' && req.body.anchor.trim() ? req.body.anchor.trim() : null
  if (!chapterNumber || !hasChapter(chapterNumber)) {
    res.status(400).json({ error: 'Unknown chapter.' })
    return
  }
  if (!req.file) {
    res.status(400).json({ error: 'Upload a file.' })
    return
  }

  const chapter = getChapter(chapterNumber)
  if (anchor && !chapter.anchorOrder.includes(anchor)) {
    res.status(400).json({ error: 'Unknown beat anchor.' })
    return
  }

  try {
    const mimeType = await sniffArtMime(req.file.buffer)
    if (!mimeType) {
      res.status(400).json({ error: 'Unsupported art file type.' })
      return
    }

    const art = await artStore.upsertArt({
      chapterNumber,
      anchor,
      anchorTitle: anchor ? chapter.anchorTitles[anchor] ?? anchor : undefined,
      chapterTitle: chapter.title,
      fileBuffer: req.file.buffer,
      mimeType,
      updatedBy: req.userId!,
    })

    res.json({ ok: true, art: withAdminArtUrl(art) })
  } catch (err) {
    console.error('[/api/admin/art/upload] error:', err)
    res.status(500).json({ error: 'Could not save art.' })
  }
})
app.use('/api/admin/art/upload', jsonUploadError)

app.get('/api/admin/art/media/:artId', requireAdmin(store), async (req, res) => {
  try {
    const asset = await artStore.getArtById(String(req.params.artId ?? ''))
    if (!asset) { res.status(404).json({ error: 'Not found.' }); return }

    const filePath = artStore.filePathFor(asset)
    try { await stat(filePath) } catch {
      res.status(404).json({ error: 'Not found.' })
      return
    }

    res.setHeader('Content-Type', asset.mimeType)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, max-age=3600')
    createReadStream(filePath).pipe(res)
  } catch (err) {
    console.error('[/api/admin/art/media/:artId] error:', err)
    if (!res.headersSent) res.status(500).json({ error: 'Could not serve art.' })
  }
})

app.get('/api/admin/art/:chapterNumber', requireAdmin(store), async (req, res) => {
  const chapterNumber = parseChapterNumber(req.params.chapterNumber)
  if (!chapterNumber || !hasChapter(chapterNumber)) {
    res.status(404).json({ error: 'Chapter not found.' })
    return
  }

  try {
    const assets = await artStore.listChapterArt(chapterNumber)
    res.json(artListResponse(assets, withAdminArtUrl))
  } catch (err) {
    console.error('[/api/admin/art/:chapterNumber] error:', err)
    res.status(500).json({ error: 'Could not load art.' })
  }
})

app.delete('/api/admin/art/:artId', requireAdmin(store), async (req, res) => {
  try {
    const deleted = await artStore.deleteArt(String(req.params.artId ?? ''))
    if (!deleted) { res.status(404).json({ error: 'Art not found.' }); return }
    res.json({ ok: true })
  } catch (err) {
    console.error('[/api/admin/art/:artId DELETE] error:', err)
    res.status(500).json({ error: 'Could not delete art.' })
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
  try {
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
    await store.upsertChapterSpec(spec.number, spec, req.userId!)
    registerSpec(spec) // live immediately
    // Non-blocking authoring warnings: reused-flag gates (6.1) + chapter-number gaps.
    const warnings = chapterSpecWarnings(spec)
    if (spec.number > 1 && !hasChapter(spec.number - 1)) {
      warnings.push(
        `Chapter ${spec.number - 1} doesn't exist yet — Chapter ${spec.number} can't be ` +
        `reached in play until it does (progression only ever looks for current + 1).`,
      )
    }
    res.json({ ok: true, number: spec.number, title: spec.title, ...(warnings.length ? { warnings } : {}) })
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
  try {
    await store.deleteChapterSpec(n)
    unregisterChapter(n)
    res.json({ ok: true })
  } catch (err) {
    console.error('[/api/admin/chapters/:n] error:', err)
    res.status(500).json({ error: 'Could not delete the chapter.' })
  }
})

// Diagnostics — one prompt to the operator's LLM. Was the Phase 0 public /api/ping;
// moved behind the auth wall + admin gate so strangers can't burn credits.
app.post('/api/admin/ping', requireAdmin(store), async (req, res) => {
  const prompt = String(req.body?.prompt ?? '').trim()
  if (!prompt) {
    res.status(400).json({ error: 'Missing "prompt".' })
    return
  }
  try {
    res.json({ reply: await askLLM(prompt) })
  } catch (err) {
    console.error('[/api/admin/ping] error:', err)
    res.status(500).json({ error: err instanceof Error ? err.message : 'AI request failed' })
  }
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
