import 'dotenv/config'
import { streamPlayTurn } from './playTurn.js'
import type { PlayTurnRequest } from './playTurn.js'

async function run(label: string, llm?: PlayTurnRequest['llm']) {
  console.log(`\n=== ${label} ===`)
  let streamError: unknown = null
  const result = streamPlayTurn(
    {
      character: 'kaspen',
      wiki: {},
      history: [],
      playerInput: 'I look around the beach and ask Pan what he is cooking.',
      llm,
    },
    (e) => {
      streamError = e
    },
  )

  let last: Record<string, unknown> = {}
  let chunks = 0
  for await (const partial of result.partialObjectStream) {
    last = partial as Record<string, unknown>
    chunks++
  }
  if (streamError) throw streamError

  console.log('partial chunks streamed:', chunks)
  console.log('narrative length:', typeof last.narrative === 'string' ? last.narrative.length : 'MISSING')
  console.log('narrative preview:', String(last.narrative ?? '').slice(0, 120))
  console.log('suggested_actions:', last.suggested_actions)
  console.log('events:', last.events)
  console.log('wiki_updates:', last.wiki_updates)
  console.log('fact_additions:', last.fact_additions)
}

async function main() {
  await run('OpenRouter (operator default from server/.env)')

  const deepseekKey = process.env.DEEPSEEK_TEST_KEY
  if (deepseekKey) {
    await run('Direct DeepSeek (BYOK path)', {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: deepseekKey,
      baseUrl: 'https://api.deepseek.com',
    })
  } else {
    console.log('\n(skipping direct DeepSeek test — set DEEPSEEK_TEST_KEY in server/.env to run it)')
  }
}

main()
  .then(() => {
    console.log('\nOK — all configured paths completed without error.')
    process.exit(0)
  })
  .catch((err) => {
    console.error('\nFAILED:', err)
    process.exit(1)
  })
