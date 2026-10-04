import type { App } from 'obsidian'
import { ShellModal } from '../modal/ShellModal'
import type { CanvasPublicationOutcome } from './core/session'
import { labelOf, type CanvasGraph } from './core/model'
import type { CanvasPublicationReview } from './obsidianStore'

export function canvasPublicationStatus(outcome: CanvasPublicationOutcome): string {
  return outcome === 'unknown'
    ? 'Canvas publication outcome is uncertain; retained work needs local review.'
    : 'The canvas write was confirmed, but local acknowledgment is pending; retained work needs local review.'
}

/** Local read-only review. Its choice is not an agent proposal or publication capability. */
export class CanvasPublicationReviewModal extends ShellModal {
  private finished = false
  constructor(
    app: App,
    private readonly review: CanvasPublicationReview,
    private readonly keep: () => void,
    private readonly discard: () => Promise<void>
  ) {
    super(app, {
      title: 'Review retained canvas change',
      footer: true,
      cls: ['abele-canvas-publication-review'],
    })
    this.showReview()
  }
  private section(title: string, value: string, kind: string, graph: CanvasGraph | null): void {
    const details = this.bodyEl.createEl('details', { cls: 'markdown-rendered' })
    details.createEl('summary', { text: title })
    // Text only: source and extension contents cannot execute markup or load attachments.
    const pre = details.createEl('pre', { text: value })
    pre.setAttribute('data-review', kind)
    if (graph)
      this.bodyEl.createEl('p', {
        text: `${graph.nodes.length} nodes, ${graph.edges.length} connections. Preview: ${
          graph.nodes
            .slice(0, 3)
            .map((node) => labelOf(node).slice(0, 120))
            .join('; ') || '(empty)'
        }. Expand for full data.`,
      })
  }
  private showReview(): void {
    this.bodyEl.empty()
    this.footerEl.empty()
    this.bodyEl.createEl('p', { text: canvasPublicationStatus(this.review.evidence.outcome) })
    this.bodyEl.createEl('p', {
      text: 'Matching file contents do not acknowledge this attempt. Keep the retained copy, or discard only local pending work. Any desired change afterward is a new ordinary edit after rereading the current file, not replay of this attempt.',
    })
    this.section(
      'Current persisted source',
      this.review.source.bytes,
      'source',
      this.review.source.graph
    )
    if (this.review.source.error)
      this.bodyEl.createEl('p', {
        text: `Persisted source cannot be parsed: ${this.review.source.error}. Discard does not repair or rewrite it.`,
      })
    this.section(
      'Retained proposed draft — not persisted-source evidence',
      JSON.stringify(this.review.evidence.proposed, null, 2),
      'proposed',
      this.review.evidence.proposed
    )
    this.section(
      'Original baseline of this attempt — historical evidence',
      JSON.stringify(this.review.evidence.baseline, null, 2),
      'baseline',
      this.review.evidence.baseline.graph
    )
    if (this.review.native)
      this.bodyEl.createEl('p', {
        text: 'A native editor is open. Its unsaved contents are separate from persisted source; this review neither cancels native saves nor proves that this attempt succeeded.',
      })
    this.addButton('Keep retained work', () => this.close())
    this.addButton('Discard local pending copy…', () => this.showConfirmation(), { warning: true })
  }
  private showConfirmation(): void {
    this.bodyEl.empty()
    this.footerEl.empty()
    this.bodyEl.createEl('p', {
      text: 'Discard the retained pending copy and its unresolved attempt evidence? This does not undo any changes already written to the canvas file. The file may already contain this change. No file contents will be written or restored, and no history entry will be added.',
    })
    if (this.review.evidence.outcome === 'written-acknowledgment-pending')
      this.bodyEl.createEl('p', {
        text: 'The source write was confirmed. Discard does not reconstruct the missing local acknowledgment or history entry.',
      })
    this.bodyEl.createEl('p', {
      text: 'After discarding, reread the current file before making a new independently chosen edit. This does not authorize replaying the old attempt.',
    })
    this.addButton('Cancel', () => this.close())
    const button = this.addButton(
      'Discard local pending copy',
      () => {
        button.setDisabled(true)
        void this.commitDiscard()
      },
      { warning: true }
    )
  }
  private async commitDiscard(): Promise<void> {
    try {
      await this.discard()
      if (!this.finished) this.close()
    } catch (cause) {
      if (this.finished) return
      this.bodyEl.empty()
      this.footerEl.empty()
      const message = cause instanceof Error ? cause.message : 'Local choice could not complete'
      this.bodyEl.createEl('p', {
        text: `${message}. Close and reopen the review; retained work has not been discarded by this obsolete choice.`,
      })
      this.addButton('Keep retained work', () => this.close())
    }
  }
  private revoke(): void {
    if (this.finished) return
    this.finished = true
    this.keep()
  }
  close(): void {
    // Admission ends at the user's choice, not at the host's eventual animation callback.
    this.revoke()
    super.close()
  }
  onClose(): void {
    this.revoke()
    super.onClose()
  }
}
