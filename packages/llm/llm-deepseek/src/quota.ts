/**
 * DeepSeek account-balance query for the quota badge (recipe §7). Reads the
 * OpenAI-compatible `GET /user/balance` endpoint; the reply is shaped for
 * direct display with an explicit reliability status.
 *
 * @module dsh-llm-deepseek/quota
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmQuotaResult } from '@deepseek-ai/dsh-llm'

/** One entry of a DeepSeek `/user/balance` reply. */
interface BalanceInfo {
  currency?: unknown
  total_balance?: unknown
  granted_balance?: unknown
  topped_up_balance?: unknown
}

/** Query the DeepSeek account balance, never throwing on provider failure. */
export async function queryBalance(
  baseURL: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<LlmQuotaResult> {
  const url = `${baseURL.replace(/\/+$/, '')}/user/balance`
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${apiKey}` },
      ...signal === undefined ? {} : { signal },
    })
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { status: 'error', text: '凭证失效' }
      }
      return { status: 'error', text: '查询失败' }
    }
    const body = await response.json() as { balance_infos?: unknown }
    const infos = body.balance_infos
    if (!Array.isArray(infos) || infos.length === 0) {
      return { status: 'unavailable', text: '余量不可查' }
    }
    const info = infos[0] as BalanceInfo
    const currency = typeof info.currency === 'string' ? info.currency : ''
    const total = info.total_balance
    if (typeof total !== 'string' && typeof total !== 'number') {
      return { status: 'unavailable', text: '余量不可查' }
    }
    const readable = (value: unknown): string => (typeof value === 'string' || typeof value === 'number') ? String(value) : '—'
    return {
      status: 'ok',
      text: `${String(total)}${currency.length > 0 ? ` ${currency}` : ''}`,
      detail: `DeepSeek 余额：${String(total)} ${currency}`
        + `（赠送 ${readable(info.granted_balance)} + 充值 ${readable(info.topped_up_balance)}）`,
    }
  } catch (error) {
    if (signal?.aborted) {
      throw new LlmError('quota query aborted by caller', 'ABORTED', { cause: error })
    }
    return { status: 'error', text: '查询失败' }
  }
}
