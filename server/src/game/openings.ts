import type { PlayableId } from './characters.js'

// Authored A1 opening prose, shown VERBATIM at turn 0 (turn-0 is the AI's first
// message; the AI continues from the player's first action). Six variants — one
// per playable character — kept in sync with the prose files in prose/c1-a1-*.md.
// The five crew openings share the Lighthouse Morning setting but differ in voice,
// details, and opening actions; the Visitor opening is a separate isekai branch.

// --- Kaspen (captain, secret-keeper) ----------------------------------------
const KASPEN_OPENING = `You wake the way you always do here: to the sound of the sea working at the shelf below, and the old wards humming under everything like a held note you stopped hearing years ago. The hum is thinner this morning. You notice. You pretend you don't.

The light comes grey-gold through the window slits — early, the dry season's first warmth not yet on the stone. Kaelen is still asleep beside you, one hand curled loosely against your wrist, and for a moment you don't move because this is one of the things you are losing and you have decided to hold it while it's here.

Your quarters are full of the long accumulation of someone who has lived in one good place for a very long time: charts, half-filled notebooks, a cup with a hairline crack you keep meaning to replace and never will. Below, the Lighthouse is already awake — a clatter from the workshop, woodsmoke and something frying, Rulan's voice carrying up the stairwell at a volume that suggests Pan is burning breakfast again.

You know what morning this is. You've known for weeks. Today the Scrubbing moves into the upper wards, and tonight, if the schedule holds, you will have to begin saying what you have been carrying alone except for Kaelen, who stirs now and murmurs something that might be your name.

But that is later. The kettle is on. Boss sits in the doorway, watching you with the patience of someone who has decided to grant you one more ordinary day.

You sit up. The morning is waiting.`

const KASPEN_ACTIONS = [
  'Climb to the top-floor library for the long view over the plain.',
  'Find Kaelen and share a quiet moment before the day fills up.',
  'Greet Boss properly — he has been waiting in the doorway.',
]

// --- Kaelen (vice-captain, master of warding) --------------------------------
const KAELEN_OPENING = `You wake to the wards before you wake to anything else.

It's a mage thing — the hum of the old Gnomish concealments runs under your skin like a second pulse, and this morning there's a flutter in the lower third that wasn't there yesterday. You file it mentally: re-weave the east anchor before lunch, or it'll fray by sundown. You've been doing this long enough that the diagnosis is automatic, as natural as breathing.

Kaspen is still asleep beside you, one hand resting where your shoulder meets the pillow, and you let yourself look at him for a moment before the day takes you both. He's been quiet lately. Quieter than usual. You know what's coming — you're the only other person in the world who does — and you've decided to be the steady thing in the room until he's ready.

The light through the window slits is grey-gold, early. Below, the Lighthouse is already clattering to life: Pan's laugh, something metal hitting the workshop floor, the particular silence that means Tariel is already up and has been for an hour. The kettle starts its low whistle from the galley.

You ease out of bed, pull on yesterday's tunic because it still smells like woodsmoke and work, and pause at the doorway to feel the wards settle back into their rhythm. You can give them another day.

Boss is in the corridor, tail flicking. He has the look of someone who has been waiting longer than he considers reasonable.

You head downstairs. The morning is waiting.`

const KAELEN_ACTIONS = [
  'Head to the east anchor and re-weave the ward before it frays.',
  'Find Kaspen — he has been too quiet, and you want to be nearby when he is ready.',
  'Check on Pan in the galley and see if breakfast survived.',
]

// --- Pan (scout, 17, Homo luzonensis) ---------------------------------------
const PAN_OPENING = `You wake because you smell breakfast, and that's pretty much how every good morning starts.

The sea is doing its thing below the shelf — surf and wind, the usual — and the wards are humming the way they always do, a sound you've gotten used to even though Rulan says most people take years. You're not most people. You've been told this enough times that it's started to feel like a job title.

Your quarters are the smallest on this floor — you picked them because the window faces the plain, not the sea, and in the early light you can just make out the dark shapes of stegodon moving through the tall grass near the treeline. Your tribe's hunting grounds are three days' walk from here. You could find them by the shape of the hills alone. You don't visit as often as you mean to.

Below, the Lighthouse is fully awake: Rulan swearing at the stove, Kaelen's calm voice cutting through with instructions, the particular thump that means Thorn has decided to sit on someone's workbench again. You're hungry. You're always hungry. You swing your legs out of the cot and nearly trip over your own boots.

The gnomes are strange and small and they're going to leave soon — you've pieced that much together, even if no one's said it straight to your face. You don't know the whole shape of it yet. But today there's work, and food, and people who have decided to keep you around.

You head for the stairs. The morning is waiting, and so is whatever Rulan is burning.`

const PAN_ACTIONS = [
  'Run down to the galley and see what Rulan is cooking.',
  'Climb to the lookout ledge and scan the plain for stegodon before the day starts.',
  'Find Kaelen and ask about the strange flutter you felt in the wards.',
]

