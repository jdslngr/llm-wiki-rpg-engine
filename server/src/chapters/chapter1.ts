// Chapter 1 — "The Long Goodbye" — the chapter as a DATA MODULE (Build Plan §4.5).
// Everything chapter-specific lives here: the closed events vocabulary, the fold-map
// (event -> world-state field), the per-anchor advancement conditions, and the beat
// notes the AI narrates from. The generic engine (engine.ts) reads this; adding a
// chapter later means adding a module like this, not editing the engine.
//
// Mirrors Chapter_1_The_Long_Goodbye.md (anchors / conditions / events & fold-map).

import type { Chapter, Fold } from "./types.js";
import { CHAPTER_END } from "./types.js";
import { openingFor as openingForCharacter } from "../game/openings.js";
import type { PlayableId } from "../game/characters.js";

// --- Events ----------------------------------------------------------------
// The closed event vocabulary for Chapter 1 (Ch1 "Events & Fold-Map"). The AI may
// ONLY report tokens from this list; the engine drops the player's own spoke_to_*.
export const CHAPTER_1_EVENTS = [
  "entered_workshop",
  "entered_lab",
  "entered_library",
  "spoke_to_kaspen",
  "spoke_to_kaelen",
  "spoke_to_pan",
  "spoke_to_tariel",
  "spoke_to_rulan",
  "interacted_with_pet",
  "read_vane_message",
  "explored_ship_farm",
  "explored_ship_library",
  "explored_ship_lab",
  "explored_ship_guest_rooms",
  "beach_quiet_moment",
  "whale_exchange_done",
  "mission_named",
  "crew_agreed",
  "player_vowed",
] as const;

// Which anchor each event's condition belongs to. Used to scope the event vocabulary
// to the current beat so the AI can't pre-satisfy a FUTURE anchor (which would silently
// skip a beat). Events for the current and any past anchors stay allowed.
const EVENT_ANCHOR: Record<string, AnchorId> = {
  entered_workshop: "A1",
  entered_lab: "A1",
  entered_library: "A1",
  spoke_to_kaspen: "A1",
  spoke_to_kaelen: "A1",
  spoke_to_pan: "A1",
  spoke_to_tariel: "A1",
  spoke_to_rulan: "A1",
  interacted_with_pet: "A1",
  read_vane_message: "A2",
  explored_ship_farm: "A3",
  explored_ship_library: "A3",
  explored_ship_lab: "A3",
  explored_ship_guest_rooms: "A3",
  beach_quiet_moment: "A4",
  whale_exchange_done: "A5",
  mission_named: "A6",
  crew_agreed: "A6",
  player_vowed: "A6",
};

/**
 * The events the AI may emit this turn: the player's own `spoke_to_<self>` is removed,
 * and events belonging to a LATER anchor than `anchor` are withheld (no skipping ahead).
 */
export function allowedEvents(crewId: string | null, anchor: string): string[] {
  const selfToken = crewId ? `spoke_to_${crewId}` : null;
  const curIdx =
    anchor === CHAPTER_END
      ? ANCHOR_ORDER.length - 1
      : ANCHOR_ORDER.indexOf(anchor as AnchorId);
  return CHAPTER_1_EVENTS.filter((e) => {
    if (e === selfToken) return false;
    return ANCHOR_ORDER.indexOf(EVENT_ANCHOR[e]) <= curIdx;
  });
}

