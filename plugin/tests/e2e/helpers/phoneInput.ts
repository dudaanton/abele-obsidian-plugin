/** Runs in the page; the injected native host uses this document's viewport coordinates. */
export async function focusPhoneInput(
  input: HTMLInputElement,
  tap: (x: number, y: number) => Promise<void>,
  wait: (ms: number) => Promise<void>,
  timeoutMs = 10000
): Promise<void> {
  const doc = input.ownerDocument,
    win = doc.defaultView!
  const deadline = Date.now() + timeoutMs
  for (let attempt = 0; attempt < 2; attempt++) {
    input.scrollIntoView({ block: 'nearest', behavior: 'instant' })
    let previous = '',
      stable = 0,
      x = 0,
      y = 0
    while (stable < 3) {
      if (!input.isConnected) throw new Error('Share input closed before native focus')
      if (Date.now() >= deadline) throw new Error('Share input has no settled hittable point')
      const r = input.getBoundingClientRect()
      x = Math.round(r.left + r.width / 2)
      y = Math.round(r.top + r.height / 2)
      const hit = doc.elementFromPoint(x, y)
      const current = JSON.stringify([r.left, r.top, r.width, r.height])
      const visible =
        r.width > 0 &&
        r.height > 0 &&
        x >= 0 &&
        y >= 0 &&
        x < win.innerWidth &&
        y < win.innerHeight &&
        hit === input
      stable = visible && current === previous ? stable + 1 : 0
      previous = current
      await wait(100)
    }
    // Remeasure after the final wait; a closing sheet must never turn this into a backdrop tap.
    const r = input.getBoundingClientRect()
    x = Math.round(r.left + r.width / 2)
    y = Math.round(r.top + r.height / 2)
    if (!input.isConnected || doc.elementFromPoint(x, y) !== input)
      throw new Error('Share input moved or became covered before native tap')
    await tap(x, y)
    for (let i = 0; i < 10; i++) {
      if (!input.isConnected) throw new Error('Share input closed during native tap')
      if (doc.activeElement === input) return
      await wait(100)
    }
  }
  throw new Error('Native tap did not focus the Share input')
}
