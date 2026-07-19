# Technical Specifications — Archipelago Lighthouse

*What the system actually is today — architecture, data model, the chapter engine, and the
API surface. This doc describes current state, not history or what's next; it has no "phase"
or "status" framing, so it doesn't go stale the way a handoff or build plan does. When the
code changes, update this doc in the same commit.*

*For design intent and the LLM Wiki concept, see [README.md](README.md). For how to author a
chapter, see [ADDING_CHAPTERS.md](ADDING_CHAPTERS.md). For forking this into a different game,
see [FORK_GUIDE.md](FORK_GUIDE.md).*

---

## 1. Shape of the system

One Node process serves both the JSON API and the built React frontend (static files). There
is no separate frontend server in production — `npm run build` compiles `client/` to
`client/dist`, the server serves it, and the browser calls `/api/*` on the same origin. In
dev, `npm run dev` runs the Vite dev server (`:5173`) and the API server (`:3001`) side by
side, with Vite proxying `/api` to the backend.

```
Browser ──/api/*──> Express (server/src/index.ts) ──> Postgres (or in-memory fallback)
   ▲                        │
   └── built client/dist ───┘ (production: same process serves both)
```

Everything is TypeScript. The server is plain Express (no framework on top); the client is
React + Vite + Tailwind v4, with no router library — `App.tsx` is a hand-rolled screen state
machine (§8).

**The core principle:** the AI narrates, but never decides progression. It answers every turn
through a forced structured shape (`{narrative, suggested_actions, events, wiki_updates}`),
and only the `events` it reports — drawn from a small, per-chapter closed vocabulary — can
move the story forward, by being folded into state fields that code (not the model) checks
against each beat's conditions. See §4 for the full mechanism.

---

## 2. Data model

Six Postgres tables (`server/src/store.ts`). Falls back to an equivalent in-memory store if
`DATABASE_URL` is unset or unreachable at boot (state then resets on restart) — see §6.

