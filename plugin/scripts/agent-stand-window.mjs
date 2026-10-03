/** A pool lease is not proof that its Obsidian window is open/routable. Never reload a
 * different vault as fallback; open/close only the owned vault, under the app gate.
 */
export function ensureOwnedPoolWindow({ probe, open, close, gate }) {
  if (probe()) return () => {}
  gate(open)
  try {
    const deadline = Date.now() + 20000
    while (!probe()) {
      if (Date.now() > deadline) throw new Error('Owned pool window did not become routable')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
    }
  } catch (e) {
    gate(close)
    throw e
  }
  return () => gate(close)
}
