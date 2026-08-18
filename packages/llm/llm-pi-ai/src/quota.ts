/**
 * pi-ai provider quota queries for the balance badge (recipe §7). Only
 * providers with a real read-only balance endpoint are queried; gateway
 * subscription providers without one degrade to honest "unavailable" — never a
 * fabricated number.
 *
 * @module dsh-llm-pi-ai/quota
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmQuotaResult } from '@deepseek-ai/dsh-llm'

/** Providers this module can answer with a real endpoint. */
const QUOTABLE_PROVIDERS: ReadonlySet<string> = new Set(['openrouter'])

/**
 * Query OpenRouter's `/api/v1/key` for the current key's usage/limit.
 * OpenRouter credits are 1e-6 USD each, so the display shows a percentage
 * with a dollar-denominated tooltip.
 */
export async function queryOpenRouterBalance(apiKey: string, signal?: AbortSignal): Promise<LlmQuotaResult> {
  const url = 'https://openrouter.ai/api/v1/key'
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
      ...signal === undefined ? {} : { signal },
    })
    if (response.status === 401 || response.status === 403) {
      return { status: 'error', text: '凭证失效' }
    }
    if (!response.ok) {
      return { status: 'error', text: '查询失败' }
    }
    const body = await response.json() as { data?: { usage?: unknown; limit?: unknown } }
    const data = body.data
    if (data == null) return { status: 'unavailable', text: '余量不可查' }
    const usage = typeof data.usage === 'number' ? data.usage : Number.NaN
    const limit = typeof data.limit === 'number' ? data.limit : Number.NaN
    if (!Number.isFinite(usage) || !Number.isFinite(limit) || limit <= 0) {
      return { status: 'unavailable', text: '余量不可查' }
    }
    const remaining = Math.max(0, limit - usage)
    const pct = Math.round((remaining / limit) * 100)
    return {
      status: 'ok',
      text: `${pct}%`,
      detail: `OpenRouter 余额 ${pct}%（剩余 ${Math.round(remaining)} / ${Math.round(limit)} credits）`,
    }
  } catch (error) {
    if (signal?.aborted) {
      throw new LlmError('quota query aborted by caller', 'ABORTED', { cause: error })
    }
    return { status: 'error', text: '查询失败' }
  }
}

/** Whether a provider route has a real balance endpoint this module can read. */
export function isQuotableProvider(provider: string): boolean {
  return QUOTABLE_PROVIDERS.has(provider)
}
