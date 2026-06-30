# Contributing

Thanks for your interest! This repo is two things: a reusable **engine** for AI-narrated,
state-tracking text RPGs (the "LLM Wiki" architecture), and one **game** built on it
(*Archipelago Lighthouse*). Contributions to the **engine and app code** are welcome.

> **Building your own game?** You don't need to contribute here — fork the repo and swap
> the content modules. See **[FORK_GUIDE.md](FORK_GUIDE.md)**.

## What's welcome

- **Engine improvements** — the turn loop, write-back, anchor gating, anti-soft-lock valve,
  provider layer, caching, persistence, auth, streaming.
- **Bug fixes** and reliability hardening.
- **Docs** — clarifications to the README, this guide, or the Fork Guide.
- **DX** — types, tests, tooling.

## What to keep in mind about content

The game's **creative content** (world, story, prose, lore, characters) is © the author and
**not** under the MIT license — see the [README License section](README.md#license). Please
**don't** submit pull requests that add to or alter *Archipelago Lighthouse's* story, and
don't paste in copyrighted text from elsewhere. Engine work that happens to touch a content
file (e.g. changing a data shape) is fine; new lore/prose is not.

## Dev setup

Full instructions are in the [README](README.md#quick-start). The short version:

```bash
npm install && npm install --prefix client && npm install --prefix server
cp server/.env.example server/.env     # add your LLM_API_KEY
npm run dev                            # backend :3001 + frontend :5173
```

No database is required for dev — the server falls back to an in-memory store (state resets
on restart). Set `DATABASE_URL` (or run `docker compose up -d db`) for persistence.

## Where things live (the engine seam)

The **server owns all game state**; the browser is a thin renderer. The story engine lives
in code, never in the AI.

- `server/src/engine.ts` — the generic gate: folds reported events into state, advances
  anchors when conditions are met, anti-soft-lock counter, validated write-back.
- `server/src/playTurn.ts` — prompt assembly + the streamed, forced `submit_turn` output.
- `server/src/store.ts` — persistence (Postgres or in-memory, one interface).
- `server/src/llm.ts` — the provider layer (swap vendors via env; caching; BYOK).
- `server/src/index.ts` — API routes.
- **Content (story-specific):** `worldBible.ts`, `chapters/`, `game/characters.ts`,
  `game/openings.ts`. The [Fork Guide](FORK_GUIDE.md) explains the content↔engine split in
  detail.

## Code style

- **TypeScript**, ESM. Match the surrounding style — small focused functions, clear names,
  comments that explain *why*, not *what*.
- The frontend lints with **oxlint** (`npm run lint --prefix client`).
- Keep the build green: `npm run build` (compiles both client and server) must pass.

## A few engine invariants (don't break these)

- **The AI reports; code decides.** The model emits `events` from a closed vocabulary; the
  engine folds them and decides progression. Never move gating into the prompt.
- **Keep events ⇄ fold-map ⇄ world-state seed ⇄ conditions consistent.** A condition that
  reads a field no event folds into is a silent soft-lock — and so is a *type* mismatch: a
  `flag` condition on a field only ever fed by a token-bearing (array) fold can never equal
  `true`, even though the field technically "is fed." `validateChapterSpec` catches both (see
  `FOLD_TOKEN_SOFTLOCK_FIX.md` for the incident that prompted the second check).
- **`ENGINE_OWNED_FIELDS`** must list every field the engine derives, so the AI's
  `wiki_updates` can't overwrite them.
- **Never voice the player's own character** — preserve that rule in prompts.

## Gotchas

See the README's [Notes & gotchas](README.md#notes--gotchas-for-contributors): the `ai` SDK
is pinned to v6, `playTurn.ts`'s per-turn schema avoids array `minItems`/`maxItems` (not a
universal restriction — see the README for the nuance), and the Docker build uses
`npm install` (not `npm ci`).

## Pull requests

1. Fork and branch from `main` (`fix/…`, `feat/…`).
2. Keep PRs focused; describe the change and how you verified it.
3. **Verify by playing** — run a chapter end-to-end and confirm anchors advance in order and
   nothing soft-locks. Make sure `npm run build` passes.
4. Write clear commit messages.

## Reporting issues

Open a GitHub issue with steps to reproduce, what you expected, and what happened (server
logs help — set `LOG_TOKEN_USAGE=true` for token/cache detail). For security issues, please
contact the maintainer privately rather than filing a public issue.
