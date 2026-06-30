# Fork Guide — Building a New Game on This Engine

## Who this is for

You are a coder (or an AI agent) who wants to take this codebase and turn it into an
**entirely new AI-narrated text RPG** — a different world, cast, and story — with **no
connection to Archipelago Lighthouse (AL)**. This guide tells you exactly what to keep,
what to replace, and how to author the new story.

The plan here is the **clean-copy fork**: duplicate the repo into a fresh project folder,
strip AL's content, and drop in yours. The engine and all the infrastructure (streaming,
caching, the code-based story gate, accounts, save/resume, BYOK, recap, the **multi-chapter
registry**, the **in-app authoring tool**, Docker deploy) come along unchanged. You are
doing **authoring**, not re-engineering — and there's less re-engineering to do than there
used to be: chapters are no longer wired in by import, they're data the engine loads at
runtime, so adding your second and third chapter later needs zero code changes.

> If instead you want **one codebase hosting many different stories** (a `stories/<id>/`
> registry, selectable at runtime), that's a different, larger refactor — see the last
> section, "Appendix: the multi-story framework." Note that the **multi-chapter** half of
> that idea — many chapters within one story — already shipped; what's left is scoping the
> world bible/cast/theme per story. For one new game, the clean copy below is the faster,
> lower-risk path.

---

## TL;DR

- **Keep (the engine + infra, ~no edits):** `engine.ts`, `store.ts`, `llm.ts`, `retry.ts`,
  `types.ts`, `auth.ts`, `consolidate.ts`, `migrate.ts`, the route wiring in `index.ts`,
  the **entire `chapters/` registry machinery** (`types.ts`, `defineChapter.ts`,
  `index.ts`), and the entire frontend *shell* (auth, saves, settings, the streaming game
  screen, the recap screen, the authoring screen). Plus Docker, caching, BYOK.
- **Replace (the story content, ~9 spots):** the world bible, your first chapter's content
  (now usually a short `ChapterSpec`, not a hand-rolled module), the playable characters,
  the opening prose, the recap prompt, two hardcoded POV lines, one hardcoded game-name
  string in the authoring tool's AI prompt, the character-select cards, and the app's
  title/theme/labels.
- **Effort:** a day or two of wiring + however long it takes to *write your story*. The
  writing is the real work; the code swap is mechanical — and for chapters 2 onward, once
  your fork is running, you may not write code at all (use the in-app authoring tool).

---

## 1. How the engine works (read this first — 2 minutes)

Every turn flows through one loop. Understanding it tells you what each file does and why
the content/engine split is where it is.

```
Player types an action
  → POST /api/play-turn  (index.ts)
      1. Load this playthrough's state from the store          (store.ts)
      2. Look up the ACTIVE CHAPTER by current_chapter          (chapters/index.ts)
      3. Build the prompt:                                     (playTurn.ts)
           world bible  +  chapter fragment  +  ACTIVE-anchor beat notes
           +  POV framing  +  the current wiki (game state) as markdown
      4. Stream the AI's structured answer (submit_turn):      (playTurn.ts + AI SDK)
           { narrative, suggested_actions, events[], wiki_updates[], fact_additions[] }
         — narrative streams to the browser as NDJSON, live.
      5. CODE-GATED write-back (the heart of it):              (engine.ts)
           - apply the AI's `wiki_updates` (validated, clamped, engine-owned fields refused)
           - apply `fact_additions` — short freeform memory notes appended to a file's
             `facts` array (capped per file, oldest dropped first when full); a separate,
             append-only mechanism from `wiki_updates`, never the two confused
           - fold reported `events` → world-state fields  (deterministic)
           - if the active anchor's CONDITIONS are now met → advance to the next anchor
           - update the anti-soft-lock counter
      6. Persist the new wiki + history; snapshot for rollback (store.ts)
      7. Return the final structured fields to the browser
```

When the last anchor's conditions are met, the chapter ends; the recap shows — and that
recap step (`recap.ts`) gets one more look at any still-live `fact_additions` notes before
they're gone, folding anything durable into the permanent recap prose. A **"Continue to
Chapter N"** action then runs `server/src/consolidate.ts` (drop the spent chapter's scratch
fields, clear the now-folded `fact_additions` lists, keep durable state, seed the next
chapter) and looks up the next chapter the same way — by number, through the registry.
**Nothing about steps 2–7 cares how many chapters exist or whether they're hand-written code
or AI-drafted data** — that's the whole point of the registry (§5).

Four ideas make this robust, and they are **story-agnostic**:

1. **The "wiki" is the game state.** Per playthrough, a set of markdown files —
   `world-state.md`, `player-character.md`, one file per other character, etc. Each is
   `{ frontmatter: {…machine-readable fields…}, body: "…prose the AI reads…" }`. Stored
   as DB rows (frontmatter = JSONB, body = text). **The frontmatter is schemaless** — you
   can put *any* fields on it (this is why inventory/skills/levels are easy; see §7).

