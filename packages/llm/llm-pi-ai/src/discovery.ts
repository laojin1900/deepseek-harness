/**
 * Answering "which models can this provider serve?" for the configuration
 * surface's "fetch available models" action.
 *
 * A catalog route that still points at the provider's own endpoint is
 * interrogated live when this build can read that protocol's listing: the
 * installed registry goes stale between pi-ai releases, and a paid key that
 * already sees a newer model (Gemini 3.7 Flash is the case that forced this)
 * must not be answered from last month's snapshot. Capacities the listing
 * withholds are filled from the installed entry of the same id. A catalog
 * route this build cannot list, and that names no endpoint override, still
 * answers from the registry — better metadata than refusing the action.
 *
 * Only a route the catalog does not describe, or one that names a baseURL,
 * was the original live path. That still holds for OpenAI-compatible
 * gateways. Official Google is the extra live path: its native
 * `GET /v1beta/models` shape is known, and a custom Google-protocol
 * gateway is still refused rather than guessed.
 *
 * Neither path is a catalog refresh. Nothing here is stored: the request
 * carries a draft the user is still editing, and the reply is candidate
 * metadata the surface offers for adoption. `settings.yaml` remains the only
 * thing that decides what a route serves.
 *
 * @module dsh-llm-pi-ai/discovery
 */

import { INVALID_CREDENTIAL_CODE, LlmError, normalizeApiKey } from '@deepseek-ai/dsh-llm'
import type { LlmDiscoveredModel, LlmModelDiscoveryRequest } from '@deepseek-ai/dsh-llm'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { Api, Model } from '@earendil-works/pi-ai'
import { catalogModels, catalogProvider } from './catalog.ts'

/**
 * Protocols whose model listing this module can read: the two that speak
 * OpenAI's `GET /models` shape with bearer auth. Azure is absent despite its
 * OpenAI lineage — it authenticates with an `api-key` header and requires an
 * `api-version` query — and Codex authenticates through OAuth; guessing at
 * either would report an authentication failure as a provider with no models.
 * pi-ai's remaining protocols are absent for the same reason.
 */
const LISTABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  'openai-completions',
  'openai-responses',
])

/**
 * Official Google Generative Language listing. A custom gateway that claims
 * this protocol is still refused — only the catalog provider's own host is
 * asked, because a middleman does not promise this response shape.
 */
const GOOGLE_GENERATIVE_AI = 'google-generative-ai'
const GOOGLE_LISTING_PAGE_SIZE = 1000
const GOOGLE_HOST = 'generativelanguage.googleapis.com'

/**
 * Endpoint replies larger than this are refused. The endpoint is whatever URL
 * the user typed, so the ceiling holds on the bytes actually read rather than
 * on the length the server claims — the same two-stage shape `dsh-web-fetch`
 * uses for its own caller-supplied URLs, except that a truncated model listing
 * is not parseable, so overflow rejects instead of truncating.
 */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024

