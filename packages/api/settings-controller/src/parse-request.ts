/**
 * Parse the domain constraints that are more specific than the generated
 * TypeScript codecs a Remote method already passes through.
 *
 * Shared by the configuration namespaces this package owns: every one of them
 * refuses a malformed payload the same way, as `gateway/bad-request` with the
 * schema's own issues attached.
 *
 * @module @deepseek-ai/dsh-api-settings-controller/src/parse-request.ts
 */

import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import type { z } from 'zod'

/**
 * Validate one payload against a schema, reporting a refusal as a remote error.
 * @param method - wire method name the payload belongs to, for the diagnostic.
 * @param schema - the domain schema stricter than the generated codec.
 * @param value - the decoded payload to check.
 * @returns the parsed payload.
 * @throws RemoteError code `gateway/bad-request` carrying the schema issues.
 */
export function parseRequest<T>(method: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw new RemoteError('gateway/bad-request', `invalid payload for ${method}`, { issues: parsed.error.issues })
  }
  return parsed.data
}
