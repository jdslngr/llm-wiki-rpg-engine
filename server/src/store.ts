// Persistence for playthroughs. Two interchangeable backends behind one interface:
//   - Postgres  (when DATABASE_URL is set & reachable) — survives restarts/refresh.
//   - In-memory (otherwise) — zero-setup `npm run dev`, resets on restart.
// The engine and routes don't care which is active.
//
// Phase 3 adds user accounts + sessions on top — same two-backend pattern.

import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { Playthrough, Turn, WikiMap, User, UserSettingsUpdate, Session, SaveEntry } from './types.js'
import type { ChapterSpec } from './chapters/defineChapter.js'
import { chapterMetaOf } from './chapterMeta.js'
import { getChapter, CHAPTER_END } from './chapters/index.js'

// A persisted, AI-authored chapter (stored as data; loaded into the registry at boot).
export type ChapterSpecRow = {
  number: number
  spec: ChapterSpec
  title: string
  updatedAt: string
  updatedBy: string | null
}

export interface PlaythroughStore {
  readonly kind: 'postgres' | 'memory'

  // --- Playthroughs (Phase 0–2) ---
  /** Create a new playthrough, owned by the given user. */
  create(character: string, wiki: WikiMap, history: Turn[], userId: string): Promise<Playthrough>
  get(id: string): Promise<Playthrough | null>
  /** Persist the post-turn wiki + history for an existing playthrough. */
  save(id: string, wiki: WikiMap, history: Turn[]): Promise<void>
  /** Append a pre-turn snapshot of the whole wiki (for per-turn rollback). */
  snapshot(id: string, wiki: WikiMap): Promise<void>
  /** The most recent snapshot (the wiki before the last committed turn), or null. */
  getLastSnapshot(id: string): Promise<WikiMap | null>
  /** Remove the most recent snapshot (after a rollback consumes it). */
  dropLastSnapshot(id: string): Promise<void>
  /** List all playthroughs belonging to a user (lightweight, for the saves screen). */
  listByUser(userId: string): Promise<SaveEntry[]>

  // --- Users (Phase 3) ---
  /** Create a user with a bcrypt-hashed password. Returns the new user. */
  createUser(username: string, passwordHash: string): Promise<User>
  /** Look up a user by username (case-insensitive). */
  getUserByUsername(username: string): Promise<User | null>
  /** Look up a user by id. */
  getUserById(id: string): Promise<User | null>
  /** Update a user's settings (Phase 5 — BYOK/provider/credits). */
  updateUserSettings(id: string, settings: UserSettingsUpdate): Promise<User>
  /** Atomically decrement hosted credits by 1 (returns new count). Phase 5. */
  decrementHostedCredits(id: string): Promise<number>

  // --- Sessions (Phase 3) ---
  /** Create a session for a user. Returns the session (its id is the cookie token). */
  createSession(userId: string): Promise<Session>
  /** Look up a session by token id. Returns null if missing or expired. */
  getSession(id: string): Promise<Session | null>
  /** Delete a session (logout). */
  deleteSession(id: string): Promise<void>
  /** Remove all expired sessions (cleanup, called periodically). */
  deleteExpiredSessions(): Promise<void>

  // --- Authored chapters (authoring tool) ---
  /** All AI-authored chapter specs, ascending by number (loaded into the registry at boot). */
  listChapterSpecs(): Promise<ChapterSpecRow[]>
  /** Create or replace the authored chapter at `number`. */
  upsertChapterSpec(number: number, spec: ChapterSpec, userId: string): Promise<void>
  /** Remove an authored chapter. */
  deleteChapterSpec(number: number): Promise<void>
}

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 days
const SNAPSHOT_CAP = 20 // per playthrough — generous enough that debug rollback stays useful

