/**
 * Waits until the phone's system keyboard really takes input into the focused field. DOM focus
 * and the keyboard-height notification both come before the native text responder is ready, so
 * text typed at once loses its first characters. Readiness is proven, not timed: a probe
 * character is typed until it shows up in the field, then erased, and the field reads as before.
 *
 * Runs inside the page: `installPhoneHost` injects its source, so it uses nothing from outside.
 * `type` is the phone's own typing (through the host); a selection is kept across the probe.
 */
export async function keyboardReady(
  type: (text: string) => Promise<unknown>,
  timeoutMs = 20_000
): Promise<void> {
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

  // The focused field and the keyboard over it, as far as the page can tell.
  for (const shown = Date.now() + timeoutMs / 2; Date.now() < shown; await wait(50))
    if (editable() && keyboard() > 1) break
  const el = editable()
  if (!el) throw new Error('No focused field to type into: ' + evidence())

  // The probe goes at the end of a selection, so typing it replaces nothing.
  let restore = () => {}
  if (plain(el)) {
    const input = el as HTMLInputElement
    const { selectionStart: start, selectionEnd: stop, selectionDirection: dir } = input
    if (start !== null && stop !== null && start !== stop) {
      input.setSelectionRange(stop, stop)
      restore = () => input.setSelectionRange(start, stop, dir ?? undefined)
    }
  } else {
    const selection = getSelection()
    if (selection && selection.rangeCount && !selection.isCollapsed) {
      const range = selection.getRangeAt(0).cloneRange()
      selection.collapseToEnd()
      restore = () => {
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
  }
  const before = read(el)
  const until = async (done: () => boolean, ms: number) => {
    for (const stop = Math.min(end, Date.now() + ms); Date.now() < stop; await wait(50))
      if (done()) return true
    return done()
  }

  let sent = 0
  for (;;) {
    if (document.activeElement !== el) throw new Error('The field lost focus: ' + evidence())
    if (Date.now() >= end)
      throw new Error(`The keyboard took no input in ${timeoutMs} ms: ` + evidence())
    await type('x')
    sent++
    if (await until(() => read(el) !== before, 1500)) break
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
  await type('\b'.repeat(extra))
  if (!(await until(() => read(el) === before, 5000)))
    throw new Error('The probe could not be erased: ' + evidence())
  restore()
}
