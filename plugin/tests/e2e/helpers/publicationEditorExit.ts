/** Let the product hear real focusout; never bypass its idle predicate or prompt controller. */
export function leaveEditorForPublication(doc: Document): void {
  const active = doc.activeElement as HTMLElement | null
  if (active && typeof active.blur === 'function') active.blur()
}
