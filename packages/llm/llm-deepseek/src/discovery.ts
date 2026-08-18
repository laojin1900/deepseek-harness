/**
 * Model discovery for the direct DeepSeek adapter: answer the configuration
 * surface's "fetch available models" action by interrogating the endpoint's
 * OpenAI-compatible `GET /models` listing.
 *
 * The DeepSeek API speaks the OpenAI Chat Completions protocol, so its model
 * listing is the one shape this reads. The listing discloses ids (and, on
 * friendlier gateways, capacities), but never the curated metadata the
 * adapter's own catalog carries — context window, output cap. So a discovered
 * id that already appears in the configured or default catalog keeps that
 * catalog's metadata, and an unknown id falls back to the adapter's defaults.
 *
 * Nothing here is stored: the request carries a draft the user is still
 * editing, and the reply is candidate metadata the surface offers for
 * adoption. `settings.yaml` remains the only thing that decides what a route
 * serves.
 *
 * @module dsh-llm-deepseek/discovery
 */

import { INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { PUBLIC_BASE_URL } from './index.ts'
import type { DeepSeekCatalogModel } from './adapter.ts'

/** Endpoint replies larger than this are refused (same ceiling pi-ai uses). */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** One entry of an OpenAI-compatible `GET /models` reply. */
interface ListingEntry {
  id?: unknown
  name?: unknown
  display_name?: unknown
  context_window?: unknown
  context_length?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
}

/** A positive integer field of a listing entry, or `undefined` when absent or unusable. */
function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isInteger(candidate) && candidate > 0) return candidate
  }
  return undefined
}

/** A non-empty string field of a listing entry, or `undefined`. */
function label(...candidates: readonly unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate
  }
  return undefined
}

/** Join the endpoint base with the listing path, treating the base as a prefix. */
function listingUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/models`
}

/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what actually enforces the bound.
 */
async function readBounded(response: Response, url: string): Promise<string> {
  const oversized = (): LlmError =>
    new LlmError(`${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`, 'DISCOVERY_FAILED')
  const declared = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw oversized()
  }
  /* v8 ignore next -- fetch always exposes a body stream on a 2xx Response; the null guard is defensive. */
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) throw oversized()
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/** Parse an OpenAI-compatible listing reply; entries without a usable id are skipped. */
function readListing(body: unknown): LlmDiscoveredModel[] {
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    throw new LlmError(
      'the endpoint\'s model listing has no "data" array; enter this provider\'s models by hand',
      'DISCOVERY_FAILED',
    )
  }
  const models: LlmDiscoveredModel[] = []
  for (const raw of data) {
    const entry = raw as ListingEntry | null
    const id = label(entry?.id)
    if (id === undefined) continue
    const name = label(entry?.name, entry?.display_name)
    const contextWindow = capacity(entry?.context_window, entry?.context_length)
    const maxTokens = capacity(entry?.max_output_tokens, entry?.max_tokens)
    models.push({
      id,
      ...name === undefined ? {} : { name },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    })
  }
  return models
}

/** Accept one probe key, or refuse it before the header is built. */
function usableProbeKey(raw: string): string {
  const checked = normalizeApiKey(raw)
  if (checked.ok) return checked.value
  throw new LlmError(
    checked.reason === 'empty'
      ? 'this provider\'s API key is blank; enter it on the Models page, or clear it to probe unauthenticated'
      : 'this provider\'s API key contains characters no HTTP header can carry; paste the raw key only',
    INVALID_CREDENTIAL_CODE,
  )
}

/** Inputs the apply() layer resolves per request, kept out of the pure discovery body. */
export interface DiscoveryContext {
  /** Resolved endpoint base (config → trusted env → public default). */
  resolvedBaseURL: string | undefined
  /** Fallback context capacity for a discovered id the catalog does not size. */
  defaultContextWindow: number
  /** Fallback output cap for a discovered id the catalog does not size. */
  defaultMaxTokens: number
  /** Configured or default catalog, for metadata merge on recognized ids. */
  knownModels: readonly DeepSeekCatalogModel[]
  /** Credential the route already stored, asked for only when the draft carries none. */
  storedApiKey?: () => Promise<string | undefined>
}

/**
 * Interrogate the DeepSeek endpoint for the models it advertises. A discovered
 * id that matches a known catalog entry keeps that entry's curated metadata;
 * an unknown id takes the listing's own fields, then the adapter defaults.
 * @param request - the endpoint and one-shot credential to use.
 * @param context - resolved endpoint, defaults, known catalog, and stored key.
 * @returns the advertised models in endpoint order, with merged metadata.
 * @throws LlmError when the endpoint refuses, fails, or answers a non-listing.
 */
export async function discoverModels(
  request: LlmModelDiscoveryRequest,
  context: DiscoveryContext,
): Promise<readonly LlmDiscoveredModel[]> {
  const baseURL = request.baseURL ?? context.resolvedBaseURL ?? PUBLIC_BASE_URL
  if (baseURL.length === 0) {
    throw new LlmError(
      'set a baseURL, or enter this provider\'s models by hand',
      'DISCOVERY_FAILED',
    )
  }
  const url = listingUrl(baseURL)
  const supplied = request.apiKey ?? await context.storedApiKey?.()
  const apiKey = supplied === undefined ? undefined : usableProbeKey(supplied)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` },
        ...attributionHeaders(),
      },
      ...request.signal === undefined ? {} : { signal: request.signal },
    })
  } catch (error: unknown) {
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error })
  }
  if (!response.ok) {
    throw new LlmError(
      `${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}`,
      'DISCOVERY_FAILED',
    )
  }
  let text: string
  try {
    text = await readBounded(response, url)
  } catch (error: unknown) {
    if (request.signal?.aborted) {
      throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error })
    }
    throw error
  }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
  const listed = readListing(body)
  // Merge: a known catalog id keeps its curated name/capacities; the listing
  // only contributes ids the catalog does not carry, and its own fields for
  // those ids (often just the id). Defaults fill what neither side sizes.
  const known = new Map(context.knownModels.map(model => [model.id, model]))
  const seen = new Set<string>()
  const merged: LlmDiscoveredModel[] = []
  for (const model of listed) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    const curated = known.get(model.id)
    if (curated !== undefined) {
      merged.push({
        id: curated.id,
        ...curated.name === undefined ? {} : { name: curated.name },
        ...curated.contextWindow === undefined ? {} : { contextWindow: curated.contextWindow },
        ...curated.maxTokens === undefined ? {} : { maxTokens: curated.maxTokens },
      })
    } else {
      merged.push({
        id: model.id,
        ...model.name === undefined ? {} : { name: model.name },
        ...model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow },
        ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens },
      })
    }
  }
  // Ensure every known catalog model appears even if the listing omitted it,
  // so a fetch never silently drops a curated entry the endpoint did not echo.
  for (const curated of context.knownModels) {
    if (seen.has(curated.id)) continue
    seen.add(curated.id)
    merged.push({
      id: curated.id,
      ...curated.name === undefined ? {} : { name: curated.name },
      ...curated.contextWindow === undefined ? {} : { contextWindow: curated.contextWindow },
      ...curated.maxTokens === undefined ? {} : { maxTokens: curated.maxTokens },
    })
  }
  // Fill defaults on any entry still missing capacities.
  return merged.map(model => ({
    id: model.id,
    ...model.name === undefined ? {} : { name: model.name },
    contextWindow: model.contextWindow ?? context.defaultContextWindow,
    ...model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens ?? context.defaultMaxTokens },
  }))
}
