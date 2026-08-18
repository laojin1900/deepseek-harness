/**
 * Client-side model usage tracking: a persistent per-`${provider}:${modelId}`
 * count in localStorage, incremented on every model selection. The count
 * drives the smart sort (most-used models float to the top of the picker).
 */

const STORAGE_KEY = 'dsh-model-usage-counts'

/** Read the persisted usage counts as a plain map. */
export function readUsageCounts(): Map<string, number> {
  if (typeof localStorage === 'undefined') return new Map()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return new Map()
    const parsed = JSON.parse(raw) as Record<string, number>
    return new Map(Object.entries(parsed))
  } catch {
    return new Map()
  }
}

/** Increment the usage count for one provider:model pair, persisting immediately. */
export function incrementUsageCount(provider: string, modelId: string): void {
  if (typeof localStorage === 'undefined') return
  const key = `${provider}:${modelId}`
  const counts = readUsageCounts()
  counts.set(key, (counts.get(key) ?? 0) + 1)
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(counts)))
  } catch {
    // Quota or serialization failure: the count stays in memory for this
    // session; the sort still benefits even if the next load starts fresh.
  }
}

/** The usage count for one provider:model pair, or 0 when never used. */
export function usageCount(provider: string, modelId: string): number {
  return readUsageCounts().get(`${provider}:${modelId}`) ?? 0
}