// --- Tariel (vanguard, disciplined swordswoman-mage) -------------------------
const TARIEL_OPENING = `You have already been awake for an hour.

The practice blade — weighted, blunted, familiar as your own handwriting — rests against the wall where you left it after the morning forms. Your quarters are orderly in the way of someone who has lived out of packs and on ships and in camps and has learned that a clear floor is a clear mind. The sea light through the window slits catches the single thing on your shelf that isn't practical: a smooth river stone, cool and dark, given to you by someone who is no longer here.

Below, the Lighthouse is beginning its day. The workshop door bangs open — Rulan, by the sound of it, which means something will be on fire within the hour. Pan's voice rises in a question you can't quite make out, followed by Kaelen's laugh, which carries. You file each sound where it belongs: crew accounted for, no threats, morning proceeding.

You have weighed this mission against your code and found it sound. The Preserving is a just cause. You have carried the secret alongside Kaspen and Kaelen from the start — you know what the Spires are and what they mean — and you have made your peace with the weight of it. What tests you is not the knowledge but the silence. Pan and Rulan deserve to know before the end. Kaspen will tell them when he's ready. He always does.

You straighten your tunic, run a thumb over the river stone, and open the door. Boss is in the corridor. He looks up at you with the expression of a creature who has judged you and found you acceptable.

You head for the workshop. The morning is waiting.`

const TARIEL_ACTIONS = [
  'Head to the workshop and check in with Rulan about the day\'s decommissioning.',
  'Find Kaspen — you have noticed his quiet and want to be present if he is ready to speak.',
  'Take a moment in the training yard and let the morning settle.',
]

// --- Rulan (decommissioner, blunt, fond of explosives) -----------------------
const RULAN_OPENING = `You wake because the light through the window slits has hit the exact angle that means someone else has already started the kettle and you're missing it.

Your quarters look like a workshop had a baby with a landslide. Half-finished charges sit on the bench by the door — nothing live, you're not an idiot — and yesterday's tunic is draped over a stack of decommissioning notes you were supposed to file last week. You know where everything is. That's what counts.

The sea is doing its usual thing outside. The wards are humming their usual hum. You've never been one for poetry about either — the sea is wet, the wards work, or they don't, and if they don't you fix them or you blow them up so someone else can build something better. That's been your philosophy for about three hundred years and it's served you fine.

Below: Pan is definitely burning something. You can tell by the smell and by the particular note of Kaelen's voice — patient, instructional, the tone of someone explaining to a seventeen-year-old that fire requires *moderation*. You grin despite yourself. The kid's all right. You're teaching him demolition next week, if the schedule holds.

The Scrubbing moves into the upper wards today. You've got charges to prep and a schedule to keep and a crew to feed, apparently, since no one else in this Lighthouse can manage a skillet.

You pull on your boots, shove the notes off the tunic, and head for the stairs. The morning is waiting, and so is breakfast.`

const RULAN_ACTIONS = [
  'Head to the galley and rescue breakfast before Pan burns it completely.',
  'Check your charges in the workshop — today\'s Scrubbing won\'t prep itself.',
  'Find Tariel and get her opinion on the detonator trigger you\'ve been redesigning.',
]

// --- Visitor (modern human, isekai) -----------------------------------------
const VISITOR_OPENING = `You wake, and nothing is right.

The ceiling is wrong — low and close, dark beams worked with patterns that mean nothing to you. The bed is too small; your feet hang off the end. The whole room is built to a scale that isn't yours, as if made for children, or for someone careful and small.

The last thing you remember is —

Nothing. A clean gap where the getting-here should be. You were somewhere. Then you were here. The seam between has been cut away.

There is a window. You go to it the way you'd reach for a railing in the dark.

Outside: a vast brown plain running down to a sea too bright and too empty — no boats, no buildings, not a single roof anywhere on it. A mountain stands on the far horizon and breathes a thin line of steam into a sky with nothing in it: no wires, no contrails, nothing of anyone. And out on the plain, unmistakable and impossible, dark shapes move in a slow herd — huge, tusked, the kind of thing elephants are descended from.

Some buried part of you knows this coast. You have just never seen it empty. You have never seen it a hundred thousand years before anyone thought to give it a name.

Behind you: a door, and a voice.

You turn. In the doorway stands a small figure — barely to your chest — looking up at you with an expression caught between wariness and wonder. Its mouth moves. The sounds are warm, careful, clearly meant for you.

You don't understand a single one of them.`

const VISITOR_ACTIONS = [
  'Try to speak to the figure in the doorway.',
  'Hold up your hands to show you mean no harm.',
  'Turn back to the window and try to make sense of what you see.',
]

// --- Branching function ------------------------------------------------------

/** The verbatim turn-0 opening for a playthrough, branched per character. */
export function openingFor(id: PlayableId): { prose: string; actions: string[] } {
  switch (id) {
    case 'kaspen':  return { prose: KASPEN_OPENING,  actions: KASPEN_ACTIONS }
    case 'kaelen':  return { prose: KAELEN_OPENING,  actions: KAELEN_ACTIONS }
    case 'pan':     return { prose: PAN_OPENING,     actions: PAN_ACTIONS }
    case 'tariel':  return { prose: TARIEL_OPENING,  actions: TARIEL_ACTIONS }
    case 'rulan':   return { prose: RULAN_OPENING,   actions: RULAN_ACTIONS }
    case 'visitor': return { prose: VISITOR_OPENING,  actions: VISITOR_ACTIONS }
  }
}