```sql
-- One row per account.
users
  id             UUID PRIMARY KEY
  username       TEXT UNIQUE NOT NULL
  password_hash  TEXT NOT NULL                  -- bcryptjs
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  key_mode       TEXT NOT NULL DEFAULT 'hosted' -- 'hosted' | 'byok'
  llm_provider   TEXT                           -- set if key_mode = 'byok'
  llm_model      TEXT
  llm_key_enc    TEXT                           -- AES-256-GCM ciphertext; never sent to client
  llm_base_url   TEXT
  hosted_credits INTEGER NOT NULL DEFAULT 9999  -- turns left on the operator's shared key

-- One row per active login. The `sid` cookie carries the id.
sessions
  id          UUID PRIMARY KEY
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
  expires_at  TIMESTAMPTZ NOT NULL
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()

-- One row per save / story run. A user may have several. The `pid` cookie carries the id
-- of the currently-active one.
playthroughs
  id          UUID PRIMARY KEY
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE
  character   TEXT NOT NULL                     -- 'kaspen'|'kaelen'|'pan'|'tariel'|'rulan'|'visitor'
  history     JSONB NOT NULL DEFAULT '[]'::jsonb -- Turn[] — the full conversation, carried across chapters
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()

-- The wiki: one row per markdown file per playthrough. Source of truth for game state.
wiki_files
  playthrough_id UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE
  name           TEXT NOT NULL                  -- 'world-state.md', 'pan.md', ...
  frontmatter    JSONB NOT NULL DEFAULT '{}'::jsonb  -- machine-readable fields; the gate reads these
  body           TEXT NOT NULL DEFAULT ''       -- prose the AI reads
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  PRIMARY KEY (playthrough_id, name)

-- One snapshot, taken just before the most recent committed turn — powers one-step rollback.
wiki_history
  id             BIGSERIAL PRIMARY KEY
  playthrough_id UUID NOT NULL REFERENCES playthroughs(id) ON DELETE CASCADE
  snapshot       JSONB NOT NULL                 -- the full WikiMap as of just before the last turn
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()

-- AI-authored chapters (the authoring tool), loaded into the in-process chapter registry at
-- boot. Chapter 1 is a hand-written built-in and never lives in this table.
authored_chapters
  number     INTEGER PRIMARY KEY
  spec       JSONB NOT NULL                     -- a ChapterSpec, see §4
  title      TEXT NOT NULL DEFAULT ''
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

Notes:
- `playthroughs.history` holds the entire conversation as one JSONB array (`{role, content}`
  per turn) — untruncated, and **not reset between chapters**. This is the stored/returned
  history (the player's story log, the recap) — it deliberately stays full. The **model's**
  view of it is a separate, narrower thing built fresh each turn; see §3 step 2 and
  the context-bounding design.
- `wiki_files.frontmatter` is where all gating state lives: `current_chapter`,
  `current_anchor`, `turns_since_progress`, `chapter_history_start`, and every chapter's
  scratch fields, all on `world-state.md`. Other files (`pan.md`, `player-character.md`, …)
  hold relationship/world facts in their own frontmatter + prose body. `chapter-log.md` is a
  normal wiki file too — written by `appendChapterLog()` at the chapter transition (§5), it
  carries each finished chapter's recap forward into every later prompt.
- `wiki_history` keeps exactly one snapshot at a time (consumed and dropped by rollback) — it
  is not a full turn-by-turn audit log.

**Art storage** (`server/src/artStore.ts`) is an independent filesystem-backed registry — it does
not use Postgres tables in v1:

- **Registry:** `server/data/art/registry.json` — a JSON array of `ArtAsset` objects (id, kind,
  chapterNumber, anchor, title, label, filename, url, mimeType, sizeBytes, updatedAt, updatedBy).
  Written atomically (tmp → rename).
- **Files:** stored under `server/data/art/beats/chapter-{n}/` with deterministic names —
  `chapter-art.{ext}` for chapter art, `{anchor-lowercase}-{slug}.{ext}` for beat art.
- **Environment:** `ART_DIR` (defaults to `cwd/data/art`) overrides the storage root. In Docker,
  set to `/app/server/data/art` and backed by the `artdata` named volume for persistence.
- **Security:** path parts are sanitized; uploaded filenames are never used as disk paths;
  MIME types are server-sniffed with `file-type` before persisting metadata or choosing
  extensions; only MP4, JPEG, PNG, WebP, GIF, and AVIF are accepted (50 MB hard cap).
- **Media serving:** no public static route. All player-facing art streams through
  `GET /api/art/media/:artId?playthroughId=` with ownership verification + unlock-gating;
  admin previews through `GET /api/admin/art/media/:artId` behind `requireAdmin`.
  `X-Content-Type-Options: nosniff` is set on all media responses.

---

## 3. The turn loop, end to end

`POST /api/play-turn` (`server/src/index.ts`) is the one endpoint that actually advances the
story. Per turn:

1. **Auth + load** — resolve the session cookie to a user, the `pid` cookie to a playthrough,
   verify ownership. Capture `priorAnchor` (the anchor *before* this turn).
2. **Build the prompt** (`playTurn.ts`) — two separate system messages, not one concatenated
   string. `buildStableSystemPrompt()` covers the fixed world bible (`worldBible.ts`), the
   active chapter's `fragment` (overview + guardrails), the active anchor's `note` (plus a
   transition/nudge block if relevant), and POV framing — sent with a `cache_control`
   breakpoint (`ephemeral`, 1h ttl). `volatileSystemPrompt()` covers the full current wiki
   state (which includes `chapter-log.md` — prior chapters' compact recaps) — sent right
   after, uncached, since it can change every turn. Splitting them keeps a wiki-state edit
   from invalidating the stable block's cache (see "Token usage, honestly" in README.md). Plus
   the model's *bounded* view of the conversation (`buildModelMessages` — the active chapter's
   last `MODEL_WINDOW_TURNS` exchanges, `retry.ts`; never the full §2 `history`) and the
   player's new input.
3. **Call the model** (`streamPlayTurn`) — streams narrative text, then resolves to a
   structured object forced to a per-anchor schema: `{narrative, suggested_actions, events,
   wiki_updates, fact_additions}`. The `events` enum offered to the model is **scoped to
   `priorAnchor`** — `Chapter.allowedEvents(crewId, anchor)` excludes any event belonging to a
   later anchor, so the model cannot report progress it hasn't earned, and excludes the
   player's own `spoke_to_<self>` token.
4. **Finalize** (`finalizeStructured`) — defensively re-filters `events` to the same allowed
   set (never trust the model's own restraint), clamps `suggested_actions` to 4, drops
   malformed `wiki_updates`/`fact_additions`.
5. **Write back** (`engine.ts runWriteBack`) — pure function, in order:
   - Apply the model's scalar `wiki_updates`, rejecting writes to engine-owned fields,
     nonexistent files, or the reserved `facts` field (`applyWikiUpdates`).
   - Apply the model's `fact_additions` (`applyFactAdditions`) — short, durable freeform notes
     appended to a file's `facts` array; capped at 8 entries/file and 30 words/220 characters
     each (oldest dropped first when full), refused for nonexistent files or
     `recap.md`/`chapter-log.md` (see `WIKI_FACTS_UPGRADE.md`). That per-turn FIFO drop isn't
     the end of a fact's life, though — at the next chapter transition, whatever's still live
     gets folded into the permanent chapter recap before the array resets (§5,
     `WIKI_FACTS_FOLD_UPGRADE.md`).
   - Fold `events` into `world-state.md` fields (`foldEvents`): a fold with no `token` sets a
     boolean field `true`; a fold **with** a token pushes that token onto an array field —
     **deduplicated** (`if (!cur.includes(token))`), so the same literal token fired twice
     only ever counts once. This is why a `count_gte` condition needs N *distinct* tokens,
     not one event fired N times.
   - Check `anchorConditionsMet(fromAnchor, fm)`; if satisfied, advance exactly one anchor
     (`nextAnchor`) and flag `pending_transition` for the next turn's prompt. At most one
     anchor advances per turn — there is no loop here.
   - Update the soft-lock counter: `turns_since_progress` resets to 0 on any fold-change or
     advance, else increments. `promptFlags()` compares this against the chapter's
     `softLockThreshold` (default 5) to decide whether to inject a "GENTLE STEER" nudge
     (`Chapter.unmetHint`) into the *next* turn's prompt.
6. **Persist** — snapshot the pre-turn wiki into `wiki_history` (for rollback), save the new
   wiki + appended history to `playthroughs`. Decrement `hosted_credits` if the user isn't BYOK.
7. **Stream the result** to the client as NDJSON frames, ending in a `done` frame carrying the
   new anchor/chapter meta and full wiki state.

Chapter transitions (`POST /api/next-chapter`) and rollback (`POST /api/rollback`) reuse the
same wiki/history machinery outside this loop — see §5 for both.

---

## 4. The chapter engine

A chapter is data, not code. `server/src/chapters/defineChapter.ts` exports `ChapterSpec` —
the one shape both the authoring tool and a hand-written chapter module produce — and
`defineChapter(spec)`, which derives everything the engine needs from it (so there's nothing
else to keep in sync by hand):

```ts
type Clause = { field: string; op: 'flag' | 'count_gte'; value?: number; hint?: string }

