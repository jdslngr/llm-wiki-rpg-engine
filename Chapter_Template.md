# Chapter Template — Archipelago Lighthouse
## Fill-in scaffold for designing a new chapter

*Companion to [ADDING_CHAPTERS.md](ADDING_CHAPTERS.md) (the full how-to) and the fully-worked
reference chapter 1 (`server/src/chapters/chapter1.ts`). This scaffold mirrors ADDING_CHAPTERS.md's
9 manual-path steps — fill in each section below, then either paste the whole thing into the
authoring tool's Brief stage, or hand it to an AI to turn into a `ChapterSpec` module (Step 9).*

---

**How to use this file.** Copy it to `Chapter_NN_Title.md`. Replace every `<…>` placeholder.
The `> 📖` blockquotes explain what each field is — keep or delete them as you like. When a
field is unclear, open **`server/src/chapters/chapter1.ts`** — it's this template
fully filled in (Chapter 1 is hand-written and a little richer than what the authoring tool
produces today — e.g. six per-character openings instead of one shared one).

---

## Chapter basics

- **Number:** `<N>` (2 or higher if this goes through the authoring tool — Chapter 1 is reserved)
- **Title:** `<"The …">`
- **Thesis, optional:** `<the one feeling or truth this chapter delivers>`

> 📖 The thesis isn't part of the data the engine reads — it's a compass for you. Chapter 1's
> is *"everyone already knows the Gnomes are leaving."* Every beat below should serve it; if
> one doesn't, cut or demote it.

---

## Step 1 — The beats (anchors)

List the **4–8 must-happen moments**, in order. For each: what happens, and what has to be
true for the story to move on.

- **A1 — `<short title>`.** `<what happens>` Advances when: `<plain-language condition>`
- **A2 — `<short title>`.** `<…>` Advances when: `<…>`
- *(…add beats as needed)*

> 📖 Keep it tight — 4 to 8 beats. The AI improvises texture and banter *between* them freely;
> these are just the non-negotiable spine.

## Step 2 — The events

For each beat's condition, decide the **events** the AI is allowed to report — a small,
closed, snake_case vocabulary.

- `<event_token>` → belongs to beat `<A?>`
- `<event_token>` → belongs to beat `<A?>`

> 📖 Keep them concrete and countable — `examined_room`, `found_clue`, `spoke_to_pan` — not
> vague ones like `made_progress`.

## Step 3 — The fold-map (event → field)

For each event, say how it updates the save:

- `<event_token>` → field `<field_name>` — **flag** (happened at least once) or **array**
  (collect a set)

> 📖 A flag field starts `false` and flips to `true` the first time its event fires. An array
> field starts `[]`; each firing pushes a token onto it. In the authoring tool's Review stage
> this is the **"array item (optional)"** box next to each event — leave it blank for a flag,
> fill it in to make an array.

> **Watch out — arrays are a deduplicated set, not a counter.** If one event always pushes the
> *same* literal token, it can only ever add ONE entry to the array — firing it again does
> nothing, since the token's already there. A condition that needs "this happened N times"
> needs **N distinct events**, each with its own token, all feeding the same field — not one
> event reused with a fixed token.

> **`facts` is reserved.** The AI has a separate mechanism for appending short freeform notes
> to a file's `facts` array (see `WIKI_FACTS_UPGRADE.md`) — don't reuse that name as a
> fold-map field here; `validateChapterSpec` will reject the spec.

## Step 4 — The conditions

Write each beat's "advances when…" as a plain check over those fields:

- **A1 advances when:** `<e.g. rooms_examined has ≥ 2 entries AND has_clue is true>`
- **A2 advances when:** `<…>`

## Step 5 — The beat notes

For each beat, a short **director's note**: who's there, the mood, the inciting event. Not
verbatim prose — guidance for the AI narrating that beat.

- **A1 note:** `<…>`
- **A2 note:** `<…>`