/** One entry of an OpenAI-compatible `GET /models` reply. */
interface ListingEntry {
  id?: unknown
  /** Common gateway extensions; absent from the official listings. */
  name?: unknown
  display_name?: unknown
  context_window?: unknown
  context_length?: unknown
  max_tokens?: unknown
  max_output_tokens?: unknown
  /** Model capability/modality marker some gateways disclose (image, embedding, …). */
  type?: unknown
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

/**
 * Join the endpoint base with the listing path. The base is treated as a
 * prefix rather than a URL to resolve against, so a deployment path such as
 * `https://gateway.example/openai/v1` keeps its segments instead of losing
 * them to `URL` resolution.
 */
function listingUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, '')}/models`
}

/**
 * The catalog provider's own Google endpoint, when this draft is that
 * official route and has not been pointed at a different host.
 */
function officialGoogleBaseURL(request: LlmModelDiscoveryRequest): string | undefined {
  if (request.provider === undefined) return undefined
  const catalog = catalogProvider(request.provider)
  if (catalog === undefined) return undefined
  // The catalog Provider does not carry `api`; the models do. One Google
  // model is enough to know this is the official Generative Language route.
  const sample = catalogModels(request.provider).values().next().value
  if (sample?.api !== GOOGLE_GENERATIVE_AI) return undefined
  if (request.api !== undefined && request.api !== GOOGLE_GENERATIVE_AI) return undefined
  const catalogBase = catalog.baseUrl?.replace(/\/+$/, '')
  const draftBase = request.baseURL === undefined || request.baseURL.length === 0
    ? catalogBase
    : request.baseURL.replace(/\/+$/, '')
  if (draftBase === undefined) return undefined
  let host: string
  try {
    host = new URL(draftBase).hostname
  } catch {
    return undefined
  }
  if (host !== GOOGLE_HOST) return undefined
  return draftBase
}

/** One entry of Google's `GET /v1beta/models` reply. */
interface GoogleListingEntry {
  name?: unknown
  displayName?: unknown
  inputTokenLimit?: unknown
  outputTokenLimit?: unknown
  supportedGenerationMethods?: unknown
}

/**
 * Whether a Google listing row can answer `generateContent`. Image, TTS, and
 * live-only rows stay out of the chat picker the same way OpenAI image /
 * embedding rows do.
 */
function isGoogleChatModel(entry: GoogleListingEntry): boolean {
  const methods = entry.supportedGenerationMethods
  if (!Array.isArray(methods)) return true
  return methods.some(method => method === 'generateContent')
}

/**
 * Read one Google Generative Language listing reply. Rows without a usable
 * id are skipped; a single malformed row must not deny the rest.
 */
function readGoogleListing(body: unknown): LlmDiscoveredModel[] {
  const data = (body as { models?: unknown } | null)?.models
  if (!Array.isArray(data)) {
    throw new LlmError(
      'the endpoint\'s model listing has no "models" array; enter this provider\'s models by hand',
      'DISCOVERY_FAILED',
    )
  }
  const models: LlmDiscoveredModel[] = []
  for (const raw of data) {
    const entry = raw as GoogleListingEntry | null
    const rawId = label(entry?.name)
    if (rawId === undefined) continue
    const id = rawId.startsWith('models/') ? rawId.slice('models/'.length) : rawId
    if (id.length === 0) continue
    if (!isGoogleChatModel(entry ?? {})) continue
    if (isNonChatModel(id, undefined)) continue
    const name = label(entry?.displayName)
    const contextWindow = capacity(entry?.inputTokenLimit)
    const maxTokens = capacity(entry?.outputTokenLimit)
    models.push({
      id,
      ...name === undefined ? {} : { name },
      ...contextWindow === undefined ? {} : { contextWindow },
      ...maxTokens === undefined ? {} : { maxTokens },
    })
  }
  return models
}

/**
 * Read a reply body, refusing one that outgrows the ceiling. A declared length
 * is checked first so an honest server is turned away without transferring
 * anything; the accumulated total is what actually enforces the bound, because
 * a server that under-declares (or streams) tells us nothing up front.
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
    /* v8 ignore next 4 -- cancel() after a completed or abandoned read settles without rejecting; unobserved best-effort cleanup. */
    await reader.cancel().catch(() => {
      // Cancel after a drained read, or after this function walked away from
      // an oversized one, is cleanup; the reply is already decided either way.
    })
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

/**
 * Whether a listing entry is a non-chat model the picker should not offer:
 * image-generation, embedding, or rerank models (recipe §3 — exclude
 * `image` / `embedding` / non-chat `type` from the discovered catalog).
 */
function isNonChatModel(id: string, type: unknown): boolean {
  if (typeof type === 'string') {
    const t = type.toLowerCase()
    if (t === 'image' || t === 'embedding' || t === 'audio' || t === 'rerank' || t === 'moderation') return true
  }
  const lid = id.toLowerCase()
  return lid.includes('embedding') || lid.includes('rerank') || lid.includes('image')
}

/**
 * Read one OpenAI-compatible listing reply. Entries without a usable id are
 * skipped rather than failing the whole interrogation: a single malformed row
 * should not deny the user the rest of a working endpoint's catalog.
 */
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
    if (isNonChatModel(id, entry?.type)) continue
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

/**
 * Accept one probe key, or refuse it before the header is built. Without this
 * the `fetch` below would throw a ByteString `TypeError` that this function's
 * catch reports as `could not reach <url>` — blaming the network for a local,
 * deterministic fault.
 * @param raw - the key typed into the form or read from storage.
 * @returns the trimmed, usable key.
 */
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

/**
 * Fetch one listing URL and parse the JSON body. Shared by the OpenAI-shaped
 * path and the official Google path so both honour the same size ceiling,
 * abort mapping, and credential-status wording.
 */
async function fetchListingJson(
  url: string,
  request: LlmModelDiscoveryRequest,
  headers: Record<string, string>,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...headers,
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
  try {
    return JSON.parse(text)
  } catch (error: unknown) {
    throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error })
  }
}

/**
 * Walk Google's paginated `GET /v1beta/models`. Auth is the `key` query
 * parameter the official endpoint documents; a Bearer header is ignored.
 */
async function listGoogleModels(
  request: LlmModelDiscoveryRequest,
  baseURL: string,
  apiKey: string,
): Promise<LlmDiscoveredModel[]> {
  const listed: LlmDiscoveredModel[] = []
  const seen = new Set<string>()
  let pageToken: string | undefined
  for (let page = 0; page < 20; page += 1) {
    const url = new URL(`${baseURL.replace(/\/+$/, '')}/models`)
    url.searchParams.set('pageSize', String(GOOGLE_LISTING_PAGE_SIZE))
    url.searchParams.set('key', apiKey)
    if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken)
    const body = await fetchListingJson(url.toString(), request, {})
    for (const model of readGoogleListing(body)) {
      if (seen.has(model.id)) continue
      seen.add(model.id)
      listed.push(model)
    }
    const next = (body as { nextPageToken?: unknown } | null)?.nextPageToken
    if (typeof next !== 'string' || next.length === 0) break
    pageToken = next
  }
  return listed
}

/** Fill listing gaps from the installed catalog of the same id. */
function mergeWithCatalog(
  listed: readonly LlmDiscoveredModel[],
  installed: Map<string, Model<Api>>,
  modelPrefix?: string,
): LlmDiscoveredModel[] {
  const merged = listed.map((model) => {
    const known = installed.get(model.id)
    const name = model.name ?? known?.name
    const contextWindow = model.contextWindow ?? known?.contextWindow
    const maxTokens = model.maxTokens ?? known?.maxTokens
    return {
      id: model.id,
      ...(name === undefined ? {} : { name }),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
    }
  })
  if (modelPrefix !== undefined && modelPrefix.length > 0) {
    return merged.filter(model => model.id.startsWith(modelPrefix))
  }
  return merged
}

/**
 * Interrogate one draft provider endpoint for the models it advertises.
 * @param request - the endpoint, protocol, and one-shot credential to use.
 * @param storedApiKey - the credential the named route already stored, asked
 *   for only when the draft carries none and only on the path that reaches the
 *   network. A configuration surface never holds a stored secret — it edits a
 *   redacted descriptor — so without this an already-configured route would be
 *   interrogated unauthenticated and answer 401.
 * @returns the advertised models in endpoint order.
 * @throws LlmError when the protocol has no readable listing, the endpoint
 *   refuses or fails the request, or the reply is not a model listing.
 */
export async function discoverModels(
  request: LlmModelDiscoveryRequest,
  storedApiKey?: () => Promise<string | undefined>,
  modelPrefix?: string,
): Promise<readonly LlmDiscoveredModel[]> {
  const installed: Map<string, Model<Api>> = request.provider !== undefined
    ? catalogModels(request.provider)
    : new Map<string, Model<Api>>()
  const officialGoogle = officialGoogleBaseURL(request)
  const baseURL = request.baseURL
  const hasBaseURL = baseURL !== undefined && baseURL.length > 0
  // Official Google is listed live even with no draft baseURL: the catalog
  // host is known, and answering from the installed snapshot would hide a
  // model the paid key already sees. A catalog route this build cannot list
  // still answers from the registry when the draft names no endpoint.
  if (officialGoogle === undefined && !hasBaseURL && installed.size > 0) {
    return [...installed.values()].map(model => ({
      id: model.id,
      name: model.name,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    }))
  }
  if (officialGoogle === undefined && !hasBaseURL) {
    throw new LlmError(
      `pi-ai ships no catalog for provider "${request.provider ?? ''}", so its models can only come from its`
      + " endpoint; set a baseURL, or enter this provider's models by hand",
      'DISCOVERY_FAILED',
    )
  }
  // A key typed into the form wins: it is the one the user is testing, and it
  // may be the replacement for exactly the stored key that is failing. The
  // stored one is only asked for here, past the catalog short-circuit and the
  // protocol check, so a route answered from the registry costs no credential
  // lookup — and no diagnostic about a credential it never needed.
  // A probe carrying no key stays unauthenticated, which is how a route that
  // relies on the provider's own ambient discovery is meant to be asked.
  const supplied = request.apiKey ?? await storedApiKey?.()
  const apiKey = supplied === undefined ? undefined : usableProbeKey(supplied)
  if (officialGoogle !== undefined) {
    if (apiKey === undefined) {
      throw new LlmError(
        'this provider\'s API key is blank; enter it on the Models page to list Google models',
        INVALID_CREDENTIAL_CODE,
      )
    }
    return mergeWithCatalog(await listGoogleModels(request, officialGoogle, apiKey), installed, modelPrefix)
  }
  // A draft that has not chosen a protocol yet is asked as OpenAI Chat
  // Completions: it is the shape a gateway is overwhelmingly likely to speak,
  // and the alternative — refusing until the field is filled — would withhold
  // the action from the case it exists for. The cost is a misdirected message
  // when the endpoint speaks something else (an Anthropic gateway answers 401,
  // which reads as a credential problem), and hand-entry remains the way out.
  const api = request.api ?? 'openai-completions'
  if (!LISTABLE_PROTOCOLS.has(api)) {
    throw new LlmError(
      `pi-ai protocol "${api}" has no model listing this build can read; enter this provider's models by hand`,
      'DISCOVERY_UNSUPPORTED',
    )
  }
  const url = listingUrl(baseURL as string)
  const listed = readListing(await fetchListingJson(url, request, {
    ...apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` },
  }))
  return mergeWithCatalog(listed, installed, modelPrefix)
}