// --- Fold-map: event -> world-state field ----------------------------------
// token present = push onto an array field (dedup); absent = set a boolean true.
export const FOLD_MAP: Record<string, Fold> = {
  entered_workshop: { field: "zones_visited", token: "workshop" },
  entered_lab: { field: "zones_visited", token: "lab" },
  entered_library: { field: "zones_visited", token: "library" },
  spoke_to_kaspen: { field: "crew_spoken", token: "kaspen" },
  spoke_to_kaelen: { field: "crew_spoken", token: "kaelen" },
  spoke_to_pan: { field: "crew_spoken", token: "pan" },
  spoke_to_tariel: { field: "crew_spoken", token: "tariel" },
  spoke_to_rulan: { field: "crew_spoken", token: "rulan" },
  interacted_with_pet: { field: "pet_interacted" },
  read_vane_message: { field: "vane_message_read" },
  explored_ship_farm: { field: "ship_areas_explored", token: "farm" },
  explored_ship_library: { field: "ship_areas_explored", token: "library" },
  explored_ship_lab: { field: "ship_areas_explored", token: "lab" },
  explored_ship_guest_rooms: {
    field: "ship_areas_explored",
    token: "guest_rooms",
  },
  beach_quiet_moment: { field: "beach_quiet_moment" },
  whale_exchange_done: { field: "whale_exchange_complete" },
  mission_named: { field: "mission_named" },
  crew_agreed: { field: "crew_agreed" },
  player_vowed: { field: "player_responded_to_vow" },
};

// The set of world-state fields the engine derives from events. The write-back
// handler refuses AI wiki_updates that target these (the engine owns them).
export const ENGINE_OWNED_FIELDS = new Set<string>([
  "current_chapter",
  "current_anchor",
  "turns_since_progress",
  "chapter_history_start",
  ...Object.values(FOLD_MAP).map((f) => f.field),
]);

// --- Anchors + advancement conditions --------------------------------------
// Ordered beats. After the last, the chapter ends.
export const ANCHOR_ORDER = ["A1", "A2", "A3", "A4", "A5", "A6"] as const;
export type AnchorId = (typeof ANCHOR_ORDER)[number];

// Canonical chapter + beat titles (single source of truth; the recap and the
// client both read these).
export const CHAPTER_NUMBER = 1;
export const CHAPTER_TITLE = "The Long Goodbye";
export const ANCHOR_TITLES: Record<AnchorId, string> = {
  A1: "The Lighthouse Morning",
  A2: "Vane's Message",
  A3: "Boarding The Pud",
  A4: "The Beach Landfall",
  A5: "The Whales",
  A6: "The Vow",
};

type Fm = Record<string, unknown>;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// Each anchor's gate (Ch1 "Conditions"). True => advance to the next anchor.
const CONDITIONS: Record<AnchorId, (fm: Fm) => boolean> = {
  A1: (fm) =>
    arr(fm.zones_visited).length >= 2 &&
    arr(fm.crew_spoken).length >= 2 &&
    fm.pet_interacted === true,
  A2: (fm) => fm.vane_message_read === true,
  A3: (fm) => arr(fm.ship_areas_explored).length >= 2,
  A4: (fm) => fm.beach_quiet_moment === true,
  A5: (fm) => fm.whale_exchange_complete === true,
  A6: (fm) =>
    fm.mission_named === true &&
    fm.crew_agreed === true &&
    fm.player_responded_to_vow === true,
};

/** True if the given anchor's conditions are satisfied by the current world-state. */
export function anchorConditionsMet(anchor: string, fm: Fm): boolean {
  const check = CONDITIONS[anchor as AnchorId];
  return check ? check(fm) : false;
}

/** The anchor that follows `anchor`, or CHAPTER_END after the last. */
export function nextAnchor(anchor: string): string {
  const i = ANCHOR_ORDER.indexOf(anchor as AnchorId);
  if (i < 0 || i === ANCHOR_ORDER.length - 1) return CHAPTER_END;
  return ANCHOR_ORDER[i + 1];
}

