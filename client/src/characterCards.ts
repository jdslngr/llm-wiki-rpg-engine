// Static card data for the character select screen. One entry per playable character.
// Emoji + name + position + personality summary + gear — no "knows secret" badge.

export type CharacterCard = {
  id: string
  emoji: string
  name: string
  position: string
  summary: string
  gear: string
}

export const CHARACTER_CARDS: CharacterCard[] = [
  {
    id: 'visitor',
    emoji: '🌌',
    name: 'Visitor',
    position: 'A modern human, transported into 100,000 BCE',
    summary:
      'You are a modern human pulled into a world a hundred thousand years before your own — you tower over the four-foot gnomes and the small-bodied local humans, practically a giant. You carry knowledge of a world that will not exist for a hundred millennia, and no one — including you — knows how you came to be here.',
    gear: 'Phone with no signal, modern clothes, a head full of future-knowledge',
  },
  {
    id: 'kaspen',
    emoji: '⚓',
    name: 'Kaspen',
    position: 'Captain of the Archipelago Lighthouse Cleanup Crew',
    summary:
      'A near-immortal Earth-Gnome mage of Inscription and Divination — visionary, dry-witted, quick to deflect sentiment before quietly doing the caring thing. You and Kaelen alone carry a secret: the Humming Spires, a hidden defiance of the Protocol meant to seed the Gnomes\' legacy into humanity.',
    gear: 'Inscription stylus, divination lens, captain\'s log',
  },
  {
    id: 'kaelen',
    emoji: '🛡️',
    name: 'Kaelen',
    position: 'Vice-Captain & Mage',
    summary:
      "Master of Warding and Concealment, and Kaspen's partner and emotional counterweight. Steady, warm, funny, teasing — you show care through competence. You hide the Spires from Vane's deep-scans and repair the failing wards. You go quiet just before something goes wrong.",
    gear: 'Warding kit, concealment charms, repair tools',
  },
  {
    id: 'pan',
    emoji: '🏹',
    name: 'Pan',
    position: 'Scout · Homo luzonensis, age 17',
    summary:
      "The crew's bridge to the local human tribes — curious, adaptable, strong, endlessly hungry, and learning magic fast. You do not yet know the crew's secret. You are quietly torn: the mission preserves humanity's legacy, but your own tribe IS that humanity.",
    gear: 'Short bow, hunting knife, foraging satchel',
  },
  {
    id: 'tariel',
    emoji: '⚔️',
    name: 'Tariel',
    position: 'Vanguard',
    summary:
      "A veteran swordswoman-mage and the crew's frontline — disciplined, principled, samurai-like; ruthless in battle, dryly deadpan otherwise. You weigh everything against your code and found this mission sound. You know the secret.",
    gear: 'Longsword, vambraces, tactical harness',
  },
  {
    id: 'rulan',
    emoji: '💣',
    name: 'Rulan',
    position: 'Decommissioner',
    summary:
      'Gruff, blunt, and gleefully fond of explosives — you bring down Gnomish structures with flair and love to cook with Pan. You say exactly what you think. You know the secret.',
    gear: 'Demolition charges, fuse kit, iron skillet',
  },
]
