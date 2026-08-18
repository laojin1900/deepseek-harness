/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort row pair (label + current value + a right chevron),
 * each drilling into its own list — the provider-grouped model list over
 * the shared directory, and the effort levels. The trigger (313:14108's
 * ToggleButton) shows both: model name + effort in the caption tone.
 * Data and submission ride the SAME per-session ModelDirectory as the
 * /model popup; exact-model reasoning metadata and the selected effort come
 * from the Host rather than a client-owned vocabulary. A rejected selection
 * announces through the shared transient Toast anchored to the composer
 * card; the in-menu strip with Retry remains the catalog-load surface.
 */
import {
  useEffect, useId, useMemo, useRef, useState, useSyncExternalStore,
  type FocusEvent, type KeyboardEvent, type ReactNode,
} from 'react'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconCloseOutline16, IconRefreshOutline16, IconWarningOutline16, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import { incrementUsageCount } from './usage.ts'
import { sortWeight, vendorOf } from './sort.ts'
import { providerKind, type ChannelKind } from './provider-labels.ts'
import { isModelVisible, readHiddenModels, rememberDefaultModel, toggleModelHidden } from './preferences.ts'
import css from './ModelSelect.module.css'

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

/** Format token capacity for context window display (e.g. 1M / 256K). */
function formatCapacity(tokens: number | undefined): string | null {
  if (typeof tokens !== 'number' || tokens <= 0) return null
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 === 0 ? 0 : 1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

/** A short localized label for the channel badge. */
function channelLabel(kind: ChannelKind, t: (key: 'channel.subscription' | 'channel.api') => string): string {
  if (kind === 'subscription') return t('channel.subscription')
  if (kind === 'api') return t('channel.api')
  return ''
}

/** Default maximum models shown per provider group before collapsing into "Show more". */
const DEFAULT_VISIBLE_MODELS = 4

/** Models in one expanded provider group beyond which a second-level vendor fold applies. */
const VENDOR_FOLD_THRESHOLD = 12

/**
 * Render the composer model seat.
 * @param props - owner share (locked) + injected face (shared directory
 * store/verbs) + the standard locale seat.
 * @returns the trigger and, while open, the two-level menu.
 */
export function ModelSelect(
  { locked, available, directory, load, loadQuota, select, t }:
  ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>,
) {
  const state = useSyncExternalStore(
    fn => directory.subscribe(fn),
    () => directory.getSnapshot(),
  )
  const [open, setOpen] = useState(false)
  const [pane, setPane] = useState<Pane>('root')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedVendors, setExpandedVendors] = useState<ReadonlySet<string>>(() => new Set())
  const [hiddenModels, setHiddenModels] = useState<ReadonlySet<string>>(() => readHiddenModels())

  const toggleGroupExpand = (groupId: string): void => {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const toggleVendor = (groupId: string, vendor: string): void => {
    const key = `${groupId}:${vendor}`
    setExpandedVendors((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  // The in-menu error strip serves catalog loads (its Retry re-runs the
  // load); a rejected SELECTION announces through the transient toast
  // instead, so the strip renders only while the latest failure-capable
  // action was a load.
  const lastActionRef = useRef<'load' | 'select'>('load')
  const [toast, setToast] = useState<{ seq: number; text: string } | null>(null)
  const toastSeq = useRef(0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()

  const choices = useMemo(() => state.groups.flatMap(group =>
    group.models.map(model => ({
      group,
      model,
      selection: {
        provider: group.id,
        model: model.id,
        ...model.reasoning?.defaultEffort === undefined
          ? {}
          : { reasoningEffort: model.reasoning.defaultEffort },
      } satisfies ModelSelection,
    }))), [state.groups])
  const selectedIndex = state.current === null
    ? -1
    : choices.findIndex(c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model)
  const currentChoice = choices[selectedIndex]
  const reasoning = currentChoice?.model.reasoning
  const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
  const effortLabel = reasoning === undefined
    ? undefined
    : effectiveEffort === undefined
      ? t('effort.providerDefault')
      : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
  const effortChoices = useMemo<readonly EffortChoice[]>(() => reasoning === undefined
    ? []
    : [
      ...reasoning.defaultEffort === undefined
        ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
        : [],
      ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
        key: `effort:${effort.id}`,
        effort: effort.id,
        label: effort.name,
        ...effort.description === undefined ? {} : { description: effort.description },
      })),
    ], [reasoning, t])
  const busy = state.status === 'selecting'

  // Smart sort (three-tier): flagship vendor base weight + bounded usage
  // frequency, tie-break with natural collation. Groups ordered by their
  // top model. Hidden models (whitelist) are filtered; search filters live.
  const sortedGroups = useMemo(() => {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    const query = searchQuery.trim().toLowerCase()

    return [...state.groups]
      .map((group) => {
        const filteredModels = group.models.filter(m =>
          isModelVisible(hiddenModels, group.id, m.id) &&
          (query.length === 0 ||
            m.id.toLowerCase().includes(query) ||
            m.name.toLowerCase().includes(query) ||
            (m.description !== undefined && m.description.toLowerCase().includes(query))),
        )
        return {
          ...group,
          models: [...filteredModels].sort((a, b) => {
            const wa = sortWeight(group.id, a.id)
            const wb = sortWeight(group.id, b.id)
            if (wa !== wb) return wb - wa
            return collator.compare(a.name, b.name)
          }),
          _topWeight: Math.max(0, ...filteredModels.map(m => sortWeight(group.id, m.id))),
        }
      })
      .filter(group => group.models.length > 0)
      .sort((a, b) => {
        if (a._topWeight !== b._topWeight) return b._topWeight - a._topWeight
        return collator.compare(a.name, b.name)
      })
  }, [state.groups, searchQuery, hiddenModels])

  const reload = (): void => {
    lastActionRef.current = 'load'
    load()
  }

  // Mount-time load resolves the trigger label; every open refreshes.
  useEffect(() => {
    if (available) {
      lastActionRef.current = 'load'
      load()
    }
  }, [available, load])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => { document.removeEventListener('mousedown', closeOutside) }
  }, [open])

  // Refresh quota answers whenever the picker opens, so provider headers show
  // fresh balances (recipe §7: one badge per provider group, not per model).
  useEffect(() => {
    if (!open) return
    for (const group of state.groups) loadQuota(group.id)
  }, [open, state.groups, loadQuota])

  if (!available) return null

  const show = (): void => {
    setPane('root')
    setExpandedGroups(new Set())
    setOpen(true)
    reload()
  }

  const close = (restoreFocus = false): void => {
    setOpen(false)
    setPane('root')
    if (restoreFocus) queueMicrotask(() => { triggerRef.current?.focus() })
  }

  const moveFocus = (offset: number): void => {
    const items = itemRefs.current.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
      if (pane !== 'root') setPane('root')
      else close(true)
      return
    }
    if (!open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (event.relatedTarget instanceof Node && rootRef.current?.contains(event.relatedTarget)) return
    close()
  }

  const settleSelection = (accepted: boolean): void => {
    if (accepted) {
      if (rootRef.current !== null) close(true)
      return
    }
    const message = directory.getSnapshot().error
    if (message !== null) {
      toastSeq.current += 1
      setToast({ seq: toastSeq.current, text: t('error.action', { message }) })
    }
  }

  const choose = (selection: ModelSelection): void => {
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      close(true)
      return
    }
    incrementUsageCount(selection.provider, selection.model)
    rememberDefaultModel(selection.provider, selection.model)
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const chooseEffort = (effort: string | undefined): void => {
    if (state.current === null) return
    if (effectiveEffort === effort) {
      close(true)
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    lastActionRef.current = 'select'
    void select(selection).then(settleSelection)
  }

  const modelLabel = currentChoice?.model.name ?? t('trigger.fallback')
  const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
  const triggerAria = currentChoice === undefined
    ? t('trigger.selectAria')
    : effortLabel === undefined
      ? t('trigger.aria', { model: modelLabel })
      : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
  itemRefs.current = []
  let itemIndex = 0
  const itemRef = () => {
    const at = itemIndex++
    return (node: HTMLButtonElement | null) => { itemRefs.current[at] = node }
  }

  return (
    <div ref={rootRef} className={css.root} onKeyDown={onRootKeyDown} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        className={css.trigger}
        aria-label={triggerAria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        title={triggerLabel}
        disabled={locked}
        onClick={() => {
          if (open) {
            close()
          } else {
            show()
          }
        }}
      >
        <span className={css.triggerLabel}>{modelLabel}</span>
        {effortLabel !== undefined && <span className={css.triggerEffort}>{effortLabel}</span>}
        <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
      </button>

      {open && (
        <div
          id={`${id}-menu`}
          className={css.menu}
          role="menu"
          aria-label={t('menu.aria')}
          aria-busy={state.status === 'loading' || busy}
        >
          {pane === 'root' && (
            <>
              <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('model') }}>
                <span className={css.cellLabel}>{t('menu.model')}</span>
                <span className={css.cellValue}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.cellChevron} />
              </button>
              {reasoning !== undefined && (
                <button ref={itemRef()} type="button" role="menuitem" className={css.cell} onClick={() => { setPane('effort') }}>
                  <span className={css.cellLabel}>{t('menu.effort')}</span>
                  <span className={css.cellValue}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.cellChevron} />
                </button>
              )}
            </>
          )}

          {pane === 'model' && (
            <>
              <div className={css.searchToolbar}>
                <input
                  type="search"
                  className={css.searchInput}
                  value={searchQuery}
                  placeholder={t('search.placeholder')}
                  aria-label={t('search.placeholder')}
                  onChange={(e) => { setSearchQuery(e.target.value) }}
                />
                <button
                  type="button"
                  className={css.refreshButton}
                  title={t('search.refresh')}
                  aria-label={t('search.refresh')}
                  onClick={reload}
                >
                  <IconRefreshOutline16 />
                </button>
              </div>
              {state.status === 'loading' && (
                <div className={css.status}>{t('status.loading')}</div>
              )}
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              )}
              {state.failures.map(failure => (
                <div className={css.warning} key={failure.id}>
                  <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('retry')}</button>
                </div>
              ))}
              <div className={clsx(css.groups, 'scrollable')}>
                {sortedGroups.map((group) => {
                  const headingId = `${id}-${group.id}`
                  const searching = searchQuery.trim().length > 0
                  // Searching bypasses collapse: the filtered set already shrinks.
                  const isExpanded = searching || expandedGroups.has(group.id)
                  const hasMore = !searching && group.models.length > DEFAULT_VISIBLE_MODELS
                  const kind = providerKind(group.id)
                  // When collapsed, show top 4 used models + ensure selected model is visible
                  const selectedModelInGroup = group.models.find(m => state.current?.provider === group.id && state.current.model === m.id)
                  let displayModels = isExpanded ? group.models : group.models.slice(0, DEFAULT_VISIBLE_MODELS)
                  if (!isExpanded && selectedModelInGroup !== undefined && !displayModels.some(m => m.id === selectedModelInGroup.id)) {
                    displayModels = [...displayModels, selectedModelInGroup]
                  }
                  const remainingCount = group.models.length - displayModels.length

                  // Second-level fold: an expanded gateway provider with many
                  // models groups them by vendor, each vendor collapsed by
                  // default so the opened list stays short.
                  const useVendorFold = isExpanded && !searching && group.models.length > VENDOR_FOLD_THRESHOLD
                  const vendorGroups = useVendorFold
                    ? [...group.models.reduce((acc, m) => {
                      const vendor = vendorOf(m.id)
                      const bucket = acc.get(vendor) ?? []
                      bucket.push(m)
                      acc.set(vendor, bucket)
                      return acc
                    }, new Map<string, typeof group.models>()).entries()]
                      .map(([vendor, models]) => ({
                        vendor,
                        models: [...models].sort((a, b) => sortWeight(group.id, b.id) - sortWeight(group.id, a.id)),
                      }))
                      .sort((a, b) => {
                        const wa = Math.max(0, ...a.models.map(m => sortWeight(group.id, m.id)))
                        const wb = Math.max(0, ...b.models.map(m => sortWeight(group.id, m.id)))
                        return wb - wa
                      })
                    : null

                  const renderModel = (model: (typeof displayModels)[number]): ReactNode => {
                    const selected = state.current?.provider === group.id && state.current.model === model.id
                    return (
                      <button
                        ref={itemRef()}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        className={clsx(css.option, selected && css.selected)}
                        key={model.id}
                        title={model.name}
                        disabled={busy}
                        onClick={() => { choose({ provider: group.id, model: model.id }) }}
                      >
                        <span className={css.optionCopy}>
                          <span className={css.modelName}>{model.name}</span>
                          {model.description !== undefined && (
                            <span className={css.description}>{model.description}</span>
                          )}
                        </span>
                        {(() => {
                          const cap = formatCapacity((model as { contextWindow?: number }).contextWindow)
                          return cap !== null ? <span className={css.capacityBadge}>{cap}</span> : null
                        })()}
                        <span className={css.check}>
                          {selected ? <IconCheckOutline16 /> : null}
                        </span>
                        <span
                          role="button"
                          tabIndex={0}
                          className={css.hideButton}
                          title={t('model.hide')}
                          aria-label={t('model.hide')}
                          onClick={(e) => {
                            e.stopPropagation()
                            setHiddenModels(toggleModelHidden(group.id, model.id))
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              e.stopPropagation()
                              setHiddenModels(toggleModelHidden(group.id, model.id))
                            }
                          }}
                        >
                          <IconCloseOutline16 size={14} />
                        </span>
                      </button>
                    )
                  }

                  return (
                    <section role="group" aria-labelledby={headingId} className={css.group} key={group.id}>
                      <div className={css.groupTitle} id={headingId}>
                        {group.name}
                        {kind !== 'neutral'
                          ? <span className={css.channelBadge} data-channel={kind}>{channelLabel(kind, t)}</span>
                          : null}
                        {(() => {
                          const quota = state.quotas[group.id]
                          if (quota === undefined) {
                            return <span className={css.quotaBadge} data-tone="loading" aria-label={t('quota.loading')} />
                          }
                          return (
                            <span className={css.quotaBadge} data-tone={quota.status} title={quota.detail}>
                              {quota.text}
                            </span>
                          )
                        })()}
                        {!searching && hasMore && !expandedGroups.has(group.id)
                          ? <span className={css.groupCountHint}>{t('group.firstOf', { count: DEFAULT_VISIBLE_MODELS, total: group.models.length })}</span>
                          : null}
                      </div>
                      {vendorGroups !== null
                        ? vendorGroups.map(({ vendor, models }) => {
                          const vendorKey = `${group.id}:${vendor}`
                          const vendorExpanded = expandedVendors.has(vendorKey)
                          return (
                            <div className={css.vendorGroup} key={vendor}>
                              <button
                                type="button"
                                className={css.vendorToggle}
                                aria-expanded={vendorExpanded}
                                onClick={() => { toggleVendor(group.id, vendor) }}
                              >
                                <span className={css.vendorChevron} aria-hidden="true">{vendorExpanded ? '▾' : '▸'}</span>
                                <span className={css.vendorName}>{vendor}</span>
                                <span className={css.vendorCount}>{models.length}</span>
                              </button>
                              {vendorExpanded ? models.map(renderModel) : null}
                            </div>
                          )
                        })
                        : displayModels.map(renderModel)}
                      {hasMore && (
                        <button
                          type="button"
                          className={css.expandToggle}
                          onClick={() => { toggleGroupExpand(group.id) }}
                        >
                          {expandedGroups.has(group.id)
                            ? t('group.collapse')
                            : t('group.expand', { count: remainingCount })}
                        </button>
                      )}
                    </section>
                  )
                })}
              </div>
              {state.status === 'ready' && choices.length === 0 && (
                <div className={css.empty}>{t('empty.models')}</div>
              )}
            </>
          )}

          {pane === 'effort' && (
            <>
              {state.error !== null && lastActionRef.current === 'load' && (
                <div className={css.error}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" className={css.retry} onClick={reload}>{t('action.reload')}</button>
                </div>
              )}
              {effortChoices.length === 0
                ? <div className={css.empty}>{t('empty.efforts')}</div>
                : effortChoices.map(level => (
                  <button
                    ref={itemRef()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={effectiveEffort === level.effort}
                    className={clsx(css.option, effectiveEffort === level.effort && css.selected)}
                    key={level.key}
                    disabled={busy}
                    onClick={() => { chooseEffort(level.effort) }}
                  >
                    <span className={css.optionCopy}>
                      <span className={css.modelName}>{level.label}</span>
                      {level.description !== undefined && (
                        <span className={css.description}>{level.description}</span>
                      )}
                    </span>
                    <span className={css.check}>
                      {effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}
                    </span>
                  </button>
                ))}
            </>
          )}
        </div>
      )}
      {toast !== null && (
        <Toast
          key={toast.seq}
          text={toast.text}
          icon={<IconWarningOutline16 />}
          anchor={rootRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null}
          onDone={() => { setToast(null) }}
        />
      )}
    </div>
  )
}
