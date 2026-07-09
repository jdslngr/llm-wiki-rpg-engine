# Mobile Optimization Implementation Plan — GameScreen

## Planning Status

This is a planning document only. No application code was changed while preparing it.

Adapted on 2026-07-09 for this repo:

`C:\Users\Paulo\Documents\Claude Cowork\Claude_Code\llm-wiki-rpg-engine`

The source plan and proven implementation are in the private upstream project:

`C:\Users\Paulo\Documents\archipelago-lighthouse`

The source project has a GitHub remote at `jdslngr/archipelago-lighthouse`. Its mobile pass was merged to `main` in commit `437f08f`, then refined through `4e65cf5`. The target repo has its own GitHub remote at `jdslngr/llm-wiki-rpg-engine`.

Do not blindly cherry-pick the upstream commits. This fork already contains some of the same iOS work and has diverged in other areas. Port the remaining behavior deliberately, one small change at a time.

## Goal

Make `client/src/GameScreen.tsx` easier to read and operate on a phone without changing game rules, server behavior, story generation, save data, or the desktop information architecture.

The finished mobile layout should:

- keep the story area as tall as practical;
- prevent long story text and multi-line player actions from rendering incorrectly;
- make the transcript navigation useful without leaving a large control floating over the story;
- let the input start at one line and grow as the player types;
- keep the Send control compact while preserving a comfortable tap target;
- hide suggested actions until requested;
- replace the wrapping header button row with one compact menu; and
- preserve the iOS reachability and safe-area work already present in this fork.

## First-Pass Repository Findings

No `graphify-out/` or `openwiki/` directory is present in this repo, so there was no generated code map to consult. This plan was grounded in the current source files, the source project's completed plan, and the source project's Git history.

Current target baseline: `d16d742` (`fix: iOS browser rendering optimizations — viewport, safe-area, font loading, scroll guards`).

### Already implemented in this fork

| Area | Current state | Planning decision |
| --- | --- | --- |
| Small viewport height | `GameScreen` already uses `min-h-[100svh]` | Keep it |
| iOS input font size | The game textarea already uses an inline `fontSize: '16px'` | Do not repeat the source plan's font bump |
| Safe-area floor | `index.css` already defines `pb-safe-room` with a 12px minimum | Keep it |
| Input safe area | The input card is already wrapped in `pb-safe-room` | Keep it |
| Side safe areas | `px-safe` already uses left/right safe-area insets with a 20px floor | Keep it |
| Touch scrolling | `.story-log` already has iOS momentum scrolling and vertical touch handling | Keep it |
| Small-control fallback | Mobile inputs, textareas, and selects already receive a 16px CSS fallback | Keep it |
| Down-to-latest control | A large text button appears when the reader is more than 300px from the bottom | Refine it; do not add a second competing control |

### Still missing

- Story bubbles do not consistently break long unbroken text.
- Player bubbles do not preserve entered line breaks.
- There is no back-to-top control.
- The existing down-to-latest text pill remains visible across a large part of a long transcript.
- The textarea is fixed at three rows.
- The Send button uses a wide text label.
- Suggested actions are always visible.
- The header can wrap into two rows on a phone.

## Existing Solution to Reuse

The exact feature already exists in the source project's final `GameScreen.tsx`. Use that implementation as a reference rather than designing a new interaction from scratch.

Relevant upstream sequence:

1. `9e15b39` — safe-area room (already present in this fork)
2. `6034415` — auto-growing textarea
3. `7c6374d` — icon-only Send button
4. `579aca9` — suggestions toggle
5. `80cec00` — compact header menu
6. `4a3b563` — keep the menu trigger above its backdrop
7. `519260a` — show every suggestion when expanded
8. `15c87a3` and `4e65cf5` — reduce scroll controls to small, near-edge-only buttons

The source plan claimed its auto-grow behavior was adapted from `AuthoringScreen.tsx`. That is not true for this fork: the current `AuthoringScreen.tsx` has no `AutoGrowTextarea`, `ResizeObserver`, or `useLayoutEffect` implementation. For this repo, the reusable source is the completed upstream `GameScreen.tsx`, not a local shared component.

Useful local patterns that do exist:

- `dossierOpen` is the established boolean open/close pattern.
- `--color-bg-surface` is available for the menu panel.
- `--color-gold-border` is already used for panel outlines.
- Suggested-action styling already provides a secondary-button treatment.
- `CharacterSelectScreen.tsx` demonstrates an `aria-label` on an icon-like visual.

## Scope

Expected application-code scope during implementation:

- `client/src/GameScreen.tsx`

No `index.css` change should be needed because `pb-safe-room` and the related iOS rules already exist.

If implementation reveals a genuine missing style, pause and explain why before expanding the file scope.

## Implementation Steps

Each numbered step should be independently reviewable and should leave the client buildable.

### 1. Fix story wrapping and player line breaks

File:

`client/src/GameScreen.tsx`

Add long-word wrapping to all four narrative surfaces:

- historical AI turns;
- the streaming AI turn;
- historical player turns; and
- the live pending player turn.