2. **The AI reports; code decides.** The AI never says "advance the story." It only emits
   `events` from a **fixed per-chapter vocabulary** (e.g. `spoke_to_rulan`). The engine
   *folds* each event into a state field (`crew_spoken += rulan`) and checks the anchor's
   conditions in code. This is what prevents the AI from skipping beats or soft-locking.

3. **Anchors are the spine.** A chapter is an ordered list of **anchors** (beats). Each
   anchor has **conditions** (a predicate over world-state). When they're met, the engine
   advances and injects the next beat's notes into the prompt, so the next scene "opens
   itself" (e.g. the messenger simply arrives).

4. **Chapters are looked up, not imported.** `getChapter(n)` (`chapters/index.ts`) is the
   *only* way any engine code reaches a chapter's content. A small set of hand-written
   chapters can be **built-in** (compiled into the code); everything else is a
   **`ChapterSpec`** — a plain data object — turned into the same shape by
   `defineChapter(spec)`, persisted in the database, and registered live. This is also what
   makes the in-app **authoring tool** possible: it never generates code, only data.

---

## 2. The file map — keep vs. replace

### Backend (`server/src/`)

| File | Role | Fork action |
|---|---|---|
| `engine.ts` | Code-based gate: fold events, advance anchors, anti-soft-lock, validate write-back | **Keep, unedited.** It reads the active chapter via `getChapter(current_chapter)` — there is no chapter import to repoint. |
| `consolidate.ts` | Chapter-end transition: drop the outgoing chapter's scratch fields, clear AI-authored `facts` lists (after `recap.ts` has folded them into the recap — see below), keep durable state, seed the next chapter, append the episodic recap summary to `chapter-log.md` (`appendChapterLog`) | **Keep as-is.** Story-agnostic. |
| `migrate.ts` | On load, seeds any of the active chapter's scratch fields missing from an old save | **Keep as-is.** |
| `store.ts` | Persistence (playthroughs, wiki, users, sessions, **authored chapter specs**). Postgres or in-memory. **Fully story-agnostic.** | **Keep as-is.** |
| `llm.ts` | Provider layer (OpenRouter today) + prompt caching (1h TTL) + BYOK model builder | **Keep.** (Optionally change the default model.) |
| `retry.ts` | Retry/timeout constants for transient provider errors, plus `MODEL_WINDOW_TURNS` — how many recent exchanges of the active chapter the model sees each turn | **Keep.** Tune `MODEL_WINDOW_TURNS` (default 14) if your game's beats run longer/shorter than AL's. |
| `types.ts` | Generic types: `Turn`, `WikiMap`, `WikiFile`, `User`, `Session`, etc. | **Keep.** (A comment or two name AL — harmless.) |
| `auth.ts` | bcrypt hashing, session tokens, `requireAuth`/`requireAdmin` middleware | **Keep as-is.** The admin gate (for the authoring tool) is a plain `ADMIN_USERNAMES` env allowlist — set it to your own usernames. |
| `index.ts` | All API routes (incl. `/api/admin/*` for authoring) + serves the built client | **Keep the wiring;** it imports content modules by name (`CHARACTERS`, `buildStarterWiki`, `openingFor`) and looks up chapters via `getChapter`/`hasChapter`. Those names stay the same; only their *contents* change. |
| `playTurn.ts` | Prompt assembly + forced structured output + `buildModelMessages` (bounds the model's view to the active chapter's last `MODEL_WINDOW_TURNS` exchanges). The system prompt is two messages, not one: `buildStableSystemPrompt` (cached) + `volatileSystemPrompt` (live wiki state, uncached) | **Keep the structure; edit `povFraming`.** It has **two hardcoded AL lines**: the "secret of the Humming Spires" framing and the Visitor "True Translation language-gap." Rewrite these for your story (or delete if not applicable). `buildModelMessages` itself is story-agnostic — no edits needed. If you add new per-turn dynamic content, put it in `volatileSystemPrompt`, not `buildStableSystemPrompt` — anything stable-looking that actually changes often will quietly tank your cache hit rate. |
| `recap.ts` | Chapter-end recap (engine-derived facts + a snapshot of live AI-authored `facts` + one AI prose call that folds them in before `consolidate.ts` clears them) | **Keep the structure; edit the prompt text.** The prompt names "Archipelago Lighthouse" and "a long goodbye" — rewrite to your title/tone. |
| `expandChapter.ts` | The authoring tool's AI step: brief → structured `ChapterSpec` draft | **Keep the structure; edit one line.** Its system-prompt `RULES` text names `"Archipelago Lighthouse"` — rewrite to your game's title (or genericize it). |
| `worldBible.ts` | **The world** as the fixed system-prompt core (~2,000–2,500 tokens) | **Replace entirely** with your world. |
| `chapters/types.ts` | The `Chapter` interface every chapter implements, + the `CHAPTER_END` sentinel | **Keep as-is.** Story-agnostic contract. |
| `chapters/defineChapter.ts` | `defineChapter(spec)`: turns a plain `ChapterSpec` into a full `Chapter`, deriving events/fold-map/scratch-seed/gating from one object — plus `validateChapterSpec`, the golden-rule checker | **Keep as-is.** This is what you author *through*, not what you edit. |
| `chapters/index.ts` | The chapter **registry**: built-ins + a live cache of authored chapters, loaded from the database at boot (`getChapter`, `hasChapter`, `lastChapter`, `registerSpec`, `unregisterChapter`, `loadAuthoredChapters`) | **Keep the machinery; edit the `BUILTINS` line.** Point it at your own hand-written chapter module(s) instead of AL's `CHAPTER_1` (see §5). |
| `chapters/chapter1.ts` | AL's **Chapter 1** — a hand-written module (needed because it has six per-character openings) | **Replace entirely with your first chapter** (see §5 — this is the core authoring task). For most forks, this becomes a short `ChapterSpec` object, not a hand-rolled module like AL's. |
| `game/characters.ts` | Playable cast: dossiers, POV labels, relationship files, the world-state seed | **Replace entirely** with your cast. Simpler than it used to be: the seed no longer lists your chapter's condition fields by hand (see §5.3). |
| `game/openings.ts` | Verbatim turn-0 opening prose, one per playable character (used by AL's hand-written Chapter 1) | **Replace, or drop entirely** if your first chapter uses `defineChapter`'s single shared opening instead of per-character ones. |

### Frontend (`client/src/`)

The whole app *shell* is generic (routing, auth screens, saves, settings, the streaming
game screen, the recap screen, **the authoring screen**). What's AL-specific is **copy,
labels, theme, and the character cards** — all easy search-and-replace:

| File | Fork action |
|---|---|
| `AuthoringScreen.tsx` | **Keep as-is.** Fully generic admin UI for the chapter authoring tool — no AL strings in it at all. |
| `characterCards.ts` | **Replace.** Character-select cards: `emoji`, `name`, `position`, `summary`, `gear`. One entry per playable character. |
| `App.tsx` | Routing/shell only — no AL-specific strings to edit. (Beat labels and chapter titles now come from the **server**, not a hardcoded map — nothing to edit there either.) |
| `index.css` | Edit the `@theme` color tokens (backgrounds: `--color-bg-page`/`nav`/`surface`/`story`/`input`/`dossier`/`card`; golds: `--color-gold`/`gold-dark`/`gold-text`/`gold-border`/`gold-mid`/`gold-dim`/`gold-nav`; text: `--color-text-primary`/`text-body`/`text-muted`/`text-dim`/`text-nav`), the `body` gradient, and the global font families — all in one place. |
| `GameScreen.tsx`, `RecapScreen.tsx`, `CharacterSelectScreen.tsx` | Edit story copy/labels (title, headings, any AL flavor text). |
| `SettingsScreen.tsx`, `SavesScreen.tsx`, `LoginScreen.tsx`, `SignupScreen.tsx` | Mostly generic; replace the app name where it appears. `SavesScreen.tsx` also shows the **"Author a chapter"** entry point, gated on `isAdmin` from `/api/auth/me` — nothing to edit. |

> Quick way to find every frontend string to change:
> `grep -rniE "archipelago|lighthouse|kaspen|kaelen|pan|tariel|rulan|vane|gnome|spire|whale" client/src`

### Root (docs & lore — design only, not run by the game)

`wiki/*.md`, `prose/*.md`, `Chapter_Template.md`, `cozy-fantasy-style-guide.md`,
`pratchett_style_guide.md`, `ADDING_CHAPTERS.md`, `Technical_Specifications.md`,
`FORK_GUIDE.md` — these are AL's **design documents, lore, and style guides**.
The running game does **not** load them. Delete them (or replace with your own).
Keep `README.md` but rewrite it for your game.

---

## 3. Step-by-step: stand up the fork

### 3.0 Prerequisites
- Node.js 22+ and npm, Docker Desktop, and an OpenRouter API key (or another provider).

### 3.1 Copy the repo into a clean, disconnected project
```bash
# from wherever you keep projects — this becomes a SEPARATE folder/project
cp -r archipelago-lighthouse my-new-game
cd my-new-game

# sever all ties to AL's history and remotes
rm -rf .git graphify-out
rm -rf server/dist client/dist server/node_modules client/node_modules node_modules
rm -f server/tsconfig.tsbuildinfo
git init

# rename the project
#  - root package.json: "name", "description"
#  - docker-compose.yml: the postgres db name/user (search "archipelago")
#  - README.md: rewrite for your game
```
Delete AL's design docs and lore now if you want a truly clean tree:
```bash
rm -f ADDING_CHAPTERS.md Technical_Specifications.md FORK_GUIDE.md \
      Chapter_Template.md *style-guide*.md
rm -rf wiki prose
```

### 3.2 Reinstall and confirm it still builds (before changing content)
```bash
npm install && npm install --prefix client && npm install --prefix server
cp server/.env.example server/.env   # paste your LLM_API_KEY; optionally set ADMIN_USERNAMES
npm run build                        # both halves should compile
```
At this point you have a *working AL clone* under a new name. Now swap the content.

### 3.3 Replace content (the rest of this guide)
Work through §4–§6 in order. Re-run `npm run dev` often and play a few turns — the loop
is the same, so you get fast feedback.

### 3.4 Run, verify, deploy
- Dev: `npm run dev` → http://localhost:5173
- Packaged: `docker compose up` → http://localhost:3001 (+ Postgres)
- Deploy: `docker compose up` on your server behind a reverse proxy/HTTPS of your choice
  (Caddy, nginx, Cosmos Cloud, a Cloudflare Tunnel — whatever you already run). Set
  `DATABASE_URL` for real persistence, including for anything you author through the
  in-app tool (§5.5) — without it, authored chapters reset on restart.

---

## 4. Author the world bible — `server/src/worldBible.ts`

This file is a single exported string, `WORLD_BIBLE`, that becomes the **fixed system
prompt** every turn (and is the chunk that prompt-caching makes nearly free). Aim for
~1,500–2,500 tokens — AL's own is ~2,000. Structure it like AL's (sections in CAPS work well):

- **ROLE** — "You are the narrator and game master of `<your game>`… Always answer through
  the `submit_turn` structure." Keep the line: *"You voice every character and the world —
  but NEVER the player's own character."* (That rule is load-bearing; see §6.)
- **SETTING** — time, place, the physical world.
- **THE SITUATION / STAKES** — the engine of your plot.
- **THE CAST** — short voice notes for the characters the AI must portray.
- **RULES OF THE WORLD** — magic/tech/economy limits the AI must respect.
- **TONE & VOICE** — the register you want.
- **MEMORY — WIKI_UPDATES VS FACT_ADDITIONS** — keep this one close to verbatim; it's
  instructions for a story-agnostic engine mechanism, not lore. It tells the AI when to
  replace a field's value (`wiki_updates`) versus append a short, durable memory note
  (`fact_additions`, capped per file — see §1, §5.7). Nothing in it names your story; the
  only edits worth making are tightening the wording if you see it over- or under-firing
  once you're playtesting.
- **UNIVERSAL GUARDRAILS** — things the AI must never do, every chapter.

Keep detailed lore *out* of here (it bloats every turn). Per-character and per-location
detail belongs in the wiki files (§5.3) which load as needed.

### 4.1 Optional: draft it with AI from a brief

Writing `WORLD_BIBLE` from a blank page is the hardest part of forking. You can speed up
the *first draft* the same way the in-app chapter tool works — fill in a brief, hand it to
an AI, review what comes back — but **as a one-time, fork-time step you do yourself**, not
a live in-app feature. The reasons are the opposite of why chapters get a live tool:

- **No validator exists for prose.** `validateChapterSpec` can mechanically prove a
  chapter's events/conditions are wired correctly; nothing can mechanically prove a world
  bible is "internally consistent" or "good." That judgment call has to be a human's.
- **The blast radius is total, not contained.** A bad chapter edit affects one chapter
  number; the world bible is the cached, shared prompt prefix for *every* playthrough,
  *every* chapter. It belongs behind your normal review-and-redeploy process, not a "save →
  instantly live" button.

So: this is a **prompt template you fill in once**, not a screen you build. Copy this
brief, answer each line in your own words, and hand the whole thing to whatever AI you're
already using to build the fork:

```
GAME TITLE: <your title>

THE PITCH: <1-2 sentences — the hook>

SETTING: <time, place, the physical world>

MAIN PLOT / STAKES: <the engine of the overall story, across all chapters>

THE CAST: <one short voice-note per major character — who they are, how they talk>

RULES OF REALITY: <magic/tech/economy limits the AI must respect — what's NOT possible>

TONE & VOICE: <the register you want — and any LEXICON notes: recurring terms, naming
conventions, words to use or avoid>

GUARDRAILS: <things the AI must never do, in any chapter>
```

Then ask the AI: *"Expand this brief into a `WORLD_BIBLE` string for an AI-narrated text
RPG's system prompt — structured in CAPS sections (ROLE, SETTING, THE SITUATION/STAKES, THE
CAST, RULES OF THE WORLD, TONE & VOICE, UNIVERSAL GUARDRAILS), aimed at ~1,500–2,500 tokens,
written as instructions to an LLM narrator, not prose for a human reader. Keep the line
about never voicing the player's own character."* Review what comes back like you would
any first draft — cut, tighten, fix anything that doesn't sound like your game — before it
goes in `worldBible.ts`.

