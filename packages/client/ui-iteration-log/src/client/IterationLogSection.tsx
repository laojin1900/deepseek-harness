/** Settings section rendering the curated iteration log timeline. */

import { useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { LocaleId } from '@deepseek-ai/dsh-client-locale/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ENTRIES } from './entries.ts'
import { KINDS, entryMatches, sortEntries } from './model.ts'
import type { IterationLogKind, IterationLogScope } from './model.ts'
import type { IterationLogLocaleKey } from './locales.ts'
import css from './IterationLogSection.module.css'

/** Minimal LocaleFace the section subscribes for active-language selection. */
export interface IterationLogSectionInjected {
  /** Active-language selection face of the shared locale runtime. */
  locale: {
    getSnapshot: () => { active: LocaleId }
    subscribe: (listener: () => void) => () => void
  }
}

/** Full component props assembled by the Settings slot renderer. */
export type IterationLogSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.iterationLog'>
  & InjectFace<IterationLogSectionInjected>

type Filters = { kind: IterationLogKind | null; scope: IterationLogScope | null; query: string }

const KIND_KEYS = {
  feature: 'kindFeature', skill: 'kindSkill', plugin: 'kindPlugin',
  core: 'kindCore', fix: 'kindFix', docs: 'kindDocs',
} satisfies Record<IterationLogKind, IterationLogLocaleKey>

/** One entry card: date, version anchor, kind/scope badges, bilingual title, collapsible detail. */
function EntryCard({ entry, zh, t }: {
  entry: ReturnType<typeof sortEntries>[number]
  zh: boolean
  t: IterationLogSectionProps['t']
}): ReactNode {
  const [open, setOpen] = useState(false)
  const title = zh ? entry.title : entry.titleEn
  const detail = zh ? entry.detail : entry.detailEn
  const toggle = (): void => { setOpen(value => !value) }
  return (
    <li className={css.card} data-entry={entry.id} data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className={css.cardHeader}
        aria-expanded={open}
        onClick={toggle}
      >
        <time className={css.date} dateTime={entry.date}>{entry.date}</time>
        <span className={css.kindBadge} data-kind={entry.kind}>{t(KIND_KEYS[entry.kind])}</span>
        <span className={css.scopeBadge} data-scope={entry.scope}>
          {t(entry.scope === 'system' ? 'scopeSystem' : 'scopeLocal')}
        </span>
        <strong className={css.title}>{title}</strong>
        {entry.version === undefined ? null : <span className={css.version}>{entry.version}</span>}
        <span className={css.chevron} aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>
      {open ? (
        <div className={css.detail}>
          <MarkdownText text={detail} />
        </div>
      ) : null}
    </li>
  )
}

/** Render the iteration-log timeline section. */
export function IterationLogSection({ t, locale }: IterationLogSectionProps): ReactNode {
  const active = useSyncExternalStore(
    callback => locale.subscribe(callback),
    () => locale.getSnapshot().active,
  )
  const zh = active === 'zh'
  const [filters, setFilters] = useState<Filters>({ kind: null, scope: null, query: '' })
  const entries = useMemo(() => sortEntries(ENTRIES), [])
  const visible = useMemo(
    () => entries.filter(entry => entryMatches(entry, filters)),
    [entries, filters],
  )

  const kindChip = (kind: IterationLogKind): ReactNode => (
    <button
      key={kind}
      type="button"
      className={css.chip}
      data-active={filters.kind === kind ? 'true' : undefined}
      data-kind={kind}
      onClick={() => {
        setFilters(current => ({ ...current, kind: current.kind === kind ? null : kind }))
      }}
    >
      {t(KIND_KEYS[kind])}
    </button>
  )
  const scopeChip = (scope: IterationLogScope | null, label: string): ReactNode => (
    <button
      key={scope ?? 'all'}
      type="button"
      className={css.chip}
      data-active={filters.scope === scope ? 'true' : undefined}
      onClick={() => { setFilters(current => ({ ...current, scope })) }}
    >
      {label}
    </button>
  )

  return (
    <div className={css.section}>
      <p className={css.intro}>{t('intro')}</p>
      <div className={css.toolbar}>
        <div className={css.chipRow} role="group" aria-label={t('kinds')}>
          {scopeChip(null, t('scopeAll'))}
          {scopeChip('system', t('scopeSystem'))}
          {scopeChip('local', t('scopeLocal'))}
        </div>
        <div className={css.chipRow} role="group" aria-label={t('kinds')}>
          {KINDS.map(kindChip)}
        </div>
        <input
          className={css.searchInput}
          type="search"
          value={filters.query}
          placeholder={t('search')}
          aria-label={t('search')}
          onChange={(event) => {
            const value = event.currentTarget.value
            setFilters(current => ({ ...current, query: value }))
          }}
        />
      </div>
      <p className={css.count} role="status">{t('count', { count: visible.length })}</p>
      {visible.length === 0 ? (
        <p className={css.empty}>{entries.length === 0 ? t('empty') : t('emptySearch')}</p>
      ) : (
        <ol className={css.timeline}>
          {visible.map(entry => <EntryCard key={entry.id} entry={entry} zh={zh} t={t} />)}
        </ol>
      )}
    </div>
  )
}