// --- In-memory backend ------------------------------------------------------
class MemStore implements PlaythroughStore {
  readonly kind = 'memory' as const
  private rows = new Map<string, Playthrough>()
  private history = new Map<string, WikiMap[]>()
  private users = new Map<string, User>()
  private sessions = new Map<string, Session>()
  private chapterSpecs = new Map<number, ChapterSpecRow>()
  private updatedAts = new Map<string, Date>()

  // -- Playthroughs --

  async create(character: string, wiki: WikiMap, history: Turn[], userId: string): Promise<Playthrough> {
    const row: Playthrough = { id: randomUUID(), character, wiki, history, userId }
    this.rows.set(row.id, structuredClone(row))
    this.history.set(row.id, [])
    this.updatedAts.set(row.id, new Date())
    return row
  }
  async get(id: string): Promise<Playthrough | null> {
    const row = this.rows.get(id)
    return row ? structuredClone(row) : null
  }
  async save(id: string, wiki: WikiMap, history: Turn[]): Promise<void> {
    const row = this.rows.get(id)
    if (!row) return
    row.wiki = structuredClone(wiki)
    row.history = structuredClone(history)
    this.updatedAts.set(id, new Date())
  }
  async snapshot(id: string, wiki: WikiMap): Promise<void> {
    const list = this.history.get(id) ?? []
    list.push(structuredClone(wiki))
    if (list.length > SNAPSHOT_CAP) list.splice(0, list.length - SNAPSHOT_CAP)
    this.history.set(id, list)
  }
  async getLastSnapshot(id: string): Promise<WikiMap | null> {
    const list = this.history.get(id) ?? []
    const last = list[list.length - 1]
    return last ? structuredClone(last) : null
  }
  async dropLastSnapshot(id: string): Promise<void> {
    const list = this.history.get(id)
    if (list && list.length) list.pop()
  }
  async listByUser(userId: string): Promise<SaveEntry[]> {
    const entries: SaveEntry[] = []
    for (const row of this.rows.values()) {
      if (row.userId !== userId) continue
      const { chapterNumber, anchorTitle } = chapterMetaOf(row.wiki)
      entries.push({
        id: row.id,
        character: row.character,
        chapterNumber,
        anchorTitle,
        updatedAt: (this.updatedAts.get(row.id) ?? new Date()).toISOString(),
        turnCount: row.history.length,
      })
    }
    return entries
  }

  // -- Users --

  async createUser(username: string, passwordHash: string): Promise<User> {
    const existing = await this.getUserByUsername(username)
    if (existing) throw new UserExistsError(username)
    const user: User = {
      id: randomUUID(),
      username,
      passwordHash,
      keyMode: 'hosted',
      llmProvider: null,
      llmModel: null,
      llmKeyEnc: null,
      llmBaseUrl: null,
      hostedCredits: 9999, // generous for testers; tighten when metering enforced
      createdAt: new Date(),
    }
    this.users.set(user.id, structuredClone(user))
    return user
  }
  async getUserByUsername(username: string): Promise<User | null> {
    const lower = username.toLowerCase()
    for (const u of this.users.values()) {
      if (u.username.toLowerCase() === lower) return structuredClone(u)
    }
    return null
  }
  async getUserById(id: string): Promise<User | null> {
    const u = this.users.get(id)
    return u ? structuredClone(u) : null
  }
  async updateUserSettings(id: string, settings: UserSettingsUpdate): Promise<User> {
    const u = this.users.get(id)
    if (!u) throw new Error('User not found')
    if (settings.keyMode !== undefined) u.keyMode = settings.keyMode
    if (settings.llmProvider !== undefined) u.llmProvider = settings.llmProvider
    if (settings.llmModel !== undefined) u.llmModel = settings.llmModel
    if (settings.llmKeyEnc !== undefined) u.llmKeyEnc = settings.llmKeyEnc
    if (settings.llmBaseUrl !== undefined) u.llmBaseUrl = settings.llmBaseUrl
    if (settings.hostedCredits !== undefined) u.hostedCredits = settings.hostedCredits
    this.users.set(id, u)
    return structuredClone(u)
  }
  async decrementHostedCredits(id: string): Promise<number> {
    const u = this.users.get(id)
    if (!u) throw new Error('User not found')
    if (u.hostedCredits > 0) u.hostedCredits -= 1
    this.users.set(id, u)
    return u.hostedCredits
  }

