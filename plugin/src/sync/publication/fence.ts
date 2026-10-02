/** Pure contract logic is testable; no engine/UI/upload hook may enable it yet. */
export const PUBLICATION_ENABLED = false
export function assertPublicationEnabled(): never {
  throw new Error(
    'Automatic publication is disabled pending native cache, transport and scoped API gates'
  )
}
