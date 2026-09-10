import { setTimeout as delay } from 'node:timers/promises'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationPrompt } from '@deepseek-ai/dsh-authorization/types'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import { remoteErrorOf, remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import AuthorizationController from '../src/authorization.ts'
import type { AuthorizationAttemptView } from '../src/types.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'

const KEY = credentialKey('llm-pi-ai', 'openai-codex')

/** Boot one Host with the real authorization seam, a memory store, and the controller under test. */
async function boot(options: { readonly seam?: boolean } = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials, {})
  if (options.seam !== false) await ctx.plugin(AuthorizationService)
  await ctx.plugin(AuthorizationController)
  return ctx
}

/** One scripted flow over the real seam: notify, optionally prompt, then commit a grant record. */
function registerFlow(ctx: Context, options: {
  readonly key?: CredentialKey
  readonly methods?: readonly [{ id: string; label: string }, ...{ id: string; label: string }[]]
  readonly prompt?: AuthorizationPrompt
  readonly run?: (session: AuthorizationSession) => Promise<void>
} = {}): CredentialKey {
  const key = options.key ?? KEY
  ctx.authorization.registerFlow({
    key,
    label: 'ChatGPT (subscription)',
    methods: [...(options.methods ?? [{ id: 'device_code', label: 'Device code' }])],
    async run(session) {
      session.notify({ message: 'Open this page', url: 'https://example.test/device', code: 'ABCD-1234' })
      if (options.prompt !== undefined) {
        const answer = await session.prompt(options.prompt)
        session.notify({ message: `answered ${answer}` })
      }
      if (options.run !== undefined) {
        await options.run(session)
        return
      }
      await commitGrant(ctx, key)
    },
  })
  return key
}

/** Commit the grant record the seam holds a flow to. */
async function commitGrant(ctx: Context, key: CredentialKey): Promise<void> {
  await ctx.credentials.modifyRecord(key, () => Promise.resolve({
    kind: 'grant',
    payload: { access: 'token', refresh: 'refresh', expires: 1 },
  }))
}

/** Poll until the attempt satisfies the predicate, so tests never race the flow. */
async function pollUntil(
  ctx: Context,
  attemptId: string,
  predicate: (view: AuthorizationAttemptView) => boolean,
): Promise<AuthorizationAttemptView> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const view = await ctx.authorizationController.poll(attemptId, 0)
    if (predicate(view)) return view
    await delay(5)
  }
  throw new Error('the attempt never reached the expected state')
}

/** Read the RemoteError one refused call produced. */
async function refusal(call: () => Promise<unknown>): Promise<unknown> {
  return call().catch((error: unknown) => error)
}

describe('authorization controller binding', () => {
  it('binds the authorization namespace and exposes the attempt protocol', async () => {
    const ctx = await boot()
    const binding = ctx.authorizationController.typertRemote
    expect(binding.serviceKey).toBe('authorizationController')
    expect(binding.namespace).toBe('authorization')
    expect(remoteMethods(ctx.authorizationController).map(entry => entry.method).sort())
      .toEqual(['answer', 'begin', 'cancel', 'list', 'poll'])
  })

  it('lists registered flows with their provider route and offered methods', async () => {
    const ctx = await boot()
    registerFlow(ctx, {
      methods: [{ id: 'browser', label: 'Browser' }, { id: 'device_code', label: 'Device code' }],
    })
    await expect(ctx.authorizationController.list()).resolves.toEqual([{
      key: 'llm-pi-ai/openai-codex',
      providerId: 'openai-codex',
      label: 'ChatGPT (subscription)',
      methods: [{ id: 'browser', label: 'Browser' }, { id: 'device_code', label: 'Device code' }],
      inFlight: false,
    }])
  })

  it('reports the actionable configuration error while no authorization seam is mounted', async () => {
    const ctx = await boot({ seam: false })
    const failure = await refusal(() => ctx.authorizationController.list())
    expect(remoteErrorOf(failure)).toMatchObject({
      code: 'gateway/internal',
      message: 'authorization service is absent: this deployment does not mount @deepseek-ai/dsh-authorization in its composition',
      details: {},
    })
  })
})

