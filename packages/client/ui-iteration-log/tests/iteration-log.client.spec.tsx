// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IterationLogSection } from '../src/client/IterationLogSection.tsx'
import type {
  IterationLogSectionInjected,
  IterationLogSectionProps,
} from '../src/client/IterationLogSection.tsx'
import { ENTRIES } from '../src/client/entries.ts'
import { en, type IterationLogLocaleKey } from '../src/client/locales.ts'

afterEach(cleanup)

const t: (key: IterationLogLocaleKey, params?: Record<string, unknown>) => string = (key, params) => {
  const template = en[key]
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]))
}

/** A subscribed locale face; flipping `active` notifies like the real runtime. */
function localeFace(active: 'zh' | 'en' = 'zh'): {
  injected: IterationLogSectionInjected
  setActive: (next: 'zh' | 'en') => void
} {
  const listeners = new Set<() => void>()
  const snapshot: { active: 'zh' | 'en' } = { active }
  return {
    injected: {
      locale: {
        getSnapshot: () => snapshot,
        subscribe: (listener) => {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
      },
    },
    setActive: (next) => {
      snapshot.active = next
      for (const listener of [...listeners]) listener()
    },
  }
}

function props(injected: IterationLogSectionInjected): IterationLogSectionProps {
  return { t, ...injected } as IterationLogSectionProps
}

describe('IterationLogSection', () => {
  it('renders every curated entry newest first with kind badges', () => {
    render(<IterationLogSection {...props(localeFace().injected)} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(ENTRIES.length)
    // First authored entry (the newest date) leads the timeline.
    expect(items[0]?.getAttribute('data-entry')).toBe(ENTRIES[0]?.id)
    expect(screen.getByText(ENTRIES[0]!.title)).toBeTruthy()
    // Chips and badges both carry kind/scope copy, so counts must match the sets.
    expect(screen.getAllByText(en.kindFeature).length).toBeGreaterThan(1)
    expect(screen.getAllByText(en.scopeSystem).length).toBeGreaterThan(1)
    expect(screen.getAllByText(en.scopeLocal).length).toBeGreaterThan(1)
  })

  it('expands and collapses one entry detail', () => {
    const first = ENTRIES[0]!
    render(<IterationLogSection {...props(localeFace().injected)} />)
    const header = screen.getByRole('button', { name: new RegExp(first.title) })
    expect(header.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(header)
    expect(header.getAttribute('aria-expanded')).toBe('false')
  })

  it('filters by kind and by scope independently', () => {
    render(<IterationLogSection {...props(localeFace().injected)} />)
    const kindCount = ENTRIES.filter(entry => entry.kind === 'plugin').length
    const pluginChip = screen.getByRole('button', { name: en.kindPlugin })
    fireEvent.click(pluginChip)
    expect(screen.getAllByRole('listitem')).toHaveLength(kindCount)
    // The kind filter alone keeps both scopes; stacking the scope filter narrows.
    fireEvent.click(screen.getByRole('button', { name: en.scopeLocal }))
    const both = ENTRIES.filter(entry => entry.kind === 'plugin' && entry.scope === 'local')
    expect(screen.getAllByRole('listitem')).toHaveLength(both.length)
  })

  it('searches bilingual content and reports the empty state', () => {
    render(<IterationLogSection {...props(localeFace().injected)} />)
    const search = screen.getByRole('searchbox', { name: en.search })
    fireEvent.change(search, { target: { value: 'qwen-mm-plugins' } })
    expect(screen.getAllByRole('listitem')).toHaveLength(
      ENTRIES.filter(entry => entry.id.includes('qwen-mm-plugins')).length,
    )
    fireEvent.change(search, { target: { value: 'no-such-entry' } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(en.emptySearch)).toBeTruthy()
  })

  it('switches entry titles to English when the locale flips', () => {
    const face = localeFace('zh')
    render(<IterationLogSection {...props(face.injected)} />)
    const first = ENTRIES[0]!
    expect(screen.getByText(first.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: en.kindFeature })) // any interaction, then flip
    act(() => { face.setActive('en') })
    expect(screen.getByText(first.titleEn)).toBeTruthy()
    expect(screen.queryByText(first.title)).toBeNull()
  })

  it('unsubscribes through the returned teardown on unmount', () => {
    const off = vi.fn()
    const subscribe = vi.fn((_listener: () => void) => off)
    const view = render(<IterationLogSection {...props({
      locale: { getSnapshot: () => ({ active: 'zh' as const }), subscribe },
    })} />)
    expect(subscribe).toHaveBeenCalledOnce()
    view.unmount()
    expect(off).toHaveBeenCalled()
  })
})
