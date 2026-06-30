import { generateText } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { createOpenAI } from '@ai-sdk/openai'

/**
 * The provider layer (Build Plan §1.5).
 *
 * The rest of the app calls `askLLM()` and never knows or cares which AI
 * vendor answered. To switch the whole game to a different brain, change the
 * LLM_* environment variables and restart — no code changes.
 *
 * Phase 0 wires up OpenRouter (one key reaches Claude, GPT, Gemini, and more).
 * Phase 5 adds BYOK with arbitrary OpenAI-compatible providers.
 */
export function getModel() {
  const provider = process.env.LLM_PROVIDER ?? 'openrouter'
  const modelId = process.env.LLM_MODEL
  const apiKey = process.env.LLM_API_KEY
  const baseUrl = process.env.LLM_BASE_URL || undefined

  if (!apiKey) throw new Error('LLM_API_KEY is not set — check server/.env')
  if (!modelId) throw new Error('LLM_MODEL is not set — check server/.env')

  return buildModel(provider, modelId, apiKey, baseUrl)
}

/** Send a single prompt to the configured model and return its text reply. */
export async function askLLM(prompt: string): Promise<string> {
  const { text } = await generateText({
    model: getModel(),
    prompt,
    maxOutputTokens: 1000,
  })
  return text
}

// --- Phase 5: BYOK key validation + per-user model resolution ----------------

/**
 * Try one cheap generation with the given credentials. Returns { ok: true } on
 * success, or { error: "..." } if the key is rejected / the model is unknown.
 */
export async function validateCredentials(
  provider: string,
  modelId: string,
  apiKey: string,
  baseUrl?: string,
): Promise<{ ok: true } | { error: string }> {
  try {
    const model = buildModel(provider, modelId, apiKey, baseUrl)
    // Minimal generation — we just need the provider to accept the key.
    await generateText({ model, prompt: 'Say "ok".', maxOutputTokens: 4 })
    return { ok: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Validation failed'
    return { error: msg }
  }
}

/** Resolves the effective provider name the same way getModel()/buildModel() do. */
function resolveProvider(explicitProvider?: string): string {
  return explicitProvider ?? process.env.LLM_PROVIDER ?? 'openrouter'
}

/**
 * providerOptions for generateObject/streamObject calls. OpenRouter translates
 * structured-output requests for every model it proxies; the direct/BYOK
 * OpenAI-compatible branch can't assume that — e.g. DeepSeek's own API only
 * accepts response_format "json_object", not "json_schema". Falling back to
 * json_object still works: streamObject/generateObject parse the returned JSON
 * and validate it against the Zod schema regardless of which response_format
 * was requested, and the system prompt already spells out the expected shape
 * in prose (see WORLD_BIBLE's "submit_turn structure" line).
 */
export function structuredOutputProviderOptions(explicitProvider?: string) {
  return resolveProvider(explicitProvider) === 'openrouter'
    ? undefined
    : { openai: { structuredOutputs: false } }
}

/**
 * True for any provider that needs system-role content folded into a regular
 * user message instead of sent as role "system".
 *
 * @ai-sdk/openai's getOpenAILanguageModelCapabilities() treats any modelId it
 * doesn't recognize as a classic GPT chat model (gpt-3*, gpt-4*, chatgpt-4o*,
 * gpt-5-chat*) as a "reasoning model", which silently rewrites the system
 * role to "developer" — a role only OpenAI's own o1/o3/gpt-5 lineup
 * understands. Third-party OpenAI-compatible APIs (DeepSeek, Venice, Groq,
 * Together, self-hosted) reject "developer" outright with a 400. OpenRouter's
 * provider package doesn't go through this code path, so it's unaffected.
 */
export function needsSystemAsUserWorkaround(explicitProvider?: string): boolean {
  return resolveProvider(explicitProvider) !== 'openrouter'
}

/**
 * Append wherever needsSystemAsUserWorkaround() is true. DeepSeek (and OpenAI)
 * reject response_format "json_object" with a 400 unless the literal word
 * "json" appears somewhere in the conversation — see structuredOutputProviderOptions.
 */
export const JSON_MODE_REMINDER =
  'Respond with a single valid JSON object only — no markdown fences, no prose outside the object.'

/**
 * Build a model instance from explicit credentials.
 *
 * - `openrouter` → uses the OpenRouter provider (caching on Anthropic models).
 * - `openai` / `openai-compatible` / anything else → uses the OpenAI-compatible
 *   provider. If a baseUrl is given, it points to that endpoint (e.g.
 *   https://api.venice.ai/v1 for Venice.ai). Otherwise the default OpenAI
 *   endpoint is used.
 */
export function buildModel(
  provider: string,
  modelId: string,
  apiKey: string,
  baseUrl?: string,
) {
  switch (provider) {
    case 'openrouter': {
      const openrouter = createOpenRouter({ apiKey })
      // 1h TTL (vs. the 5m default) so normal think-between-turns pacing keeps cache
      // hits instead of expiring while the player reads/decides (Context Bounding §3.3).
      return openrouter(modelId, { cache_control: { type: 'ephemeral', ttl: '1h' } })
    }
    default: {
      // Guard: provider should look like a real name.
      const trimmed = provider.trim()
      if (!trimmed || !/^[a-z][a-z0-9._-]*$/i.test(trimmed)) {
        throw new Error(
          `Unsupported provider "${provider}". Use "openrouter" or any OpenAI-compatible name.`,
        )
      }
      // Treat everything else as OpenAI-compatible.
      const opts: { apiKey: string; baseURL?: string } = { apiKey }
      if (baseUrl) opts.baseURL = baseUrl
      const openai = createOpenAI(opts)
      // .chat() hits the universal /v1/chat/completions contract that Venice, Groq,
      // Together, DeepSeek, and self-hosted endpoints implement. The bare call
      // (openai(modelId)) resolves to OpenAI's proprietary /v1/responses API, which
      // third-party "OpenAI-compatible" providers don't support.
      return openai.chat(modelId)
    }
  }
}
