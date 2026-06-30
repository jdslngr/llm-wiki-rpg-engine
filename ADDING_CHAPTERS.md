# Guide to Adding New Chapters

*For the author. Plain-language. This is about extending **this** game with Chapter 2, 3, …
— same world and cast, more story. (Building a whole different game instead? That's
[FORK_GUIDE.md](FORK_GUIDE.md).)*

---

## The big picture (read this first)

A **chapter** is one self-contained arc of the story. It's made of **beats** (the code
calls them "anchors") — the handful of must-happen moments, in order — plus the rules that
decide when each beat is "done" and the scene moves on. Chapter 1 already exists and is your
template.

Adding a chapter is **the repeatable creative work** of authoring it — the engine already
handles holding many chapters and moving from one to the next, with nothing left for you to
build there. **The easiest way is the in-app authoring tool** (admin-only): sketch the beats
in plain language, an AI expands them, you review/edit, and saving makes the chapter live
immediately — no coding, no file, no redeploy. A manual hand-write-with-AI-help path also
exists below, for cases the tool doesn't cover yet (see §"Using the authoring tool").

> **Status today:** the multi-chapter engine is live, and so is the authoring tool. The game
> plays a chapter, shows its recap, and a **"Continue to Chapter N"** button starts the next
> chapter (durable state carries over; per-chapter trackers reset). **The authoring tool
> produces Chapter 2 onward** — Chapter 1 is the only reserved, hand-written built-in. When
> there is no next chapter authored yet, the recap shows an "end of story" state instead of
> a Continue button.

---

## How a chapter works (the mental model)