The same brief's **THE CAST** answers carry forward to §6: they're a starting point for
each character's full `dossier`/`povLabel` in `game/characters.ts`, which needs more than
the world bible does (machine fields, `knowsSecret`, etc.) — expand from the brief, don't
copy it verbatim.

> **Note what's *not* in this brief:** things like the wiki's frontmatter/body shape, the
> events↔fold-map↔conditions spine, or how the prompt prefix gets cached are *engineering*,
> not authored content — they're already built into the engine (§1, §5) and there's nothing
> for an AI to draft there. Don't try to extend this brief to cover them.

---

## 5. Author your first chapter

This is the most important authoring task, but it's now **considerably simpler** than it
used to be, because of one architectural change: chapters are **data**, not code. You
describe a chapter as a `ChapterSpec` object; `defineChapter(spec)` derives everything the
engine needs (events, fold-map, scratch seed, gating helpers) from that one object — so
the four lists that have to line up (events ⇄ fold-map ⇄ seed ⇄ conditions) can't drift
apart. The same builder is what the in-app **authoring tool** uses under the hood.

You have three ways to get your first chapter written, in order of how much code you touch:

### 5.1 Easiest: bootstrap with a `ChapterSpec`, then use the authoring tool for everything after

Write **just your first chapter** as a `ChapterSpec` (below), wire it in as a built-in
(§5.4) so the app has *something* to boot into — then, once your fork is running, author
**every chapter after that through the in-app tool** (admin-gated; see §5.5). You'll never
hand-write another chapter file.

