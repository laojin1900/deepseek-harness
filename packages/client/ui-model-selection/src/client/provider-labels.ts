/**
 * Central provider channel-kind map — the single source of truth for which
 * providers are subscription-quota channels, pay-per-use API channels, or
 * neutral (recipe §5: never scatter these labels across components).
 */

export type ChannelKind = 'subscription' | 'api' | 'neutral'

const PROVIDER_KINDS: Readonly<Record<string, ChannelKind>> = {
  'qwen-token-plan-cn': 'subscription',
  dashscope: 'api',
  'b-ai': 'api',
  openrouter: 'api',
  google: 'api',
  'deepseek-official': 'api',
  gateway01: 'neutral',
}

/** The channel kind for a provider id, defaulting to neutral. */
export function providerKind(providerId: string): ChannelKind {
  return PROVIDER_KINDS[providerId] ?? 'neutral'
}
