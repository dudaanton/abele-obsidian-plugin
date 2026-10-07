const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const emptyObject = (value: unknown) => object(value) && Object.keys(value).length === 0

/** Shared by live settlement and retirement. Unknown layouts or any retained handle hold. */
export function emptyLocalLinkUnit(value: unknown): boolean {
  if (!object(value)) return false
  const keys = Object.keys(value)
  // Legacy link units were just a fact map; only its genuinely empty map is terminal.
  if (!keys.length) return true
  return (
    keys.every((key) => ['facts', 'localCreates', 'delayed'].includes(key)) &&
    emptyObject(value.facts) &&
    Array.isArray(value.localCreates) &&
    value.localCreates.length === 0 &&
    (value.delayed === undefined || emptyObject(value.delayed))
  )
}