describe('authorization controller attempts', () => {
  it('streams notices from the caller cursor, answers the prompt, and settles authorized', async () => {
    const ctx = await boot()
    registerFlow(ctx, { prompt: { kind: 'text', message: 'Paste the code', placeholder: 'code' } })

    const attemptId = await ctx.authorizationController.begin(KEY, 'device_code')
    const opened = await pollUntil(ctx, attemptId, view => view.prompt !== null)
    expect(opened.status).toBe('running')
    expect(opened.notices).toEqual([{
      seq: 1,
      message: 'Open this page',
      url: 'https://example.test/device',
      code: 'ABCD-1234',
    }])
    expect(opened.prompt).toEqual({
      promptId: 1,
      kind: 'text',
      message: 'Paste the code',
      placeholder: 'code',
    })

    // The cursor is what makes a repeated poll cheap: nothing new is pending
    // while the flow waits on the prompt.
    await expect(ctx.authorizationController.poll(attemptId, opened.nextSince))
      .resolves.toMatchObject({ notices: [], nextSince: 1, prompt: { promptId: 1 } })

    await ctx.authorizationController.answer(attemptId, 1, 'typed-code')
    const settled = await pollUntil(ctx, attemptId, view => view.status !== 'running')
    expect(settled.status).toBe('authorized')
    expect(settled.notices.map(notice => notice.message)).toEqual(['Open this page', 'answered typed-code'])
    expect(settled.prompt).toBeNull()
  })

  it('refuses an unknown flow, an unoffered method, and a second attempt for the same key', async () => {
    const ctx = await boot()
    registerFlow(ctx, { prompt: { kind: 'secret', message: 'Paste the token' } })

    const absent = await refusal(() => ctx.authorizationController.begin('llm-pi-ai/absent', 'device_code'))
    expect(remoteErrorOf(absent)).toMatchObject({
      code: 'authorization/unknown-flow',
      details: { key: 'llm-pi-ai/absent' },
    })

    const unoffered = await refusal(() => ctx.authorizationController.begin(KEY, 'browser'))
    expect(remoteErrorOf(unoffered)).toMatchObject({
      code: 'authorization/unknown-method',
      details: { key: 'llm-pi-ai/openai-codex', method: 'browser' },
    })

    const attemptId = await ctx.authorizationController.begin(KEY, 'device_code')
    await pollUntil(ctx, attemptId, view => view.prompt !== null)
    const doubled = await refusal(() => ctx.authorizationController.begin(KEY, 'device_code'))
    expect(remoteErrorOf(doubled)).toMatchObject({
      code: 'authorization/in-flight',
      details: { key: 'llm-pi-ai/openai-codex' },
    })
    await ctx.authorizationController.cancel(attemptId)
  })

  it('refuses a stale answer and reports an untracked attempt', async () => {
    const ctx = await boot()
    registerFlow(ctx, { prompt: { kind: 'select', message: 'Pick an account', options: [{ id: 'a', label: 'Account A' }] } })

    const attemptId = await ctx.authorizationController.begin(KEY, 'device_code')
    await pollUntil(ctx, attemptId, view => view.prompt !== null)

    const stale = await refusal(() => ctx.authorizationController.answer(attemptId, 7, 'a'))
    expect(remoteErrorOf(stale)).toMatchObject({
      code: 'authorization/stale-prompt',
      details: { attemptId, promptId: 7 },
    })
    const unknown = await refusal(() => ctx.authorizationController.poll('not-an-attempt', 0))
    expect(remoteErrorOf(unknown)).toMatchObject({
      code: 'authorization/unknown-attempt',
      details: { attemptId: 'not-an-attempt' },
    })

    await ctx.authorizationController.answer(attemptId, 1, 'a')
    await expect(pollUntil(ctx, attemptId, view => view.status !== 'running'))
      .resolves.toMatchObject({ status: 'authorized' })
  })

  it('settles a cancelled attempt even when its flow ignores the signal', async () => {
    const ctx = await boot()
    registerFlow(ctx, {
      run: async () => {
        // A wedged flow: it never reacts to the attempt's signal.
        await new Promise(() => {})
      },
    })

    const attemptId = await ctx.authorizationController.begin(KEY, 'device_code')
    await ctx.authorizationController.cancel(attemptId)
    await expect(pollUntil(ctx, attemptId, view => view.status !== 'running'))
      .resolves.toMatchObject({ status: 'cancelled' })
  })

  it('survives a flow that withdraws its own prompt, refusing a late answer', async () => {
    const ctx = await boot()
    registerFlow(ctx, {
      run: async (session) => {
        const withdrawal = new AbortController()
        const answered = session.prompt({
          kind: 'secret',
          message: 'Paste the code from the browser',
          signal: withdrawal.signal,
        })
        setTimeout(() => { withdrawal.abort() }, 5)
        await answered.catch(() => undefined)
        await commitGrant(ctx, KEY)
      },
    })

    const attemptId = await ctx.authorizationController.begin(KEY, 'device_code')
    await pollUntil(ctx, attemptId, view => view.status !== 'running')
      .then(async (settled) => {
        expect(settled.status).toBe('authorized')
        const late = await refusal(() => ctx.authorizationController.answer(attemptId, 1, 'too-late'))
        expect(remoteErrorOf(late)).toMatchObject({ code: 'authorization/stale-prompt' })
      })
  })

  it('reports a flow failure on the attempt instead of as a thrown poll', async () => {
    const ctx = await boot()
    registerFlow(ctx, {
      run: async () => {
        throw new Error('the gateway refused the device code')
      },
    })

    const attemptId = await ctx.authorizationController.begin(KEY, 'device_code')
    const settled = await pollUntil(ctx, attemptId, view => view.status !== 'running')
    expect(settled.status).toBe('failed')
    expect(settled.message).toBe('the gateway refused the device code')
  })
})