### 5.2 Design on paper first
Before writing the spec, decide:
1. **The anchors** — 4–8 ordered beats that MUST happen (your spine).
2. **For each anchor, its conditions** — what must be true to advance (e.g. "talked to 2
   people AND found the key").
3. **The events vocabulary** — the closed list of tokens the AI may report, one or more
   per condition (e.g. `found_key`, `spoke_to_mara`).
4. **The fold-map** — how each event updates a world-state field.

### 5.3 The `ChapterSpec` shape

```ts
// server/src/chapters/myChapter.ts
import { defineChapter, type ChapterSpec } from './defineChapter.js'

const SPEC: ChapterSpec = {
  number: 1,
  title: 'Your Chapter Title',
  // The fixed chapter overview + this chapter's guardrails, appended to the world bible.
  fragment: `CHAPTER 1 — "Your Chapter Title" ... PACING ... GUARDRAILS ... EVENTS ...`,

  anchors: [
    {
      id: 'A1',
      title: 'The Arrival',
      note: `Director's guidance for what the AI narrates while this beat is active —
not verbatim prose. Who's there, the mood, the inciting event.`,
      advanceWhen: [
        { field: 'has_key', op: 'flag', hint: 'find the key' },
        { field: 'people_spoken', op: 'count_gte', value: 1, hint: 'talk to someone' },
      ],
    },
    // … A2, A3, …
  ],

  events: [
    // token present in `fold` = push onto an array field (a "count_gte"-able field);
    // absent = set a boolean field true (a "flag"-able field).
    { token: 'found_key', anchor: 'A1', fold: { field: 'has_key' } },
    { token: 'spoke_to_mara', anchor: 'A1', fold: { field: 'people_spoken', token: 'mara' } },
  ],

  opening: {
    prose: `Verbatim turn-0 opening prose, immersive second person…`,
    actions: ['Starter action one', 'Starter action two', 'Starter action three'],
  },

  softLockThreshold: 5, // optional; turns without progress before a gentle in-world nudge

  // optional — durable facts written into world-state.md when THIS chapter ends, still
  // readable by a LATER chapter's conditions or prose (unlike fact_additions — see §1 —
  // these are structured, permanent, and engine-checkable, not freeform AI memory). Every
  // field name must start with `chapterend_`; validateChapterSpec enforces it, so it can't
  // collide with a chapter's own scratch fields.
  endState: [
    { field: 'chapterend_<name>', op: 'set', value: true },
  ],
}

