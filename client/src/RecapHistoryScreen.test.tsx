import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RecapHistoryScreen from './RecapHistoryScreen'
import type { GameState } from './types'

// ── Helpers ───────────────────────────────────────────────────────────────────

const CHAPTERS = [
  { number: 1, title: 'The Arrival', recapTitle: 'Landfall at Dawn' },
  { number: 2, title: 'The Storm', recapTitle: 'Winds of Change' },
  { number: 3, title: 'The Reef', recapTitle: 'Hidden Depths' },
]

const MOCK_GAME_STATE: GameState = {
  playthroughId: 'pt-1',
  character: {
    id: 'kaspen',
    name: 'Kaspen',
    role: 'First Mate',
    knowsLabel: 'knowledge',
    dossier: 'A loyal sailor.',
    povLabel: 'viewpoint',
  },
  anchor: 'some-beat',
  chapterNumber: 2,
  chapterTitle: 'The Storm',
  anchorTitle: 'Landfall',
  history: [],
  actions: [],
  wikiState: {},
  setting: '',
}

function mockSummaries(n: number) {
  const items = Array.from({ length: n }, (_, i) => ({
    chapterNumber: CHAPTERS[i].number,
    chapterTitle: CHAPTERS[i].title,
    title: CHAPTERS[i].recapTitle,
    isFinal: i === n - 1,
    // Legacy entries (i === 0) have no timestamp — matches server behaviour.
    ...(i !== 0 ? { createdAt: new Date(2026, 0, i + 1).toISOString() } : {}),
    ...(i === 0 ? { legacy: true as const } : {}),
  }))
  // Server returns newest-first; replicate that order.
  return { recaps: [...items].reverse() }
}

function mockDetail(chapterNumber: number, opts?: { legacy?: boolean; isFinal?: boolean; epilogue?: string; acknowledgment?: string }) {
  const ch = CHAPTERS[chapterNumber - 1]
  return {
    recap: {
      chapterNumber,
      chapterTitle: ch.title,
      title: ch.recapTitle,
      prose: `This is the recap prose for ${ch.title}. It has multiple paragraphs.\n\nSecond paragraph here.`,
      facts: opts?.legacy ? undefined : {
        chapterNumber,
        chapterTitle: ch.title,
        characterName: 'Kaspen',
        characterRole: 'First Mate',
        isVisitor: false,
        beats: [{ id: 'b1', title: 'The First Step' }, { id: 'b2', title: 'A Dark Turn' }],
        crew: [{ id: 'kaelen', name: 'Kaelen', trust: 75, arc: 'warming' }],
        journey: { zonesVisited: [], crewSpoken: [], shipAreasExplored: [], petInteracted: false },
        turnCount: 5,
      },
      isFinal: opts?.isFinal ?? false,
      epilogue: opts?.epilogue,
      acknowledgment: opts?.acknowledgment,
      // Legacy entries omit createdAt — matches server behaviour.
      ...(opts?.legacy ? {} : { createdAt: new Date(2026, 0, chapterNumber).toISOString() }),
      ...(opts?.legacy ? { legacy: true as const } : {}),
    },
    legacy: opts?.legacy ?? false,
  }
}

/** Set up fetch mock from a map of path → response.
 *  Response values can be:
 *    - A plain data object → returned as `{ ok: true, json: async () => structuredClone(data) }`
 *    - A function → called; its return value is used directly (for non-ok or dynamic responses)
 *    - An Error → thrown
 */
