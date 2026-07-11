# 16-Bit Art Code Implementation Plan for llm-wiki-rpg-engine

## Planning Status

This is a planning document only. No application code was changed while preparing it.

Adapted for:

```text
C:\Users\Paulo\Documents\Claude Cowork\Claude_Code\llm-wiki-rpg-engine
```

Source plan reviewed:

```text
C:\Users\Paulo\Documents\archipelago-lighthouse\16BIT_ART_CODE_IMPLEMENTATION_PLAN.md
```

The source plan has already been implemented, shipped, and audited in `archipelago-lighthouse`.
This fork does not currently have that art feature, so treat this as a fresh port using the
corrected source plan, including its route-ordering and post-audit bug shields.

Do not blindly cherry-pick upstream commits. This fork has the same broad app shape, but it has
its own current source state and should be changed deliberately in small, buildable steps.

## First-Pass Repository Findings

No `graphify-out/` or `openwiki/` directory is present in this repo, so there was no generated
code map to consult. This plan was grounded in the current source files and the source project's
completed implementation plan.

Current relevant target files:

- `server/src/index.ts` has one Express app, the `/api` auth wall, save ownership checks, admin
  routes, and production frontend serving.
- `server/src/store.ts` owns playthrough, user, session, save-list, and authored-chapter
  persistence. The art feature should not be forced into this store for v1.
- `server/src/chapters/index.ts` has `getChapter(n)` and `hasChapter(n)`. Important: `getChapter`
  falls back to Chapter 1 for unknown chapter numbers, so chapter existence checks must use
  `hasChapter`.
- `server/src/chapterMeta.ts` already centralizes `chapterNumber`, `chapterTitle`, and
  `anchorTitle` response metadata.
- `client/src/App.tsx` has a local screen router with `saves`, `game`, `recap`, `settings`, and
  `authoring`.
- `client/src/SavesScreen.tsx` already fetches `isAdmin`, shows `Author a chapter` to admins, and
  renders one row per save.
- `client/src/GameScreen.tsx` already has the post-mobile-optimization layout, compact menu,
  safe-area utilities, transcript scroll container, debug panel, and admin detection.
- `client/src/types.ts` does not yet include `playthroughId` on `GameState`.
- `client/vite.config.ts` already proxies `/api`, so no new dev proxy should be needed.
- `docker-compose.yml` currently persists only Postgres data with `pgdata`.
- The only existing art-like asset is `client/public/art/lighthouse-daytime.jpg`, used on auth
  screens. It is public and not suitable for locked chapter/beat art.

## Goal

Add curated portrait 16-bit chapter and beat art to this fork without changing story generation,
chapter rules, wiki state, prompt behavior, or player progression.

The feature should support:

- admin upload and management of chapter-level and beat-level MP4 plus common raster image art;
- filesystem-backed art metadata and files, not a Postgres migration in v1;
- protected media URLs that only load for the logged-in owner of an unlocked save/session;
- a per-save Chapter Art gallery from `Your Stories`;
- desktop art rails in the game screen;
- compact mobile inline beat art inside the transcript flow;
- Docker persistence for uploaded art.

## Confirmed Product Decisions

These decisions are already settled and should not be reopened during implementation unless the
user explicitly changes scope:

- Keep the visible player-facing label `Chapter Art`.
- v1 includes chapter art and beat art only.
- Uploads are admin-curated only. Do not add player uploads, per-user private art libraries, or
  user-submitted media in v1.
- Use a larger upload cap than the source project's `12 MB` limit. This plan uses a `50 MB`
  server hard cap per uploaded MP4 or raster image file.
- Once all implementation and verification tasks are complete, update `README.md` and
  `Technical_Specifications.md` to document the finished feature.

## Non-Goals

Do not change:

- the AI prompt;
- the chapter engine;
- `submit_turn` / play-turn schema;
- wiki state shape;
- chapter progression rules;
- authored chapter generation;
- ComfyUI or any external art generation workflow.

