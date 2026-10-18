import { t } from '@/i18n'
import type { App } from 'obsidian'
import { mountKit, type KitMount } from '@/components/obsidian/mount'
import CanvasPublicationReview from '@/components/canvas/CanvasPublicationReview.vue'
import type { CanvasPublicationOutcome } from './core/session'
import type { CanvasPublicationReview as Review } from './obsidianStore'

export function canvasPublicationStatus(outcome: CanvasPublicationOutcome): string {
  return outcome === 'unknown' ? t('streamC.0875b7517098c910') : t('streamC.45ff3754e5110bf9')
}

/**
 * Local read-only review. Its choice is not an agent proposal or publication capability.
 *
 * The handle the canvas view keeps: the dialog is the kit's `CanvasPublicationReview`, mounted
 * on `open()` and taken down on `close()`; `modalEl` is its `.modal` element while it is open.
 */
export class CanvasPublicationReviewModal {
  /** The dialog's `.modal` element, once opened. */
  modalEl: HTMLElement | null = null
  private finished = false
  private mounted: KitMount | null = null
  constructor(
    _app: App,
    private readonly review: Review,
    private readonly keep: () => void,
    private readonly discard: () => Promise<void>
  ) {}
  open(): void {
    if (this.mounted || this.finished) return
    const doc = typeof activeDocument === 'undefined' ? document : activeDocument
    // A container of its own in the active window; the dialog itself goes where Obsidian puts it.
    const host = doc.win.createDiv()
    doc.body.appendChild(host)
    this.mounted = mountKit(
      host,
      CanvasPublicationReview,
      {
        review: this.review,
        status: canvasPublicationStatus(this.review.evidence.outcome),
        keep: () => this.revoke(),
        discard: this.discard,
        onClose: () => this.close(),
        onOpened: (modalEl: HTMLElement) => (this.modalEl = modalEl),
      },
      { remove: true }
    )
  }
  private revoke(): void {
    if (this.finished) return
    this.finished = true
    this.keep()
  }
  close(): void {
    // Admission ends at the user's choice, not at the host's eventual animation callback.
    this.revoke()
    const mounted = this.mounted
    this.mounted = null
    mounted?.unmount()
  }
}
