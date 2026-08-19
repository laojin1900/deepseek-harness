/** Content-block structure helpers. @module @deepseek-ai/dsh-llm/content */

import type { ContentBlock } from './types.ts'
import type { Message } from './message.ts'

/** Model-facing stand-in for an image removed to fit a provider request bound. */
export const OFFLOADED_IMAGE_TEXT
  = '[image omitted to keep the request within its image limit; older images are omitted first. If this image is still needed, read its file again when a path is available; otherwise ask the user to attach it again.]'

/**
 * True when typed model content contains an image block, walking nested
 * tool-result content. This is the one recursive image walk shared by every
 * image policy (capability gating, text-only serialization, compaction
 * survey), so a consumer cannot silently diverge on nesting depth.
 * @param content - typed model content blocks.
 * @returns whether any nested block is an image.
 */
export function contentHasImage(content: readonly ContentBlock[]): boolean {
  return content.some(block => block.type === 'image'
    || (block.type === 'tool-result' && contentHasImage(block.content)))
}

/**
 * Placeholder replacing an image block when the resolved model explicitly
 * does not accept image input. It keeps the turn structure intact and tells
 * the model why the visual content is missing instead of silently erasing it.
 */
export const IMAGE_OMITTED_PLACEHOLDER = '[image omitted: current model does not accept image input]'

/**
 * Replace image blocks with {@link IMAGE_OMITTED_PLACEHOLDER} text blocks,
 * walking nested tool-result content. Unknown merge-extensible blocks pass
 * through untouched. The session log is never rewritten — this transform is
 * applied only to the capability-filtered request a text-only model receives.
 * @param content - typed model content blocks.
 * @returns the filtered copy, or `undefined` when the content has no image.
 */
export function withoutImageBlocks(content: readonly ContentBlock[]): ContentBlock[] | undefined {
  let changed = false
  const mapped: ContentBlock[] = []
  for (const block of content) {
    if (block.type === 'image') {
      changed = true
      mapped.push({ type: 'text', text: IMAGE_OMITTED_PLACEHOLDER })
    } else if (block.type === 'tool-result') {
      const nested = withoutImageBlocks(block.content)
      if (nested === undefined) {
        mapped.push(block)
      } else {
        changed = true
        mapped.push({ ...block, content: nested })
      }
    } else {
      mapped.push(block)
    }
  }
  return changed ? mapped : undefined
}

/** Base64 length of raw image bytes, including padding. */
function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4
}

/** Collect base64 payload lengths in request and nested-block order. */
function collectImageLengths(blocks: readonly ContentBlock[], lengths: number[]): void {
  for (const block of blocks) {
    if (block.type === 'image') {
      lengths.push(base64Length(block.attachment.bytes))
    } else if (block.type === 'tool-result') {
      collectImageLengths(block.content, lengths)
    }
  }
}

/** Replace the first `remaining.count` image occurrences without mutating durable messages. */
function replaceOldestImages(
  blocks: readonly ContentBlock[],
  remaining: { count: number },
): ContentBlock[] {
  let next: ContentBlock[] | undefined
  for (const [index, block] of blocks.entries()) {
    if (block.type === 'image' && remaining.count > 0) {
      remaining.count -= 1
      next ??= blocks.slice(0, index)
      next.push({ type: 'text', text: OFFLOADED_IMAGE_TEXT })
      continue
    }
    if (block.type === 'tool-result') {
      const content = replaceOldestImages(block.content, remaining)
      if (content !== block.content) {
        next ??= blocks.slice(0, index)
        next.push({ ...block, content })
        continue
      }
    }
    next?.push(block)
  }
  return next ?? blocks as ContentBlock[]
}

/**
 * Return transient request messages whose oldest images are replaced until
 * their accumulated base64 payload fits the configured bound. The selection
 * is deterministic from durable message order and attachment metadata; a
 * provider can serialize the returned messages without reading omitted bytes.
 * @param messages - complete request history, oldest first.
 * @param maxRequestImageBytes - positive bound on total base64 image payload; undefined preserves every image.
 * @returns the original messages when they already fit, otherwise shallow message copies with replaced content trees.
 */
export function offloadRequestImages(
  messages: readonly Message[],
  maxRequestImageBytes: number | undefined,
): readonly Message[] {
  if (maxRequestImageBytes === undefined) return messages
  const lengths: number[] = []
  for (const message of messages) collectImageLengths(message.content, lengths)
  let total = lengths.reduce((sum, bytes) => sum + bytes, 0)
  let count = 0
  for (const bytes of lengths) {
    if (total <= maxRequestImageBytes) break
    total -= bytes
    count += 1
  }
  if (count === 0) return messages
  const remaining = { count }
  return messages.map((message) => {
    const content = replaceOldestImages(message.content, remaining)
    return content === message.content ? message : { ...message, content }
  })
}