export const CHAPTER_1 = defineChapter(SPEC)
```

That's the whole file. Compare this to AL's hand-rolled `chapter1.ts` (still in the repo as
a worked example) — same ideas, far less to write, and `defineChapter` guarantees
consistency for you.

### 5.4 Wire it into the registry
`server/src/chapters/index.ts` has one line to edit:
```ts
import { CHAPTER_1 } from './chapter1.js'        // ← point this at your module
const BUILTINS: Record<number, Chapter> = { 1: CHAPTER_1 }
```
Nothing else in the engine changes — `engine.ts`, `playTurn.ts`, `recap.ts`, and `index.ts`
all reach your chapter through `getChapter(current_chapter)`.

### 5.5 Adding chapter 2, 3, … — use the authoring tool, not more code
Once your fork is running, log in as a user listed in `ADMIN_USERNAMES`
(`server/.env`/`.env.example`) and open **"Author a chapter"** from Your Stories: sketch
the beats and plain-language conditions, let the AI expand them into a full `ChapterSpec`
draft, review/edit it, and **Save** — it's registered and playable *immediately*, no
redeploy. Authored chapters persist in the database (set `DATABASE_URL`); built-in numbers
(whatever you listed in `BUILTINS`) are protected and can't be overwritten through the
tool. Three things worth knowing:
- **Durable end-state is authorable in the tool too** — the Review stage has a "Durable
  end-state" section for adding `set`/`append` ops (§5.3's `endState`) that fire when the
  chapter ends. Field names must start with `chapterend_`; the tool blocks the save
  otherwise, and separately catches cross-chapter conflicts (two chapters using the same
  field name with different ops).
- **v1 has one shared opening**, not per-character ones. If you want that level of polish
  for a given chapter, hand-write it as a `ChapterSpec`/module instead (§5.3) and add it to
  `BUILTINS`.
- **Editing or deleting a live chapter affects every player immediately**, including
  anyone mid-playthrough on it — there's no migration for someone already partway through
  the old shape. Avoid touching a chapter that has active players.

### 5.6 Seed the world-state fields — usually nothing to do
With `defineChapter`, the scratch condition fields are **derived automatically** from your
`events`/`fold` entries (`scratchSeed()`), and `game/characters.ts`'s `worldStateSeed()`
spreads in `getChapter(1).scratchSeed()` for you. You only need to think about this
yourself if you hand-roll a chapter module the old way (matching AL's `chapter1.ts`
pattern) instead of using `defineChapter`.

### 5.7 The golden rule of chapter authoring
**Events, fold-map, and conditions must be mutually consistent.** If a condition reads a
field no event ever folds into, that anchor can never advance — a silent soft-lock. Using
`defineChapter`, run `validateChapterSpec(spec)` (the same check the authoring tool runs
before every save) — it lists exactly what's wrong, by name, instead of letting you ship a
stuck game.

Two field names are reserved, and `validateChapterSpec` rejects a spec that misuses either:
**`facts`** can never be a fold-map field — it's owned by the separate AI-memory mechanism
(`fact_additions`, §1); and any `endState` field **must** start with `chapterend_`, which
keeps durable end-of-chapter facts from colliding with a chapter's own scratch fields.

---

## 6. Author the characters & openings

### 6.1 `server/src/game/characters.ts`
If you drafted a world bible from a brief (§4.1), start from that brief's THE CAST answers
— expand each into the fuller shape below rather than copying the short voice-notes verbatim.

Define `PlayableId` (the union of your character ids) and `CHARACTERS` (one `CharacterDossier`
each):
- `id, name, role` — identity.
- `crewId` — the character's own token, dropped from "spoke_to_self" events; `null` for an
  outsider/visitor-type POV who isn't one of the main cast.
- `knowsSecret` / `knowsLabel` — AL used this for dramatic irony; rename or drop for your
  story (it only affects POV framing text).
- `dossier` — the profile shown to the player AND seeded into `player-character.md` (so the
  AI knows who the player is).
- `povLabel` — the one-liner used in the system prompt's POV framing.

Also define, in the same file:
- `CREW_RELATIONSHIPS` — the relationship `.md` file content for each non-player character
  (trust score, notes). `buildStarterWiki` loads every one EXCEPT the player's own.
- `worldStateSeed()` — the `world-state.md` seed: the engine fields
  (`current_chapter`, `current_anchor`, `turns_since_progress`) plus your chapter's
  `scratchSeed()` (see §5.6), plus a durable `body` string describing the starting scene —
  AL's says "a dry-season morning at the Archipelago Lighthouse…"; replace it with yours.
- `buildStarterWiki(id)` — assembles the starter wiki. Generic logic; keep it.

### 6.2 `server/src/game/openings.ts`
Only needed if your first chapter uses **per-character** openings (the hand-rolled pattern,
§5.3's "manual" option) rather than `defineChapter`'s single shared opening. One verbatim
turn-0 opening (prose + 3 starter action suggestions) per playable id, returned by
`openingFor(id)`. This is the first thing the player reads; the AI continues from their
first action. Make each opening establish voice and place fast.

### 6.3 The hardcoded story-specific strings (3 spots)
- **`playTurn.ts`'s `povFraming()`** — rewrite the **secret** line (`'…the secret of the
  Humming Spires.'`) → your story's dramatic-irony hook, or remove it; and the
  **language-gap** block (the Visitor / True Translation handshake) → your equivalent
  onboarding beat, or remove it if your game has no outsider POV.
