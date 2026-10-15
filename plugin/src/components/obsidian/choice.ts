/** One answer of a choice dialog; `value: null` is a Cancel that answers nothing. */
export interface Choice {
  value: string | null
  text: string
  tooltip?: string
  /** The one that does the thing. */
  cta?: boolean
  /** The one that destroys something. */
  warning?: boolean
}