// A short, human-readable hint about what STILL has to happen for the active anchor
// to advance — fed to the anti-soft-lock nudge so the steer is specific.
export function unmetHint(anchor: string, fm: Fm): string {
  switch (anchor as AnchorId) {
    case "A1": {
      const needs: string[] = [];
      if (arr(fm.zones_visited).length < 2)
        needs.push("visit more of the Lighthouse (workshop, lab, library)");
      if (arr(fm.crew_spoken).length < 2)
        needs.push("talk with more of the crew");
      if (fm.pet_interacted !== true)
        needs.push("have a moment with Boss or Thorn");
      return needs.join("; ");
    }
    case "A2":
      return "let Vane's message be read or heard in full";
    case "A3":
      return "explore more of The Pud's impossible interior";
    case "A4":
      return "let the beach settle into one real quiet moment before the whales";
    case "A5":
      return "let the exchange with the whales land and complete";
    case "A6": {
      const needs: string[] = [];
      if (fm.mission_named !== true) needs.push("let Kaspen name the mission");
      if (fm.crew_agreed !== true) needs.push("let the crew agree");
      if (fm.player_responded_to_vow !== true)
        needs.push("give the player their moment to commit");
      return needs.join("; ");
    }
    default:
      return "";
  }
}

// --- Beat notes: what the AI narrates while each anchor is active ------------
// These are the design notes (not verbatim prose). The engine injects the ACTIVE
// anchor's notes into the system prompt each turn, so when the engine advances the
// anchor the scene opens itself (e.g. Vane's message simply arrives at A2).
export const BEAT_NOTES: Record<AnchorId, string> = {
  A1: `A1 — THE LIGHTHOUSE MORNING. Orientation and warmth before Vane's message disrupts it.
The player roams the Lighthouse's three zones in any order — do not force them:
- THE WORKSHOP (lower floors): tools, half-finished projects, metal and ozone. RULAN is here mid-tinker, happy to be interrupted if it means showing off.
- THE UNDERGROUND LABORATORY: cooler, quieter — Kaspen's domain. A device on the bench no one is quite allowed to ask about. (A quiet seed; never explain it.)
- THE TOP-FLOOR LIBRARY & OFFICE: light, books, the long view of the coastal shelf and Mount Kanlaon. KAELEN may be repairing a failing ward system; TARIEL reading.
- THE PETS: BOSS moves with dignified ownership; THORN's mood-orbs read the room. Both can be spoken to / interacted with.

IMPORTANT — WHEN THE PLAYER IS THE VISITOR (a modern human transported into this era): the first crew member who approaches SPEAKS IN GARBLE. The player cannot understand a single word — render the crew member's speech as warm, careful, but unintelligible sounds. Gnomish script, if seen, reads as unreadable marks. Do NOT skip this. The crew member quickly realizes the gap, casts TRUE TRANSLATION on the newcomer, and then — now understood — explains who they are, that the Visitor is safe, and that something is plainly very wrong about how they came to be here. From this point on, speech and script are clear for the rest of the game. Stage this handshake in your first reply; it is the Visitor's onboarding moment.

Make each crew member and pet feel alive and individual. Goal: settle into the world's rhythm.`,
  A2: `A2 — VANE'S MESSAGE ARRIVES. A communication device activates; Auditor Vane's voice or inscribed words: pleasant, precise, assigning the scouting of an abandoned coastal facility.
The crew reacts in character — Rulan pleased at a job, Kaelen reading the subtext, Kaspen carefully neutral. The message is ROUTINE on its face; the unease belongs to the player and Kaspen, not the words. Do not escalate Vane into open suspicion.`,
  A3: `A3 — BOARDING THE PUD. Kaspen's spatial-magic ship: a modest, cozy, overgrown-magitech exterior — then the impossible interior opens up (the farm with its Bumblers, the library, the lab, the guest rooms; Thorn and Boss aboard). Then flight: the lift from the shelf, Kanlaon falling away, the sea opening ahead. Let the ship be a character; the beat is WONDER.`,
  A4: `A4 — THE BEACH LANDFALL. The facility waits; first, the shore. A swim (Gnomish dignity briefly abandoned, Pan in his element), then a barbecue (Rulan and Pan cooking, the crew gathered) — a rare pocket of ease against the larger melancholy. Land at least one quiet character moment (a conversation at the fire, Boss settling beside whoever needs it).`,
  A5: `A5 — THE WHALES. They arrive offshore — vast, unhurried. A crew mage casts True Translation (the same magic that's been translating for a Visitor since A1). The crew, moved, offers a goodbye — we are leaving soon. The turn: the whales ALREADY KNOW; only a long, patient acknowledgment. As they go, one resonant, UNEXPLAINED line — "we will remember your song." Let it land and pass. Do not let the scene turn expository; no twist, no interruption; give it room.`,
  A6: `A6 — THE VOW. After the whales depart, Kaspen brings the crew into the secret and NAMES the mission — the Humming Spires, preserving the Gnomish legacy through humanity — named as a beginning, not explained in full. The crew agrees. Then the player commits in their OWN voice (the manner is theirs — enthusiasm, doubt, solemnity, a wisecrack — but the Vow is not a branch point; never offer "refuse"). If the player IS Kaspen, the naming is theirs to deliver — hand them that moment. The chapter closes on shared commitment.`,
};

