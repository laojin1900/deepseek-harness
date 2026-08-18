/** Iteration-log timeline registered into Web Settings. */

import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { IterationLogSection, type IterationLogSectionInjected } from './IterationLogSection.tsx'
import { en, zh, type IterationLogLocaleKey } from './locales.ts'

export type { IterationLogSectionInjected, IterationLogSectionProps } from './IterationLogSection.tsx'
export type { IterationLogLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Iteration-log timeline copy. */
    'settings.iterationLog': IterationLogLocaleKey
  }
}

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.iterationLog'

/** Services required by the Settings registration. */
export const inject = ['slots', 'locale']

/** Contribute the iteration-log section to Web Settings. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-iteration-log: dictionaries')

  const t = ctx.locale.bind(NS)
  const injected = (): IterationLogSectionInjected => ({ locale: ctx.locale })

  // Ordered right after Plugins: plugin/skill changes are the entries users
  // most often cross-check against the settings the panel manages.
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'iteration-log',
    order: 18,
    label: () => t('nav'),
    locale: NS,
    inject: injected,
  }, IterationLogSection))
}
