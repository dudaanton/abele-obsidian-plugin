/** Self-contained so renderer probes can embed it without importing test code into the app. */
export async function settledHoverTarget(find: () => HTMLElement | null) {
  const deadline = Date.now() + 10_000
  let previous: HTMLElement | null = null
  let rectangle = ''
  let since = Date.now()
  while (Date.now() < deadline) {
    const element = find()
    const box = element?.getBoundingClientRect()
    const x = box ? box.left + box.width / 2 : 0
    const y = box ? box.top + box.height / 2 : 0
    const hit = element?.ownerDocument.elementFromPoint(x, y)
    const ready =
      element?.isConnected &&
      box &&
      box.width > 0 &&
      box.height > 0 &&
      (hit === element || (hit && element.contains(hit)))
    const next = ready ? JSON.stringify([box.left, box.top, box.width, box.height]) : ''
    if (!ready || previous !== element || rectangle !== next) since = Date.now()
    if (ready && Date.now() - since >= 700) return { element, x, y }
    previous = element
    rectangle = next
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Hover target did not settle: marker missing, moving or covered')
}
