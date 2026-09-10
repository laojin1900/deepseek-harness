/**
 * The Host reads and writes the Models cards perform, as callbacks built in the
 * plugin body. Cards receive these instead of a context: the outcomes name what
 * a card renders — a stored view, a stale revision, a refusal message — so the
 * failure codes and Remote namespaces stay in the apply world.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  AuthorizationAttemptView, AuthorizationFlowView,
  CredentialInfo, LlmDiscoveredModel, LlmModelDiscoveryRequest,
  SettingsNamespaceView, SettingsPathOpView,
} from '@deepseek-ai/dsh-api-remotes/client'

/** What one namespace write answered. */
export type SettingsWriteOutcome =
  /** Committed; the view carries the stored user subtree and the new revision. */
  | { readonly kind: 'written'; readonly view: SettingsNamespaceView }
  /**
   * The stored revision moved after the card read it, so the draft is stale.
   * The message stays for callers that report the Host diagnostic as it is.
   */
  | { readonly kind: 'conflict'; readonly message: string }
  /** Any other refusal, with the Host's own diagnostic. */
  | { readonly kind: 'refused'; readonly message: string }

/** What one endpoint interrogation answered. */
export type ModelDiscoveryOutcome =
  /** The candidates the provider disclosed, in its own order. */
  | { readonly kind: 'found'; readonly models: readonly LlmDiscoveredModel[] }
  /** The interrogation was refused, with the Host's own diagnostic. */
  | { readonly kind: 'refused'; readonly message: string }

/** What starting one sign-in attempt answered. */
export type AuthorizationStartOutcome =
  /** The attempt id the page polls and answers. */
  | { readonly kind: 'started'; readonly attemptId: string }
  /** The Host refused the start, with its own diagnostic. */
  | { readonly kind: 'refused'; readonly message: string }

/** The Host operations the Models page and its cards invoke. */
export interface ModelsOperations {
  /**
   * Read one credential reference's state.
   * @param ref - credential reference name.
   * @returns the state, or undefined when the reference is unknown or the read was refused.
   */
  describeCredential(ref: string): Promise<CredentialInfo | undefined>
  /**
   * Store one credential literal under its reference.
   * @param ref - credential reference name.
   * @param value - the literal to store.
   * @returns the refusal message, or undefined once stored.
   */
  storeCredential(ref: string, value: string): Promise<string | undefined>
  /**
   * Remove one credential reference (idempotent).
   * @param ref - credential reference name.
   * @returns the refusal message, or undefined once removed.
   */
  removeCredential(ref: string): Promise<string | undefined>
  /**
   * Apply path operations to one settings namespace.
   * @param ns - settings namespace identity.
   * @param ops - ordered path operations against the stored section, as the
   * wire takes them (the Remote signature owns the array).
   * @param expectedRevision - revision the draft was opened at, or undefined to write unfenced.
   * @returns the write outcome the card renders from.
   */
  writeSettings(
    ns: string,
    ops: SettingsPathOpView[],
    expectedRevision: number | undefined,
  ): Promise<SettingsWriteOutcome>
  /**
   * Ask a provider endpoint what models it serves.
   * @param settingsNs - namespace whose adapter family answers.
   * @param request - endpoint facts as the form currently shows them.
   * @returns the candidates, or the refusal.
   */
  discoverModels(settingsNs: string, request: LlmModelDiscoveryRequest): Promise<ModelDiscoveryOutcome>
  /**
   * List the sign-in flows the Host's authorization seam offers. A deployment
   * without the seam answers with an undefined list rather than a failure, and
   * the sign-in card then simply does not render.
   * @returns one view per flow, or undefined when the read was refused.
   */
  listAuthorizations(): Promise<readonly AuthorizationFlowView[] | undefined>
  /**
   * Start one sign-in attempt for a flow's key.
   * @param key - the flow's joined credential key.
   * @param method - the method id to run.
   * @returns the attempt id, or the Host's refusal.
   */
  beginAuthorization(key: string, method: string): Promise<AuthorizationStartOutcome>
  /**
   * Read one attempt's progress since the caller's cursor.
   * @param attemptId - the attempt to read.
   * @param since - the highest notice sequence already held.
   * @returns the attempt view, or undefined when the attempt is gone.
   */
  pollAuthorization(attemptId: string, since: number): Promise<AuthorizationAttemptView | undefined>
  /**
   * Answer the prompt an attempt is waiting on.
   * @param attemptId - the attempt to answer.
   * @param promptId - the prompt number the answer belongs to.
   * @param value - the typed text, the secret, or a chosen option id.
   * @returns the refusal message, or undefined once accepted.
   */
  answerAuthorization(attemptId: string, promptId: number, value: string): Promise<string | undefined>
  /**
   * Withdraw one attempt (idempotent).
   * @param attemptId - the attempt to withdraw.
   * @returns the refusal message, or undefined once withdrawn.
   */
  cancelAuthorization(attemptId: string): Promise<string | undefined>
  /**
   * Declare the profile a signed-in subscription route needs, so its catalog
   * models register as a pickable route. Idempotent: the write merges at the
   * profile node, so an existing profile keeps whatever else it carries.
   * @param ns - settings namespace owning the profile.
   * @param path - profile path inside that namespace.
   * @param displayName - label recorded on a freshly declared profile.
   * @returns the write outcome the card renders from.
   */
  ensureProviderProfile(
    ns: string,
    path: readonly string[],
    displayName: string,
  ): Promise<SettingsWriteOutcome>
}

