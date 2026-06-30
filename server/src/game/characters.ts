import type { WikiFile, WikiMap } from "../types.js";
import { getChapter } from "../chapters/index.js";

// SERVER-SIDE single source of truth for the playable characters (Phase 2 moved
// state ownership to the server). Drives the POV framing in the prompt AND seeds
// player-character.md + the relationship files. The client renders the dossier it
// receives from /api/new-game | /api/state, so this file no longer has a browser twin.

export type PlayableId =
  | "kaspen"
  | "kaelen"
  | "pan"
  | "tariel"
  | "rulan"
  | "visitor";

export type CharacterDossier = {
  id: PlayableId;
  name: string;
  role: string;
  /** The crew member you ARE (also the token dropped from spoke_to_*). null = the Visitor. */
  crewId: string | null;
  knowsSecret: boolean;
  knowsLabel: string;
  /** Shown on the dossier card AND seeded into player-character.md so the AI sees it too. */
  dossier: string;
  /** One-line POV label used in the system prompt's POV framing. */
  povLabel: string;
};

export const CHARACTERS: Record<PlayableId, CharacterDossier> = {
  kaspen: {
    id: "kaspen",
    name: "Kaspen",
    role: "Captain of the Archipelago Lighthouse Cleanup Crew",
    crewId: "kaspen",
    knowsSecret: true,
    knowsLabel: "You carry the secret.",
    dossier:
      "A near-immortal Earth-Gnome mage of Inscription and Divination — visionary, dry-witted, quick to deflect sentiment before quietly doing the caring thing. You and your partner Kaelen alone carry a secret: the Humming Spires, a hidden defiance of the Protocol meant to seed the Gnomes' legacy into humanity. You dread being forgotten.",
    povLabel:
      "KASPEN — the crew's captain and the secret-keeper of the Humming Spires",
  },
  kaelen: {
    id: "kaelen",
    name: "Kaelen",
    role: "Vice-Captain & Mage",
    crewId: "kaelen",
    knowsSecret: true,
    knowsLabel: "You carry the secret.",
    dossier:
      "Master of Warding and Concealment, and Kaspen's partner and emotional counterweight. Steady, warm, funny, teasing; you show care through competence. You hide the Spires from Vane's deep-scans and repair the failing wards — the secret is yours too. You go quiet just before something goes wrong.",
    povLabel:
      "KAELEN — vice-captain, master of warding & concealment, Kaspen's partner",
  },
  pan: {
    id: "pan",
    name: "Pan",
    role: "Scout · Homo luzonensis, age 17",
    crewId: "pan",
    knowsSecret: false,
    knowsLabel: "You don't know the crew's secret — yet.",
    dossier:
      "The crew's bridge to the local human tribes — curious, adaptable, strong, endlessly hungry, and learning magic fast. You do not know the crew's secret. You are quietly torn: the mission preserves humanity's legacy, but your own tribe IS that humanity, and leaving Earth means leaving them.",
    povLabel:
      "PAN — a 17-year-old Homo luzonensis scout, the crew's bridge to the local humans",
  },
  tariel: {
    id: "tariel",
    name: "Tariel",
    role: "Vanguard",
    crewId: "tariel",
    knowsSecret: true,
    knowsLabel: "You carry the secret.",
    dossier:
      "A veteran swordswoman-mage and the crew's frontline — disciplined, principled, samurai-like; ruthless in battle, dryly deadpan otherwise. You weigh everything against your code and find this mission sound. You know the secret.",
    povLabel:
      "TARIEL — the crew's vanguard, a disciplined veteran swordswoman-mage",
  },
  rulan: {
    id: "rulan",
    name: "Rulan",
    role: "Decommissioner",
    crewId: "rulan",
    knowsSecret: true,
    knowsLabel: "You carry the secret.",
    dossier:
      "Gruff, blunt, and gleefully fond of explosives — you bring down Gnomish structures with flair and love to cook with Pan. You say exactly what you think. You know the secret.",
    povLabel:
      "RULAN — the decommissioner, blunt and gleefully fond of explosives",
  },
  visitor: {
    id: "visitor",
    name: "the Visitor",
    role: "A modern human, transported",
    crewId: null,
    knowsSecret: false,
    knowsLabel: "You don't know the crew's secret — yet.",
    dossier:
      "A modern human pulled into 100,000 BCE — you tower over the four-foot gnomes and the small-bodied local humans, practically a giant. You carry knowledge of a world that will not exist for a hundred thousand years, and no one — including you — knows how you came to be here. You are an outsider the crew folds in.",
    povLabel:
      "a modern human just transported into 100,000 BCE, to whom this world is utterly new",
  },
};

