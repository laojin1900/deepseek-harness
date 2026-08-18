/**
 * The two modality lists the image-input switches write, plus the mapping a
 * model row's picker uses to turn a stored list into one of its three
 * positions and back. Shared by the provider editor's route switch, the
 * custom-provider create card, and the pi-ai model rows.
 * @module @deepseek-ai/dsh-client-ui-settings-models/imageInput
 */

/** The modality list that admits images — a switch's on position. */
export const IMAGE_INPUT_ON: readonly string[] = ['text', 'image']

/** The modality list that admits text only — a switch's off position, and the adapter's default. */
export const IMAGE_INPUT_OFF: readonly string[] = ['text']

/**
 * Whether a modality list admits images. Absent and empty both mean "no
 * answer here" — resolution moves on to the catalog, then the route's
 * `defaultInput` — which the switch shows as off, since the adapter's own
 * fallback is text-only.
 * @param value - a stored modality list, or nothing.
 * @returns whether the list names `image`.
 */
export function imageInputOn(value: readonly string[] | undefined): boolean {
  return value !== undefined && value.includes('image')
}

/** The three positions a model row's image-input picker offers. */
export type ModelImageInputChoice = 'inherit' | 'on' | 'off'

/**
 * The picker position a stored model list shows. Absent — or empty, which the
 * adapter reads as no answer either — is inherit; any list naming `image` is
 * on; any other list (text alone, today) is off.
 * @param value - the row's stored `input` list.
 * @returns the picker position to show.
 */
export function modelImageInputChoice(value: unknown): ModelImageInputChoice {
  if (!Array.isArray(value) || value.length === 0) return 'inherit'
  return value.includes('image') ? 'on' : 'off'
}

/**
 * The modality list one picker position writes. `inherit` writes nothing —
 * the row keeps whatever the catalog or the route's `defaultInput` supplies —
 * which the row editor stores by dropping the key rather than as a value.
 * @param choice - the picked position.
 * @returns the list to store, or `undefined` to inherit.
 */
export function modelImageInputList(choice: ModelImageInputChoice): readonly string[] | undefined {
  if (choice === 'inherit') return undefined
  return choice === 'on' ? IMAGE_INPUT_ON : IMAGE_INPUT_OFF
}
