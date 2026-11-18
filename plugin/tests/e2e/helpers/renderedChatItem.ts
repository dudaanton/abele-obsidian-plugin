/** Locate a message, including a call represented by its collapsed run header. */
export function renderedChatItem(el: HTMLElement | undefined, id: string) {
  return (
    el?.querySelector<HTMLElement>(`[data-message-id="${id}"]`) ??
    el?.querySelector<HTMLElement>(`[data-run-ids~="${id}"]`) ??
    null
  )
}