export function isPlayableId(id: string): id is PlayableId {
  return id in CHARACTERS;
}

/** Build the player-character.md wiki file for the chosen character. */
function playerCharacterFile(id: PlayableId, visitorName?: string): WikiFile {
  const c = CHARACTERS[id];
  if (id === "visitor" && visitorName && visitorName.trim()) {
    const name = visitorName.trim();
    return {
      frontmatter: {
        name,
        role: "A modern human, transported",
        knows_secret: c.knowsSecret,
      },
      body: `A modern human named ${name}, pulled into 100,000 BCE — you tower over the four-foot gnomes and the small-bodied local humans, practically a giant. You carry knowledge of a world that will not exist for a hundred thousand years, and no one — including you — knows how you came to be here. You are an outsider the crew folds in.`,
    };
  }
  return {
    frontmatter: { name: c.name, role: c.role, knows_secret: c.knowsSecret },
    body: c.dossier,
  };
}

// Relationship-file content for each crew member, as seen by the rest of the crew.
// buildStarterWiki loads every crew member's file EXCEPT the one the player is.
const CREW_RELATIONSHIPS: Record<string, WikiFile> = {
  kaspen: {
    frontmatter: {
      trust_score: 80,
      arc_status: "open",
      knows_about_spires: true,
    },
    body: "The crew's captain — near-immortal, visionary, dry-witted; deflects sentiment then quietly does the caring thing. Carries a secret he shares only with Kaelen.",
  },
  kaelen: {
    frontmatter: {
      trust_score: 90,
      arc_status: "open",
      knows_about_spires: true,
    },
    body: "Vice-captain and Kaspen's partner; master of warding and concealment, who hides the Spires from Vane. Steady, warm, teasing. Shares the secret.",
  },
  pan: {
    frontmatter: {
      trust_score: 60,
      arc_status: "open",
      knows_about_spires: false,
    },
    body: "The 17-year-old Homo luzonensis scout, the crew's bridge to the local humans. Curious, hungry, learning magic fast. Does not know the secret.",
  },
  tariel: {
    frontmatter: {
      trust_score: 70,
      arc_status: "open",
      knows_about_spires: true,
    },
    body: "The crew's vanguard — a disciplined veteran swordswoman-mage, dryly deadpan. Principled; weighs everything against her code.",
  },
  rulan: {
    frontmatter: {
      trust_score: 70,
      arc_status: "open",
      knows_about_spires: true,
    },
    body: "The decommissioner — gruff, blunt, gleefully fond of explosives, loves to cook with Pan. Says exactly what she thinks.",
  },
};

// The world-state.md seed: the ENGINE fields (chapter/anchor/soft-lock counter) plus the
// active chapter's scratch condition fields (seeded by the chapter, not hardcoded here).
// The engine derives the scratch fields from reported events; the AI must not write them
// directly. turns_since_progress drives the anti-soft-lock valve.
function worldStateSeed(): WikiFile {
  const ch = getChapter(1);
  return {
    frontmatter: {
      current_chapter: 1,
      current_anchor: ch.firstAnchor,
      turns_since_progress: 0,
      chapter_history_start: 0,
      ...ch.scratchSeed(),
    },
    body: "A dry-season morning at the Archipelago Lighthouse. No Spire has been planted yet. Vane has not yet made contact.",
  };
}

// Build the starter wiki for a new playthrough. Seeds player-character.md from the
// chosen character's dossier, and loads every crew member's relationship file
// EXCEPT your own (you don't track a relationship to yourself; the Visitor, with no
// crewId, gets all five).
export function buildStarterWiki(
  id: PlayableId,
  visitorName?: string,
): WikiMap {
  const wiki: WikiMap = {
    "world-state.md": worldStateSeed(),
    "player-character.md": playerCharacterFile(id, visitorName),
  };
  const ownCrewId = CHARACTERS[id].crewId;
  for (const crew of ["kaspen", "kaelen", "pan", "tariel", "rulan"] as const) {
    if (crew === ownCrewId) continue;
    wiki[`${crew}.md`] = structuredClone(CREW_RELATIONSHIPS[crew]);
  }
  return wiki;
}
