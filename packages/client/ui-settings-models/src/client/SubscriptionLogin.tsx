/**
 * The Models page's subscription sign-in card: the browser half of the
 * `authorization` Remote namespace.
 *
 * A deployment whose composition mounts no sign-in flow renders nothing here.
 * Otherwise the card lists what can be signed into, runs one attempt per dialog
 * (polling its notices and prompt through the injected operations), and — once
 * the Host reports the credential committed — declares the provider profile
 * that makes the route's catalog models pickable.
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  AuthorizationAttemptStatusView, AuthorizationFlowView, AuthorizationNoticeView,
  AuthorizationPromptView,
} from '@deepseek-ai/dsh-api-remotes/client'
import { OnboardingModal } from './OnboardingModal.tsx'
import type { ModelsSectionInjected } from './ModelsSection.tsx'
import type { ModelsOperations } from './operations.ts'
import type { ProviderRow } from './store.ts'
import css from './ModelsSection.module.css'

/** One open sign-in dialog, as the page tracks it. */
interface Session {
  readonly flow: AuthorizationFlowView
  readonly attemptId: string
  readonly notices: readonly AuthorizationNoticeView[]
  readonly prompt: AuthorizationPromptView | null
  readonly status: AuthorizationAttemptStatusView
  readonly message: string | undefined
  /** Set once the terminal status has been handled (profile declared or not). */
  readonly settled: boolean
  /** The success line to keep on screen after the credential is committed. */
  readonly declared: boolean
  /** A profile-write diagnostic, present when the sign-in succeeded without one. */
  readonly profileFailure: string | undefined
}

/** Fill the placeholders a localized template carries, leaving unknown names alone. */
function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match)
}

/** Injected dependencies of {@link SubscriptionLogin}. */
export interface SubscriptionLoginProps {
  /** The page's Host operations, including the authorization verbs. */
  readonly operations: ModelsOperations
  /** Sign-in flows the page snapshot loaded; empty when the deployment offers none. */
  readonly flows: readonly AuthorizationFlowView[]
  /** Provider rows, so a signed-in route reads differently from a dormant one. */
  readonly rows: readonly ProviderRow[]
  /** Bound section translate. */
  readonly t: ModelsSectionInjected['t']
  /** Called after a profile lands, so the page reloads its provider directory. */
  readonly onProfileDeclared: () => void
  /**
   * Attempt poll cadence in milliseconds. The default suits a human watching a
   * device-code page; tests shorten it.
   */
  readonly pollMs?: number
}

/**
 * Render the subscription sign-in card and its dialog.
 * @param props - the loaded flows, injected operations, current rows, copy, and refresh callback.
 * @returns the card, or null while the page holds no flow.
 */