Add preserved whitespace to both player-turn surfaces so a multi-line action is displayed with the same line breaks the player entered.

Use the existing Tailwind utilities from the upstream solution:

- `break-words` on all four surfaces;
- `whitespace-pre-wrap` on both player surfaces.

The AI surfaces already use `whitespace-pre-wrap`; keep that behavior and add `break-words`.

Acceptance checks:

- A long URL or 100+ character unbroken string stays inside every bubble.
- Historical and streaming AI text both wrap.
- A two-line player action remains two lines while pending and after the turn is committed.
- Normal prose spacing is unchanged.

Suggested commit:

`fix: wrap long story text and preserve player line breaks`

### 2. Make transcript navigation small and near-edge-only

File:

`client/src/GameScreen.tsx`

Refine the existing `isScrolledUp` behavior and add `isScrolledFromTop`.

Use one `handleTranscriptScroll` calculation for both controls:

- Compute `scrollable = el.scrollHeight - el.clientHeight`.
- If `scrollable <= 300`, hide both controls.
- Show down-to-latest only while `el.scrollTop <= 20`.
- Show back-to-top only while `el.scrollTop >= scrollable - 20`.
- Hide both throughout the middle of a long transcript.

This intentionally uses the final upstream behavior from `4e65cf5`, not the earlier halfway-split version.

Control placement:

- Back-to-top is the first child inside the scrollable story log and uses `sticky top-4`.
- Down-to-latest remains the last child and uses `sticky bottom-4`.
- Both controls are `w-9 h-9` icon-only squares.
- Use plain `↑` and `↓` glyphs.
- Give each button an `aria-label` and a descriptive `title`.
- Reuse the current gold gradient and shadow.

Acceptance checks:

- Neither control appears when the transcript has 300px or less of scrollable content.
- At the top edge of a long transcript, only down-to-latest appears.
- In the middle, neither appears.
- At the bottom edge, only back-to-top appears.
- Each control scrolls smoothly to the correct edge.
- The controls do not cover normal story reading for most of the scroll range.

Suggested commit:

`fix: make transcript navigation compact and edge-only`

### 3. Convert the textarea to one-line auto-grow

File:

`client/src/GameScreen.tsx`

Adapt the tested implementation from the source project's final `GameScreen.tsx`:

- add the required React imports (`useCallback` and `useLayoutEffect`);
- add a `textareaRef`;
- resize the textarea to its `scrollHeight` whenever `input` changes;
- use a `ResizeObserver` to remeasure after its width changes;
- retain a guard for environments where `ResizeObserver` is unavailable;
- change `rows={3}` to `rows={1}`; and
- cap growth visually at about 200px using `max-h-[200px] overflow-y-auto`.

Keep the existing inline 16px font size. It is already the correct iOS-safe value.

Why `useLayoutEffect` matters:

The existing turn flow measures a player bubble before scrolling it into position. Resizing the input before paint avoids measuring against a stale input height.

Acceptance checks:

- An empty input starts at one line.
- It grows as text wraps or new lines are added.
- It shrinks after Send clears the input.
- It stops growing at roughly 200px and then scrolls internally.
- Resizing the browser narrower and wider recalculates the height.
- Sending a turn still places the pending player bubble correctly.
- The browser console shows no observer or layout errors.

Suggested commit:

`feat: add an auto-growing game input`

### 4. Replace the wide Send label with a compact icon

File:

`client/src/GameScreen.tsx`

Replace the `Send →` / `Sending…` text with the same `✒️` icon used by the proven upstream implementation.

Requirements:

- Keep the current disabled conditions.
- Keep a tap target of approximately 44×44px.
- Add `aria-label="Send action"`.
- Add a desktop tooltip such as `title="Send (⌘/Ctrl + Enter)"`.
- Mark the emoji span `aria-hidden="true"` so it is not announced twice.
- Use a loading animation such as `animate-pulse` to replace the lost `Sending…` text feedback.
- Remove text-only styles that do nothing for an emoji, such as letter spacing.

Acceptance checks:

- The button remains easy to tap at a 390px-wide viewport.
- Screen readers receive a meaningful label.
- Hovering on desktop reveals the keyboard shortcut.
- Loading, empty-input, and over-word-cap disabled states still work.
- The word counter and error/retry display still have enough room.

Suggested commit:

`feat: compact the game send control`

### 5. Put suggested actions behind a toggle

File:

`client/src/GameScreen.tsx`

Add `suggestionsOpen`, defaulting to `false`.

Move the existing suggestion label and buttons inside the input card, between the textarea and its footer. Add a secondary-style footer button:

- `Suggestions` while closed;
- `Hide suggestions` while open.

Only show the toggle when `actions.length > 0`.

Do not add a fixed-height or internally scrolling suggestions panel. When expanded, show all suggestions. The upstream source tried a height cap and removed it after review.

Close suggestions inside `takeTurn`. This covers both free-text sends and suggestion-chip sends and prevents disabled, stale suggestions from remaining open while the storyteller responds.

Acceptance checks:

- Suggestions are collapsed on initial render.
- The toggle is absent when the server provides no suggestions.
- Expanding shows every suggestion without an inner scrollbar.
- A suggestion still submits its exact text.
- Sending either typed text or a suggestion closes the panel.
- A new response can supply a new set of suggestions normally.

Suggested commit:

`feat: collapse suggested actions behind a toggle`

### 6. Collapse the header actions into one menu

File:

`client/src/GameScreen.tsx`

Add `navMenuOpen`, defaulting to `false`.

Change the header to a single row at every viewport width:

- Keep the title block on the left.
- Add `truncate` to the chapter/anchor subtitle.
- Keep `min-w-0` on the title block.
- Replace the current wrapping action row with one `Menu ▾` / `Menu ▴` trigger on the right.

Menu contents must preserve the same availability rules and actions:

- Export;
- Your Stories, when `onBackToSaves` exists;
- Show/Hide debug, only in development or for an admin;
- Settings, when `onSettings` exists; and
- Log out.

Menu behavior:

- Reuse `--color-bg-surface` for the panel background.
- Reuse `--color-gold-border` for the panel ring.
- Give every menu item a minimum 44px height.
- Close the menu after any item is selected.
- Close it on backdrop click.
- Close it when Escape is pressed.
- Keep the trigger at `relative z-50` so the `fixed inset-0 z-40` backdrop cannot block it.

Do not add focus trapping or ARIA menu roles in this pass. The source implementation intentionally stayed aligned with the app's current accessibility baseline. A broader accessibility audit can handle those semantics separately.

Acceptance checks:

- The header remains one row at 390px width.
- Long chapter and anchor titles truncate instead of pushing the menu off-screen.
- Every previously available header action remains reachable.
- Conditional Debug, Settings, and Your Stories entries appear only when appropriate.
- The trigger works both while opening and closing the menu.
- Backdrop click and Escape close the panel.
- Selecting any item closes the panel before or while its action runs.
- The menu stays within the viewport and above the story content.

Suggested commit:

`feat: collapse game header actions into a menu`

## Validation Plan

### Automated checks

After each implementation commit:

```powershell
npm --prefix client run lint
npm --prefix client run build
```

After the full pass:

```powershell
npm run build
```

This repo does not currently expose a dedicated client test script, so build/lint alone are not sufficient proof of the interactions.

### Browser checks

Run the real app:

```powershell
npm run dev
```

Validate at minimum:

- mobile viewport: `390x844`;
- desktop viewport: `1440x900`;
- a short transcript;
- a transcript with more than 300px of scrollable content;
- a transcript long enough to test the top, middle, and bottom positions;
- an admin/development session where Debug is available; and
- a normal user session where Debug is absent.

Capture screenshots of:

- mobile header closed and open;
- one-line input and expanded multi-line input;
- suggestions closed and open;
- down-to-latest at the top edge;
- no navigation control in the transcript middle;
- back-to-top at the bottom edge; and
- the desktop game screen after the changes.

Keep screenshot artifacts outside tracked source files unless the user explicitly asks to commit them.

### Real-device checks

If an iPhone is available, verify in Safari through the deployed HTTPS URL:

- focusing the textarea does not zoom the page;
- the Send button clears the home indicator;
- the input grows and scrolls correctly;
- the header menu can be opened and dismissed;
- scrolling the story remains smooth; and
- rotating the device recalculates the textarea height.

Also check one Android phone if available, especially the minimum bottom padding when the safe-area inset reports zero.

## Regression Checklist

- Starting and resuming a story still opens at the top of the transcript.
- Sending a turn still snaps the new player message into position.
- Streaming narrative still appears and completes normally.
- Retry restores and resends failed input.
- The 300-word cap still blocks oversized input.
- Suggested actions still submit through `takeTurn`.
- Chapter completion still replaces the input with the recap action.
- Export still downloads the full story.
- Your Stories, Settings, Debug, and Log out still perform their original actions.
- The dossier still expands and collapses.
- Older-turn expansion still works.
- Desktop layout remains usable.

## Out of Scope

- Server, database, authentication, cookie, or reverse-proxy changes.
- Reworking screens other than `GameScreen`.
- Replacing the already-present safe-area utilities.
- A repo-wide viewport-height sweep.
- Font-loading or preconnect changes.
- Debug-panel redesign.
- New mobile navigation architecture outside the game screen.
- Focus trapping or a full accessibility semantics audit.
- Changing story, turn, suggestion, save, or chapter behavior.

## Completion Definition

The pass is complete only when:

1. All six remaining implementation steps are present.
2. Client lint and the full repo build pass.
3. The mobile and desktop browser checks pass.
4. No header action or game-input behavior is lost.
5. Screenshots confirm the intended layouts.
6. Real-iPhone limitations, if testing is unavailable, are reported explicitly rather than treated as verified.

## Recommended Delivery Shape

Use a dedicated branch such as:

`codex/mobile-game-screen-optimization`

Keep the six suggested commits separate while implementing and reviewing. That makes visual regressions easier to identify or revert. After browser validation, merge them together or preserve the small-commit history according to the repo owner's preference.
