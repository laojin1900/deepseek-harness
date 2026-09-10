/**
 * Smart-sort weight (three-tier, usage-driven), per the
 * model-subscription-api-dual-channel recipe §4:
 *
 *   weight(modelId, provider) = baseWeight(flag-vendor, take max)
 *                             + min(100, usageCount * 10)
 *
 * Flagship vendors start higher regardless of recent usage, so a model the
 * user hasn't touched lately still outranks a low-weight vendor's frequent
 * model. Ties fall back to natural collation in the picker.
 */

import { usageCount } from './usage.ts'

/**
 * Flag-vendor base weights. The recipe requires this table to be configurable
 * rather than hard-coded, because each deployment's flagship vendors differ.
 */
const FLAG_VENDOR_WEIGHTS: Readonly<Record<string, number>> = {
  deepseek: 90,
  qwen: 85,
  claude: 82,
  anthropic: 82,
  openai: 82,
  gpt: 82,
  google: 80,
  gemini: 80,
  antigravity: 78,
  kimi: 78,
  glm: 75,
  grok: 75,
  xai: 75,
  minimax: 72,
}

/** Highest flag-vendor base weight for one provider:model pair. */
export function baseWeight(provider: string, modelId: string): number {
  const haystack = `${provider}/${modelId}`.toLowerCase()
  let weight = 0
  for (const [vendor, base] of Object.entries(FLAG_VENDOR_WEIGHTS)) {
    if (haystack.includes(vendor)) weight = Math.max(weight, base)
  }
  return weight
}

/** Combined sort weight: flagship base plus bounded usage frequency. */
export function sortWeight(provider: string, modelId: string): number {
  return baseWeight(provider, modelId) + Math.min(100, usageCount(provider, modelId) * 10)
}

/**
 * Extract the vendor a model id belongs to, for the second-level fold inside
 * large gateway providers. Handles the common shapes:
 *   `openrouter/anthropic/claude-sonnet` → `anthropic`
 *   `ai21/jamba-large`                    → `ai21`
 *   `auto/best-coding`                    → `auto`
 *   `minimax-m3` / `glm-5.2` / `kimi-k2.5` → `minimax` / `glm` / `kimi`
 */
export function vendorOf(modelId: string): string {
  const parts = modelId.split('/')
  const first = parts[0] ?? ''
  // A gateway prefix (openrouter, tllm, …) wraps the real vendor as the
  // second segment; a bare `vendor/model` keeps the first.
  if (parts.length >= 3 && first.toLowerCase() === 'openrouter') {
    return (parts[1] ?? '').toLowerCase()
  }
  if (parts.length >= 2) {
    return first.toLowerCase()
  }
  // Slash-free ids (`qwen3.6-flash`, `glm-5.2`, `minimax-m3`): match a known
  // brand prefix first, then fall back to the leading alpha token.
  const lower = modelId.toLowerCase()
  for (const vendor of Object.keys(FLAG_VENDOR_WEIGHTS)) {
    if (lower.startsWith(vendor)) return vendor
  }
  const match = /^([a-zA-Z][a-zA-Z0-9]*)/.exec(lower)
  return (match?.[1] ?? lower)
}

/** One vendor sub-group inside a provider (the second-level fold). */
export interface VendorGroup<M> {
  /** Lowercase vendor token from {@link vendorOf}. */
  readonly vendor: string
  readonly models: readonly M[]
}

/**
 * Bucket already-sorted models into vendor sub-groups, preserving per-vendor
 * order. Vendor groups order by their top model's {@link sortWeight},
 * tie-broken alphabetically, so flagship vendors float to the top of a large
 * gateway provider.
 */
export function groupByVendor<M extends { id: string }>(
  providerId: string,
  models: readonly M[],
): readonly VendorGroup<M>[] {
  const order: string[] = []
  const buckets = new Map<string, M[]>()
  for (const model of models) {
    const vendor = vendorOf(model.id)
    const bucket = buckets.get(vendor)
    if (bucket === undefined) {
      buckets.set(vendor, [model])
      order.push(vendor)
    } else {
      bucket.push(model)
    }
  }
  const groups: VendorGroup<M>[] = []
  for (const vendor of order) {
    const bucket = buckets.get(vendor)
    if (bucket !== undefined) groups.push({ vendor, models: bucket })
  }
  return groups.sort((a, b) => {
    const wa = Math.max(0, ...a.models.map(model => sortWeight(providerId, model.id)))
    const wb = Math.max(0, ...b.models.map(model => sortWeight(providerId, model.id)))
    if (wa !== wb) return wb - wa
    return a.vendor.localeCompare(b.vendor)
  })
}

/** Display names for known vendor tokens; anything else falls back to title-case. */
const VENDOR_NAMES: Readonly<Record<string, string>> = {
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  claude: 'Claude',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gpt: 'GPT',
  google: 'Google',
  gemini: 'Gemini',
  antigravity: 'Antigravity',
  kimi: 'Kimi',
  glm: 'GLM',
  grok: 'Grok',
  xai: 'xAI',
  minimax: 'MiniMax',
  ai21: 'AI21',
  amazon: 'Amazon',
}

/** Human-readable vendor name for the fold header. */
export function vendorLabel(vendor: string): string {
  return VENDOR_NAMES[vendor] ?? vendor.charAt(0).toUpperCase() + vendor.slice(1)
}