export function SubscriptionLogin({
  operations, flows, rows, t, onProfileDeclared, pollMs = 500,
}: SubscriptionLoginProps): ReactNode {
  const [methods, setMethods] = useState<Readonly<Record<string, string>>>({})
  const [session, setSession] = useState<Session | null>(null)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const sinceRef = useRef(0)

  const attemptId = session?.attemptId
  const running = session?.status === 'running'

  // One poll chain per open attempt: the Host answers with the notices after
  // the cursor this page holds, so a dropped tick costs nothing.
  useEffect(() => {
    if (attemptId === undefined || !running) return
    let cancelled = false
    const tick = async (): Promise<void> => {
      // A dropped transport tick is not an attempt failure: the next one
      // resumes from the cursor this page still holds.
      const view = await operations.pollAuthorization(attemptId, sinceRef.current).catch(() => undefined)
      if (cancelled || view === undefined) return
      sinceRef.current = view.nextSince
      setSession(current => current === null || current.attemptId !== attemptId ? current : {
        ...current,
        notices: [...current.notices, ...view.notices],
        prompt: view.prompt,
        status: view.status,
        message: view.message,
      })
    }
    const timer = setInterval(() => { void tick() }, pollMs)
    void tick()
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [attemptId, running, operations, pollMs])

  // Terminal handling: a committed credential declares the route's profile, a
  // withdrawal closes the dialog, a failure stays for its own diagnostic.
  useEffect(() => {
    if (session === null || session.status === 'running' || session.settled) return
    if (session.status === 'cancelled') {
      setSession(null)
      return
    }
    if (session.status !== 'authorized') return
    let cancelled = false
    const declare = async (): Promise<void> => {
      const row = rows.find(candidate => candidate.entry.provider === session.flow.providerId)
      const outcome = row === undefined || row.entry.settingsNs.length === 0
        ? undefined
        : await operations.ensureProviderProfile(
          row.entry.settingsNs,
          row.entry.settingsPath,
          session.flow.label,
        ).catch(() => undefined)
      if (cancelled) return
      if (outcome !== undefined && outcome.kind !== 'written') {
        setSession(current => current === null ? current : {
          ...current, settled: true, declared: false, profileFailure: outcome.message,
        })
        return
      }
      if (outcome !== undefined) onProfileDeclared()
      setSession(current => current === null ? current : {
        ...current, settled: true, declared: true, profileFailure: undefined,
      })
    }
    void declare()
    return () => { cancelled = true }
  }, [session, rows, operations, onProfileDeclared])

  if (flows.length === 0) return null

  const start = async (flow: AuthorizationFlowView): Promise<void> => {
    setFailure(undefined)
    const method = methods[flow.key] ?? flow.methods[0]?.id ?? ''
    const outcome = await operations.beginAuthorization(flow.key, method)
      .catch((error: unknown) => ({ kind: 'refused' as const, message: error instanceof Error ? error.message : String(error) }))
    if (outcome.kind === 'refused') {
      setFailure(fill(t('subscriptionStartFailed'), { message: outcome.message }))
      return
    }
    sinceRef.current = 0
    setSession({
      flow,
      attemptId: outcome.attemptId,
      notices: [],
      prompt: null,
      status: 'running',
      message: undefined,
      settled: false,
      declared: false,
      profileFailure: undefined,
    })
  }

  const dismiss = async (): Promise<void> => {
    if (session !== null && session.status === 'running') {
      await operations.cancelAuthorization(session.attemptId).catch(() => undefined)
    }
    setSession(null)
  }

  const answer = async (prompt: AuthorizationPromptView, value: string): Promise<void> => {
    const refusal = await operations.answerAuthorization(session?.attemptId ?? '', prompt.promptId, value)
      .catch((error: unknown) => error instanceof Error ? error.message : String(error))
    if (refusal !== undefined) setFailure(refusal)
  }

  const signedIn = (flow: AuthorizationFlowView): boolean => {
    const row = rows.find(candidate => candidate.entry.provider === flow.providerId)
    return row !== undefined && row.entry.active && row.configured
  }

  return (
    <section className={css.section}>
      <h2 className={css.title}>{t('subscriptionTitle')}</h2>
      <p className={css.intro}>{t('subscriptionIntro')}</p>
      {failure !== undefined ? <p className={css.fetchError}>{failure}</p> : null}
      <div className={css.rows}>
        {flows.map(flow => (
          <div className={css.rowCard} key={flow.key}>
            <div className={css.rowHead}>
              <div className={css.rowIdentity}>
                <span className={css.rowName}>{flow.label}</span>
                <span className={css.rowTag}>{flow.providerId}</span>
                {signedIn(flow) ? <span className={css.rowTag}>{t('subscriptionSignedIn')}</span> : null}
              </div>
              <div className={css.rowActions}>
                {flow.methods.length > 1 ? (
                  <select
                    className={`${css.input} ${css.selectInput}`}
                    aria-label={t('subscriptionMethod')}
                    value={methods[flow.key] ?? flow.methods[0]?.id ?? ''}
                    onChange={(event) => {
                      const chosen = event.target.value
                      setMethods(current => ({ ...current, [flow.key]: chosen }))
                    }}
                  >
                    {flow.methods.map(method => <option key={method.id} value={method.id}>{method.label}</option>)}
                  </select>
                ) : null}
                <button
                  type="button"
                  className={css.primaryButton}
                  disabled={flow.inFlight || (session !== null && session.status === 'running')}
                  onClick={() => { void start(flow) }}
                >
                  {flow.inFlight ? t('subscriptionInFlight') : t('subscriptionSignIn')}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {session !== null ? (
        <OnboardingModal title={session.flow.label}>
          <p className={css.intro}>{t('subscriptionIntro')}</p>
          {session.notices.map(notice => (
            <p className={css.notice} key={notice.seq}>
              <span>{notice.message}</span>
              {notice.url === undefined ? null : (
                <> <a className={css.linkButton} href={notice.url} target="_blank" rel="noreferrer">{notice.url}</a></>
              )}
              {notice.code === undefined ? null : <> <code>{notice.code}</code></>}
            </p>
          ))}
          {session.prompt !== null ? (
            <PromptAnswer prompt={session.prompt} t={t} onAnswer={answer} />
          ) : null}
          {session.status === 'failed' ? (
            <p className={css.fetchError}>
              {fill(t('subscriptionFailed'), { message: session.message ?? '' })}
            </p>
          ) : null}
          {session.declared ? (
            <p className={css.savedNotice}>
              {fill(t('subscriptionAuthorized'), { provider: session.flow.label })}
            </p>
          ) : null}
          {session.profileFailure !== undefined ? (
            <p className={css.fetchError}>
              {fill(t('subscriptionProfileFailed'), { message: session.profileFailure })}
            </p>
          ) : null}
          <div className={css.editorActions}>
            {session.status === 'failed' ? (
              <button type="button" className={css.secondaryButton} onClick={() => { void start(session.flow) }}>
                {t('retry')}
              </button>
            ) : null}
            <button type="button" className={css.secondaryButton} onClick={() => { void dismiss() }}>
              {session.settled || session.status === 'failed' ? t('subscriptionDone') : t('cancel')}
            </button>
          </div>
        </OnboardingModal>
      ) : null}
    </section>
  )
}

/** One prompt's answer control: a masked or plain field, or the option buttons. */
function PromptAnswer({
  prompt, t, onAnswer,
}: {
  prompt: AuthorizationPromptView
  t: ModelsSectionInjected['t']
  onAnswer: (prompt: AuthorizationPromptView, value: string) => Promise<void>
}): ReactNode {
  const [value, setValue] = useState('')

  if (prompt.kind === 'select') {
    return (
      <div className={css.editorActions}>
        {prompt.options.map(option => (
          <button
            key={option.id}
            type="button"
            className={css.secondaryButton}
            title={option.description}
            onClick={() => { void onAnswer(prompt, option.id) }}
          >
            {option.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <form
      className={css.field}
      onSubmit={(event) => {
        event.preventDefault()
        void onAnswer(prompt, value)
      }}
    >
      <span className={css.fieldLabel}>{prompt.message}</span>
      <input
        className={css.input}
        type={prompt.kind === 'secret' ? 'password' : 'text'}
        autoComplete="off"
        aria-label={prompt.message}
        placeholder={prompt.placeholder ?? ''}
        value={value}
        onChange={(event) => { setValue(event.target.value) }}
      />
      <div className={css.editorActions}>
        <button type="submit" className={css.primaryButton} disabled={value.length === 0}>
          {t('subscriptionSubmit')}
        </button>
      </div>
    </form>
  )
}
