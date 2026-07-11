# Archipelago Lighthouse

**An AI-narrated, chapter-based text RPG — and a proof of concept implementation of durable,
compounding game state for LLMs using the _LLM Wiki_ pattern.**

A large language model narrates the story one turn at a time. What keeps its *state*
coherent across a long, stateful narrative isn't a vector database — it's a per-playthrough
**wiki** of plain-markdown files that the engine reads selectively and writes back to every
turn, with **story progression gated in code, not by the model.**

> The game (set on a prehistoric Philippine coast where a crew of departing star-faring
> gnomes quietly preserves a fading world) is the vehicle. The reusable part is the
> architecture below — fork this repo and swap the content modules to build an entirely
> different game. See **[FORK_GUIDE.md](FORK_GUIDE.md)**.

Forks are welcome. This is a reference implementation, not an active community
project — pull requests are not accepted. If you fork it, feel free to share in
[Discussions](https://github.com/jdslngr/llm-wiki-rpg-engine/discussions)
or tag [@jdslngr](https://github.com/jdslngr).

---

## The idea: the LLM Wiki pattern

Long-running AI narratives have a hard problem: **state.** A flat JSON "save blob"
re-derives everything from scratch each call; RAG retrieves fragments and forgets the
thread; and stuffing the whole history into context is expensive and drifts.

This project takes a different route — an adaptation of **Andrej Karpathy's "LLM wiki"
idea**: instead of one growing blob, you keep a small folder of plain-markdown files that
**accumulate and compound**. Each turn reads only the files relevant to the current scene
and writes back any changes. Knowledge builds up over time instead of being regenerated on
every call. Each file is `frontmatter` (machine-readable fields) + a prose `body` (texture
the model reads naturally), stored as database rows.

State is organized into four memory tiers, each more durable than the one below:

| Tier | What | Lifespan | Example |
|---|---|---|---|
| **Working** | Raw recent turns | This session | "Player asked Rulan about the drift" |
| **Episodic** | Chapter summary | Per chapter | The end-of-chapter recap |
| **Semantic** | Cross-chapter facts | Permanent | A character's trust score; story flags |
| **Procedural** | Fixed world rules | Never changes | The world bible (system prompt) |

### Two design decisions make it reliable

**1. Forced structured write-back.** The model never emits free-text JSON you have to
regex out of prose. It answers *through* a fixed `submit_turn` shape — `{ narrative,
suggested_actions, events[], wiki_updates[] }` — enforced as a schema-valid object every
turn. An empty `events`/`wiki_updates` array is a deliberate "nothing changed," not a
parsing failure.

**2. The AI reports; code decides.** This is the crux. The model does **not** decide that
the story advances. It only reports `events` from a **closed, per-chapter vocabulary**
(e.g. `spoke_to_rulan`, `found_key`). The engine *folds* each event into a state field
(`crew_spoken += rulan`) and then checks the active beat's **conditions in code**. When
they're met, the engine advances to the next beat and the scene opens itself. Because
gating lives in code, the model can't skip a beat, fire one twice, or hallucinate
progress — the classic failure modes of "let the LLM track the plot."

```
Player action
  → build prompt: world bible (cached) + active-beat notes + the selected wiki files
  → model streams a structured submit_turn answer (narrative streams live)
  → ENGINE (code):  fold events → state fields
                    apply validated/clamped wiki_updates (engine-owned fields refused)
                    if the beat's conditions are now met → advance the anchor
                    update the anti-soft-lock counter
  → persist the new wiki + a rollback snapshot
```

The result is a long, stateful story that stays coherent without a vector DB or a RAG
pipeline — the **wiki state** is bounded by file-size discipline rather than accumulation.

### Token usage, honestly

That boundedness now applies to the **model's view of the conversation**, not just the wiki.
The **stored/returned** history is still the entire playthrough, uncompressed, carried across
chapters — the player's story log and the chapter recap both depend on that and always will.
But what gets *sent to the model* each turn is bounded: only the active chapter's last
`MODEL_WINDOW_TURNS` exchanges (14, `server/src/retry.ts`), via `buildModelMessages()`
(`server/src/playTurn.ts`). A finished chapter's raw turns never reach the model again — at
the chapter transition, its recap prose is written into a short `chapter-log.md` wiki file
instead (`server/src/consolidate.ts`), which the prompt picks up like any other wiki file. The
same transition is where the AI's own short-term `facts` notes (capped per file so they can't
grow unbounded turn over turn) get one chance to be folded into that recap prose before the
list is cleared — a smaller memory tier feeding into a larger, cheaper one, rather than just
being dropped at the cap. So per-turn input tokens stay roughly flat for the life of a save,
not just for the life of a chapter.

**Prompt caching softens the *cost* of what's left, it doesn't replace the bound.** The
"~90% cheaper on cached turns" feature below means repeated tokens are billed at a steep
discount. That used to undersell itself in practice: the *live* wiki state (trust scores,
flags, `last_actions`) was rendered into the same system-prompt string as the genuinely-stable
world bible and chapter fragment, so any single state change invalidated the whole cached
prefix, not just the part that changed. The system prompt is now sent as two separate
messages instead of one (`buildStableSystemPrompt`/`volatileSystemPrompt`, `playTurn.ts`): a
stable prefix (world bible + chapter fragment + anchor notes + POV framing) carrying the
`cache_control` breakpoint, and an uncached volatile tail (the live wiki state) right after
it. A wiki edit now only costs that small tail, not a full rewrite — verified live against a
real playthrough: turn 2 read 5,210 of 5,550 input tokens from cache, turn 3 read 4,252 of
5,901.

---

## Features

- 🧠 **LLM Wiki state engine** — selective per-scene loading, structured write-back,
  code-gated anchor progression, and an **anti-soft-lock valve** that gently steers a
  stalled player so they can never get permanently stuck.
- 🪟 **Bounded model context** — a rolling per-chapter window plus a compact episodic
  `chapter-log.md` summary keep per-turn input tokens flat regardless of save length; the
  full history is still kept for the player's story log and the recap.
- ⚡ **Live streaming** — the narrative streams token-by-token (NDJSON); prose appears in
  ~1–3s and flows, with the structured fields finishing in the same generation.
- 💸 **Prompt caching** — the fixed prompt prefix is cached (1h TTL), cutting input cost
  ~90% on cached turns.
- 🔌 **Provider-agnostic** — one code path over the [AI SDK](https://sdk.vercel.ai),
  defaulting to Claude Sonnet via OpenRouter; swap to any OpenAI-compatible provider
  (OpenAI, Groq, Together, Ollama, LM Studio) by changing env vars.
  **Bring-your-own-key** is supported per user.
- 👤 **Accounts & saves** — own email/password auth (bcrypt + httpOnly session cookie),
  ownership-checked routes, multiple save files, resume-where-you-left-off.
- 📖 **Chapter-end recap** — engine-derived facts woven into a short AI-written summary.
- 📝 **AI-authored memory** — the model can append short, freeform durable notes per
  character/world file — *why* a choice was made, not just lore. Capped per file so the
  per-turn prompt stays small; at chapter end, anything still live gets one chance to be
  folded into that permanent recap before the cap resets, instead of just falling off when
  full.
- ✎ **In-app chapter authoring (admin-only)** — sketch beats in plain language, an AI
  expands them into a full chapter, review/edit, then save — live immediately, no redeploy.
  See [ADDING_CHAPTERS.md](ADDING_CHAPTERS.md).
- 🎨 **16-bit chapter & beat art (admin-curated)** — upload portrait MP4/JPEG/PNG/WebP/GIF/AVIF
  art per chapter and beat (up to 50 MB); player-facing gallery per save; desktop art rails and
  mobile inline art in the game screen. All media served through ownership-checked, unlock-gated
  URLs — no public static art route. See [16BIT_ART_CODE_IMPLEMENTATION_PLAN.md](16BIT_ART_CODE_IMPLEMENTATION_PLAN.md).
- 🗄️ **Persistence with zero-setup fallback** — Postgres when available, in-memory
  otherwise, behind one interface.
- 🐳 **Self-hostable** — `docker compose up` brings up the app + Postgres; no vendor lock-in.

---

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | React + Vite + TypeScript + Tailwind v4 |
| Backend | Node.js + Express (serves the API *and* the built frontend) |
| AI | Provider-agnostic via the `ai` SDK: Claude Sonnet via OpenRouter by default; any OpenAI-compatible provider works |
| Database | PostgreSQL (with an in-memory fallback) |
| Auth | Own username/password — bcrypt + signed httpOnly session cookie |
| Packaging | Docker + docker-compose |

---

## Quick start

**Prerequisites:** Node.js 22+, Docker Desktop (for the containerized run / Postgres), and
an LLM API key (e.g. an [OpenRouter](https://openrouter.ai/keys) key).

```bash
# install
npm install && npm install --prefix client && npm install --prefix server

# configure
cp server/.env.example server/.env     # then paste your key into LLM_API_KEY

# run (hot reload) — http://localhost:5173
npm run dev

# or the packaged app + Postgres — http://localhost:3001
docker compose up
```

The API key lives only in `server/.env` / the server process — **it never reaches the
browser.**

### Configuration (`server/.env`)

```bash
LLM_PROVIDER=openrouter
LLM_API_KEY=sk-or-...                    # your key (never committed)
LLM_MODEL=anthropic/claude-sonnet-4.6    # any model id your provider supports
PORT=3001
# DATABASE_URL=postgres://…              # optional in dev; enables Postgres persistence
# ADMIN_USERNAMES=yourname               # optional; comma-separated, enables the chapter authoring tool
# APP_SECRET=...                         # optional; only needed for BYOK key encryption (see below)
# LOG_TOKEN_USAGE=true                   # optional; logs per-turn token usage + cache hits
```

**Persistence:** with `DATABASE_URL` set and reachable, playthroughs survive
restarts/refresh (including any chapters created with the authoring tool); unset, the
server uses an in-memory store (zero-setup, resets on restart). `docker compose up` wires
`DATABASE_URL` for you.

---

## Architecture

The **server owns all game state**; the browser is a thin renderer that sends the player's
input and reflects what comes back. The story engine — event folding, anchor conditions,
advancement, the anti-soft-lock valve — lives entirely in code.

```
server/src/
  index.ts             API routes (auth, saves, new-game, state, play-turn, next-chapter) + serves the client
  engine.ts            the generic engine: write-back, event fold, anchor advance, soft-lock valve
  consolidate.ts       chapter-end transition: reset scratch, fold-then-clear AI facts, keep durable state, seed next chapter
  migrate.ts           on load, seed missing scratch fields (old-save insurance)
  playTurn.ts          prompt assembly + streamed structured submit_turn (zod)
  store.ts             persistence: Postgres or in-memory, behind one interface
  artStore.ts          filesystem-backed art registry (metadata + uploaded files, served through protected URLs)
  llm.ts               provider layer — swap vendors via env; prompt caching; BYOK
  auth.ts              bcrypt hashing, session tokens, requireAuth/requireAdmin middleware
  recap.ts             chapter-end recap (engine facts + notable AI facts + one AI prose call)
  worldBible.ts        the world as the fixed system-prompt core            ← story content
  chapters/types.ts    the Chapter interface every chapter implements + CHAPTER_END
  chapters/defineChapter.ts  data-driven chapter builder (ChapterSpec → Chapter) + the
                       golden-rule validator — what the authoring tool produces and checks
  chapters/index.ts    chapter registry (cache-backed): getChapter, hasChapter, lastChapter,
                       registerSpec/unregisterChapter, loadAuthoredChapters (boot-load from DB)
  chapters/chapter1.ts the only built-in Chapter Definition: events, fold-map, conditions,
                       beats ← story content. Chapter 2 onward are authored, not files —
                       see the authoring tool below.
  expandChapter.ts     authoring tool's AI step: brief → structured ChapterSpec draft
  game/characters.ts   playable cast, relationships, the starter-wiki seed   ← story content
  game/openings.ts     verbatim turn-0 opening prose (Chapter 1)             ← story content
client/src/
  App.tsx              screen router (login → saves → character select → game → authoring)
  GameScreen.tsx       the streaming game UI (story log, actions, input)
  AuthoringScreen.tsx  admin-only chapter authoring UI (brief → AI draft → review → save)
  ArtAdminScreen.tsx   admin-only art upload / delete UI (chapter/beat selector, MIME + size validation, preview)
  ChapterArtScreen.tsx per-save art gallery (chapter list → detail → full-screen overlay)
  ArtLoop.tsx          shared MIME-branching art renderer (<img> for images, <video> for MP4)
  CharacterSelectScreen.tsx · SavesScreen.tsx · RecapScreen.tsx · SettingsScreen.tsx · Login/Signup
```

The files marked **story content** are the only ones you replace to build a different game;
everything else is the reusable engine. The full recipe is in
**[FORK_GUIDE.md](FORK_GUIDE.md)**.

### Core API

- `POST /api/play-turn` → `{ playerInput }` → **streams NDJSON**: `{"type":"narrative",…}`
  chunks as prose is written, then a final `{"type":"done", narrative, suggested_actions,
  events, wiki_updates, anchor, advanced, chapterNumber, chapterTitle, anchorTitle, wikiState }`.
  The engine folds events and advances the anchor before sending `done`.
- `POST /api/next-chapter` → at chapter end (`anchor === END`), consolidates state and opens
  the next chapter; returns the new game state, or `{ complete: true }` when the story is over.
- `POST /api/new-game` · `GET /api/state` · `GET /api/saves` · `POST /api/saves/:id/resume`
- `GET /api/recap` — the chapter-end recap (cached after first generation)
- `POST /api/auth/signup` · `/login` · `/logout` · `GET /api/auth/me` (includes `isAdmin`)
- **Admin-only** (`requireAdmin`, gated by `ADMIN_USERNAMES`) — the authoring tool:
  `POST /api/admin/expand-chapter` (brief → AI-drafted `ChapterSpec`) ·
  `POST /api/admin/save-chapter` (validate + persist + register live) ·
  `GET /api/admin/chapters` · `GET /api/admin/chapters/:n` · `DELETE /api/admin/chapters/:n`
- **Art gallery** (ownership-checked, unlock-gated):
  `GET /api/art/gallery/:playthroughId` (per-save chapter-organized gallery) ·
  `GET /api/art/:chapterNumber?playthroughId=` (chapter + beat art for the game screen) ·
  `GET /api/art/:chapterNumber/:anchor?playthroughId=` (single beat art) ·
  `GET /api/art/media/:artId?playthroughId=` (protected media streaming)
- **Admin-only — art management**: `GET /api/admin/art/chapters` (chapter options for the uploader) ·
  `POST /api/admin/art/upload` (multipart, 50 MB cap, file-signature sniffing, allowed MIME list) ·
  `GET /api/admin/art/:chapterNumber` (existing art for a chapter, unfiltered) ·
  `GET /api/admin/art/media/:artId` (admin preview streaming) ·
  `DELETE /api/admin/art/:artId`

---

## Build your own game on this engine

The engine is story-agnostic; "Archipelago Lighthouse" is one set of content files. To
build a different game — new world, cast, and chapters — fork the repo and swap the content
modules. **[FORK_GUIDE.md](FORK_GUIDE.md)** is a comprehensive, step-by-step walkthrough
(including how to author a chapter's events → fold-map → conditions, and how to add flexible
character fields like inventory, skills, and levels).

---

## Design docs

The thinking behind the game and the engine lives in the repo:

- [Technical Specifications](Technical_Specifications.md) — architecture, data model, the
  chapter engine, and the API surface, as the code actually is today
- [Adding Chapters](ADDING_CHAPTERS.md) — how to author Chapter 2 onward, via the in-app
  tool or by hand
- [Chapter Template](Chapter_Template.md) — how a chapter is structured
- `wiki/` — the canonical lore

---

## Notes & gotchas (for contributors)

- **The model's conversation view is bounded; the stored history is not, on purpose** — the
  prompt only gets the active chapter's last `MODEL_WINDOW_TURNS` exchanges + `chapter-log.md`
  (see "Token usage, honestly" above), but `playthroughs.history` itself still grows forever,
  because the story log and recap need the full record. Don't bound that part.
- **`ai` SDK is pinned to v6** — the OpenRouter provider peer-depends on `ai@^6`; `ai@7`
  breaks it.
- **The per-turn schema avoids array `minItems`/`maxItems`** (`playTurn.ts`, via
  `streamObject`) — Anthropic's structured-output mode was found to reject array bounds
  other than 0/1 here, so "3–4 suggested actions" is enforced via the field description + a
  code clamp instead. This isn't a universal restriction, though: `expandChapter.ts`'s
  chapter-authoring schema (via `generateObject`) uses `.min(1)` on four arrays and works
  fine — verified live against the real API. Don't assume array bounds are unsafe elsewhere
  without checking; `streamObject` and `generateObject` apparently don't behave identically
  here.
- **The Docker build uses `npm install`, not `npm ci`** — Windows-generated lockfiles omit
  Linux-only optional native deps (Tailwind v4's engine).
- **The in-memory dev store resets on server restart** — set `DATABASE_URL` for persistent
  dev state.
- **The anti-soft-lock threshold** is per-chapter (`ChapterSpec.softLockThreshold`,
  defaults to 5). Authored chapters can override it in the authoring tool; built-in
  Chapter 1 uses 5. The engine reads it from the active chapter at runtime.
- **Authored chapters (the authoring tool) need `DATABASE_URL` to persist** — they're stored
  in Postgres and loaded at boot; with the in-memory store they reset on restart same as
  everything else.
- **Saving or deleting an authored chapter takes effect immediately for every player**,
  including anyone mid-playthrough on it — there's no migration for someone already partway
  through the old shape. Avoid editing/deleting a chapter with active players.
- **The facts-fold-then-clear step (above) only runs on a real chapter transition.** Viewing
  `GET /api/recap` always folds live `facts` into the prose if it's not already cached, but
  the arrays themselves are only cleared by `consolidate()`, which `/api/next-chapter` never
  reaches if there's no next chapter registered — it returns `{ complete: true }` first.
  Harmless for a finished story, but worth knowing if you're testing this on a save sitting at
  your highest registered chapter.

---

## License

This repository contains two kinds of work, licensed differently:

- **The code — the engine and application (MIT).** All source code is released under the
  [MIT License](LICENSE). You're free to use, modify, and redistribute it — including
  commercially — to build your own games. Just keep the copyright notice. (See
  [FORK_GUIDE.md](FORK_GUIDE.md).)
- **The creative content — © the author, all rights reserved.** The world, story, prose,
  lore, and characters of *Archipelago Lighthouse* are **not** covered by the MIT license.
  This includes the authored prose and worldbuilding wherever it lives — `wiki/`, `prose/`,
  and the story text embedded in `server/src/worldBible.ts`,
  `server/src/chapters/chapter1.ts`, `server/src/game/characters.ts`, and
  `server/src/game/openings.ts`. (The rest of `server/src/chapters/` — the `Chapter`
  interface, the `defineChapter` builder, the registry — is engine code, not content, and
  *is* MIT-licensed.)

In short: **reuse the engine freely; bring your own story.** When you fork, replace the
content files with your own (FORK_GUIDE.md walks through exactly which ones).

## Credits

State architecture inspired by Andrej Karpathy's "LLM wiki" idea for long-horizon memory,
adapted here into a stateful narrative engine with code-based story gating.

*Dedicated to Roslin Pal.*
