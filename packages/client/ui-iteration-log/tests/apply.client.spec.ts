/**
 * Registration: one apply contributes the localized settings section and
 * defers until the settings.section slot has been declared.
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { SlotRegistry } from '@deepseek-ai/dsh-client-runtime/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { usePinnedBrowserLanguages } from '@deepseek-ai/dsh-client-test-runtime'
import { apply, inject } from '../src/client/index.ts'
import { IterationLogSection } from '../src/client/IterationLogSection.tsx'

// These specs assert the shipped Chinese copy, so they state the browser they assume.
usePinnedBrowserLanguages('zh-CN')

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const locale = new LocaleRuntime(ctx)
  ctx.provide('locale', locale)
  return { ctx, slots: ctx.get('slots') as SlotRegistry }
}

function declareRoot(slots: SlotRegistry): () => void {
  return slots.register({
    name: 'root',
    children: {
      'settings.section': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
}

describe('ui-iteration-log apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual(['slots', 'locale'])
  })

  it('registers the iteration-log settings section', async () => {
    const { ctx, slots } = await bench()
    declareRoot(slots)

    await ctx.plugin({ inject: [...inject], apply }).await()

    const section = slots.entries('settings.section')[0]!
    expect(section.component).toBe(IterationLogSection)
    expect(section.options).toMatchObject({ id: 'iteration-log', order: 18 })
    expect(resolveSlotLabel(section.options.label)).toBe('迭代日志')
  })

  it('registers into a declaration that arrives after apply', async () => {
    const { ctx, slots } = await bench()

    await ctx.plugin({ inject: [...inject], apply }).await()
    expect(slots.entries('settings.section')).toHaveLength(0)

    declareRoot(slots)
    const section = slots.entries('settings.section')[0]!
    expect(section.component).toBe(IterationLogSection)
    expect(section.options).toMatchObject({ id: 'iteration-log', order: 18 })
  })
})