- **`recap.ts`'s prompt text** — names "Archipelago Lighthouse" and "a long goodbye";
  rewrite to your title and tone.
- **`expandChapter.ts`'s `RULES` text** — names "Archipelago Lighthouse" once, in the
  system prompt the authoring tool's AI step uses. Only matters if you're keeping that
  tool (most forks should — it's free, and it's how you'll add chapter 2 onward).

### 6.4 The "never voice the player" rule
Keep this everywhere it appears (world bible, chapter guardrails, `povFraming`): *the AI
narrates everyone and everything EXCEPT the player's own character; at beats that script the
player's character as the actor, it hands the moment to the player.* This is core to the
feel — don't drop it.

---

## 7. Flexible character fields — inventory, skills, levels

You do **not** need a new system for these. Because `player-character.md` frontmatter is
schemaless and the engine already manages arbitrary state fields, RPG-style stats are just
more fields. Three levels of integration:

**A. Display/flavor only.** Add fields to the character seed and the select-screen card.
`characterCards.ts` already has a `gear` string — rename/extend to `inventory`, add
`skills`, `level`, etc. Seed live values in `characters.ts`:
```ts
// in playerCharacterFile / the dossier seed
frontmatter: { name, role, level: 1, inventory: [], skills: { stealth: 1 } }
```
The AI sees these every turn and can reference them. Zero engine work.

**B. AI-driven changes.** The AI can already modify them via `wiki_updates`
(`{ file:'player-character.md', field:'inventory', value:[…] }`). The engine validates and
applies them. Two enhancements worth making:
- Add **add/remove semantics** for arrays (so "gain a torch" appends instead of replacing
  the whole list). Today `wiki_updates` does scalar replace; extend `applyWikiUpdates` in
  `engine.ts` if you want push/pull ops.
- Add **clamps** for numeric stats. `engine.ts` already clamps `trust_score` to 0–100 — copy
  that pattern for `level`, `hp`, etc.

**C. Gated mechanics (deterministic).** When a stat or item must *gate the story*, route it
through the same events→fold→conditions spine as everything else — in `ChapterSpec` terms:
```ts
events:  [..., { token: 'acquired_torch', anchor: 'A2', fold: { field: 'has_torch' } }]
anchors: [..., { id: 'A2', /* … */, advanceWhen: [
  { field: 'has_torch', op: 'flag', hint: 'find a light source before going underground' },
] }]
```
That covers "has this specific item" (a boolean flag, set by exactly one event). If you
need "has at least N of *something*" instead, that's `count_gte` on an array field (see
§5.3's `people_spoken` example). What `defineChapter`'s two ops *don't* cover is "this
array contains a specific token" (e.g. "has a torch, among possibly many other items") —
for that, either give the specific item its own boolean field as above (simplest), or
hand-roll the condition function the way AL's original `chapter1.ts` does. This gives you
reliable, code-checked item/stat gating with no new mechanism. (Mark such fields as
engine-owned — `defineChapter` does this for you automatically from your `fold` entries —
so the AI can't set them directly; it can only
*report the event* that earns them.)

**Where to store them:** simplest is on `player-character.md`. If a story has lots of
mechanical state, add a dedicated `inventory.md` / `stats.md` wiki file in `buildStarterWiki`
— it'll render into the prompt and persist like any other file.

---

## 8. Known pitfalls (learned building AL — keep these)

- **`ai` SDK is pinned to v6.** The OpenRouter provider peer-depends on `ai@^6`; `ai@7`
  breaks it. Don't bump it casually.
- **Structured output rejects array bounds.** Anthropic's structured mode disallows
  `minItems`/`maxItems` other than 0/1. "3–4 suggested actions" is enforced via the field
  *description* + a code clamp, not the schema. Keep it that way — this applies to the
  authoring tool's AI-expansion schema too.
- **Docker build uses `npm install`, not `npm ci`.** Windows-generated lockfiles omit
  Linux-only optional native deps (the CSS engine). If you develop on Windows, leave the
  Dockerfile on `npm install`.
- **Prompt caching is on, and the stable/volatile split matters.** The system prompt is sent
  as two messages (`playTurn.ts`): `buildStableSystemPrompt()` (world bible + chapter fragment
  + anchor notes + POV framing) carries the `cache_control` breakpoint (`ephemeral`, 1h ttl);
  `volatileSystemPrompt()` (the live wiki state) is uncached and sent right after. Keep it
  that way — if live, per-turn-changing content ends up in the stable message, it stops being
  stable and the cache stops hitting, the same bug this split fixed. The cached prefix varies
  by chapter, which is fine — each chapter's fragment is stable while that chapter is active.
  Set `LOG_TOKEN_USAGE=true` to watch cache hits (`inputTokenDetails.cacheReadTokens` in the
  logged usage).
- **Keep events ⇄ fold ⇄ conditions consistent** (§5.7) — the #1 source of soft-locks.
  `validateChapterSpec` catches this for you if you author via `defineChapter`/the tool;
  it's on you to keep it consistent if you hand-roll a chapter module.
- **The `facts` cap is a token-cost lever, not an arbitrary number — don't loosen it without
  measuring.** `fact_additions` notes live in the *uncached* volatile prompt block (resent in
  full every turn, unlike the cached world bible/chapter fragment), so AL's cap (8
  entries/file, 30 words/220 chars each) was sized against that recurring cost. If you raise
  it, check the aggregate across every fact-eligible file maxed out *at once* — they can all
  fill up in the same long playthrough — not just one file in isolation.