Do not make the model choose art. The app already knows the active `chapterNumber` and `anchor`;
server-owned metadata should select the art.

## Art Asset Assumptions

First-pass chapter and beat art should be treated as portrait 9:16 media:

```text
Resolution target: 720x1280
```

Use stable portrait rendering such as `aspect-[9/16]`. Do not use `aspect-video` for these
surfaces.

Allowed production upload formats:

- `video/mp4`
- `image/jpeg`
- `image/png`
- `image/webp`
- `image/gif`
- `image/avif`

Do not accept SVG in v1. SVG is common, but uploaded SVG has a different security profile than
raster images and should only be added later with explicit sanitization and response-header rules.
Do not accept BMP, TIFF, or HEIC/HEIF in v1 unless the user explicitly expands scope; they are less
reliable as browser-first story art formats and would add extra preview/rendering edge cases.

Server upload cap:

```ts
limits: { fileSize: 50 * 1024 * 1024 }
```

UI guidance:

- Warn admins when a selected file is over `25 MB`.
- Block client-side when a selected file is over the server hard cap of `50 MB`.
- The server remains the source of truth and must reject anything over `50 MB` even if the client
  check is bypassed.

## Key Design Decision

Admin-uploaded production art should not be written into `client/public`.

Use this shape instead:

- Store uploaded art under a server-owned runtime directory: `server/data/art/beats/` locally.
- In Docker, mount a named volume at `/app/server/data/art`.
- Serve uploaded media only through authenticated `/api/art/media/:artId` URLs that verify the
  logged-in user, selected playthrough, and unlock state.
- Keep `client/public/art/` only for public, checked-in seed images that are not secret,
  progress-gated, or user-uploaded.
- Do not add a public static `/art` route for uploaded production media.

## Phase 0: Pre-Implementation Read

Before coding, read this whole plan once and confirm the working tree still matches the source
anchors listed above. This is a handoff document for another coder/AI agent, not a prompt to
reinterpret the product.

Stopgate:

- If the implementation target has changed significantly, stop and report the mismatch before
  coding.
- Do not expand scope beyond admin-curated chapter art and beat art.

## Per-Phase Handoff Rule

The coder must treat each phase as a separate checkpoint:

1. Complete only the current phase.
2. Run that phase's validation commands.
3. Update this document with a short implementation note under the completed phase.
4. Commit that phase before starting the next one.
5. Stop and report status after the commit so the next phase can be reviewed deliberately.

Do not batch multiple phases into one commit unless the user explicitly changes this instruction.

## Phase 1: Filesystem Art Store

Files:

- Add `server/src/artStore.ts`.
- Add `server/src/verify-art-store.ts`.

Create a filesystem-backed art registry. Do not add Postgres tables in v1.

Registry path:

```text
server/data/art/registry.json
```

Art file examples:

```text
server/data/art/beats/chapter-1/chapter-art.mp4
server/data/art/beats/chapter-1/a1-lighthouse-morning.mp4
server/data/art/beats/chapter-1/a2-some-beat.webp
```

Types:

```ts
export type ArtKind = 'chapter' | 'beat'

export type ArtAsset = {
  id: string
  kind: ArtKind
  chapterNumber: number
  anchor: string | null
  title: string
  label: string
  filename: string
  url: string
  mimeType: 'video/mp4' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/avif'
  sizeBytes: number
  updatedAt: string
  updatedBy: string | null
}
```

Store responsibilities:

1. Ensure directories exist.
2. Read and write `registry.json`.
3. Write uploads to deterministic chapter/beat filenames.
4. Replace previous art for the same chapter/anchor.
5. Delete the previous file when replacing or deleting art.
6. Sanitize all path parts.
7. Never use raw uploaded filenames as disk paths.
8. Return stable response objects to API routes.

Use atomic-ish registry writes:

1. Write `registry.json.tmp`.
2. Rename it to `registry.json`.

