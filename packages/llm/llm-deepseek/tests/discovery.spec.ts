import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverModels } from '../src/discovery.ts'
import type { StoredDeepSeekDiscoveryProfile } from '../src/discovery.ts'

afterEach(() => { vi.unstubAllGlobals() })

/** A stored profile whose endpoint answers one scripted listing. */
function profile(knownModels: StoredDeepSeekDiscoveryProfile['knownModels'] = []): StoredDeepSeekDiscoveryProfile {
  return {
    resolvedBaseURL: 'https://api.deepseek.com',
    defaultContextWindow: 1_000_000,
    defaultMaxTokens: 256_000,
    knownModels,
    resolveApiKey: async () => undefined,
  }
}

/** Stub `fetch` to answer one OpenAI-compatible listing. */
function stubListing(data: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data }), {
    status,
    headers: { 'content-type': 'application/json', 'content-length': String(JSON.stringify({ data }).length) },
  })))
}

describe('deepseek model discovery', () => {
  it('keeps a known catalog model\'s curated metadata and fills defaults for unknown ids', async () => {
    stubListing([
      { id: 'deepseek-v4-flash' },
      { id: 'from-the-endpoint', name: 'Endpoint Model' },
    ])
    const models = await discoverModels(
      { baseURL: 'https://api.deepseek.com' },
      () => profile([
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 123_456, maxTokens: 65_432 },
      ]),
    )
    expect(models).toEqual([
      { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', contextWindow: 123_456, maxTokens: 65_432 },
      { id: 'from-the-endpoint', name: 'Endpoint Model', contextWindow: 1_000_000, maxTokens: 256_000 },
    ])
  })

  it('never drops a known catalog model the endpoint did not echo', async () => {
    stubListing([{ id: 'only-this' }])
    const models = await discoverModels(
      { baseURL: 'https://api.deepseek.com' },
      () => profile([{ id: 'curated-model', name: 'Curated', contextWindow: 999 }]),
    )
    expect(models.map(model => model.id)).toEqual(['only-this', 'curated-model'])
    expect(models[1]).toEqual({ id: 'curated-model', name: 'Curated', contextWindow: 999, maxTokens: 256_000 })
  })
})
