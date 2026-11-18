/** Serialized into the renderer; dismiss through the same controls as a person. */
export async function closeScopeCapture(doc: Document, win: Window): Promise<void> {
  ;(doc.activeElement as HTMLElement | null)?.blur()
  doc.documentElement.style.removeProperty('--keyboard-height')
  win.dispatchEvent(new Event('keyboardWillHide'))
  const dismiss = () => {
    for (const modal of Array.from(doc.querySelectorAll('.modal.abele-modal')).reverse()) {
      const close =
        Array.from(modal.querySelectorAll<HTMLButtonElement>('.abele-modal__footer button')).find(
          (button) => button.textContent?.trim() === 'Close' && !button.disabled
        ) ??
        modal.querySelector<HTMLElement>(
          '.modal-close-button, .modal-header-button:has(svg.lucide-x)'
        )
      close?.click()
    }
  }
  dismiss()
  doc.dispatchEvent(new Event('abele-scope-capture-release'))
  for (let attempt = 0; attempt < 30 && doc.querySelector('.modal.abele-modal'); attempt++) {
    await new Promise((resolve) => win.setTimeout(resolve, 100))
    dismiss()
  }
  if (doc.querySelector('.modal.abele-modal')) throw new Error('Scope capture dialog did not close')
}
