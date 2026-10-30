/** Browser-only interactions shared by portable probes and DOM regression tests. */
export function revealNativeMenuItem(menu: HTMLElement, item: HTMLElement): boolean {
  const doc = item.ownerDocument
  const win = doc.defaultView!
  // Only scroll the menu's own scrollports. Moving the page or an overflow:hidden box
  // would make an inaccessible item appear usable without a gesture the owner can perform.
  for (
    let parent = item.parentElement;
    parent && menu.contains(parent);
    parent = parent.parentElement
  ) {
    if (!/^(auto|scroll)$/.test(win.getComputedStyle(parent).overflowY)) continue
    const row = item.getBoundingClientRect(),
      box = parent.getBoundingClientRect()
    if (row.bottom > box.bottom) parent.scrollTop += row.bottom - box.bottom
    else if (row.top < box.top) parent.scrollTop -= box.top - row.top
  }
  const box = item.getBoundingClientRect()
  if (
    !box.width ||
    !box.height ||
    box.left < 0 ||
    box.right > win.innerWidth ||
    box.top < 0 ||
    box.bottom > win.innerHeight
  )
    return false
  for (
    let parent = item.parentElement;
    parent && menu.contains(parent);
    parent = parent.parentElement
  ) {
    const style = win.getComputedStyle(parent),
      clip = parent.getBoundingClientRect()
    if (
      /^(auto|scroll|hidden|clip)$/.test(style.overflowY) &&
      (box.top < clip.top || box.bottom > clip.bottom)
    )
      return false
    if (
      /^(auto|scroll|hidden|clip)$/.test(style.overflowX) &&
      (box.left < clip.left || box.right > clip.right)
    )
      return false
  }
  const hit = doc.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
  return !!hit && item.contains(hit)
}

export async function waitForUiMatch<T>(
  find: () => T,
  wait: (ms: number) => Promise<void>,
  ms: number
): Promise<T | false> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    const match = find()
    if (match) return match
    await wait(100)
  }
  return false
}

export function expandFirstOutlineQuestion(root: ParentNode): void {
  const question = root.querySelector<HTMLElement>('[data-question]')
  if (question?.classList.contains('is-collapsed'))
    question.querySelector<HTMLElement>(':scope > .tree-item-self > .collapse-icon')?.click()
}

export async function openChatSetup(
  chat: HTMLElement,
  until: (find: () => unknown, ms: number) => Promise<unknown>
): Promise<boolean> {
  const more = chat.querySelector<HTMLButtonElement>('[aria-label="More chat actions"]')
  if (!more) throw new Error('No chat header overflow action')
  more.click()
  const find = () =>
    [...chat.ownerDocument.querySelectorAll<HTMLElement>('.menu-item')].find(
      (item) =>
        (item.querySelector('.menu-item-title')?.textContent ?? item.textContent)?.trim() ===
        'Access, tools and chat settings'
    )
  if (!(await until(find, 3000))) throw new Error('No chat setup menu action')
  const action = find()
  if (!action) throw new Error('Chat setup menu action disappeared')
  action.click()
  return true
}

export function dismissNativeDialog(root: HTMLElement): void {
  const doc = root.ownerDocument
  const win = doc.defaultView!
  const event = new win.KeyboardEvent('keydown', {
    key: 'Escape',
    code: 'Escape',
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperty(event, 'keyCode', { value: 27 })
  doc.body.dispatchEvent(event)
}
