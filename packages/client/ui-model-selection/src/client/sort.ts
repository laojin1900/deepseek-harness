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
