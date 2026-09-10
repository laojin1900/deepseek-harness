// @vitest-environment jsdom
/** The subscription sign-in card and dialog over a scripted operations double. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizationAttemptView, AuthorizationFlowView } from '@deepseek-ai/dsh-api-remotes/client'
import { SubscriptionLogin } from '../src/client/SubscriptionLogin.tsx'
import type { ModelsOperations } from '../src/client/operations.ts'
import type { ProviderRow } from '../src/client/store.ts'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]

const FLOW: AuthorizationFlowView = {
  key: 'llm-pi-ai/openai-codex',
  providerId: 'openai-codex',
  label: 'ChatGPT (subscription)',
  methods: [{ id: 'browser', label: 'Browser' }, { id: 'device_code', label: 'Device code' }],
  inFlight: false,
}

/** One dormant catalog row for the flow's provider. */
function dormantRow(): ProviderRow {
  return {
    entry: {
      provider: 'openai-codex',
      displayName: 'openai-codex',
      settingsNs: 'llm-pi-ai',
      settingsPath: ['providers', 'openai-codex'],
      active: false,
    },
    configured: false,
    removable: false,
    apiKeyEnv: undefined,
    credential: undefined,
  }
}

/** A completed poll answer: everything empty but the fields under test. */
function view(overrides: Partial<AuthorizationAttemptView> = {}): AuthorizationAttemptView {
  return { status: 'running', notices: [], nextSince: 0, prompt: null, ...overrides }
}

/** The operations double, with only the sign-in verbs scripted per test. */
function operations(overrides: Partial<ModelsOperations> = {}): ModelsOperations {
  return {
    describeCredential: vi.fn(async () => undefined),
    storeCredential: vi.fn(async () => undefined),
    removeCredential: vi.fn(async () => undefined),
    writeSettings: vi.fn(async () => ({ kind: 'written' as const, view: undefined as never })),
    discoverModels: vi.fn(async () => ({ kind: 'found' as const, models: [] })),
    listAuthorizations: vi.fn(async () => [FLOW]),
    beginAuthorization: vi.fn(async () => ({ kind: 'started' as const, attemptId: 'attempt-1' })),
    pollAuthorization: vi.fn(async () => view()),
    answerAuthorization: vi.fn(async () => undefined),
    cancelAuthorization: vi.fn(async () => undefined),
    ensureProviderProfile: vi.fn(async () => ({ kind: 'written' as const, view: undefined as never })),
    ...overrides,
  }
}

function renderCard(
  face: ModelsOperations,
  rows: readonly ProviderRow[] = [dormantRow()],
  flows: readonly AuthorizationFlowView[] = [FLOW],
) {
  const onProfileDeclared = vi.fn()
  render(<SubscriptionLogin
    operations={face}
    flows={flows}
    rows={rows}
    t={t}
    onProfileDeclared={onProfileDeclared}
    pollMs={5}
  />)
  return { onProfileDeclared }
}