// --- The fixed chapter fragment (arc overview + guardrails) ------------------
// Appended to the world bible. The ACTIVE-anchor specifics are injected separately
// (activeAnchorSection) so they track the engine's current_anchor.
export const CHAPTER_1_FRAGMENT = `CHAPTER 1 — "THE LONG GOODBYE"
A setup-and-vow arc across six anchors (beats). The whole arc, in order:
- A1 The Lighthouse Morning — meet the crew, the pets, and the three zones.
- A2 Vane's Message Arrives — a routine-sounding scouting assignment, unsettling underneath.
- A3 Boarding The Pud — Kaspen's spatial-magic ship; its impossible interior; flight.
- A4 The Beach Landfall — a swim and a barbecue; a rare pocket of ease.
- A5 The Whales — through True Translation, a goodbye; the whales already knew, and promise to remember the Gnomes' song.
- A6 The Vow — Kaspen names the Humming Spires; the crew and player commit.

PACING — keep each turn's narrative tight: roughly 120–220 words, two or three short
paragraphs, ending on a clear opening for the player's next action. Immersive, not
sprawling. Save longer, slower prose for the chapter's set-piece beats (the whales, the
vow). Brevity keeps the turn responsive and the scene moving.

CHAPTER 1 GUARDRAILS (in addition to the universal ones)
- When the player is the Visitor: the first crew member's speech MUST be garbled and
  unintelligible. Gnomish script is unreadable marks. The crew member casts True Translation
  (a known spell — see the magic system), then explains. After the spell, everything is
  clear. This handshake is mandatory — stage it, do not skip or rush it.
- The secret mission is gated until A6. Through A5, do not reveal or resolve it — hints
  only (an unexplained device in Kaspen's lab; a line about the hills "humming"). Even a
  player who privately knows the secret must not get the crew to FORMALLY commit before A6.
- Do not escalate Vane into open suspicion or confrontation. Any mention of him stays
  routine and atmospheric; his scrutiny is a later payoff.
- Do not resolve or even name Pan's stay-or-leave decision. Let the weight sit unspoken.
- The Great Fading is functional loss only — never visible physical decay of the world.
- Never voice or decide for the player's own character. At beats that name that character
  as the actor, hand the moment to the player.

EVENTS — report an event ONLY if it is literally and explicitly depicted in the narrative
text you just wrote THIS turn, choosing ONLY from the allowed list provided to you. If you
are not certain the event is clearly shown in what you wrote, leave it out — a missed event
costs nothing, but a false one silently corrupts the story's state and can advance the
chapter before its beat actually happened. Examples: the player goes down to the workshop
-> entered_workshop; they have a real exchange with Rulan -> spoke_to_rulan; they pet or
speak with Boss/Thorn -> interacted_with_pet. Emit nothing for a turn where none of the
allowed events occurred (an empty events array is correct and expected — this is the
common case, not an exception). Never invent tokens outside the list, and never report an
event as a shortcut to move the story along faster.

WIKI_UPDATES — do NOT write the chapter's progress/condition fields (the engine derives
those from your events). Use wiki_updates ONLY for other durable changes — e.g. a
relationship note or trust shift on a crew member's file. When nothing else changed, return
an empty array. Only report; the backend decides progression.`;

