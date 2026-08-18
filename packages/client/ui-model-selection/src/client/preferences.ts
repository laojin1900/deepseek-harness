/**
 * Per-user model preferences persisted outside the catalog (recipe §10):
 * a hidden-models list (empty = show all) so users can hide models they
 * never want, and the last selected provider:model as the remembered default.
 */

const HIDDEN_KEY = 'dsh-model-hidden-models'
const DEFAULT_KEY = 'dsh-model-default'

/** Read the hidden-models set; empty means "show all". */
export function readHiddenModels(): ReadonlySet<string> {
  if (typeof localStorage === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    if (raw === null) return new Set()
    const parsed = JSON.parse(raw) as string[]
    return new Set(parsed)
  } catch {
    return new Set()
  }
}

/** Whether a model is visible, given the hidden set (empty = all visible). */
export function isModelVisible(hidden: ReadonlySet<string>, provider: string, modelId: string): boolean {
  return !hidden.has(`${provider}/${modelId}`)
}

/** Toggle one model's hidden state, returning the new hidden set. */
export function toggleModelHidden(provider: string, modelId: string): ReadonlySet<string> {
  const key = `${provider}/${modelId}`
  const next = new Set(readHiddenModels())
  if (next.has(key)) next.delete(key)
  else next.add(key)
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]))
    } catch {
      // Quota/serialization failure: the in-memory set still works this session.
    }
  }
  return next
}

/** Read the remembered default provider:model, or null. */
export function readDefaultModel(): { provider: string; model: string } | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(DEFAULT_KEY)
    if (raw === null) return null
    return JSON.parse(raw) as { provider: string; model: string }
  } catch {
    return null
  }
}

/** Remember the last selected provider:model as the default. */
export function rememberDefaultModel(provider: string, modelId: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(DEFAULT_KEY, JSON.stringify({ provider, model: modelId }))
  } catch {
    // Persistence is best-effort; selection still works this session.
  }
}