- **The facts-fold-then-clear step only runs on a real chapter transition.** Viewing the
  recap always folds live facts into the prose if it's not already cached, but the per-file
  arrays are only cleared by `consolidate()` — which `/api/next-chapter` never reaches if
  there's no next chapter registered (it reports the story complete first instead). Harmless
  once a story's actually finished, but worth knowing if you're testing this on a save
  sitting at your highest currently-registered chapter.
- **Authored chapters need `DATABASE_URL` to persist.** Without it (the in-memory dev
  store), anything saved through the authoring tool resets on restart — fine for testing,
  not for anything you want to keep.
- **A live chapter edit/delete affects every player immediately** — there's no migration
  for someone mid-playthrough on the old shape (§5.5).

---

## 9. Fork checklist

```
[ ] Copied repo to a new folder; removed .git/dist/node_modules; git init; renamed project
[ ] Deleted AL design docs & lore (wiki/, prose/, *_Plan.md, ADDING_CHAPTERS.md, etc.); rewrote README
[ ] npm install (root + client + server); created server/.env with your key; npm run build OK
[ ] worldBible.ts — your world
[ ] Your first chapter — a ChapterSpec via defineChapter (recommended) or a hand-rolled
    module like AL's chapter1.ts; wired into chapters/index.ts's BUILTINS
[ ] characters.ts — your cast, relationships, world-state seed
[ ] openings.ts — your turn-0 openings (only if hand-rolling per-character ones)
[ ] playTurn.ts — rewrote the two hardcoded POV lines
[ ] recap.ts — rewrote the recap prompt text
[ ] expandChapter.ts — rewrote the game-name line (if keeping the authoring tool)
[ ] characterCards.ts + App.tsx (title) + index.css (theme)
[ ] Searched client/src for AL strings and replaced them
[ ] Played your first chapter start → end in npm run dev; anchors advance in order; no soft-lock
[ ] (optional) Set ADMIN_USERNAMES; logged in as admin; authored Chapter 2 through the
    in-app tool; confirmed Continue → Chapter 2 works
[ ] docker compose up works (with DATABASE_URL set, if you want authored chapters to
    persist); deployed behind HTTPS
```

