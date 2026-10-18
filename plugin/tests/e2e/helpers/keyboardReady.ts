/**
 * Waits until the phone's system keyboard really takes input into the focused field. DOM focus
 * and the keyboard-height notification both come before the native text responder is ready, so
 * text typed at once loses its first characters. Readiness is proven, not timed: a probe
 * character is typed until it shows up in the field, then erased, and the field reads as before.
 *
 * The driver can type two ways, and one of them (XCUITest typing into the element it believes
 * has the focus) sometimes answers success while nothing arrives. `paths` lists the ways to try,
 * in order; one whose probes keep going nowhere gives way to the next, and the way that worked
 * is the answer, for the text to be typed the same way.
 *
 * Runs inside the page: `installPhoneHost` injects its source, so it uses nothing from outside.
 * `type` is the phone's own typing (through the host).
 */
export async function keyboardReady<P>(
  type: (text: string, path: P) => Promise<unknown>,
  paths: P[],
  timeoutMs = 20_000,
  // The probe is erased from the page, as a backward delete: the keys path has no Backspace,
  // and on some fields a typed one is not delivered.
  erase = (count: number) => {
    for (let i = 0; i < count; i++) document.execCommand('delete')
  }
): Promise<P> {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const end = Date.now() + timeoutMs
  const editable = (): HTMLElement | null => {
    const el = document.activeElement as HTMLElement | null
    return el && (el.matches('input,textarea') || el.isContentEditable) ? el : null
  }
  const plain = (el: HTMLElement) => el.matches('input,textarea')
  const read = (el: HTMLElement): string => {
    if (plain(el)) return (el as HTMLInputElement).value
    // An editor's placeholder is drawn inside the field and goes once anything is typed.
    const copy = el.cloneNode(true) as HTMLElement
    copy.querySelectorAll('.cm-placeholder,.cm-widgetBuffer').forEach((n) => n.remove())
    return copy.textContent ?? ''
  }
  const keyboard = () =>
    Math.max(
      ...[document.documentElement, document.body].map(
        (el) => parseFloat(getComputedStyle(el).getPropertyValue('--keyboard-height')) || 0
      ),
      window.visualViewport ? innerHeight - window.visualViewport.height : 0
    )
  const evidence = () =>
    JSON.stringify({
      active: document.activeElement?.tagName + '.' + (document.activeElement?.className || ''),
      keyboard: keyboard(),
      value: editable() ? read(editable()!).slice(-40) : null,
    })

  const el = editable()
  if (!el) throw new Error('No focused field to type into: ' + evidence())

  // A selection is the caller's to replace and a probe would replace it first: there the settled
  // keyboard is all the evidence there is.
  const selected = plain(el)
    ? (el as HTMLInputElement).selectionStart !== null &&
      (el as HTMLInputElement).selectionStart !== (el as HTMLInputElement).selectionEnd
    : getSelection()?.isCollapsed === false
  if (selected) {
    let height = -1,
      still = 0
    for (const shown = Date.now() + timeoutMs / 2; Date.now() < shown; await wait(100)) {
      const now = document.activeElement === el ? keyboard() : 0
      still = now > 1 && now === height ? still + 1 : 0
      height = now
      if (still >= 3) break
    }
    if (document.activeElement !== el) throw new Error('The field lost focus: ' + evidence())
    return paths[0]
  }
  // A contenteditable can have the native keyboard while its page still reports zero height.
  // The driver checks the real keyboard; delivered probes prove readiness without consuming
  // half the input deadline on an unrelated geometry notification.
  const before = read(el)
  const until = async (done: () => boolean, ms: number) => {
    for (const stop = Math.min(end, Date.now() + ms); Date.now() < stop; await wait(50))
      if (done()) return true
    return done()
  }

  // One probe can get through while the next text still loses its start: two in a row must.
  let sent = 0,
    delivered = 0,
    lost = 0,
    at = 0
  while (delivered < 2) {
    if (document.activeElement !== el) throw new Error('The field lost focus: ' + evidence())
    if (Date.now() >= end)
      throw new Error(`The keyboard took no input in ${timeoutMs} ms: ` + evidence())
    // Three lost in a row on one way: the next way, while there is one.
    if (lost >= 3 && at < paths.length - 1) {
      at++
      lost = 0
    }
    const was = read(el)
    const started = Date.now()
    await type('x', paths[at])
    sent++
    const arrived = await until(() => read(el) !== was, 1500)
    console.debug('[phone-keyboard-probe]', {
      path: paths[at],
      probe: sent,
      arrived,
      elapsed: Date.now() - started,
      remaining: end - Date.now(),
      evidence: evidence(),
    })
    delivered = arrived ? delivered + 1 : 0
    lost = arrived ? 0 : lost + 1
  }
  // A probe sent earlier may still be on its way: read until two readings agree.
  let last = read(el)
  await until(() => {
    const now = read(el)
    const same = now === last
    last = now
    return same
  }, 1000)
  const extra = read(el).length - before.length
  if (extra < 1 || extra > sent)
    throw new Error(`The probe changed the field unexpectedly (sent ${sent}): ` + evidence())
  erase(extra)
  if (!(await until(() => read(el) === before, 5000)))
    throw new Error('The probe could not be erased: ' + evidence())
  return paths[at]
}