  // -- Sessions --

  async createSession(userId: string): Promise<Session> {
    const session: Session = {
      id: randomUUID(),
      userId,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      createdAt: new Date(),
    }
    this.sessions.set(session.id, structuredClone(session))
    return session
  }
  async getSession(id: string): Promise<Session | null> {
    const s = this.sessions.get(id)
    if (!s) return null
    if (new Date() > s.expiresAt) {
      this.sessions.delete(id)
      return null
    }
    return structuredClone(s)
  }
  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id)
  }
  async deleteExpiredSessions(): Promise<void> {
    const now = new Date()
    for (const [id, s] of this.sessions) {
      if (now > s.expiresAt) this.sessions.delete(id)
    }
  }

  // -- Authored chapters --

  async listChapterSpecs(): Promise<ChapterSpecRow[]> {
    return [...this.chapterSpecs.values()]
      .map((r) => structuredClone(r))
      .sort((a, b) => a.number - b.number)
  }
  async upsertChapterSpec(number: number, spec: ChapterSpec, userId: string): Promise<void> {
    this.chapterSpecs.set(number, {
      number,
      spec: structuredClone(spec),
      title: spec.title ?? '',
      updatedAt: new Date().toISOString(),
      updatedBy: userId,
    })
  }
  async deleteChapterSpec(number: number): Promise<void> {
    this.chapterSpecs.delete(number)
  }
}

// --- Postgres backend -------------------------------------------------------
class PgStore implements PlaythroughStore {
  readonly kind = 'postgres' as const
  constructor(private pool: pg.Pool) {}

