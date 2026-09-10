// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ComponentProps } from 'react'
import type { ModelDirectoryState } from '../src/client/directory.ts'
import { ModelSelect } from '../src/client/ModelSelect.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'

// The seat's key domain is model ∪ common; the stub mirrors the real lookup
// chain: package dictionary, then common vocabulary, then the key.
const t: ComponentProps<typeof ModelSelect>['t'] = (key, params) => {
  const template = (zh as Record<string, string>)[key]
    ?? (commonZh as Record<string, string>)[key]
    ?? key
  return params === undefined
    ? template
    : template.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match)
}

const reasoning = {
  efforts: [
    { id: 'off', name: 'Off' },
    { id: 'high', name: 'High' },
    { id: 'max', name: 'Max', description: 'Largest budget' },
  ],
  defaultEffort: 'high',
}

function state(overrides: Partial<ModelDirectoryState> = {}): ModelDirectoryState {
  return {
    current: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    routable: true,
    groups: [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [{
        id: 'deepseek-v4-flash',
        name: 'DeepSeek-V4-Flash',
        description: 'Fast catalog description',
        reasoning,
      }],
    }],
    failures: [],
    quotas: {},
    status: 'ready',
    error: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe('ModelSelect reasoning effort', () => {
  it('renders effort names without descriptions and submits the effort as part of the session selection', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    const select = vi.fn(async (selection: ModelSelection) => {
      directory.set(state({ current: selection }))
      return true
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      loadQuota={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', {
      name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
    })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Off', 'High', 'Max'])
    expect(screen.queryByText('Largest budget')).toBeNull()

    fireEvent.click(screen.getByRole('menuitemradio', { name: /Max/ }))
    await waitFor(() => {
      expect(select).toHaveBeenCalledWith({
        provider: 'deepseek-official',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'max',
      })
      expect(trigger.getAttribute('aria-label')).toBe('选择模型，当前 DeepSeek-V4-Flash，推理等级 Max')
    })
  })

  it('offers provider default only when the adapter does not configure a model default', () => {
    const directory = createSnapshotStore(state({
      groups: [{
        id: 'provider',
        name: 'Provider',
        models: [{
          id: 'model',
          name: 'Model',
          reasoning: { efforts: [{ id: 'standard', name: 'Standard' }] },
        }],
      }],
      current: { provider: 'provider', model: 'model' },
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      loadQuota={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', {
      name: '选择模型，当前 Model，推理等级 Default',
    }))
    fireEvent.click(screen.getByRole('menuitem', { name: /推理等级/ }))
    expect(screen.getAllByRole('menuitemradio').map(item => item.textContent))
      .toEqual(['Default', 'Standard'])
  })

  it('shows the durable model id when the catalog has no matching display name', () => {
    const directory = createSnapshotStore(state({
      current: { provider: 'deepseek-official', model: 'removed-model' },
    }))
    const select = vi.fn().mockResolvedValue(true)
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      loadQuota={vi.fn()}
      select={select}
      t={t}
    />)

    const trigger = screen.getByRole('button', { name: '选择模型，当前 deepseek-official/removed-model' })
    expect(trigger.textContent).toContain('deepseek-official/removed-model')
    fireEvent.click(trigger)
    expect(screen.queryByRole('menuitem', { name: /推理等级/ })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    expect(screen.queryByRole('menuitemradio', { name: 'removed-model' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
    expect(screen.queryByText('Fast catalog description')).toBeNull()
  })

  it('shows loading until the catalog and Session projection are both ready', async () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      current: null,
      routable: null,
      groups: [],
      status: 'loading',
    }))
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      loadQuota={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)

    expect(screen.getByRole('button', { name: '正在加载模型…' }).textContent)
      .toContain('正在加载模型…')
    directory.set(state())
    await waitFor(() => {
      expect(screen.getByRole('button', {
        name: '选择模型，当前 DeepSeek-V4-Flash，推理等级 High',
      })).toBeTruthy()
    })
  })

  it('announces a rejected selection as a transient toast and keeps the in-menu strip for loads', async () => {
    const groups = [{
      id: 'deepseek-official',
      name: 'DeepSeek',
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', reasoning },
        { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
      ],
    }]
    const directory = createSnapshotStore<ModelDirectoryState>(state({ groups }))
    const select = vi.fn(async () => {
      directory.set(state({ groups, status: 'error', error: 'session/model-unavailable: session already contains images' }))
      return false
    })
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      loadQuota={vi.fn()}
      select={select}
      t={t}
    />)

    fireEvent.click(screen.getByRole('button', { name: /选择模型|当前/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek-V4-Pro/ }))
    const toast = await screen.findByRole('alert')
    expect(toast.textContent).toContain('模型操作失败：session/model-unavailable: session already contains images')
    // The selection failure does not render the in-menu load strip (no Retry).
    expect(screen.queryByRole('button', { name: '重试' })).toBeNull()
  })

  it('portals the placed menu card to body and closes only on truly-outside mousedown', () => {
    const offsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!
    const offsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')!
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 200 })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 300 })
    try {
      const { container } = render(<ModelSelect
        locked={false}
        available
        directory={createSnapshotStore(state())}
        load={vi.fn()}
        select={vi.fn().mockResolvedValue(true)}
        t={t}
      />)
      const trigger = screen.getByRole('button', { name: /选择模型/ })
      fireEvent.click(trigger)
      const menu = screen.getByRole('menu')
      // Outside the composer subtree — column overflow clips cannot crop it.
      expect(container.contains(menu)).toBe(false)
      expect(menu.parentElement).toBe(document.body)
      // jsdom anchor rects are all zero, so the measured 200x300 card clamps
      // to the 12px viewport margin on both axes.
      expect(menu.style.left).toBe('12px')
      expect(menu.style.top).toBe('12px')
      // Interactions inside the trigger subtree or the portaled card stay open.
      fireEvent.mouseDown(menu)
      fireEvent.mouseDown(trigger)
      fireEvent.blur(trigger, { relatedTarget: menu })
      expect(screen.getByRole('menu')).toBeTruthy()
      fireEvent.mouseDown(document.body)
      expect(screen.queryByRole('menu')).toBeNull()
    } finally {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidth)
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeight)
    }
  })

  it('renders no Agent-bound control for an addressed subagent session', () => {
    const load = vi.fn()
    render(<ModelSelect
      locked={false}
      available={false}
      directory={createSnapshotStore(state())}
      load={load}
      loadQuota={vi.fn()}
      select={vi.fn().mockResolvedValue(false)}
      t={t}
    />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(load).not.toHaveBeenCalled()
  })
})