/**
 * Bind the page's Host operations to the plugin's own Remote namespaces.
 * @param ctx - the page plugin's context, which declares `remote.credentials`,
 * `remote.llm`, and `remote.settings` in its own `inject`.
 * @returns the callbacks the section and its cards are injected with.
 */
export function createModelsOperations(ctx: ClientContext): ModelsOperations {
  return {
    describeCredential: async (ref) => {
      const response = await ctx.remote.credentials.describe([ref])
      return response.ok ? response.value[ref] : undefined
    },
    storeCredential: async (ref, value) => {
      const response = await ctx.remote.credentials.set(ref, value)
      return response.ok ? undefined : response.error.message
    },
    removeCredential: async (ref) => {
      const response = await ctx.remote.credentials.unset(ref)
      return response.ok ? undefined : response.error.message
    },
    writeSettings: async (ns, ops, expectedRevision) => {
      const response = await ctx.remote.settings.mutate(ns, ops, expectedRevision)
      if (response.ok) return { kind: 'written', view: response.value }
      const { code, message } = response.error
      return code === 'settings/conflict' ? { kind: 'conflict', message } : { kind: 'refused', message }
    },
    discoverModels: async (settingsNs, request) => {
      const response = await ctx.remote.llm.discoverModels(settingsNs, request)
      return response.ok
        ? { kind: 'found', models: response.value }
        : { kind: 'refused', message: response.error.message }
    },
    listAuthorizations: async () => {
      const response = await ctx.remote.authorization.list()
      return response.ok ? response.value : undefined
    },
    beginAuthorization: async (key, method) => {
      const response = await ctx.remote.authorization.begin(key, method)
      return response.ok
        ? { kind: 'started', attemptId: response.value }
        : { kind: 'refused', message: response.error.message }
    },
    pollAuthorization: async (attemptId, since) => {
      const response = await ctx.remote.authorization.poll(attemptId, since)
      return response.ok ? response.value : undefined
    },
    answerAuthorization: async (attemptId, promptId, value) => {
      const response = await ctx.remote.authorization.answer(attemptId, promptId, value)
      return response.ok ? undefined : response.error.message
    },
    cancelAuthorization: async (attemptId) => {
      const response = await ctx.remote.authorization.cancel(attemptId)
      return response.ok ? undefined : response.error.message
    },
    ensureProviderProfile: async (ns, path, displayName) => {
      const response = await ctx.remote.settings.mutate(
        ns,
        [{ op: 'set', path: [...path], value: { displayName } }],
        undefined,
      )
      if (response.ok) return { kind: 'written', view: response.value }
      const { code, message } = response.error
      return code === 'settings/conflict' ? { kind: 'conflict', message } : { kind: 'refused', message }
    },
  }
}