function setupFetch(responses: Record<string, unknown>) {
  const mock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as Request).url
    const path = url.replace('http://localhost:3001', '')
    const key = Object.keys(responses).find((k) => path === k) ?? 'default'
    const response = responses[key] ?? responses['default']
    if (response instanceof Error) throw response
    if (typeof response === 'function') return (response as () => unknown)()
    return { ok: true, json: async () => structuredClone(response) } as Response
  })
  vi.stubGlobal('fetch', mock)
  return mock
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RecapHistoryScreen', () => {
  it('loads and renders summary cards with badges', async () => {
    setupFetch({ '/api/recaps': mockSummaries(2) })

    render(<RecapHistoryScreen onResume={vi.fn()} />)

    // Wait for the chapter title text to appear (unique, not ambiguous with "Chapter N").
    expect(await screen.findByText('The Arrival')).toBeInTheDocument()
    expect(screen.getByText('The Storm')).toBeInTheDocument()
    expect(screen.getByText('"Landfall at Dawn"')).toBeInTheDocument()

    // Badges.
    expect(screen.getByText('Legacy')).toBeInTheDocument()
    expect(screen.getByText('Final')).toBeInTheDocument()
  })

  it('shows empty state when there are no recaps', async () => {
    setupFetch({ '/api/recaps': { recaps: [] } })

    render(<RecapHistoryScreen onResume={vi.fn()} />)

    expect(await screen.findByText('No completed chapters yet.')).toBeInTheDocument()
  })

  it('shows error state with retry button', async () => {
    let calls = 0
    setupFetch({
      '/api/recaps': () => {
        calls++
        if (calls === 1) return { ok: false, json: async () => ({ error: 'Server error.' }) } as Response
        return { ok: true, json: async () => mockSummaries(1) } as Response
      },
    })

    const user = userEvent.setup()
    render(<RecapHistoryScreen onResume={vi.fn()} />)

    expect(await screen.findByText('Server error.')).toBeInTheDocument()

    await user.click(screen.getByText('Try again'))

    expect(await screen.findByText('The Arrival')).toBeInTheDocument()
    expect(screen.queryByText('Server error.')).not.toBeInTheDocument()
  })

  it('opens detail view when clicking a summary card', async () => {
    setupFetch({
      '/api/recaps': mockSummaries(2),
      '/api/recaps/1': mockDetail(1),
    })

    const user = userEvent.setup()
    render(<RecapHistoryScreen onResume={vi.fn()} />)

    // Click the "The Arrival" card (chapter 1).
    await user.click(await screen.findByText('The Arrival'))

    // Detail view: prose, back button, facts.
    expect(await screen.findByText(/recap prose for The Arrival/)).toBeInTheDocument()
    // "← All recaps" appears both at top and bottom — use getAllByText.
    expect(screen.getAllByText('← All recaps').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/Played as/)).toBeInTheDocument()
    expect(screen.getByText('The First Step')).toBeInTheDocument()
    expect(screen.getByText('Kaelen')).toBeInTheDocument()
  })

  it('shows legacy label on legacy detail entries', async () => {
    setupFetch({
      '/api/recaps': mockSummaries(1),
      '/api/recaps/1': mockDetail(1, { legacy: true }),
    })

    const user = userEvent.setup()
    render(<RecapHistoryScreen onResume={vi.fn()} />)

    await user.click(await screen.findByText('The Arrival'))

    expect(await screen.findByText('Prose-only (pre-archive save)')).toBeInTheDocument()
    expect(screen.queryByText('Your journey')).not.toBeInTheDocument()
  })

  it('renders final-chapter fields (epilogue, acknowledgment)', async () => {
    setupFetch({
      '/api/recaps': mockSummaries(1),
      '/api/recaps/1': mockDetail(1, {
        isFinal: true,
        epilogue: 'And they lived happily ever after.',
        acknowledgment: 'Thanks to everyone.',
      }),
    })

    const user = userEvent.setup()
    render(<RecapHistoryScreen onResume={vi.fn()} />)

    await user.click(await screen.findByText('The Arrival'))

    expect(await screen.findByText('Epilogue')).toBeInTheDocument()
    expect(screen.getByText('And they lived happily ever after.')).toBeInTheDocument()
    expect(screen.getByText('Acknowledgment')).toBeInTheDocument()
    expect(screen.getByText('Thanks to everyone.')).toBeInTheDocument()
  })

  it('handles race: clicking two summaries quickly only shows the second', async () => {
    // Two deferred promises so we control resolution order.
    let resolve1!: (v: unknown) => void
    let resolve2!: (v: unknown) => void
    const p1 = new Promise((r) => { resolve1 = r })
    const p2 = new Promise((r) => { resolve2 = r })

    const mock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      if (url === '/api/recaps') {
        return { ok: true, json: async () => mockSummaries(3) } as Response
      }
      if (url.includes('/api/recaps/1')) {
        return { ok: true, json: () => p1 } as unknown as Response
      }
      if (url.includes('/api/recaps/2')) {
        return { ok: true, json: () => p2 } as unknown as Response
      }
      return { ok: false, json: async () => ({ error: 'unknown' }) } as Response
    })
    vi.stubGlobal('fetch', mock)

    const user = userEvent.setup()
    render(<RecapHistoryScreen onResume={vi.fn()} />)

    // Wait for list to render.
    await screen.findByText('The Storm')

    // Click chapter 1 and chapter 2 in rapid succession.
    // Use fireEvent (sync) instead of userEvent (async) to avoid yielding between clicks.
    const ch1Btn = screen.getByText('The Arrival').closest('button')!
    const ch2Btn = screen.getByText('The Storm').closest('button')!
    ch1Btn.click()
    ch2Btn.click()

    // Resolve ch2 first, then ch1.
    resolve2!(mockDetail(2))
    resolve1!(mockDetail(1))

    // Wait for React to process the state updates.
    // Only chapter 2's content should be visible.
    const ch2Text = await screen.findByText(/recap prose for The Storm/)
    expect(ch2Text).toBeInTheDocument()
    expect(screen.queryByText(/recap prose for The Arrival/)).not.toBeInTheDocument()
  })

  it('back-to-game fetches fresh state and calls onResume on success', async () => {
    setupFetch({
      '/api/recaps': mockSummaries(1),
      '/api/state': MOCK_GAME_STATE,
    })

    const onResume = vi.fn()
    const user = userEvent.setup()
    render(<RecapHistoryScreen onResume={onResume} />)

    await screen.findByText('The Arrival')
    await user.click(screen.getByText('Back to Game'))

    expect(onResume).toHaveBeenCalledWith(MOCK_GAME_STATE)
  })

  it('back-to-game shows error and stays mounted on failure', async () => {
    setupFetch({
      '/api/recaps': mockSummaries(1),
      '/api/state': () => ({ ok: false, json: async () => ({ error: 'Server unavailable.' }) } as Response),
    })

    const onResume = vi.fn()
    const user = userEvent.setup()
    render(<RecapHistoryScreen onResume={onResume} />)

    await screen.findByText('The Arrival')
    await user.click(screen.getByText('Back to Game'))

    expect(await screen.findByText('Server unavailable.')).toBeInTheDocument()
    expect(onResume).not.toHaveBeenCalled()
    // The screen should still show the list.
    expect(screen.getByText('The Arrival')).toBeInTheDocument()
  })

  it('sort toggle reverses list order', async () => {
    setupFetch({ '/api/recaps': mockSummaries(3) })

    const user = userEvent.setup()
    render(<RecapHistoryScreen onResume={vi.fn()} />)

    // Wait for the list to load — newest-first by default.
    await screen.findByText('The Reef')

    // Default newest-first: chapters should appear 3, 2, 1.
    // We check by getting chapter title elements in document order.
    const chapterTitles = () =>
      screen.getAllByText(/^(The Arrival|The Storm|The Reef)$/).map((el) => el.textContent)

    expect(chapterTitles()).toEqual(['The Reef', 'The Storm', 'The Arrival'])

    // Toggle to oldest-first.
    await user.click(screen.getByText('Newest first ▾'))

    expect(chapterTitles()).toEqual(['The Arrival', 'The Storm', 'The Reef'])
  })

  it('shows detail error when a recap fails to load', async () => {
    setupFetch({
      '/api/recaps': mockSummaries(2),
      '/api/recaps/1': () => ({ ok: false, json: async () => ({ error: 'Recap not found.' }) } as Response),
    })

    const user = userEvent.setup()
    render(<RecapHistoryScreen onResume={vi.fn()} />)

    await user.click(await screen.findByText('The Arrival'))

    expect(await screen.findByText('Recap not found.')).toBeInTheDocument()
    expect(screen.getByText('← Back to list')).toBeInTheDocument()
  })

  it('renders "Pre-archive save" for legacy entries, never "Invalid Date"', async () => {
    setupFetch({ '/api/recaps': mockSummaries(2) })

    render(<RecapHistoryScreen onResume={vi.fn()} />)

    await screen.findByText('The Arrival')

    // Chapter 1 is legacy (i=0 in mockSummaries) — should show "Pre-archive save" label.
    expect(screen.getByText('Pre-archive save')).toBeInTheDocument()
    // Must never render "Invalid Date".
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument()
  })

  it('renders fallback for malformed timestamp without "Invalid Date"', async () => {
    // Return a summary with a garbled createdAt and no legacy flag.
    const malformed = {
      recaps: [{
        chapterNumber: 1,
        chapterTitle: 'The Arrival',
        title: 'Landfall at Dawn',
        isFinal: false,
        createdAt: 'not-a-date',
      }],
    }
    setupFetch({ '/api/recaps': malformed })

    render(<RecapHistoryScreen onResume={vi.fn()} />)

    await screen.findByText('The Arrival')

    // The garbled timestamp should produce the fallback, not "Invalid Date".
    expect(screen.getByText('Pre-archive save')).toBeInTheDocument()
    expect(screen.queryByText('Invalid Date')).not.toBeInTheDocument()
  })
})
