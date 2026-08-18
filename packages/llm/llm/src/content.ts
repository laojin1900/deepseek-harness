/** Content-block structure helpers. @module @deepseek-ai/dsh-llm/content */

import type { ContentBlock } from './types.ts'

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