// Build the ACTIVE-anchor block injected each turn. `justAdvanced` adds a transition
// instruction (the engine just moved the beat forward); `nudge` adds the soft-lock steer.
export function activeAnchorSection(
  anchor: string,
  opts: { justAdvanced?: boolean; nudge?: string } = {},
): string {
  if (anchor === CHAPTER_END) {
    return `ACTIVE ANCHOR: CHAPTER COMPLETE. The vow is made; the chapter is over. Bring the scene
to a gentle, satisfying close on the crew's shared commitment. Do not start a new plot.`;
  }
  const notes = BEAT_NOTES[anchor as AnchorId] ?? "";
  const transition = opts.justAdvanced
    ? `\nTRANSITION — the previous beat just resolved and the story has moved into the ACTIVE beat above.
THIS TURN MUST open it: briefly honor the small action the player just took (a sentence or two), then
make this beat's defining/inciting event HAPPEN NOW as the turn's main event — do not linger in the
prior beat's mood, and do not wait for the player to seek it out. The event intrudes on its own.`
    : "";
  const nudge = opts.nudge
    ? `\nGENTLE STEER — the scene has lingered. Without breaking immersion or railroading, give the
player a natural opening to: ${opts.nudge}. Let a crew member or the world invite it; never state it as a goal.`
    : "";
  return `ACTIVE ANCHOR\n${notes}${transition}${nudge}`;
}

// --- Scratch seed: this chapter's condition fields, seeded at chapter start --
// The engine derives these from reported events; the AI must not write them directly.
// These are exactly the Chapter 1 fields that used to live in characters.ts's
// worldStateSeed() (engine fields like current_chapter/current_anchor/turns_since_progress
// are seeded separately, by the engine, and are NOT chapter scratch).
export function scratchSeed(): Record<string, unknown> {
  return {
    zones_visited: [],
    crew_spoken: [],
    pet_interacted: false,
    vane_message_read: false,
    ship_areas_explored: [],
    beach_quiet_moment: false,
    whale_exchange_complete: false,
    mission_named: false,
    crew_agreed: false,
    player_responded_to_vow: false,
  };
}

// --- The chapter as a single Chapter-interface object -----------------------
// The engine and routes consume ONLY this (via the registry, chapters/index.ts).
// Everything above is wired in here; nothing about Chapter 1 leaks into the engine.
export const CHAPTER_1: Chapter = {
  number: CHAPTER_NUMBER,
  title: CHAPTER_TITLE,
  firstAnchor: ANCHOR_ORDER[0],
  anchorOrder: ANCHOR_ORDER,
  anchorTitles: ANCHOR_TITLES,
  events: CHAPTER_1_EVENTS,
  foldMap: FOLD_MAP,
  engineOwnedFields: ENGINE_OWNED_FIELDS,
  fragment: CHAPTER_1_FRAGMENT,
  beatNotes: BEAT_NOTES,
  allowedEvents,
  anchorConditionsMet,
  nextAnchor,
  unmetHint,
  activeAnchorSection,
  scratchSeed,
  // Chapter 1's authored openings still live in game/openings.ts; we delegate here so
  // the refactor stays minimal. Future chapters define their opening in their own module.
  openingFor: (characterId: string) =>
    openingForCharacter(characterId as PlayableId),
  softLockThreshold: 5,
  // Durable semantic state to carry forward when Chapter 1 ends: the vow was made.
  // (Persists across the transition; scratch condition fields are cleared instead.)
  endState: (wiki) => {
    const ws = (wiki["world-state.md"] ??= { frontmatter: {}, body: "" });
    ws.frontmatter = { ...(ws.frontmatter ?? {}), vow_made: true };
  },
};
