/**
 * Browser-safe failure vocabulary of the configuration surfaces this package
 * serves. The redacted views themselves live with their seam in
 * `@deepseek-ai/dsh-settings/types`, whose Cordis event declarations already
 * register that file for the Client compilation face.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/types
 */

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /**
     * Every seam refusal that is not a stale write: an unregistered or malformed
     * namespace, a read-only provider, schema validation, storage.
     */
    'settings/rejected': { readonly ns: string }
    /**
     * The stored revision moved after the caller read it. Its own outcome rather
     * than an invalid request: the caller must re-read and re-apply.
     */
    'settings/conflict': { readonly ns: string; readonly expected: number; readonly actual: number }
    /**
     * The provider refused a valid credential write, for example because a
     * read-only source shadows the reference. The details name only the
     * reference, never the value.
     */
    'credential/rejected': { readonly ref: string }
    /**
     * No registered authorization flow claims the key the page asked to sign
     * into; the details name only the key, never a credential value.
     */
    'authorization/unknown-flow': { readonly key: string }
    /**
     * The named flow is registered but does not offer the requested method —
     * a page whose method list went stale between `list` and `begin`.
     */
    'authorization/unknown-method': { readonly key: string; readonly method: string }
    /**
     * Another attempt for the same key is already running: the seam admits one
     * at a time, so the page must join through the running attempt's own page.
     */
    'authorization/in-flight': { readonly key: string }
    /** The attempt id is not one this Host tracks (a restart, or a stale page). */
    'authorization/unknown-attempt': { readonly attemptId: string }
    /**
     * The attempt waits on a different prompt than the one answered, so the
     * answer is refused rather than applied to its successor.
     */
    'authorization/stale-prompt': { readonly attemptId: string; readonly promptId: number }
  }
}

/** Confirmation that the settings document was handed to the native editor. */
export interface SettingsDocumentOpenValue {
  readonly opened: true
}

/** Result of opening or revealing one locally authored Agent preset directory. */
export type AgentPresetDirectoryOpenValue =
  | { readonly opened: true }
  | { readonly opened: false; readonly path: string }

/** One way a registered sign-in flow can obtain its credential. */
export interface AuthorizationMethodView {
  /** Flow-owned method id, echoed back when the page starts an attempt. */
  readonly id: string
  /** User-facing label for the page's picker. */
  readonly label: string
}

/** One registered sign-in flow, as the page's own list renders it. */
export interface AuthorizationFlowView {
  /** The credential record the flow writes, in its joined `<scope>/<id>` form. */
  readonly key: string
  /** The provider route that key addresses — the id a profile is declared under. */
  readonly providerId: string
  /** User-facing name of what is being authorized. */
  readonly label: string
  /** The methods this flow offers, most preferred first. */
  readonly methods: readonly AuthorizationMethodView[]
  /** Whether an attempt for this key runs right now. */
  readonly inFlight: boolean
}

/** One notice from a running attempt, carrying the cursor a poll resumes from. */
export interface AuthorizationNoticeView {
  /** Monotonic sequence within the attempt: poll again from the highest one held. */
  readonly seq: number
  /** What is happening, or what the human must do next. */
  readonly message: string
  /** A page the human must open to continue. */
  readonly url?: string
  /** A short code the human must enter on that page. */
  readonly code?: string
}

/** One choice offered by a `select` prompt. */
export interface AuthorizationPromptOptionView {
  /** Value returned when this option is chosen. */
  readonly id: string
  /** User-facing label. */
  readonly label: string
  /** Optional extra context rendered by capable surfaces. */
  readonly description?: string
}

/**
 * One question an attempt waits on. `secret` differs from `text` only in
 * presentation — the page masks it and keeps it out of logs — and `select`
 * answers with the chosen option's id.
 */
export type AuthorizationPromptView = {
  /** This attempt's prompt number; an answer must echo it. */
  readonly promptId: number
} & ({
  readonly kind: 'text'
  readonly message: string
  readonly placeholder?: string
} | {
  readonly kind: 'secret'
  readonly message: string
  readonly placeholder?: string
} | {
  readonly kind: 'select'
  readonly message: string
  readonly options: readonly AuthorizationPromptOptionView[]
})

/** How one attempt stands for the page watching it. */
export type AuthorizationAttemptStatusView = 'running' | 'authorized' | 'cancelled' | 'failed'

/**
 * One poll answer: the attempt's status, the notices after the caller's cursor,
 * and the prompt it currently waits on. A failure reaches the page here rather
 * than as a thrown error, because the caller that started an attempt is not
 * necessarily the caller polling it.
 */
export interface AuthorizationAttemptView {
  readonly status: AuthorizationAttemptStatusView
  readonly notices: readonly AuthorizationNoticeView[]
  /** Pass back as `since` on the next poll to receive only newer notices. */
  readonly nextSince: number
  /** The prompt awaiting an answer, or null while none is pending. */
  readonly prompt: AuthorizationPromptView | null
  /** The failure diagnostic, present only while `status` is `failed`. */
  readonly message?: string
}