  static async init(pool: pg.Pool): Promise<PgStore> {
    // Phase 3: users + sessions tables added alongside the existing Phase 0–2 tables.
    // Phase 5: BYOK/credits columns added to users.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY,
        username      TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      ALTER TABLE users ADD COLUMN IF NOT EXISTS key_mode       TEXT    NOT NULL DEFAULT 'hosted';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_provider   TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_model      TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_key_enc    TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS hosted_credits INTEGER NOT NULL DEFAULT 9999;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS llm_base_url  TEXT;
      CREATE TABLE IF NOT EXISTS sessions (
        id            UUID PRIMARY KEY,
        user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at    TIMESTAMPTZ NOT NULL,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS playthroughs (
        id          UUID PRIMARY KEY,
        user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
        character   TEXT NOT NULL,
        history     JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS wiki_files (
        playthrough_id UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
        name           TEXT NOT NULL,
        frontmatter    JSONB NOT NULL DEFAULT '{}'::jsonb,
        body           TEXT NOT NULL DEFAULT '',
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (playthrough_id, name)
      );
      CREATE TABLE IF NOT EXISTS wiki_history (
        id             BIGSERIAL PRIMARY KEY,
        playthrough_id UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE,
        snapshot       JSONB NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS authored_chapters (
        number     INTEGER PRIMARY KEY,
        spec       JSONB NOT NULL,
        title      TEXT NOT NULL DEFAULT '',
        updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      -- One-time trim of snapshots accumulated before the cap existed (no-op once clean).
      -- The literal 20 must stay in sync with the SNAPSHOT_CAP TypeScript constant above.
      DELETE FROM wiki_history WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (
            PARTITION BY playthrough_id ORDER BY id DESC
          ) rn FROM wiki_history
        ) t WHERE rn > 20
      );

      -- Repair rows corrupted by the pre-fix "null" string bug (no-op once clean;
      -- safe to re-run every boot, same pattern as the ALTER TABLE migrations above).
      UPDATE users SET llm_provider = NULL WHERE llm_provider = 'null';
      UPDATE users SET llm_model    = NULL WHERE llm_model    = 'null';
      UPDATE users SET llm_base_url = NULL WHERE llm_base_url = 'null';
    `)
    return new PgStore(pool)
  }

  // -- Playthroughs --

  async create(character: string, wiki: WikiMap, history: Turn[], userId: string): Promise<Playthrough> {
    const id = randomUUID()
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        'INSERT INTO playthroughs (id, user_id, character, history) VALUES ($1, $2, $3, $4)',
        [id, userId, character, JSON.stringify(history)],
      )
      for (const [name, file] of Object.entries(wiki)) {
        await client.query(
          'INSERT INTO wiki_files (playthrough_id, name, frontmatter, body) VALUES ($1, $2, $3, $4)',
          [id, name, JSON.stringify(file.frontmatter ?? {}), file.body ?? ''],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    return { id, character, wiki, history, userId }
  }

  async get(id: string): Promise<Playthrough | null> {
    const pt = await this.pool.query(
      'SELECT character, history, user_id FROM playthroughs WHERE id = $1',
      [id],
    )
    if (pt.rowCount === 0) return null
    const files = await this.pool.query(
      'SELECT name, frontmatter, body FROM wiki_files WHERE playthrough_id = $1',
      [id],
    )
    const wiki: WikiMap = {}
    for (const r of files.rows) {
      wiki[r.name] = { frontmatter: r.frontmatter ?? {}, body: r.body ?? '' }
    }
    return {
      id,
      character: pt.rows[0].character,
      history: pt.rows[0].history ?? [],
      wiki,
      userId: pt.rows[0].user_id ?? undefined,
    }
  }

  async save(id: string, wiki: WikiMap, history: Turn[]): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('UPDATE playthroughs SET history = $2, updated_at = now() WHERE id = $1', [
        id,
        JSON.stringify(history),
      ])
      for (const [name, file] of Object.entries(wiki)) {
        await client.query(
          `INSERT INTO wiki_files (playthrough_id, name, frontmatter, body, updated_at)
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT (playthrough_id, name)
           DO UPDATE SET frontmatter = EXCLUDED.frontmatter, body = EXCLUDED.body, updated_at = now()`,
          [id, name, JSON.stringify(file.frontmatter ?? {}), file.body ?? ''],
        )
      }
      // Delete rows no longer in the wiki map (e.g. recap.md dropped by consolidate).
      // Guarded on a non-empty key list so a stray empty-wiki save can never wipe
      // every row for a playthrough.
      const names = Object.keys(wiki)
      if (names.length > 0) {
        await client.query(
          'DELETE FROM wiki_files WHERE playthrough_id = $1 AND name <> ALL($2::text[])',
          [id, names],
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  async snapshot(id: string, wiki: WikiMap): Promise<void> {
    await this.pool.query('INSERT INTO wiki_history (playthrough_id, snapshot) VALUES ($1, $2)', [
      id,
      JSON.stringify(wiki),
    ])
    // Keep only the N most recent snapshots for this playthrough.
    await this.pool.query(
      `DELETE FROM wiki_history
       WHERE playthrough_id = $1
         AND id NOT IN (
           SELECT id FROM wiki_history
           WHERE playthrough_id = $1
           ORDER BY id DESC LIMIT $2
         )`,
      [id, SNAPSHOT_CAP],
    )
  }

  async getLastSnapshot(id: string): Promise<WikiMap | null> {
    const r = await this.pool.query(
      'SELECT snapshot FROM wiki_history WHERE playthrough_id = $1 ORDER BY id DESC LIMIT 1',
      [id],
    )
    return r.rowCount ? (r.rows[0].snapshot as WikiMap) : null
  }

  async dropLastSnapshot(id: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM wiki_history WHERE id = (
         SELECT id FROM wiki_history WHERE playthrough_id = $1 ORDER BY id DESC LIMIT 1
       )`,
      [id],
    )
  }

  async listByUser(userId: string): Promise<SaveEntry[]> {
    const result = await this.pool.query(
      `SELECT p.id, p.character, p.updated_at,
              jsonb_array_length(p.history) AS turn_count,
              COALESCE(wf.frontmatter->>'current_anchor', 'A1') AS anchor,
              COALESCE(wf.frontmatter->>'current_chapter', '1') AS chapter_num
       FROM playthroughs p
       LEFT JOIN wiki_files wf ON wf.playthrough_id = p.id AND wf.name = 'world-state.md'
       WHERE p.user_id = $1
       ORDER BY p.updated_at DESC`,
      [userId],
    )
    // Chapter-title resolution needs the in-process chapter registry, which raw SQL can't
    // reach — so resolve it here, mirroring chapterMetaOf's CHAPTER_END handling.
    return result.rows.map((r) => {
      const ch = getChapter(Number(r.chapter_num))
      const anchor = String(r.anchor)
      return {
        id: r.id,
        character: r.character,
        chapterNumber: ch.number,
        anchorTitle: anchor === CHAPTER_END ? 'Chapter complete' : (ch.anchorTitles[anchor] ?? anchor),
        updatedAt: (r.updated_at as Date).toISOString(),
        turnCount: Number(r.turn_count),
      }
    })
  }

  // -- Users --

  async createUser(username: string, passwordHash: string): Promise<User> {
    const id = randomUUID()
    try {
      const result = await this.pool.query(
        `INSERT INTO users (id, username, password_hash)
         VALUES ($1, $2, $3)
         RETURNING id, username, password_hash, key_mode, llm_provider, llm_model, llm_key_enc, llm_base_url, hosted_credits, created_at`,
        [id, username, passwordHash],
      )
      const row = result.rows[0]
      return {
        id: row.id,
        username: row.username,
        passwordHash: row.password_hash,
        keyMode: row.key_mode,
        llmProvider: row.llm_provider,
        llmModel: row.llm_model,
        llmKeyEnc: row.llm_key_enc,
        llmBaseUrl: row.llm_base_url,
        hostedCredits: row.hosted_credits,
        createdAt: row.created_at,
      }
    } catch (err: any) {
      if (err.code === '23505') throw new UserExistsError(username) // unique violation
      throw err
    }
  }
  async getUserByUsername(username: string): Promise<User | null> {
    const result = await this.pool.query(
      'SELECT id, username, password_hash, key_mode, llm_provider, llm_model, llm_key_enc, llm_base_url, hosted_credits, created_at FROM users WHERE LOWER(username) = LOWER($1)',
      [username],
    )
    if (result.rowCount === 0) return null
    const row = result.rows[0]
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      keyMode: row.key_mode,
      llmProvider: row.llm_provider,
      llmModel: row.llm_model,
      llmKeyEnc: row.llm_key_enc,
      llmBaseUrl: row.llm_base_url,
      hostedCredits: row.hosted_credits,
      createdAt: row.created_at,
    }
  }
  async getUserById(id: string): Promise<User | null> {
    const result = await this.pool.query(
      'SELECT id, username, password_hash, key_mode, llm_provider, llm_model, llm_key_enc, llm_base_url, hosted_credits, created_at FROM users WHERE id = $1',
      [id],
    )
    if (result.rowCount === 0) return null
    const row = result.rows[0]
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      keyMode: row.key_mode,
      llmProvider: row.llm_provider,
      llmModel: row.llm_model,
      llmKeyEnc: row.llm_key_enc,
      llmBaseUrl: row.llm_base_url,
      hostedCredits: row.hosted_credits,
      createdAt: row.created_at,
    }
  }
  async updateUserSettings(id: string, settings: UserSettingsUpdate): Promise<User> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      if (settings.keyMode !== undefined) {
        await client.query('UPDATE users SET key_mode = $2 WHERE id = $1', [id, settings.keyMode])
      }
      if (settings.llmProvider !== undefined) {
        await client.query('UPDATE users SET llm_provider = $2 WHERE id = $1', [id, settings.llmProvider])
      }
      if (settings.llmModel !== undefined) {
        await client.query('UPDATE users SET llm_model = $2 WHERE id = $1', [id, settings.llmModel])
      }
      if (settings.llmKeyEnc !== undefined) {
        await client.query('UPDATE users SET llm_key_enc = $2 WHERE id = $1', [id, settings.llmKeyEnc])
      }
      if (settings.llmBaseUrl !== undefined) {
        await client.query('UPDATE users SET llm_base_url = $2 WHERE id = $1', [id, settings.llmBaseUrl])
      }
      if (settings.hostedCredits !== undefined) {
        await client.query('UPDATE users SET hosted_credits = $2 WHERE id = $1', [id, settings.hostedCredits])
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    return (await this.getUserById(id))!
  }
  async decrementHostedCredits(id: string): Promise<number> {
    const result = await this.pool.query(
      `UPDATE users SET hosted_credits = hosted_credits - 1
       WHERE id = $1 AND hosted_credits > 0
       RETURNING hosted_credits`,
      [id],
    )
    return result.rowCount === 0 ? 0 : Number(result.rows[0].hosted_credits)
  }

  // -- Sessions --

  async createSession(userId: string): Promise<Session> {
    const id = randomUUID()
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
    await this.pool.query(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)',
      [id, userId, expiresAt],
    )
    return { id, userId, expiresAt, createdAt: new Date() }
  }
  async getSession(id: string): Promise<Session | null> {
    const result = await this.pool.query(
      'SELECT id, user_id, expires_at, created_at FROM sessions WHERE id = $1 AND expires_at > now()',
      [id],
    )
    if (result.rowCount === 0) return null
    const row = result.rows[0]
    return { id: row.id, userId: row.user_id, expiresAt: row.expires_at, createdAt: row.created_at }
  }
  async deleteSession(id: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE id = $1', [id])
  }
  async deleteExpiredSessions(): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE expires_at <= now()')
  }

  // -- Authored chapters --

  async listChapterSpecs(): Promise<ChapterSpecRow[]> {
    const r = await this.pool.query(
      'SELECT number, spec, title, updated_at, updated_by FROM authored_chapters ORDER BY number',
    )
    return r.rows.map((row) => ({
      number: row.number,
      spec: row.spec as ChapterSpec,
      title: row.title,
      updatedAt: (row.updated_at as Date).toISOString(),
      updatedBy: row.updated_by ?? null,
    }))
  }
  async upsertChapterSpec(number: number, spec: ChapterSpec, userId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO authored_chapters (number, spec, title, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (number) DO UPDATE
         SET spec = EXCLUDED.spec, title = EXCLUDED.title, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [number, JSON.stringify(spec), spec.title ?? '', userId],
    )
  }
  async deleteChapterSpec(number: number): Promise<void> {
    await this.pool.query('DELETE FROM authored_chapters WHERE number = $1', [number])
  }
}

// --- Factory ----------------------------------------------------------------
// Postgres when DATABASE_URL is set AND reachable; otherwise in-memory. A bad/absent
// DB never crashes the app — it just falls back so the game still runs.
export async function createStore(): Promise<PlaythroughStore> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.log('[store] No DATABASE_URL — using in-memory store (state resets on restart).')
    return new MemStore()
  }
  try {
    const pool = new pg.Pool({ connectionString: url })
    await pool.query('SELECT 1')
    const store = await PgStore.init(pool)
    console.log('[store] Connected to Postgres — playthroughs persist across restarts.')
    return store
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[store] Postgres unreachable (${msg}) — falling back to in-memory store.`)
    return new MemStore()
  }
}

// --- Custom error -----------------------------------------------------------
export class UserExistsError extends Error {
  constructor(username: string) {
    super(`Username "${username}" is already taken.`)
    this.name = 'UserExistsError'
  }
}