Support an environment override:

```ts
const ART_DIR = process.env.ART_DIR ?? path.resolve(process.cwd(), 'data/art')
```

Verifier requirements:

1. Create a temp art directory.
2. Initialize the art store with that directory.
3. Upsert chapter art.
4. Upsert beat art.
5. Replace beat art and confirm the old file is gone.
6. Delete art and confirm metadata and file are gone.
7. Attempt path traversal input and confirm it is sanitized or rejected.
8. Await every async check before printing the final result.

Run:

```bash
cd server
npm exec -- tsx src/verify-art-store.ts
cd ..
```

Acceptance:

- Verifier passes.
- Missing registry file behaves as an empty registry.
- Replacing art deletes stale files.
- Path traversal via anchor, title, id, or filename is not possible.

Suggested commit:

```text
add filesystem art store and verifier
```

Implementation note, 2026-07-12:

- Added `server/src/artStore.ts` with a filesystem-backed registry, deterministic chapter/beat
  filenames, MIME-derived extensions for MP4/JPEG/PNG/WebP/GIF/AVIF, path-part validation,
  registry sorting, replacement cleanup, and a default `ART_DIR`-aware singleton.
- Added `server/src/verify-art-store.ts` as a hermetic verifier covering empty registries,
  chapter/beat upsert, replacement cleanup, deletion, traversal rejection, special-character
  slugging, all supported image MIME extension mappings, unsupported MIME rejection, and
  tampered registry filename rejection.
- Phase 1 deliberately does not install `multer` or `file-type`; upload parsing and byte-signature
  sniffing belong to Phase 2.
- Validation run for this phase: `npm exec -- tsx src/verify-art-store.ts` from `server/`,
  `npm --prefix server run build`, and full `npm run build`.

## Phase 2: Server Contract and Art Routes

Files:

- Update `server/package.json`.
- Update `server/package-lock.json`.
- Update `server/src/index.ts`.
- Optionally add small helper functions near existing route helpers, or in a focused
  `server/src/artVisibility.ts` if `index.ts` becomes hard to read.

Install upload parser and file-signature sniffing helper:

```bash
npm --prefix server install multer file-type
npm --prefix server install -D @types/multer
```

Use `multer.memoryStorage()` or a temp upload directory, then let `artStore.ts` validate and
write the final file. Do not rely only on the browser-provided filename or `Content-Type`; validate
against the allowed MIME list and sniff the file signature with a maintained helper such as
`file-type` before choosing the extension or persisting metadata.

### 2.1 Add `playthroughId` to State-Shaped Responses

`client/src/types.ts` currently has no `GameState.playthroughId`, but protected media URLs need a
specific save/session id.

Update these server responses to include `playthroughId: pt.id`:

- `POST /api/new-game`
- `POST /api/saves/:id/resume`
- `GET /api/state`
- `POST /api/next-chapter`
- `POST /api/rollback`, if it returns the same state shape

Update the final NDJSON `done` frame only if the client will need to refresh the active
playthrough id from streamed turn completion. In normal use the id is stable, so this is optional.

Acceptance:

- Existing game boot, resume, next chapter, and rollback still work.
- `GameState` in the browser has `playthroughId`.

### 2.2 Shared Unlock Helper

Implement one shared helper for reached beats instead of duplicating unlock logic across routes:

```ts
function getReachedAnchors(pt: Playthrough, chapterNumber: number): string[] | null
```

Meaning:

- `null`: the chapter is future/unreached.
- `[]`: chapter is reached but no beat anchors are visible. This should rarely happen because
  current chapters include the current beat.
- string array: reached beat anchors for that chapter.

Rules:

- Let `currentChapter = chapterNumOf(pt.wiki)`.
- Let `currentAnchor = anchorOf(pt.wiki)`.
- If `chapterNumber < currentChapter`, all anchors in `getChapter(chapterNumber).anchorOrder`
  are visible.