---

## Appendix: the multi-story framework (the bigger option)

If you eventually want **one deployment hosting several different stories** (rather than
one fork per game), generalize instead of copying. **Good news: the "many chapters" half
of this is already done** — `chapters/index.ts`'s registry means `engine.ts`, `playTurn.ts`,
`index.ts`, and `recap.ts` already take the active chapter as a runtime lookup
(`getChapter(current_chapter)`), never an import. What's left is scoping everything
*outside* the chapter — the world bible, the cast, the theme — per story:

1. Define a `Story` interface = `{ id, title, worldBible, povFraming, characters,
   builtinChapters, theme }`.
2. Move each story's content (world bible, `game/characters.ts`'s equivalent, its built-in
   chapter set) behind that interface into `stories/<id>/`.
3. Give the chapter registry a `storyId` scope — either a registry-per-story, or a
   compound key (`storyId:chapterNumber`) in the existing cache and in the
   `authored_chapters` table — so two stories can both have a "Chapter 3" without
   colliding. (The `BUILTINS` vs. authored split, and `defineChapter`/the authoring tool
   themselves, need no change — only what scopes a chapter number changes.)
4. Make `playTurn.ts`/`recap.ts` take the active story's world bible/POV framing/recap
   tone as a parameter (loaded by a `story_id` stored on the playthrough) instead of
   importing `worldBible.ts` by name. Add a `story_id` column.
5. Make the frontend read title/theme/character cards from the story (via the API) instead
   of hardcoding.

Then a new game = a new `stories/<id>/` folder, no engine edits, and **its chapters can
still be authored live through the same in-app tool**, just scoped to that story. It's a
contained refactor (a few focused sessions), worth it only when you actually want many
stories or external authors. For a single new game, the clean copy in this guide is the
better trade.