describe('SubscriptionLogin', () => {
  it('renders nothing while the deployment offers no sign-in flow', () => {
    renderCard(operations(), [dormantRow()], [])
    expect(screen.queryByText(en.subscriptionTitle)).toBeNull()
  })

  it('starts the chosen method, shows the notice and code, and answers the prompt', async () => {
    // The attempt holds its prompt until the answer lands, so the field stays
    // mounted for the interaction under test.
    const answered = { done: false }
    let announced = false
    const prompt = { promptId: 1, kind: 'text' as const, message: 'Paste the code', placeholder: 'code' }
    const face = operations({
      pollAuthorization: vi.fn(async () => {
        if (answered.done) return view({ status: 'authorized', nextSince: 1 })
        if (!announced) {
          announced = true
          return view({
            notices: [{ seq: 1, message: 'Open this page', url: 'https://example.test/device', code: 'ABCD-1234' }],
            nextSince: 1,
            prompt,
          })
        }
        return view({ nextSince: 1, prompt })
      }),
      answerAuthorization: vi.fn(async () => {
        answered.done = true
        return undefined
      }),
    })
    const { onProfileDeclared } = renderCard(face)

    fireEvent.change(await screen.findByLabelText(en.subscriptionMethod), { target: { value: 'device_code' } })
    fireEvent.click(screen.getByRole('button', { name: en.subscriptionSignIn }))
    await waitFor(() => {
      expect(face.beginAuthorization).toHaveBeenCalledWith('llm-pi-ai/openai-codex', 'device_code')
    })

    await screen.findByText('Open this page')
    expect(screen.getByText('ABCD-1234')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'https://example.test/device' })).toBeTruthy()

    const input = await screen.findByLabelText('Paste the code')
    fireEvent.change(input, { target: { value: 'typed-code' } })
    fireEvent.click(screen.getByRole('button', { name: en.subscriptionSubmit }))
    await waitFor(() => {
      expect(face.answerAuthorization).toHaveBeenCalledWith('attempt-1', 1, 'typed-code')
    })

    // The committed credential declares the profile and refreshes the page.
    await waitFor(() => {
      expect(face.ensureProviderProfile).toHaveBeenCalledWith(
        'llm-pi-ai', ['providers', 'openai-codex'], 'ChatGPT (subscription)',
      )
    })
    await waitFor(() => { expect(onProfileDeclared).toHaveBeenCalled() })
    expect(await screen.findByText('ChatGPT (subscription) is signed in; its models are now available.')).toBeTruthy()
  })

  it('answers a select prompt with the chosen option id', async () => {
    // The attempt stays on its prompt until the answer lands, so the option
    // buttons cannot be replaced by the settled dialog mid-click.
    const answered = { done: false }
    const face = operations({
      pollAuthorization: vi.fn(async () => answered.done
        ? view({ status: 'authorized', nextSince: 1 })
        : view({
          nextSince: 1,
          prompt: {
            promptId: 2,
            kind: 'select',
            message: 'Pick an account',
            options: [{ id: 'acct-a', label: 'Account A' }, { id: 'acct-b', label: 'Account B' }],
          },
        })),
      answerAuthorization: vi.fn(async () => {
        answered.done = true
        return undefined
      }),
    })
    renderCard(face)

    fireEvent.click(await screen.findByRole('button', { name: en.subscriptionSignIn }))
    fireEvent.click(await screen.findByRole('button', { name: 'Account B' }))
    await waitFor(() => {
      expect(face.answerAuthorization).toHaveBeenCalledWith('attempt-1', 2, 'acct-b')
    })
  })

  it('shows a failed attempt with its diagnostic and retries it', async () => {
    const face = operations({
      pollAuthorization: vi.fn(async () => view({ status: 'failed', message: 'the gateway refused the device code', nextSince: 1 })),
    })
    renderCard(face)

    fireEvent.click(await screen.findByRole('button', { name: en.subscriptionSignIn }))
    await screen.findByText('Sign-in failed: the gateway refused the device code')

    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    await waitFor(() => { expect(face.beginAuthorization).toHaveBeenCalledTimes(2) })
  })

  it('withdraws a running attempt when the dialog is closed', async () => {
    const face = operations()
    renderCard(face)

    fireEvent.click(await screen.findByRole('button', { name: en.subscriptionSignIn }))
    await waitFor(() => { expect(face.beginAuthorization).toHaveBeenCalledTimes(1) })
    fireEvent.click(await screen.findByRole('button', { name: en.cancel }))
    await waitFor(() => { expect(face.cancelAuthorization).toHaveBeenCalledWith('attempt-1') })
    await waitFor(() => { expect(screen.queryByRole('button', { name: en.cancel })).toBeNull() })
  })

  it('reports a refused start without opening a dialog', async () => {
    const face = operations({
      beginAuthorization: vi.fn(async () => ({ kind: 'refused' as const, message: 'an attempt is already running' })),
    })
    renderCard(face)

    fireEvent.click(await screen.findByRole('button', { name: en.subscriptionSignIn }))
    expect(await screen.findByText('Could not start the sign-in: an attempt is already running')).toBeTruthy()
    expect(screen.queryByRole('button', { name: en.cancel })).toBeNull()
  })

  it('marks an already signed-in route', async () => {
    const face = operations()
    const row = dormantRow()
    const active: ProviderRow = {
      ...row,
      entry: { ...row.entry, active: true },
      configured: true,
    }
    renderCard(face, [active])

    expect(await screen.findByText(en.subscriptionSignedIn)).toBeTruthy()
  })
})