> 📖 Two easy-to-miss rules (see ADDING_CHAPTERS.md's "Keeping the scene pinned"):
> 1. **Always name the location**, even if unchanged from the last beat — *"Still at the
>    beach…"* — don't assume the AI will infer it.
> 2. **Always say what hasn't happened yet.** The AI sees your whole chapter overview
>    (Step 6) every turn, even while an early beat is active — without a reminder, it can
>    narrate straight into a later beat's events before the player has actually earned them.

## Step 6 — The chapter overview + guardrails

One short paragraph naming the arc, plus this chapter's "never do" list.

- **Overview:** `<…>`
- **Never do:** `<e.g. "don't reveal X yet," "keep character Y's decision unresolved">`

> 📖 This becomes the `fragment` — shown to the AI every turn alongside the active beat's
> note. Keep the overview to the overall shape and stakes; don't spell out each beat's
> concrete events so plainly that the AI mistakes the summary for things already in progress.

## Step 7 — The opening

The turn-0 opening prose (what the player reads before their first action), plus 3–4 starter
action suggestions.

- **Opening prose:** `<…>`
- **Starter actions:** `<…>`, `<…>`, `<…>`

> 📖 v1 of the authoring tool has one shared opening for every character. Want per-character
> openings like Chapter 1's six? That needs the manual path — see Step 9.

## Step 8 — Titles

- **Chapter number:** `<N>`
- **Chapter title:** `<…>`
- **Beat titles:** A1 `<…>`, A2 `<…>`, … *(used in the header + recap)*

## Step 9 — Hand it off

**Easiest:** paste this filled-in template straight into the authoring tool's Brief stage —
same plain-language design; the tool expands and saves it for you.

**Manual** — only if you need something the tool's v1 doesn't do (per-character openings, or a
hand-committed, code-reviewed chapter rather than a database-stored one): ask an AI to turn this
into a `ChapterSpec` module. See the shape below.

---

## If going manual: the `ChapterSpec` module

> 📖 This is the *only* shape the engine actually reads — everything above is the same design
> in plain language. `defineChapter()` builds the rest (fold-map, anchor order, scratch-field
> seeding) from this one spec, so there's nothing else to keep in sync by hand.

```ts
// server/src/chapters/chapterN.ts
import { defineChapter, type ChapterSpec } from './defineChapter.js'

const SPEC: ChapterSpec = {
  number: <N>,
  title: '<…>',
  fragment: `<the Step 6 overview + guardrails, as one block>`,

  anchors: [
    {
      id: 'A1',
      title: '<Step 8 beat title>',
      note: `<Step 5 beat note — director's guidance, location named, nothing later spoiled>`,
      advanceWhen: [
        { field: '<field>', op: 'flag', hint: '<plain nudge if this is what is blocking>' },
        // or: { field: '<field>', op: 'count_gte', value: <N>, hint: '<…>' },
      ],
    },
    // … A2, A3, …
  ],

  events: [
    // fold.token present => pushes onto an array field; absent => sets a boolean field true.
    { token: '<event_token>', anchor: 'A1', fold: { field: '<field>' } },
    { token: '<event_token>', anchor: 'A1', fold: { field: '<field>', token: '<distinct_value>' } },
  ],

  opening: {
    prose: `<Step 7 opening prose, verbatim, immersive second person>`,
    actions: ['<starter action 1>', '<starter action 2>', '<starter action 3>'],
  },

  softLockThreshold: 5, // optional; turns without progress before a gentle in-world nudge

  // optional — mark this as the final chapter of the story; defaults false
  isFinal: false,

  // optional — author-written closing prose (only meaningful when isFinal is true)
  epilogue: '<…>',

  // optional — author-written thank-you / credits (independent of epilogue)
  acknowledgment: '<…>',

  // optional — durable facts to write into world-state.md when this chapter ENDS (see below)
  endState: [
    { field: 'chapterend_<name>', op: 'set', value: true },
  ],
}

export const CHAPTER_<N> = defineChapter(SPEC)
```

**Durable end-state — facts that outlive this chapter.** Use `endState` (shown above, optional)
for anything that should still be true in a *later* chapter — a relationship that changed for
good, a location that's now destroyed, a list that grows chapter over chapter. `'set'` replaces
a field's value outright; `'append'` adds to a list, creating it if it doesn't exist yet.
**Every endState field name must start with `chapterend_`** — this is enforced (both the
authoring tool and `validateChapterSpec` reject a field that doesn't), and it's what keeps a
durable fact from getting deleted the moment this chapter ends (scratch fields are cleared on
every transition; `chapterend_`-prefixed ones never are). If two different chapters use the same
field name with different ops, saving either one is blocked — reuse the exact name only when you
mean to keep adding to the same fact.

> 📖 This works the same way whether you go manual or use the authoring tool — the tool's
> Review stage has its own "Durable end-state" section for exactly this. Chapter 1 instead bolts
> a hand-written function straight onto the `Chapter` object (`endState: (wiki) => {...}`) — an
> older, equivalent form still available on the manual path. See
> `server/src/chapters/chapter1.ts` or
> `server/src/chapters/chapter1.ts` for a worked example.

Then register it in `server/src/chapters/index.ts`'s `BUILTINS`, and **play it end to end** —
finish the prior chapter, hit Continue, and confirm your new beats gate in order.

---

*Worked example: `server/src/chapters/chapter1.ts`. Full how-to:
[ADDING_CHAPTERS.md](ADDING_CHAPTERS.md). Same recipe for a brand-new game:
[FORK_GUIDE.md](FORK_GUIDE.md) §5.*
