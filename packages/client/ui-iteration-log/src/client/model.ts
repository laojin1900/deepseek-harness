/** Entry model and pure helpers for the iteration log timeline. */

/** What one entry changed, the filter axis users care about. */
export const KINDS = ['feature', 'skill', 'plugin', 'core', 'fix', 'docs'] as const
export type IterationLogKind = typeof KINDS[number]

/** Whether the change ships with the codebase or happened on this machine. */
export const SCOPES = ['system', 'local'] as const
export type IterationLogScope = typeof SCOPES[number]

/** One curated iteration entry; bilingual content follows the settings convention. */
export interface IterationLogEntry {
  /** Stable identity across builds; unique within the log. */
  readonly id: string
  /** ISO calendar date (YYYY-MM-DD). */
  readonly date: string
  /** Optional release anchor this entry ships in. */
  readonly version?: string
  /** Change classification. */
  readonly kind: IterationLogKind
  /** System (codebase) or local (this machine) scope. */
  readonly scope: IterationLogScope
  /** Simplified Chinese title. */
  readonly title: string
  /** English title. */
  readonly titleEn: string
  /** Simplified Chinese Markdown detail. */
  readonly detail: string
  /** English Markdown detail. */
  readonly detailEn: string
}

/**
 * Newest-first ordering by date; same-day entries keep authoring order
 * (a stable sort, so the curated file controls same-day precedence).
 */
export function sortEntries(entries: readonly IterationLogEntry[]): IterationLogEntry[] {
  return [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}

/** Whether an entry passes the active kind, scope, and text filters. */
export function entryMatches(
  entry: IterationLogEntry,
  filters: { kind: IterationLogKind | null; scope: IterationLogScope | null; query: string },
): boolean {
  if (filters.kind !== null && entry.kind !== filters.kind) return false
  if (filters.scope !== null && entry.scope !== filters.scope) return false
  const needle = filters.query.trim().toLocaleLowerCase()
  if (needle.length === 0) return true
  return [
    entry.title, entry.titleEn, entry.detail, entry.detailEn,
    entry.version ?? '', entry.id,
  ].some(value => value.toLocaleLowerCase().includes(needle))
}