Every turn, the engine does this (no AI deciding the plot — that's the whole trick):

1. The AI narrates and **reports what happened** using a small fixed list of **events**
   (e.g. `boarded_ship`, `spoke_to_pan`).
2. The engine **folds** each event into a **state field** (e.g. `ship_areas_explored += farm`).
3. The engine checks the **current beat's conditions** (e.g. "explored at least 2 areas").
4. If they're met → **advance to the next beat**, and the new scene opens itself.

So a chapter is really just four lists that line up:
**events** → **fold-map** (event → field) → **state fields** → **conditions** (field checks
that advance the beat). Get those four consistent and the chapter plays itself.

---

## Authoring a new chapter (the repeatable creative work)

This is the fun part, and the part you own. There are two ways to do it — **use the tool**
(recommended; covers most chapters) or **go manual** (for the cases the tool's v1 doesn't
cover yet). Both end up at the same place: a chapter the engine can run.

### Using the authoring tool (recommended)

1. Log in as an admin (your username must be listed in the server's `ADMIN_USERNAMES` env
   var) and open **"✎ Author a chapter"** from Your Stories.
2. **Brief:** pick a chapter number (2 or higher), a title, and list your beats — for each,
   a short title, what happens, and a plain-language sentence for when it advances (e.g.
   *"once they've explored at least two rooms and found a clue"*). Optionally add guardrails
   and an opening direction.
3. Click **Expand with AI** — it drafts the full chapter: events, fold-map, per-beat
   conditions (with hints), beat notes, the chapter fragment, and opening prose, all from the
   world bible plus the engine's rules.
4. **Review:** every field is editable — fix wording, add/remove a condition, retarget an
   event, tweak the opening, or adjust **Stall turns** (how many turns without progress before
   the engine nudges the player; 1–20, default 5 — lower for tense beats, higher for slow
   exploration). Not happy with the shape? Type a revision note under "Re-expand with notes"
   and run it again. **Check that every beat's note names its location explicitly** — the
   AI-expanded draft doesn't always do this consistently, and an unanchored beat can drift
   toward a place from later in the chapter (see "Keeping the scene pinned" below).
5. **Save chapter (go live).** The tool validates the golden rule first (every condition
   field must be fed by some event, etc.) and lists any problems instead of saving if it
   finds one. Once it saves, **the chapter is playable immediately** — no rebuild, no
   redeploy. It also appears in the chapter list below the editor, with Edit and Delete.

**Know before you use it:**
- **It only produces Chapter 2 onward.** Chapter 1 is a reserved, hand-written built-in; the
  tool refuses to overwrite it (you'll get a clear error if you try).
- **Saving or deleting affects every player immediately**, including anyone mid-playthrough
  on that chapter — there's no migration for someone already partway through the old shape.
  Avoid editing or deleting a chapter that currently has active players.
- **v1 has one shared opening**, not six per-character ones like Chapter 1. If you want that
  level of polish, see the manual path below.

### Going manual (when the tool doesn't cover it)

Reach for this if you want per-character openings, hand control over every line, or you're
editing the engine itself rather than authoring through it. Design first, in plain language;
an AI fills in the code file afterward. There's a blank scaffold for the design step:
**[Chapter_Template.md](Chapter_Template.md)** — and Chapter 1's worked version
(`server/src/chapters/chapter1.ts`) to copy from.

### Step 1 — Design the beats (anchors)
List the **4–8 must-happen moments** of the chapter, in order. For each, write one sentence:
what happens, and **what has to be true for the story to move on** (its condition).

> Example beat: *"B1 — Scout the facility. The crew explores the abandoned site. Advances
> once they've examined at least two rooms AND found the first clue."*

### Step 2 — Pick the events
For each condition, decide the **events** the AI is allowed to report — the small, closed
vocabulary. Keep them concrete and countable.

> *examined_room, found_clue, spoke_to_pan, triggered_trap …*

### Step 3 — The fold-map (event → field)
Say how each event updates the save:
- "happened at least once" → a **true/false** field (`found_clue → has_clue = true`)
- "collect a set" → an **array** field that accumulates (`examined_room → rooms_examined += <room>`)

> In the authoring tool's Review stage, this choice shows up per-event as **"array item
> (optional)"**, next to the field name. Leave it blank for a flag; fill it in (often just
> the event's own token) to make that field an accumulating array instead.

> **Watch out — that array is a deduplicated set, not a counter.** If one event always writes
> the *same* literal token (e.g. `question_or_answer → interactions += "question_or_answer"`),
> it can only ever contribute ONE entry to the array — firing it again does nothing, since the
> token's already there. A `count_gte` condition built on a single constant-token event can
> never be satisfied past 1, which soft-locks the beat for good. If the beat needs "this kind
> of thing to happen N times," give each occurrence its **own event with its own distinct
> token** (e.g. three separate events for three sub-topics, all feeding the same field) instead
> of one event reused with a fixed token.

> **`facts` is a reserved field name.** The AI can separately append short, durable freeform
> notes to a file's `facts` array (see `WIKI_FACTS_UPGRADE.md`) — that's a different mechanism
> from this fold-map. Don't use `facts` as a fold-map field name for your own chapter;
> `validateChapterSpec` will reject the spec if you do.

### Step 4 — The conditions
Write each beat's "move on when…" as a plain check over those fields:
> *B1 advances when `rooms_examined` has ≥ 2 entries AND `has_clue` is true.*

### Step 5 — The beat notes
For each beat, write a short **director's note** — what the AI should make happen while that
beat is active (who's there, the mood, the inciting event, and **where** — name the location
even when it's unchanged from the beat before it; see "Keeping the scene pinned" below). Not
verbatim prose; guidance.

### Step 6 — The chapter overview + guardrails
A short paragraph naming the arc, plus this chapter's **"never do" list** (e.g. "don't reveal
X yet," "keep character Y's decision unresolved").

### Step 7 — The opening
Write the **turn-0 opening prose** for the chapter's first scene (what the player reads
before their first action), plus 3 starter action suggestions.

### Step 8 — Titles
The chapter number, title, and a short title for each beat (used in the header + recap).

### Step 9 — Hand it to an AI
The simplest route is to **paste your filled-in template straight into the authoring tool's
Brief stage** — same plain-language design, but the tool expands and saves it for you (see
above), and you keep the manual control of having written every beat yourself. Only write an
actual `chapterN.ts` file by hand if you need something the tool doesn't do (per-character
openings, or it's meant to be a hand-committed, code-reviewed
chapter rather than a database-stored one): ask an AI to *"Turn this into a chapter data
module using `defineChapter` from `server/src/chapters/defineChapter.ts`, implementing the
`ChapterSpec` shape, and register it in `chapters/index.ts`'s `BUILTINS`."* Then **play it
end to end** — finish the prior chapter, hit **Continue**, and confirm your new beats gate
in order.

---

## The golden rule (this is how you avoid a stuck game)

**Your events, fold-map, fields, and conditions must line up.** If a condition checks a field
that no event ever sets, that beat can *never* advance — the player gets stuck. Quick check
before you ship a chapter:

- Every field a **condition** reads is set by some entry in the **fold-map**.
- Every event in the **fold-map** is in the chapter's **events list**.
- Every field starts with a seeded value (arrays start `[]`, flags start `false`).

(The engine also has an **anti-soft-lock valve** — if the player stalls for several turns it
gently nudges them toward the missing beat — but correct wiring is what truly prevents a
dead end. If you're using the authoring tool, it runs exactly this check before letting you
save, and lists any violation by name — you can't accidentally ship a soft-lock through it.)

---

## Keeping the scene pinned (avoiding location drift)

The engine has no separate "where is the player right now" field — it relies entirely on
each beat's **note** to say where the scene is. Every turn, the AI sees the **whole chapter
overview** (your guardrails block) alongside only the active beat's note — which means it
already knows about places later beats will visit, even while an early beat is still playing
out. If a beat's note doesn't say where it's set, the AI can drift toward a place mentioned
later in the overview, within the SAME chapter.

(Drifting back toward an *earlier chapter's* setting is no longer the risk it once was: the
model's conversation view is windowed per-chapter — a finished chapter's raw turns drop out of
the prompt entirely, replaced by a short `chapter-log.md` summary. The same-chapter drift below is
unrelated to that and still very much a live concern.)

**The fix: name the location in every beat's note, even when it hasn't changed.**
- Same place as the last beat? Say so anyway — *"Still at the beach, the crew gathers..."*
- New place? Open the note with it, plainly — *"They board the ship, grimy and drained..."*
- Don't rely on the AI inferring location from history or from the previous beat's note;
  restate it fresh, every beat.

> Real-world example: a beat note that only said *"The crew processes the news and asks
> questions; the mood is heavy"* — no location — let the AI describe the player wandering
> into a room from a much later beat, while they were still supposed to be on the beach
> where the scene started. Opening the note with *"Still at the beach where the last scene
> ended — no one has gone anywhere yet"* fixed it.

This matters more for AI-expanded chapters than for Chapter 1: the authoring tool's overview
tends to summarize the **entire arc** up front (so the AI can hold all the beats together),
which previews later locations more eagerly than a hand-tuned chapter would.

---

## What carries over between chapters (continuity)

When a chapter ends, the consolidation pass (`server/src/consolidate.ts`) keeps the story
coherent without letting the save bloat:

- **Durable facts persist** — relationship/trust scores, and story flags you want to echo
  later, written via a chapter's `endState(wiki)` hook (Chapter 1 sets `vow_made: true` this
  way). A later chapter's conditions or prose can reference these, so **choices in Chapter 1
  can pay off in Chapter 3** with no extra plumbing.
- **End-state facts are now authorable in the tool** — the "Durable end-state" section in the
  review stage lets you add `set`/`append` ops that write permanent facts when the chapter
  ends. Every field name **must** start with `chapterend_` (this keeps them from colliding
  with scratch fields). The tool checks for conflicts across chapters: if two chapters use
  the same field name with different ops, the save is blocked with a clear message. Same
  name + same op = accreting fact (e.g. a list built up across multiple chapters).
- **AI-authored `facts` don't carry over the same way.** Those are the AI's own freeform
  memory notes (`fact_additions`, see `WIKI_FACTS_UPGRADE.md`) — a different mechanism from
  `endState`'s durable facts above, despite the shared name. They're capped per file and
  cleared at every chapter transition; whatever's still live gets folded into that chapter's
  recap prose first (`WIKI_FACTS_FOLD_UPGRADE.md`), but only as paraphrased prose baked into
  `chapter-log.md` — not as a raw value your next chapter's conditions or prose can query. If
  you need something from an earlier chapter to be reliably referenceable later, that's what
  `endState` is for, not `fact_additions`.
- **Spent scratch fields reset** — per-chapter trackers like `zones_visited` are cleared at
  chapter end so they don't pile up forever.
- **Open threads carry forward** — unresolved plot flags (e.g. "Vane confrontation pending")
  move into the next chapter to be picked up.

So to make a callback, just **read a durable field** in the new chapter's conditions or beat
notes. To start fresh trackers, **seed new scratch fields** for the new chapter.

---

## A tiny worked example — Chapter 2 sketch

To make it concrete, here's a 3-beat Chapter 2, "The Abandoned Facility," in design terms:

| Beat | What happens | Advances when |
|---|---|---|
| **B1 — Approach** | The crew lands and studies the silent facility from outside | `observed_exterior` is true |
| **B2 — Inside** | They enter and explore; old wild-magic stirs | `rooms_explored` has ≥ 2 AND `found_artifact` is true |
| **B3 — The find** | They recover the artifact and decide what it means | `artifact_secured` is true AND `crew_weighed_in` is true |

Events: `observed_exterior, explored_room, found_artifact, secured_artifact, spoke_to_<crew>,
crew_weighed_in`.
Fold-map: `explored_room → rooms_explored += <room>`; `found_artifact → found_artifact = true`;
`secured_artifact → artifact_secured = true`; etc.
That's it — flesh out the prose and beat notes and you have a chapter.

---

## Who does what (so you're not stuck waiting on code)

| Task | You (author) | The tool / AI |
|---|---|---|
| Design beats + conditions (plain language) | ✅ | — |
| Expand into events/fold-map/conditions/prose | — | ✅ (the authoring tool's AI step) |
| Review, edit, validate | ✅ | tool checks the golden rule |
| Save → live (or hand-write `chapterN.ts` for the manual path) | — | ✅ |
| Play-test & tweak the feel | ✅ | — |

**You design the story; the tool (an AI under the hood) handles the data module.** With the
authoring tool, you never touch a file or the registry at all.

---

## Checklist for shipping a new chapter

**Using the authoring tool:**
```
[ ] Logged in as an admin (ADMIN_USERNAMES)
[ ] Sketched beats + plain conditions in the Brief stage; chapter number is 2 or higher
[ ] Expanded with AI, reviewed/edited the draft, re-expanded with notes if needed
[ ] Each beat's note names the current location, even when unchanged from the beat before it
[ ] No active players currently mid-playthrough on this chapter number (if editing one)
[ ] Saved — the tool's validator passed with no problems, and it's live
[ ] Played the chapter start → end: beats advance in order, nothing soft-locks, the feel is right
[ ] Recap still works at chapter end
```

**Going manual:**
```
[ ] Filled in Chapter_Template.md: beats, conditions, events, fold-map, beat notes, guardrails
[ ] Each beat's note names the current location, even when unchanged from the beat before it
[ ] Wrote the chapter's opening prose + 3 starter actions (per character, if you want that)
[ ] An AI produced chapters/chapterN.ts (via defineChapter) from the design; registered it
[ ] Golden-rule check: every condition field is fed by an event; every event is in the list;
    every field is seeded
[ ] Decided what carries over (durable fields/threads) and what resets (scratch fields)
[ ] Played the chapter start → end: beats advance in order, nothing soft-locks, the feel is right
[ ] Recap still works at chapter end
```

---

*Related: [Chapter_Template.md](Chapter_Template.md) (the design scaffold) ·
`server/src/chapters/chapter1.ts` (worked example) ·
[FORK_GUIDE.md](FORK_GUIDE.md) §5 (the same recipe, for a brand-new game).*
