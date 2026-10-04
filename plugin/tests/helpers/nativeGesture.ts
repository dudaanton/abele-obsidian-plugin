/** A missing reply leaves delivery unknown; never replay a native gesture or hide its error. */
export async function nativeGesture(
  gesture: () => Promise<{ ok: boolean }>
): Promise<{ ok: boolean }> {
  const reply = await gesture()
  if (reply?.ok !== true)
    throw new Error('Native gesture unacknowledged; delivery unknown; not replayed')
  return reply
}