- If `chapterNumber === currentChapter` and `currentAnchor === CHAPTER_END`, all anchors are
  visible.
- If `chapterNumber === currentChapter` and `currentAnchor !== CHAPTER_END`, include anchors
  from the start of `anchorOrder` through `currentAnchor`, inclusive.
- If `chapterNumber > currentChapter`, return `null`.

Use `hasChapter(chapterNumber)` before trusting `getChapter(chapterNumber)`.

### 2.3 Player-Facing Routes

All routes below sit after the existing `/api` auth wall.

Registration order matters. Register literal routes before `:chapterNumber` routes:

1. `GET /api/art/media/:artId?playthroughId=:playthroughId`
2. `GET /api/art/gallery/:playthroughId`
3. `GET /api/art/:chapterNumber?playthroughId=:playthroughId`
4. `GET /api/art/:chapterNumber/:anchor?playthroughId=:playthroughId`

`GET /api/art/media/:artId`

- Require `playthroughId` query param.
- Verify the logged-in user owns the playthrough.
- Verify the art belongs to a reached chapter/beat.
- Stream the file with the correct `Content-Type`.
- Set `X-Content-Type-Options: nosniff` on media responses.
- Return `404` for missing, future, unreached, or other-user media.
- Include `?v=${updatedAt}` in generated URLs so replacement uploads refresh in browsers.

`GET /api/art/gallery/:playthroughId`

Response:

```ts
{
  chapters: {
    chapterNumber: number
    chapterTitle: string
    state: 'completed' | 'current'
    chapterArt: ArtAsset | null
    beatArts: {
      anchor: string
      anchorTitle: string
      art: ArtAsset | null
    }[]
  }[]
}
```

Rules:

- Verify ownership of `playthroughId`.
- Include completed chapters and the current chapter.
- Hide future chapters entirely.
- For completed chapters, include every beat.
- For current chapter, include reached beats only, including the current beat.
- Do not include locked placeholders.

`GET /api/art/:chapterNumber?playthroughId=:playthroughId`

Response:

```ts
{
  chapterArt: ArtAsset | null
  beatArt: Record<string, ArtAsset>
}
```

Rules:

- Verify playthrough ownership.
- Return `404` for missing or other-user playthroughs.
- Return no future art URLs.
- Missing unlocked art returns empty/null values, not a hard error.

`GET /api/art/:chapterNumber/:anchor?playthroughId=:playthroughId`

Response:

```ts
{ art: ArtAsset | null }
```

Rules:

- Verify ownership and unlock state.
- Return `{ art: null }` for missing unlocked art.
- Return `404` for future, unreached, invalid, or other-user access.

### 2.4 Admin Routes

All admin routes must use `requireAdmin(store)`.

Register literal admin routes before param routes:

1. `GET /api/admin/art/chapters`
2. `POST /api/admin/art/upload`
3. `GET /api/admin/art/media/:artId`
4. `GET /api/admin/art/:chapterNumber`
5. `DELETE /api/admin/art/:artId`

`GET /api/admin/art/chapters`

- Include built-in Chapter 1.
- Include authored chapters from `store.listChapterSpecs()`.
- Use `hasChapter(number)` before `getChapter(number)`.
- Do not loop from 1 to max and expect `getChapter(n)` to throw for gaps. It will not.

`GET /api/admin/art/:chapterNumber`

- Return the same `{ chapterArt, beatArt }` shape as the player route, but unfiltered by unlock
  state.
- Use admin preview URLs: `/api/admin/art/media/:artId`.
- Do not fake a `playthroughId`.

`POST /api/admin/art/upload`

Multipart fields:

```text
file: MP4, JPEG, PNG, WebP, GIF, or AVIF file
chapterNumber: number
anchor: optional string
```

Rules:

- `chapterNumber` is required.
- Blank/missing `anchor` means chapter art.
- Present `anchor` means beat art.
- Validate chapter existence with `hasChapter(chapterNumber)`.
- Validate beat anchor against `getChapter(chapterNumber).anchorOrder`.
- Accept only `video/mp4`, `image/jpeg`, `image/png`, `image/webp`, `image/gif`, and `image/avif`.
- Reject SVG and all other MIME types with `400`.
- Sniff file signatures server-side; do not trust `file.mimetype` alone.
- Derive the file extension from the validated, sniffed MIME type, not the uploaded filename.
- Store chapter art as `chapter-art.<ext>`.
- Store beat art as `<anchor-lowercase>-<anchor-title-slug>.<ext>`.
- Replace existing art for that exact chapter/anchor.

`DELETE /api/admin/art/:artId`

- Delete metadata and file.
- Return `{ ok: true }` if the registry row existed even when the file is already gone.
- Return `404` if no registry row exists.

`GET /api/admin/art/media/:artId`

- Stream uploaded media for admin preview.
- Set `X-Content-Type-Options: nosniff` on admin media responses too.
- Do not require `playthroughId`.
- Keep behind `requireAdmin(store)`.

Acceptance:

- Non-admin users cannot upload, delete, or preview admin media.
- Invalid MIME type gets `400`.
- Oversized upload gets `413` or a clean JSON error.
- Unknown chapter/anchor gets `400` or `404`.
- Future/unreached player media URLs return `404`.
- Route-shadowing is impossible because literal routes are registered first.

Suggested commit:

```text
add protected art API routes
```

Implementation note, 2026-07-12:

- Installed `multer`, `file-type`, and `@types/multer`.
- Updated server state-shaped responses from new-game, resume, state, next-chapter, and rollback
  to include `playthroughId` through a shared `statePayload()` helper.
- Added shared art helpers for player/admin media URLs, chapter/beat art response shaping,
  playthrough ownership checks, reached-anchor unlock checks, MIME sniffing, and Multer JSON
  error handling.
- Added protected player routes in literal-before-param order: `/api/art/media/:artId`,
  `/api/art/gallery/:playthroughId`, `/api/art/:chapterNumber`, and
  `/api/art/:chapterNumber/:anchor`.
- Added admin-only art chapter listing, upload, preview media, chapter art listing, and delete
  routes. Uploads are memory-backed, capped at 50 MB, byte-sniffed with `file-type`, and saved
  only after resolving to the allowed MP4/JPEG/PNG/WebP/GIF/AVIF MIME list.
- Validation run for this phase: `npm --prefix server run build`, `npm exec -- tsx
  src/verify-art-store.ts` from `server/`, and full `npm run build`.

## Phase 3: Client Types and Routing

Files:

- Update `client/src/types.ts`.
- Update `client/src/App.tsx`.
- Update `client/src/SavesScreen.tsx`.
- Add `client/src/ArtAdminScreen.tsx`.
- Add `client/src/ChapterArtScreen.tsx`.

Add types:

```ts
export type ArtAsset = {
  id: string
  kind: 'chapter' | 'beat'
  chapterNumber: number
  anchor: string | null
  title: string
  label: string
  filename: string
  url: string
  mimeType: 'video/mp4' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' | 'image/avif'
  sizeBytes: number
  updatedAt: string
  updatedBy: string | null
}

export type ChapterArtResponse = {
  chapterArt: ArtAsset | null
  beatArt: Record<string, ArtAsset>
}

export type ArtChapterOption = {
  number: number
  title: string
  anchors: { id: string; title: string }[]
}

export type ArtGalleryResponse = {
  chapters: {
    chapterNumber: number
    chapterTitle: string
    state: 'completed' | 'current'
    chapterArt: ArtAsset | null
    beatArts: { anchor: string; anchorTitle: string; art: ArtAsset | null }[]
  }[]
}
```

Extend `GameState`:

```ts
export type GameState = {
  playthroughId: string
  // existing fields stay
}
```

Update `App.tsx`:

- Add screen variants: `artAdmin` and `chapterArt`.
- Add `artPlaythroughId` state.
- Import `ArtAdminScreen` and `ChapterArtScreen`.
- Render `ArtAdminScreen` from the existing saves flow.
- Render `ChapterArtScreen` for the selected save/session id.

Update `SavesScreen.tsx` props:

```ts
interface Props {
  onResume: (state: GameState) => void
  onStartNew: () => void
  onSettings: () => void
  onLogout: () => void
  onAuthor: () => void
  onManageArt: () => void
  onChapterArt: (playthroughId: string) => void
}
```

UI rules:

- Admins see `Author a chapter` and `Manage art` in the existing header link cluster.
- Every save row gets its own compact `Chapter Art` action near `Continue`.
- The gallery must be scoped to `s.id`, not the currently active `pid` cookie.

Acceptance:

- Admin sees `Manage art`.
- Non-admin does not see `Manage art`.
- Every save row shows `Chapter Art`.
- Clicking a row's `Chapter Art` opens that save's gallery without resuming the save.

Suggested commit:

```text
add art screens to client routing
```

## Phase 4: Admin Upload Screen

File:

- Add `client/src/ArtAdminScreen.tsx`.

Use `AuthoringScreen.tsx` as the local UI model:

- compact operational admin screen;
- same palette and form feel;
- no landing-page copy;
- no huge hero section.

Workflow:

1. Load chapter options from `/api/admin/art/chapters`.
2. Load existing art for selected chapter from `/api/admin/art/:chapterNumber`.
3. Let admin choose chapter number, optional beat anchor, and file.
4. Show local preview before upload.
5. POST `FormData` to `/api/admin/art/upload`.
6. Refresh existing art after upload.
7. Allow delete for each existing art row.

Upload UI rules:

- If `anchor === ''`, label it as chapter art.
- If `anchor !== ''`, label it as beat art.
- File picker accepts `.mp4,.jpg,.jpeg,.png,.webp,.gif,.avif`.
- Client validation accepts only `video/mp4`, `image/jpeg`, `image/png`, `image/webp`, `image/gif`, and `image/avif`, but server validation remains authoritative.
- Show file size before upload.
- Warn if file is over `25 MB`.
- Block if file is over server max (`50 MB`).
- Show a clear validation message if the selected file exceeds `50 MB`; do not attempt upload.
- Revoke local object URLs in effect cleanup.
- Branch rendering by `mimeType`; do not render images as `<video>`.

Acceptance:

- Admin can upload chapter art and immediately see it in the existing-art list.
- Admin can upload beat art and immediately see it in the existing-art list.
- JPEG, PNG, WebP, GIF, and AVIF previews render as images.
- MP4 previews render muted and playable.
- Delete refreshes the list.

Suggested commit:

```text
add admin art upload screen
```

## Phase 5: Chapter Art Gallery

File:

- Add `client/src/ChapterArtScreen.tsx`.

Props:

```ts
interface Props {
  playthroughId: string
  onBack: () => void
}
```

Purpose:

- Show a chapter-organized gallery for the selected save/session.
- Scope visibility to `playthroughId`.
- Do not use the active `pid` cookie as the source of truth.
- This is a player gallery, not an admin editor.

Data:

```ts
GET /api/art/gallery/:playthroughId
```

List view:

- Header with `Chapter Art` and back button.
- Loading, error, and empty states.
- One card per reached chapter.
- Include completed chapters and the current chapter.
- Hide future chapters entirely.
- Tapping/clicking a chapter opens detail view.

Detail view:

1. Show chapter art first.
2. List beat art below it.
3. Label each beat row with anchor and title, for example `A4 - Whales`.
4. For completed chapters, show every beat in the chapter.
5. For current chapter, show reached beats only.
6. Hide future beats.
7. Clicking an art item can open a full-screen overlay.

Rendering rules:

- Branch on `mimeType`.
- MP4 should be muted, looping, and `playsInline` when autoplaying.
- Any `image/*` asset should render as `<img>`. Only `video/mp4` should render as `<video>`.
- Use portrait dimensions and avoid layout shift.

Acceptance:

- Gallery loads from each save row.
- Current chapter appears even when no chapter has been completed.
- Future chapters and future beats do not appear.
- Another user's playthrough id returns a clean error/empty state and no media.

Suggested commit:

```text
add per-save chapter art gallery
```

## Phase 6: GameScreen Art Rendering

File:

- Update `client/src/GameScreen.tsx`.
- Optional: add `client/src/ArtLoop.tsx` if a shared renderer keeps `GameScreen` cleaner.

Add state:

```ts
const [chapterArt, setChapterArt] = useState<ArtAsset | null>(null)
const [beatArtByAnchor, setBeatArtByAnchor] = useState<Record<string, ArtAsset>>({})
```

Fetch art when `chapterNumber` or `initialState.playthroughId` changes:

```ts
const params = new URLSearchParams({ playthroughId: initialState.playthroughId })
fetch(`/api/art/${chapterNumber}?${params.toString()}`)
```

Derived value:

```ts
const beatArt = beatArtByAnchor[anchor] ?? null
```

Create one renderer that branches by MIME type:

```tsx
function ArtLoop({ art, className }: { art: ArtAsset; className?: string }) {
  if (art.mimeType.startsWith('image/')) {
    return <img src={art.url} alt={art.label} className={className} />
  }

  return (
    <video
      src={art.url}
      autoPlay
      muted
      loop
      playsInline
      aria-label={art.label}
      className={className}
    />
  )
}
```

Desktop layout:

- Use art rails only at `xl` width and above.
- Left rail: chapter art.
- Center: story.
- Right rail: beat art.
- If debug is open, debug wins over the right-side beat art rail.
- Increase the outer max width from the current `max-w-6xl` to something like
  `max-w-[1440px]` so rails do not squeeze the story.
- Use stable rail widths, such as `w-[220px]` left and `w-[260px]` right.
- Use `aspect-[9/16]`, `object-cover`, and `rounded-sm`.
- Main story page art must not have borders. Do not put `border`, `ring`, outline, framed-card
  wrappers, or `boxShadow` frame effects on the desktop chapter rail, desktop beat rail, or mobile
  inline beat art. The art should stand on its own.

Mobile inline art:

- Place beat art inside the transcript scroll container after the dossier block and before older
  turns.
- Show only beat art, not chapter art.
- Hide on `xl` and above.
- Use fixed portrait aspect ratio to avoid scroll jump.
- Ensure videos are muted and `playsInline`.
- Do not add a border, ring, outline, or framed-card wrapper around mobile inline art.

Acceptance:

- No art: current game layout still works.
- Chapter art only: left rail appears on desktop.
- Beat art only: right rail appears on desktop and inline mobile.
- Both art types: all expected slots render.
- Debug panel open: no overlap with beat art.
- Anchor changes update beat art without refresh.
- Mobile layout has no horizontal overflow.
- Image art is visible, not a broken video element.
- Computed styles confirm story-page art surfaces have no visible border/ring/frame.

Suggested commit:

```text
render chapter and beat art in game screen
```

## Phase 7: Docker and Local Runtime Plumbing

Files:

- Update `docker-compose.yml`.
- Usually no `client/vite.config.ts` change is needed.

`client/vite.config.ts` already proxies `/api`, which covers `/api/art/media/:artId`.

Update `docker-compose.yml`:

```yaml
services:
  app:
    environment:
      PORT: "3001"
      DATABASE_URL: "postgres://archipelago:archipelago@db:5432/archipelago"
      ART_DIR: "/app/server/data/art"
    volumes:
      - artdata:/app/server/data/art

volumes:
  pgdata:
  artdata:
```

Deployment caution:

- If deploying to the NUC, check for local `docker-compose.yml` differences first.
- Do not overwrite machine-local compose edits blindly.

Acceptance:

- `/api/art/media/:artId` works in dev through the existing `/api` proxy.
- Uploaded art persists across Docker app rebuilds.
- Existing Postgres persistence still works.

Suggested commit:

```text
persist art uploads in docker
```

## Phase 8: Verification

Run from repo root:

```bash
npm run build
```

Run the hermetic server verifier:

```bash
cd server
npm exec -- tsx src/verify-art-store.ts
cd ..
```

Optional client lint:

```bash
npm --prefix client run lint
```

Manual browser checks:

1. Start dev server with `npm run dev`.
2. Log in as an admin.
3. Open `Your Stories`.
4. Confirm `Manage art` appears.
5. Upload a small MP4 for Chapter 1 chapter art.
6. Confirm it immediately appears in the Manage Art existing-art list.
7. Upload a small PNG or WebP for a reached Chapter 1 beat.
8. Start or resume a Chapter 1 game.
9. At a wide viewport around `1440x900`, confirm chapter and beat art rails render.
10. Confirm uploaded image beat art renders as an image, not a broken video element.
11. At a mobile viewport around `390x844`, confirm inline beat art renders without horizontal
    overflow.
12. Confirm each save row has its own `Chapter Art` button.
13. Open the gallery from a save row and confirm it loads.
14. Confirm future chapters and future beats do not appear.
15. Confirm another user's playthrough id returns not found/unauthorized behavior.
16. Confirm a guessed future art media URL returns `404`.
17. Confirm `/api/admin/art/media/:artId` fails for non-admin users.

Production-style local check:

```bash
docker compose up --build -d
curl -fsS http://localhost:3001/api/health
```

Expected health response:

```json
{"ok":true,"store":"postgres"}
```

## Bug Shields

- Do not write runtime uploads to `client/public`.
- Do not add Postgres migrations for v1 art metadata.
- Do not expose upload/delete without `requireAdmin(store)`.
- Do not accept arbitrary file types.
- Do not trust browser-supplied MIME labels; sniff uploads server-side before saving metadata or choosing extensions.
- Do not omit `X-Content-Type-Options: nosniff` on player-facing or admin media responses.
- Do not trust uploaded filenames.
- Do not trust anchor/title strings as paths.
- Do not expose production uploaded art through a public static `/art` route.
- Do not make videos play with sound.
- Do not let art load resize the story layout after render; use fixed aspect ratios.
- Do not put borders, rings, outlines, framed-card wrappers, or shadow frames around art shown on
  the main story page.
- Do not let debug panel and beat-art rail overlap.
- Do not show future chapters or future beats in the player gallery.
- Do not touch prompt, chapter engine, or wiki progression code for this feature.
- Do not register `:chapterNumber` routes before literal `/media`, `/gallery`, or admin
  `/chapters` routes.
- Do not give the admin upload screen a fake `playthroughId`.
- Do not render `art.url` with only one hardcoded tag. Branch on `mimeType` everywhere: `image/*` uses `<img>`, `video/mp4` uses `<video>`.
- Do not let verifier assertions run fire-and-forget.
- Do not use `getChapter(n)` as an existence check. Use `hasChapter(n)`.

## Suggested Commit Split

1. `add filesystem art store and verifier`
2. `add protected art API routes`
3. `add art screens to client routing`
4. `add admin art upload screen`
5. `add per-save chapter art gallery`
6. `render chapter and beat art in game screen`
7. `persist art uploads in docker`
8. `document 16-bit art workflow`

Keep each commit buildable when possible.

## Final Documentation Note

After all implementation and verification tasks above are complete, update `README.md` and
`Technical_Specifications.md` so the repo documentation matches the finished feature. Do this at
the end, after the code behavior is real and verified, so the docs describe the actual shipped
routes, storage paths, upload cap, admin-only workflow, gallery behavior, and story-page rendering
rules.