describe('ModelSelect vendor fold', () => {
  const multiVendor = () => [{
    id: 'b-ai',
    name: 'b.ai',
    models: [
      { id: 'minimax-m3', name: 'MiniMax-M3' },
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'kimi-k2.5', name: 'Kimi-K2.5' },
    ],
  }]

  function openModelPane(directory: ReturnType<typeof createSnapshotStore<ModelDirectoryState>>) {
    render(<ModelSelect
      locked={false}
      available
      directory={directory}
      load={vi.fn()}
      loadQuota={vi.fn()}
      select={vi.fn().mockResolvedValue(true)}
      t={t}
    />)
    fireEvent.click(screen.getByRole('button', { name: /选择模型/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /模型/ }))
  }

  it('folds into vendor sub-groups, collapsed except the current selection', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups: multiVendor(),
      current: { provider: 'b-ai', model: 'kimi-k2.5' },
    }))
    openModelPane(directory)

    expect(screen.getByRole('button', { name: /展开 MiniMax/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: /展开 GLM/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.getByRole('button', { name: /收起 Kimi/ }).getAttribute('aria-expanded')).toBe('true')

    expect(screen.queryByRole('menuitemradio', { name: 'MiniMax-M3' })).toBeNull()
    expect(screen.queryByRole('menuitemradio', { name: 'GLM-5.2' })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'Kimi-K2.5' })).toBeTruthy()
  })

  it('toggles a vendor sub-group open and shut', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups: multiVendor(),
      current: { provider: 'b-ai', model: 'kimi-k2.5' },
    }))
    openModelPane(directory)

    fireEvent.click(screen.getByRole('button', { name: /展开 MiniMax/ }))
    expect(screen.getByRole('menuitemradio', { name: 'MiniMax-M3' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /收起 MiniMax/ }))
    expect(screen.queryByRole('menuitemradio', { name: 'MiniMax-M3' })).toBeNull()
  })

  it('renders a single-vendor provider flat, without a vendor header', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state())
    openModelPane(directory)

    expect(screen.queryByRole('button', { name: /展开/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /收起/ })).toBeNull()
    expect(screen.getByRole('menuitemradio', { name: 'DeepSeek-V4-Flash' })).toBeTruthy()
  })

  /** Six vendors: weight order is DeepSeek, Qwen, Kimi, GLM, Grok, MiniMax. */
  const manyVendors = () => [{
    id: 'b-ai',
    name: 'b.ai',
    models: [
      { id: 'minimax-m3', name: 'MiniMax-M3' },
      { id: 'glm-5.2', name: 'GLM-5.2' },
      { id: 'kimi-k2.5', name: 'Kimi-K2.5' },
      { id: 'deepseek-v3.2', name: 'DeepSeek-V3.2' },
      { id: 'qwen3-max', name: 'Qwen3-Max' },
      { id: 'grok-4', name: 'Grok-4' },
    ],
  }]

  it('keeps four vendors plus the current one, unfolding the rest on demand', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups: manyVendors(),
      current: { provider: 'b-ai', model: 'deepseek-v3.2' },
    }))
    openModelPane(directory)

    // The four heaviest vendors; the current vendor is the expanded one.
    expect(screen.getByRole('button', { name: /收起 DeepSeek/ })).toBeTruthy()
    for (const vendor of ['Qwen', 'Kimi', 'GLM']) {
      expect(screen.getByRole('button', { name: `展开 ${vendor} 的模型` }).getAttribute('aria-expanded')).toBe('false')
    }
    expect(screen.queryByRole('button', { name: /Grok/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /MiniMax/ })).toBeNull()

    const fold = screen.getByRole('button', { name: /显示更多/ })
    expect(fold.textContent).toBe('显示更多（还有 2 个）前 4/6')
    fireEvent.click(fold)
    expect(screen.getByRole('button', { name: /展开 Grok/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /展开 MiniMax/ })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '收起列表' }))
    expect(screen.queryByRole('button', { name: /Grok/ })).toBeNull()
    expect(screen.getByRole('button', { name: /显示更多/ })).toBeTruthy()
  })

  it('always shows the current selection vendor even past the fold', () => {
    const directory = createSnapshotStore<ModelDirectoryState>(state({
      groups: manyVendors(),
      current: { provider: 'b-ai', model: 'minimax-m3' },
    }))
    openModelPane(directory)

    // MiniMax is the lightest vendor (outside the four kept) yet the current
    // selection keeps it visible, expanded, and reachable.
    expect(screen.getByRole('button', { name: /收起 MiniMax/ })).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: 'MiniMax-M3' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Grok/ })).toBeNull()
    expect(screen.getByRole('button', { name: /显示更多/ }).textContent)
      .toBe('显示更多（还有 1 个）前 5/6')
  })
})