type ChapterSpec = {
  number: number
  title: string
  fragment: string                // overview + guardrails, appended to the world bible every turn
  anchors: { id: string; title: string; note: string; advanceWhen: Clause[] }[]
  events: { token: string; anchor: string; fold: { field: string; token?: string } }[]
  opening: { prose: string; actions: string[] }
  softLockThreshold?: number      // default 5
  endState?: EndStateOp[]         // durable cross-chapter writes (see §5)
  isFinal?: boolean               // marks this as the last chapter; defaults false
  epilogue?: string               // optional author-written closing prose (only meaningful when isFinal)
  acknowledgment?: string         // optional author-written credits/thank-you (only meaningful when isFinal)
}
```

`defineChapter()` returns a `Chapter` (`server/src/chapters/types.ts`) — the runtime shape the
engine actually calls:

```ts
interface Chapter {
  number: number; title: string; firstAnchor: string
  anchorOrder: readonly string[]
  anchorTitles: Record<string, string>
  events: readonly string[]
  foldMap: Record<string, { field: string; token?: string }>
  engineOwnedFields: Set<string>          // current_chapter, current_anchor, turns_since_progress, chapter_history_start, + every fold field
  fragment: string
  beatNotes: Record<string, string>
  softLockThreshold: number
  allowedEvents(crewId: string | null, anchor: string): string[]
  anchorConditionsMet(anchor: string, fm: Fm): boolean
  nextAnchor(anchor: string): string
  unmetHint(anchor: string, fm: Fm): string
  activeAnchorSection(anchor: string, opts?: { justAdvanced?: boolean; nudge?: string }): string
  scratchSeed(): Record<string, unknown>  // [] for token-bearing folds, false for flags — auto-derived
  openingFor(characterId: string): { prose: string; actions: string[] }
  endState?: (wiki: WikiMap) => void      // optional durable write — see below
  isFinal: boolean                        // author-declared final chapter; defaults false
  epilogue?: string                       // author-written closing prose
  acknowledgment?: string                 // author-written credits/thank-you
}
```

**Registry** (`chapters/index.ts`): a `Map<number, Chapter>` cache, seeded with `BUILTINS`
(`{ 1: CHAPTER_1, 2: defineChapter(CHAPTER_2_SPEC), 3: CHAPTER_3 }` — hand-written, see
`chapter1.ts`/`chapter2.ts`/`chapter3.ts`) and filled at boot from `authored_chapters` via
`loadAuthoredChapters()`. Saving a chapter through the admin endpoint
calls `registerSpec()` directly — the cache updates immediately, no restart needed. **A raw
database write to `authored_chapters` does NOT update the live cache** — only a server restart
(which reruns `loadAuthoredChapters`) or the save endpoint does. `canAdvanceFrom(n)` gates
chapter transitions: returns `true` only when chapter `n` is not final AND chapter `n+1` exists
in the registry.

**The golden rule** (`validateChapterSpec`, run by the save endpoint before every write): every
field a condition reads must be fed by some event's fold; every event must belong to a real
anchor; `count_gte` may only target a token-bearing (array) field; symmetrically, `flag` may
only target a field actually fed by a flag-type fold — a field only ever pushed onto as an
array can never equal `true`. An empty-string `fold.token` is treated as absent (a flag fold),
since structured-output models reliably emit `""` instead of omitting an optional field
(`FOLD_TOKEN_SOFTLOCK_FIX.md` has the full incident — it once made every anchor in an authored
chapter unwinnable). A spec that fails any of this is refused, never saved.

**`endState`** is durable, cross-chapter state written when a chapter ends — `consolidate.ts`
calls the *outgoing* chapter's `endState` before its scratch fields are dropped (e.g. Chapter 1
sets `vow_made: true`). Two ways to author it: a hand-written `(wiki: WikiMap) => void` function
bolted directly onto a `Chapter` object (the manual path — see
[ADDING_CHAPTERS.md](ADDING_CHAPTERS.md) / [FORK_GUIDE.md](FORK_GUIDE.md) §5), or declaratively
via `ChapterSpec.endState: EndStateOp[]` — `{ field, op: 'set' | 'append', value }` entries that
`defineChapter()` converts into the same function shape. Every `endState` field name must start
with `chapterend_` (enforced by `validateChapterSpec`), and no event's fold field may ever use
that prefix — this keeps a chapter's durable facts from colliding with its own or a later
chapter's scratch fields, which are cleared on every transition. The validator also checks for
cross-chapter name reuse: if two chapters declare the same field with different ops, the save
that introduces the conflict is refused. The authoring tool's Review stage has its own "Durable
end-state" section for the declarative form.

---

## 5. Other server-owned mechanics

- **Consolidation** (`consolidate.ts`) — at `POST /api/next-chapter`: `consolidate()` calls the
  outgoing chapter's `endState(wiki)` if present, drops its spent scratch fields (exactly
  `scratchSeed()`'s keys — the per-chapter condition fields, distinct from the universal engine
  fields like `current_chapter`/`chapter_history_start`), seeds the incoming chapter's
  `scratchSeed()`, and resets every file's `facts` array to `[]`. That last step is safe only
  because `generateRecapProse` (see Recap below) already had its one chance to fold anything
  worth keeping out of those arrays into the outgoing chapter's permanent recap prose before
  this function ever runs — clearing them here just frees the next chapter's full 8-slot
  allowance instead of carrying over whatever FIFO eviction (§3 step 5) hadn't already
  dropped. Everything else on the wiki (relationship files, durable world-state flags) passes
  through untouched — that's how a Chapter 1 choice can pay off in Chapter 3 with no extra
  plumbing. The same route also calls `appendChapterLog(wiki, fromNumber, title, prose)`
  (also `consolidate.ts`) right after, which writes the outgoing chapter's recap prose into
  `chapter-log.md` — reusing the cached `recap.md` if the player already viewed the recap
  screen, generating it fresh otherwise — then sets `chapter_history_start = history.length`
  (pre-append) so the model's window starts clean on the new chapter (see §3 step 2). One edge
  case: if there's no next chapter registered, `/api/next-chapter` returns `{ complete: true }`
  before any of this runs — the recap can still fold facts into its prose (next bullet), but
  the live arrays are never actually cleared, since there's nothing to consolidate into.
- **Migration** (`migrate.ts`) — on load, seeds any scratch field a chapter's current spec
  expects but an older save doesn't have yet (e.g. the chapter was edited after the save was
  created).
- **Recap** (`recap.ts`) — at chapter end: `buildRecapFacts` derives hard facts from the final
  wiki in code (no AI call) and also snapshots every file's live AI-authored `facts` array into
  `notableFacts` (omitting empty ones); `generateRecapProse` makes exactly one AI call for the
  warm narrative + title — its prompt includes those notable facts (via
  `buildNotableFactsBlock`) so anything durable gets one chance to be woven into the permanent
  recap before consolidation clears the live arrays — cached into `recap.md` so revisiting the
  recap never re-bills (see `WIKI_FACTS_FOLD_UPGRADE.md`).
- **Recap archive** (`recapArchive.ts`) — append-only, immutable store of every completed
  chapter recap kept in `recap-history.md` frontmatter as a versioned envelope
  (`{ version: 1, entries: [...] }`). Once written an entry is never rewritten — later chapter
  edits cannot change historical recap data. Existing unversioned archives (`{ entries: [...] }`)
  are read as legacy v0 and silently upgraded to v1 on the next successful append (invalid
  rows preserved byte-for-value). A corrupt or unsupported declared version is treated as
  archive corruption — `archiveEnvelopeError()` returns the reason; `prepareChapterRecap` fails
  safely with `RecapCorruptionError` rather than regenerating. A legacy prose-only fallback
  (`chapter-log.md`) is parsed for chapters predating the archive (only strictly increasing
  chapter numbers accepted); archive always wins for the same chapter number.
- **Recap preparation** (`recapPreparation.ts`) — shared archive-first, cache-second,
  generate-last logic used by both the recap and next-chapter routes. Valid archive hits
  return the exact snapshot (only `hasNextChapter` is live-computed); corrupt entries throw
  a retryable error and never regenerate.
- **Chapter-end lock** (`chapterEndLock.ts`) — process-local FIFO lock keyed by playthrough
  id. Prevents concurrent recap generation or chapter advancement for the same save. Release
  is idempotent; different keys are independent. The map entry is retained while a successor
  runs, then deleted only when the final holder releases with no queued waiters — this prevents
  a third request from seeing an empty queue and entering concurrently with a just-woken holder.
  **Single-process limitation:** this lock is not safe across multiple Node.js processes;
  deployments must continue to run one app instance.
- **Rollback** (`POST /api/rollback`, admin-only) — restores the wiki from the one stored
  `wiki_history` snapshot and trims the last player/AI exchange from `history`. One step only;
  the snapshot is dropped once consumed.
- **BYOK** (`crypto.ts`, `llm.ts`) — a user's own provider/model/key (`key_mode = 'byok'`) is
  validated with a cheap test call before saving, then encrypted at rest (AES-256-GCM under a
  server-held `APP_SECRET`) and never returned to the client. `key_mode = 'hosted'` users
  share the operator's key and are metered via `hosted_credits` (decremented per turn; not yet
  enforced at zero).

---

## 6. Storage fallback

`createStore()` (`store.ts`) picks Postgres if `DATABASE_URL` is set **and** reachable at
boot; otherwise it logs a warning and falls back to an equivalent in-memory store — the app
never fails to start over a missing database. The trade-off: in-memory state (every user,
save, and authored chapter) is lost on restart. `docker compose up` (see
[README.md](README.md)) wires `DATABASE_URL` automatically; plain `npm run dev` does
not, by design (zero-setup local dev).

---

## 7. API surface

All protected routes require a valid `sid` session cookie (`requireAuth`); admin routes
additionally require the session's username to be listed in `ADMIN_USERNAMES`.

**Public**
| Route | Purpose |
|---|---|
| `GET /api/health` | Liveness check; reports which store backend is active. |
| `POST /api/ping` | Diagnostic: send a hardcoded prompt through the LLM layer, return the reply. |
| `POST /api/auth/signup` | Create an account, start a session. |
| `POST /api/auth/login` | Verify credentials, start a session. |

**Protected — auth & settings**
| Route | Purpose |
|---|---|
| `GET /api/auth/me` | Current user's profile (never the decrypted key). |
| `POST /api/auth/logout` | End the session. |
| `GET /api/auth/settings` | Current LLM/credits settings. |
| `PUT /api/auth/settings` | Update provider/model/key/base URL; validates + encrypts a new BYOK key. |
| `POST /api/auth/settings/validate-key` | Test a key without saving it. |

**Protected — saves & state**
| Route | Purpose |
|---|---|
| `GET /api/saves` | List the user's playthroughs (chapter + beat title, turn count, updated-at). |
| `POST /api/saves/:id/resume` | Make a specific playthrough the active one; returns full game state. |
| `POST /api/new-game` | Start a new playthrough as a chosen character (or the Visitor). |
| `GET /api/state` | Rehydrate the currently-active playthrough. |

**Protected — gameplay**
| Route | Purpose |
|---|---|
| `POST /api/play-turn` | The core loop (§3). Streams NDJSON narrative, then a `done` frame. |
| `GET /api/recap` | Chapter-end facts + prose (cached after first generation). Chapter must be complete. |
| `POST /api/next-chapter` | Consolidate and advance to the next chapter, or report the story is complete. |
| `POST /api/rollback` | **Admin.** Undo the last committed turn. |

**Protected — recap history** (read-only, ownership-checked via pid cookie)
| Route | Purpose |
|---|---|
| `GET /api/recaps` | Newest-first summary list of all completed chapter recaps. |
| `GET /api/recaps/:chapterNumber` | Exact archive or legacy detail for one chapter. Never calls the LLM. |

**Protected — chapter authoring (admin only)**
| Route | Purpose |
|---|---|
| `POST /api/admin/expand-chapter` | AI-expand a plain-language brief into a draft `ChapterSpec`. |
| `POST /api/admin/save-chapter` | Validate (golden rule) and save a spec; registers it live. |
| `GET /api/admin/chapters` | List authored chapters. |
| `GET /api/admin/chapters/:n` | Fetch one chapter's full spec (to reload into the editor). |
| `DELETE /api/admin/chapters/:n` | Remove an authored chapter (Chapter 1 is protected). |

**Protected — art gallery** (ownership-checked, unlock-gated per chapter/beat)
| Route | Purpose |
|---|---|
| `GET /api/art/gallery/:playthroughId` | Chapter-organized gallery for a specific save (completed + current chapters). |
| `GET /api/art/:chapterNumber?playthroughId=` | Chapter art + reached beat art for the active game screen. |
| `GET /api/art/:chapterNumber/:anchor?playthroughId=` | Single beat art lookup. |
| `GET /api/art/media/:artId?playthroughId=` | Protected media streaming (`X-Content-Type-Options: nosniff`). |

**Admin-only — art management** (multipart upload, 50 MB cap, file-signature sniffing)
| Route | Purpose |
|---|---|
| `GET /api/admin/art/chapters` | Chapter options (built-in + authored) for the uploader UI. |
| `POST /api/admin/art/upload` | Upload chapter/beat art (multipart: file, chapterNumber, optional anchor). |
| `GET /api/admin/art/:chapterNumber` | Existing art for a chapter (unfiltered by unlock state, admin preview URLs). |
| `GET /api/admin/art/media/:artId` | Admin media preview streaming. |
| `DELETE /api/admin/art/:artId` | Delete art (metadata + file). |

---

## 8. Module map

**`server/src/`**
| File | Responsibility |
|---|---|
| `index.ts` | Express app, every route, auth wall, store/chapter-registry init at boot. |
| `store.ts` | `PlaythroughStore` interface; `PgStore` and `MemStore` implementations. |
| `artStore.ts` | Filesystem-backed art registry: read/write `registry.json`, deterministic upload paths, MIME validation, path sanitization, atomic writes. |
| `types.ts` | Shared server-side types (`WikiMap`, `Turn`, `Playthrough`, `User`, `SaveEntry`, …). |
| `auth.ts` | Password hashing/validation, `requireAuth`/`requireAdmin` middleware. |
| `llm.ts` | Provider abstraction over the AI SDK; model resolution for hosted vs. BYOK. |
| `crypto.ts` | AES-256-GCM encryption for BYOK keys at rest. |
| `playTurn.ts` | Prompt assembly — `buildStableSystemPrompt`/`volatileSystemPrompt` (split system messages so a wiki-state change can't invalidate the cached stable prefix), `buildModelMessages` (the bounded per-chapter window) — the forced structured-output schema, `finalizeStructured`. |
| `engine.ts` | `runWriteBack` (fold + gate + advance), `promptFlags` (nudge logic). |
| `chapterMeta.ts` | `anchorOf`/`chapterNumOf`/`chapterMetaOf` — resolve frontmatter against the registry. |
| `consolidate.ts` | Chapter-end transition: durable writes, scratch reset, next-chapter seed, clears AI-authored `facts` arrays (post-fold), `appendChapterLog` (episodic summary into `chapter-log.md`). |
| `migrate.ts` | Seeds scratch fields a save is missing (chapter edited after the save started). |
| `recap.ts` | Recap facts (code, incl. a snapshot of live AI-authored facts) + recap prose (one cached AI call that folds those facts in). |
| `recapArchive.ts` | Append-only immutable recap archive in `recap-history.md`; validation, sorted read, legacy chapter-log parser, archive/legacy merge. |
| `recapPreparation.ts` | Shared archive-first/cache-second/generate-last logic for `/api/recap` and `/api/next-chapter`. |
| `recapHistoryRoutes.ts` | Read-only `GET /api/recaps` and `GET /api/recaps/:chapterNumber` routes. |
| `chapterEndLock.ts` | Process-local per-playthrough FIFO lock for chapter-end operations. |
| `retry.ts` | Turn retry/timeout constants, the friendly failure message, and `MODEL_WINDOW_TURNS` (the model's per-chapter context window). |
| `expandChapter.ts` | The authoring tool's AI expansion step (brief → draft `ChapterSpec`). |
| `worldBible.ts` | The fixed, compressed system-prompt core. |
| `chapters/index.ts` | The chapter registry (builtins + authored, cached, hot-swappable). |
| `chapters/chapter1.ts` | Chapter 1, hand-written (six per-character openings, an `endState` hook). |
| `chapters/types.ts` | The `Chapter` runtime interface. |
| `chapters/defineChapter.ts` | `ChapterSpec` type, `defineChapter()`, `validateChapterSpec()`. |
| `game/characters.ts` | Playable-character config, dossiers, POV/relationship wiring. |
| `game/openings.ts` | Per-character Chapter 1 opening prose. |

**`client/src/`**
| File | Responsibility |
|---|---|
| `main.tsx` | React entry point. |
| `App.tsx` | The screen router — a hand-rolled state machine, no router library (see below). |
| `LoginScreen.tsx` / `SignupScreen.tsx` | Auth forms. |
| `SavesScreen.tsx` | "Your Stories" — list, resume, start new, settings, logout, authoring link. |
| `CharacterSelectScreen.tsx` | Choose a crew member or the Visitor; starts a new game. |
| `characterCards.ts` | Static per-character card data (emoji, summary, gear) for the character select screen. |
| `GameScreen.tsx` | Responsive turn-loop UI — scrollable transcript with edge navigation, compact header menu, collapsible dossier/suggestions, auto-growing input, streamed response, and admin debug context. |
| `RecapScreen.tsx` | Chapter-end recap + "Continue to Chapter N" / story-complete state. |
| `RecapHistoryScreen.tsx` | "Your Story So Far" — browse past chapter recaps (list + detail), race-condition-safe fetches, fresh-state back-to-game. |
| `SettingsScreen.tsx` | BYOK/hosted settings, key entry + validation. |
| `AuthoringScreen.tsx` | Admin chapter-authoring UI (brief → expand → review → save/edit/delete). |
| `ArtAdminScreen.tsx` | Admin art upload/delete UI (chapter/beat selector, MIME + size validation, local preview, existing-art list). |
| `ChapterArtScreen.tsx` | Per-save player art gallery (chapter list → detail view → full-screen overlay). |
| `ArtLoop.tsx` | Shared MIME-branching art renderer (`<img>` for images, `<video autoPlay muted loop playsInline>` for MP4). |
| `types.ts` | Shared client-side shapes (mirrors the server's wire formats). |

**Screen routing:** `App.tsx` holds a `screen` string in `useState` and renders one component
per value (`'login' | 'signup' | 'saves' | 'select' | 'settings' | 'game' | 'recap' |
'recapHistory' | 'authoring' | 'artAdmin' | 'chapterArt'`); each screen takes callback props
(`onLogin`, `onResume`, …) that call `setScreen`. The `chapterArt` screen also carries
`artPlaythroughId` state scoped to the selected save (not the active `pid` cookie). On boot it
calls `/api/auth/me` then `/api/state` to decide where to land. No client-side router library.

---

## 9. Build & run

| Layer | Stack |
|---|---|
| Frontend | React 19 + Vite + TypeScript, Tailwind CSS v4 |
| Backend | Node.js + Express 5, TypeScript (`tsx` for dev, `tsc` for build) |
| Database | PostgreSQL (via `pg`); in-memory fallback when unset/unreachable |
| Auth | `bcryptjs` password hashing; session id in a signed httpOnly cookie |
| AI | Vercel `ai` SDK + `@openrouter/ai-sdk-provider`, provider-agnostic |
| Validation | `zod`, for the forced structured turn output |
| Packaging | Docker + `docker-compose` (app + Postgres) |

Root `package.json` scripts: `dev` (concurrently runs server `tsx watch` + client `vite`),
`build` (client `tsc -b && vite build` then server `tsc`), `start` (`node server/dist/index.js`).
Client also has `test` (`vitest run` — React Testing Library + jsdom). See
[README.md](README.md) for local setup and the Docker deploy flow.

**Verification scripts** — run from the repository root:
```powershell
npm --prefix server exec -- tsx server/src/<name>.ts
```

| Script | Covers |
|---|---|
| `verify-final-chapter.ts` | `isFinal`/`epilogue`/`acknowledgment` defaults, normalization, validation, backward compat (29 tests). |
| `verify-recap-history.ts` | Archive entry validation, facts hardening (crew/journey/notableFacts), envelope versioning (v0/v1/corrupt), legacy parsing (strictly increasing only), read/append/merge, AI-write exclusion, deep-clone isolation (79 tests). |
| `verify-recap-history-phase3.ts` | `prepareChapterRecap` archive-first logic, all-rows corruption safety, envelope corruption, lock FIFO + A/B/C timing regression, wikiStateOf exclusion (25 tests). |
| `verify-recap-history-routes.ts` | Live Express HTTP tests for auth/ownership/parse/read-only behavior (22 tests). |
| `verify-facts.ts` | Fact addition/eviction/guards (19 tests). |
| `verify-facts-recap.ts` | `buildRecapFacts` notableFacts, consolidation (17 tests). |
| `verify-endstate.ts` | `endState` ops, golden-rule, cross-chapter validation, + nested verify-facts/verify-chapter-fold smoke tests (31 tests). |
| `verify-store-deletion.ts` | Postgres-backed store deletion (requires `DATABASE_URL`). |

---

*Keep this current: when a route, table, or module's job changes, update the relevant section
here in the same commit — that's the whole point of this doc existing instead of a handoff.*
