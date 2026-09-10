/**
 * Host owner of the `authorization` Remote namespace: the browser sign-in
 * surface over `ctx.authorization`.
 *
 * One attempt per credential key runs in the Host; a browser page starts it,
 * polls the notices and the pending prompt it produced, answers that prompt,
 * and cancels it. Nothing but the projected views crosses the wire: the flow's
 * own `AbortSignal`s stay Host-side, and the notice/prompt projections copy the
 * declared fields rather than serializing a foreign object the flow built.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/authorization.ts
 */

import { randomUUID } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import type AuthorizationService from '@deepseek-ai/dsh-authorization'
import type {
  AuthorizationNotice, AuthorizationPrompt,
} from '@deepseek-ai/dsh-authorization/types'
import { credentialKeyId, parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials/types'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { z } from 'zod'
import { parseRequest } from './parse-request.ts'
import type {
  AuthorizationAttemptStatusView, AuthorizationAttemptView, AuthorizationFlowView,
  AuthorizationNoticeView, AuthorizationPromptView,
} from './types.ts'

/**
 * Live attempts one Host keeps for its browsers. A page runs at most one
 * attempt per flow (the seam refuses a second for the same key), so this is far
 * above any real page and still bounds the registry a stalled page can grow.
 */
const MAX_ATTEMPTS = 8

const beginRequestSchema = z.object({
  key: z.string().min(3).max(200),
  method: z.string().min(1).max(64),
})
const pollRequestSchema = z.object({
  attemptId: z.string().min(1).max(64),
  since: z.number().int().min(0),
})
const answerRequestSchema = z.object({
  attemptId: z.string().min(1).max(64),
  promptId: z.number().int().min(1),
  value: z.string().max(4096),
})
const cancelRequestSchema = z.object({ attemptId: z.string().min(1).max(64) })

/** One prompt a flow is waiting on, with the Host-side settle functions. */
interface PendingPrompt {
  readonly view: AuthorizationPromptView
  readonly settle: (value: string) => void
  readonly fail: (error: Error) => void
}

/** One attempt the Host is running for a browser page. */
interface Attempt {
  readonly id: string
  readonly key: CredentialKey
  readonly controller: AbortController
  readonly notices: AuthorizationNoticeView[]
  status: AuthorizationAttemptStatusView
  /** Highest notice sequence handed out; a caller polls from the one it holds. */
  seq: number
  /** Prompt numbering within this attempt, so a stale answer is detectable. */
  promptSeq: number
  prompt: PendingPrompt | null
  message: string | undefined
}

/** Copy exactly the notice fields the wire declares, with its own sequence. */
function projectNotice(seq: number, notice: AuthorizationNotice): AuthorizationNoticeView {
  return {
    seq,
    message: notice.message,
    ...notice.url === undefined ? {} : { url: notice.url },
    ...notice.code === undefined ? {} : { code: notice.code },
  }
}

/**
 * Copy exactly the prompt fields the wire declares. The flow's `signal` — the
 * handle that withdraws this one prompt — never crosses.
 * @param promptId - this attempt's prompt number.
 * @param prompt - the prompt the flow is waiting on.
 * @returns the wire view, with no `AbortSignal` attached.
 */
function projectPrompt(promptId: number, prompt: AuthorizationPrompt): AuthorizationPromptView {
  if (prompt.kind === 'select') {
    return {
      promptId,
      kind: 'select',
      message: prompt.message,
      options: prompt.options.map(option => ({
        id: option.id,
        label: option.label,
        ...option.description === undefined ? {} : { description: option.description },
      })),
    }
  }
  return {
    promptId,
    kind: prompt.kind,
    message: prompt.message,
    ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host owner of the `authorization` Remote namespace. */
    authorizationController: AuthorizationController
  }
}

/**
 * Host service backing the generated `ctx.remote.authorization` namespace. It
 * carries every wire obligation the authorization seam itself does not: the
 * one-attempt-per-key refusal restated as a remote error, the notice cursor, the
 * prompt numbering that makes a stale answer detectable, and the projection of
 * both onto wire-safe views.
 */
export class AuthorizationController extends TypertRemoteService {
  private readonly attempts = new Map<string, Attempt>()

  /** @param ctx - Host context where the authorization seam may be mounted. */
  constructor(ctx: Context) {
    super(ctx, 'authorizationController', { namespace: 'authorization' })
  }

  /**
   * Every sign-in a mounted flow owner offers, for the page's sign-in list.
   * @returns one view per registered flow, in registration order.
   * @throws RemoteError when no authorization seam is mounted.
   */
  @Remote
  async list(): Promise<AuthorizationFlowView[]> {
    const authorization = this.service()
    return authorization.list().map(entry => ({
      key: String(entry.key),
      providerId: credentialKeyId(entry.key),
      label: entry.label,
      methods: entry.methods.map(method => ({ id: method.id, label: method.label })),
      inFlight: entry.inFlight,
    }))
  }

  /**
   * Start one attempt. The call returns its id at once: the flow then runs in
   * the Host and the page follows it through {@link AuthorizationController.poll}.
   * @param key - the joined `<scope>/<id>` credential key a flow claims.
   * @param method - the method id to run, as `list` reported it.
   * @returns the attempt id this Host tracks.
   * @throws RemoteError when the payload is invalid, no seam or flow matches,
   *   the method is not offered, or an attempt for this key already runs.
   */
  @Remote
  async begin(key: string, method: string): Promise<string> {
    const request = parseRequest('authorization.begin', beginRequestSchema, { key, method })
    const authorization = this.service()
    const branded = this.brand(request.key)
    const entry = authorization.list().find(candidate => String(candidate.key) === request.key)
    if (entry === undefined) {
      throw new RemoteError(
        'authorization/unknown-flow',
        `no authorization flow claims "${request.key}"`,
        { key: request.key },
      )
    }
    if (!entry.methods.some(candidate => candidate.id === request.method)) {
      throw new RemoteError(
        'authorization/unknown-method',
        `authorization flow for "${request.key}" offers no method "${request.method}"`,
        { key: request.key, method: request.method },
      )
    }
    if (entry.inFlight) {
      throw new RemoteError(
        'authorization/in-flight',
        `an authorization attempt for "${request.key}" is already running`,
        { key: request.key },
      )
    }
    const attempt = this.create(branded)
    void this.run(attempt, request.method)
    return attempt.id
  }

  /**
   * Read one attempt's progress since the caller's cursor, so a dropped poll
   * costs nothing: notices carry their own sequence and the next call resumes
   * from the last one held.
   * @param attemptId - the attempt to read.
   * @param since - the highest notice sequence the caller already holds, 0 for none.
   * @returns the attempt's status, the notices after `since`, and its pending prompt.
   * @throws RemoteError when the payload is invalid or the attempt is unknown.
   */
  @Remote
  async poll(attemptId: string, since: number): Promise<AuthorizationAttemptView> {
    const request = parseRequest('authorization.poll', pollRequestSchema, { attemptId, since })
    const attempt = this.attempt(request.attemptId)
    return {
      status: attempt.status,
      notices: attempt.notices.filter(notice => notice.seq > request.since),
      nextSince: attempt.seq,
      prompt: attempt.prompt?.view ?? null,
      ...attempt.message === undefined ? {} : { message: attempt.message },
    }
  }

  /**
   * Answer the prompt an attempt is waiting on. An answer naming a prompt the
   * attempt no longer waits for is refused rather than applied to its
   * successor, which is what a second browser tab's stale view would send.
   * @param attemptId - the attempt to answer.
   * @param promptId - the prompt number the answer belongs to.
   * @param value - the typed text, the secret, or a chosen option id.
   * @throws RemoteError when the payload is invalid, the attempt is unknown, or
   *   the attempt waits on no such prompt.
   */
  @Remote
  async answer(attemptId: string, promptId: number, value: string): Promise<void> {
    const request = parseRequest('authorization.answer', answerRequestSchema, { attemptId, promptId, value })
    const attempt = this.attempt(request.attemptId)
    const pending = attempt.prompt
    if (pending === null || pending.view.promptId !== request.promptId) {
      throw new RemoteError(
        'authorization/stale-prompt',
        `attempt "${request.attemptId}" waits on no prompt ${String(request.promptId)}`,
        { attemptId: request.attemptId, promptId: request.promptId },
      )
    }
    // Cleared before settling so a poll racing this answer cannot see the
    // prompt as still pending and answer it twice.
    attempt.prompt = null
    pending.settle(request.value)
  }

  /**
   * Withdraw one attempt. The seam reports the attempt as `cancelled` once its
   * runner unwinds; a page closes its dialog on this call rather than on that
   * settlement, so a flow that ignores its signal cannot hold the surface.
   * @param attemptId - the attempt to withdraw.
   * @throws RemoteError when the payload is invalid or the attempt is unknown.
   */
  @Remote
  async cancel(attemptId: string): Promise<void> {
    const request = parseRequest('authorization.cancel', cancelRequestSchema, { attemptId })
    this.attempt(request.attemptId).controller.abort()
  }

  /** Resolve the mounted seam or report how to supply it. */
  private service(): AuthorizationService {
    const authorization = this.ctx.get('authorization')
    if (authorization === undefined) {
      throw new RemoteError(
        'gateway/internal',
        'authorization service is absent: this deployment does not mount @deepseek-ai/dsh-authorization in its composition',
        {},
      )
    }
    return authorization
  }

  /** Validate and brand one joined credential key, refusing anything else as a bad payload. */
  private brand(key: string): CredentialKey {
    try {
      return parseCredentialKey(key)
    } catch (error: unknown) {
      throw new RemoteError(
        'gateway/bad-request',
        error instanceof Error ? error.message : String(error),
        {},
        { cause: error },
      )
    }
  }

  /** One tracked attempt, pruned to {@link MAX_ATTEMPTS} with settled entries dropped first. */
  private create(key: CredentialKey): Attempt {
    if (this.attempts.size >= MAX_ATTEMPTS) {
      const settled = [...this.attempts.values()].find(candidate => candidate.status !== 'running')
      const victim = settled ?? this.attempts.values().next().value
      if (victim !== undefined) this.attempts.delete(victim.id)
    }
    const attempt: Attempt = {
      id: randomUUID(),
      key,
      controller: new AbortController(),
      notices: [],
      status: 'running',
      seq: 0,
      promptSeq: 0,
      prompt: null,
      message: undefined,
    }
    this.attempts.set(attempt.id, attempt)
    return attempt
  }

  /** Resolve one tracked attempt or refuse the call. */
  private attempt(attemptId: string): Attempt {
    const attempt = this.attempts.get(attemptId)
    if (attempt === undefined) {
      throw new RemoteError(
        'authorization/unknown-attempt',
        `no authorization attempt "${attemptId}" is tracked`,
        { attemptId },
      )
    }
    return attempt
  }

  /**
   * Run one attempt to its settlement, recording what the page must see. The
   * interaction's prompt await is what a page answers through `answer`; the
   * attempt's own controller is the only signal the flow receives, so a page
   * that stops polling cannot leave the seam holding the key.
   */
  private async run(attempt: Attempt, method: string): Promise<void> {
    const authorization = this.service()
    try {
      const outcome = await authorization.begin({
        key: attempt.key,
        method,
        interaction: {
          notify: (notice) => {
            attempt.seq += 1
            attempt.notices.push(projectNotice(attempt.seq, notice))
          },
          prompt: prompt => this.awaitAnswer(attempt, prompt),
        },
        signal: attempt.controller.signal,
      })
      attempt.status = outcome.status
    } catch (error: unknown) {
      attempt.status = 'failed'
      attempt.message = error instanceof Error ? error.message : String(error)
    } finally {
      attempt.prompt?.fail(new Error('the authorization attempt settled before this prompt was answered'))
      attempt.prompt = null
    }
  }

  /**
   * Publish one prompt and wait for the page's answer. A flow may withdraw a
   * prompt alone — racing a typed code against a browser callback — so the
   * prompt's own signal rejects with a message that reads as the flow's choice
   * rather than as a surface failure.
   */
  private awaitAnswer(attempt: Attempt, prompt: AuthorizationPrompt): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      attempt.promptSeq += 1
      const view = projectPrompt(attempt.promptSeq, prompt)
      attempt.prompt = { view, settle: resolve, fail: reject }
      prompt.signal?.addEventListener('abort', () => {
        // Only if this prompt is still the pending one: a withdrawn prompt that
        // was already answered leaves its successor alone.
        if (attempt.prompt?.view.promptId !== view.promptId) return
        attempt.prompt = null
        reject(new Error('the authorization flow withdrew this prompt'))
      }, { once: true })
    })
  }
}

export default AuthorizationController
