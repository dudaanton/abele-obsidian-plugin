/** Visible reference for native-motion probes; avoid forcing layout of hidden markdown. */
export function visibleChatAnchor(el: HTMLElement): Element | undefined {
  const top = el.getBoundingClientRect().top
  const visible = new Set(
    Array.from(el.querySelectorAll('.abele-markdown')).filter((root) => {
      const bounds = root.getBoundingClientRect()
      return bounds.bottom > top && bounds.top < top + el.clientHeight
    })
  )
  const block = Array.from(el.querySelectorAll('.abele-markdown > *')).find(
    (e) =>
      visible.has(e.parentElement!) &&
      e.getClientRects().length &&
      e.getBoundingClientRect().top >= top &&
      e.getBoundingClientRect().top < top + el.clientHeight
  )
  if (block) return block
  return Array.from(
    el.querySelectorAll('[data-message-id], .abele-ai-chat__streaming-content p')
  ).find((e) => e.getBoundingClientRect().bottom > top + 20)
}
