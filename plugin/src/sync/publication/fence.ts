/** Publication is available in production; per-context policy still controls each operation. */
export const PUBLICATION_ENABLED = true
export function assertPublicationEnabled(enabled = PUBLICATION_ENABLED): void {
  if (enabled) return
  throw new Error(
    'Automatic publication is disabled for this context'
  )
}
