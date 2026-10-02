/** A phone file must not hand landscape or a native keyboard to the next file. */
export interface PhoneState {
  width: number
  height: number
  keyboard: number
  typing: boolean
}

/** Also serialized into the page; keep this function independent of module-level values. */
export async function restorePhoneState(
  read: () => PhoneState,
  portrait: () => Promise<unknown>,
  blur: () => Promise<unknown>,
  wait: () => Promise<unknown>,
  attempts = 120
): Promise<{ before: PhoneState; after: PhoneState }> {
  const before = read()
  // Both are idempotent. Blur even when the height is zero: a focused editor can summon
  // its keyboard on the next frame. Never fake the native keyboard variable or viewport.
  try {
    if (before.width >= before.height) await portrait()
  } finally {
    await blur()
  }
  let after = before
  let stable = 0
  for (let i = 0; i < attempts; i++) {
    after = read()
    if (after.height > after.width && after.keyboard <= 1 && !after.typing) stable++
    else stable = 0
    if (stable >= 5) return { before, after }
    await wait()
  }
  throw new Error('phone did not settle in portrait with no keyboard: ' + JSON.stringify(after))
}

export const RESTORE_PHONE_SCRIPT = `(async () => {
  const read = () => {
    const viewport = window.visualViewport
    const native = parseFloat(getComputedStyle(document.body).getPropertyValue('--keyboard-height')) || 0
    const visual = viewport ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop) : 0
    const active = document.activeElement
    return { width: innerWidth, height: innerHeight, keyboard: Math.max(native, visual),
      typing: !!active && (active.matches('input,textarea') || active.isContentEditable) }
  }
  const result = await (${restorePhoneState.toString()})(read,
    () => window.__e2eHost.orientation('portrait'),
    async () => { document.activeElement?.blur() },
    () => new Promise(resolve => setTimeout(resolve, 100)))
  return result
})()`
