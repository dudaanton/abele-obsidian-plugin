import './destinationReview.css'
import { openDialog } from '@/components/obsidian/dialogs'
import KeyDestinationsModal from '@/components/settings/KeyDestinationsModal.vue'

/**
 * The open review dialog, as its callers reach it: the shell's elements, `close()`, and an
 * `onClose` called once it has closed by any way, which a caller may wrap to wait for that.
 */
export interface KeyDestinationsDialog {
  readonly modalEl: HTMLElement
  readonly bodyEl: HTMLElement
  readonly footerEl: HTMLElement | null
  close(): void
  onClose(): void
}

/** One recipient decision, with named-key permissions kept visible rather than only transport exceptions. */
export function reviewKeyDestinations(): KeyDestinationsDialog {
  const controller = new AbortController()
  let modalEl = null as HTMLElement | null
  // A kit dialog given as the component itself mounts before `openDialog` returns, so the
  // shell is on screen and `opened` has run by the next line.
  const closed = openDialog(
    KeyDestinationsModal,
    { onOpened: (el: HTMLElement) => (modalEl = el) },
    { signal: controller.signal }
  )
  if (!modalEl) {
    controller.abort()
    void closed.catch(() => {})
    throw new Error('The key destinations dialog failed to open')
  }
  const shell: HTMLElement = modalEl
  const dialog: KeyDestinationsDialog = {
    modalEl: shell,
    bodyEl: shell.querySelector<HTMLElement>('.abele-modal__body'),
    footerEl: shell.querySelector<HTMLElement>('.abele-modal__footer'),
    close: () => controller.abort(),
    onClose: () => {},
  }
  void closed
    .catch((error) => console.debug('[Abele] Key destinations dialog failed', error))
    .finally(() => dialog.onClose())
  return dialog
}
