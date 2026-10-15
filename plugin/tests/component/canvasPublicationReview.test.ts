/**
 * The local review of an uncertain canvas publication, as the canvas view opens it: its three
 * screens, their text and buttons in order, the source shown as text only, `keep` called exactly
 * once whichever way it ends, and a discard that disables itself, is awaited and only then closes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { Modal } from 'obsidian'
import { ShellModal } from '@/modal/ShellModal'
import { CanvasPublicationReviewModal } from '@/canvas/CanvasPublicationReviewModal'
import type { CanvasPublicationReview } from '@/canvas/obsidianStore'
import { emptyCanvas, serializeCanvas } from '@/canvas/core/model'
import { planCanvasEdit } from '@/canvas/core/service'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

const graph = (label: string) =>
  planCanvasEdit(emptyCanvas(), [
    { op: 'add_node', node: { id: 'sample', kind: 'text', label, x: 0, y: 0 } },
  ])

function sampleReview(over: Partial<CanvasPublicationReview> = {}): CanvasPublicationReview {
  const source = graph('<img src="sample-image.png">Sample source')
  return {
    source: {
      bytes: serializeCanvas(source),
      graph: source,
      error: null,
      revision: 'sample-source',
    },
    evidence: {
      outcome: 'unknown',
      baseline: { graph: graph('Sample baseline'), revision: 'sample-baseline' },
      proposed: graph('Sample proposed'),
      kind: 'command',
    },
    native: false,
    ...over,
  }
}

let opened: CanvasPublicationReviewModal[] = []
function open(
  review = sampleReview(),
  discard: () => Promise<void> = async () => {}
): {
  modal: CanvasPublicationReviewModal
  keep: ReturnType<typeof vi.fn>
  discard: typeof discard
} {
  const keep = vi.fn()
  const spy = vi.fn(discard)
  const modal = new CanvasPublicationReviewModal(useVault([]) as never, review, keep, spy)
  opened.push(modal)
  modal.open()
  return { modal, keep, discard: spy }
}

const root = () => document.querySelector<HTMLElement>('.abele-canvas-publication-review')
const body = () => root()!.querySelector('.abele-modal__body')!
const paragraphs = () => [...body().querySelectorAll(':scope > p')].map((p) => p.textContent)
const buttons = () => [
  ...root()!.querySelectorAll<HTMLButtonElement>('.abele-modal__footer button'),
]
const labels = () => buttons().map((b) => b.textContent)
const press = (text: string) =>
  buttons()
    .find((b) => b.textContent === text)!
    .click()

beforeEach(() => useVault([]))
afterEach(() => {
  for (const modal of opened.splice(0)) modal.close()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('CanvasPublicationReview', () => {
  it('shows the review with its sections, summaries and buttons in order', () => {
    const { modal } = open(sampleReview({ native: true }))
    expect(root()!.classList.contains('modal')).toBe(true)
    expect(modal.modalEl).toBe(root())
    expect(root()!.querySelector('.modal-title, .abele-modal__body')).not.toBeNull()
    expect(paragraphs()[0]).toBe(
      'Canvas publication outcome is uncertain; retained work needs local review.'
    )
    expect(paragraphs()[1]).toMatch(/^Matching file contents do not acknowledge this attempt\./)
    expect(
      [...body().querySelectorAll('details.markdown-rendered > summary')].map((s) => s.textContent)
    ).toEqual([
      'Current persisted source',
      'Retained proposed draft — not persisted-source evidence',
      'Original baseline (historical)',
    ])
    expect(paragraphs().filter((p) => p!.endsWith('Expand for full data.'))).toEqual([
      '1 node, 0 connections. Preview: <img src="sample-image.png">Sample source. Expand for full data.',
      '1 node, 0 connections. Preview: Sample proposed. Expand for full data.',
      '1 node, 0 connections. Preview: Sample baseline. Expand for full data.',
    ])
    expect(paragraphs().at(-1)).toMatch(/^A native editor is open\./)
    expect(labels()).toEqual(['Keep retained work', 'Discard local pending copy…'])
    expect(buttons()[1].classList.contains('mod-warning')).toBe(true)
    expect(buttons()[0].classList.contains('mod-warning')).toBe(false)
  })

  it('shows source, draft and baseline as text only, never as markup', () => {
    const review = sampleReview()
    open(review)
    const source = body().querySelector('pre[data-review="source"]')!
    expect(source.textContent).toBe(review.source.bytes)
    expect(source.children).toHaveLength(0)
    expect(body().querySelector('img')).toBeNull()
    expect(body().querySelector('pre[data-review="proposed"]')!.textContent).toBe(
      JSON.stringify(review.evidence.proposed, null, 2)
    )
    expect(body().querySelector('pre[data-review="baseline"]')!.textContent).toBe(
      JSON.stringify(review.evidence.baseline, null, 2)
    )
  })

  it('says when the persisted source cannot be parsed, after its section', () => {
    open(
      sampleReview({
        source: { bytes: '{ broken', graph: null, error: 'Sample parse error', revision: 'r' },
        evidence: { ...sampleReview().evidence, outcome: 'written-acknowledgment-pending' },
      })
    )
    expect(paragraphs()[0]).toMatch(/^The canvas write was confirmed/)
    expect(paragraphs()[2]).toBe(
      'Persisted source cannot be parsed: Sample parse error. Discard does not repair or rewrite it.'
    )
    expect(paragraphs().some((p) => p!.startsWith('A native editor'))).toBe(false)
  })

  it('keeps once on Keep retained work and closes', () => {
    const { modal, keep, discard } = open()
    press('Keep retained work')
    expect(keep).toHaveBeenCalledOnce()
    expect(root()).toBeNull()
    modal.close()
    expect(keep).toHaveBeenCalledOnce()
    expect(discard).not.toHaveBeenCalled()
  })

  it('keeps at once when the host dismisses it, before its close animation finishes', async () => {
    const shown = vi.spyOn(ShellModal.prototype, 'open')
    const { keep } = open()
    const shell = shown.mock.contexts[0] as ShellModal
    // The host can defer onClose and removal while its mobile sheet animates away.
    const close = vi.spyOn(Modal.prototype, 'close').mockImplementation(() => {})
    // Escape, the backdrop and the close button all end in the host modal's close.
    shell.close()
    expect(keep).toHaveBeenCalledOnce()
    await nextTick()
    expect(close).toHaveBeenCalled()
    shell.onClose()
    expect(keep).toHaveBeenCalledOnce()
    close.mockRestore()
    shell.containerEl.remove()
  })

  it('keeps once when closed by its owner, even before it was opened', () => {
    const keep = vi.fn()
    const modal = new CanvasPublicationReviewModal(
      useVault([]) as never,
      sampleReview(),
      keep,
      async () => {}
    )
    modal.close()
    modal.close()
    expect(keep).toHaveBeenCalledOnce()
  })

  it('asks before discarding and Cancel keeps without discarding', async () => {
    const { keep, discard } = open(
      sampleReview({
        evidence: { ...sampleReview().evidence, outcome: 'written-acknowledgment-pending' },
      })
    )
    press('Discard local pending copy…')
    await nextTick()
    expect(paragraphs()).toEqual([
      'Discard the retained pending copy and its unresolved attempt evidence? This does not undo any changes already written to the canvas file. The file may already contain this change. No file contents will be written or restored, and no history entry will be added.',
      'The source write was confirmed. Discard does not reconstruct the missing local acknowledgment or history entry.',
      'After discarding, reread the current file before making a new independently chosen edit. This does not authorize replaying the old attempt.',
    ])
    expect(body().querySelector('pre')).toBeNull()
    expect(labels()).toEqual(['Cancel', 'Discard local pending copy'])
    expect(buttons()[1].classList.contains('mod-warning')).toBe(true)
    expect(keep).not.toHaveBeenCalled()
    press('Cancel')
    expect(keep).toHaveBeenCalledOnce()
    expect(discard).not.toHaveBeenCalled()
    expect(root()).toBeNull()
  })

  it('leaves out the acknowledgment line when the outcome is unknown', async () => {
    open()
    press('Discard local pending copy…')
    await nextTick()
    expect(paragraphs()).toHaveLength(2)
  })

  it('disables Discard while discarding, awaits it and only then closes, keeping once', async () => {
    const pending = deferred<void>()
    const { keep, discard } = open(sampleReview(), () => pending.promise)
    press('Discard local pending copy…')
    await nextTick()
    press('Discard local pending copy')
    press('Discard local pending copy')
    await nextTick()
    expect(discard).toHaveBeenCalledOnce()
    expect(buttons()[1].disabled).toBe(true)
    expect(root()).not.toBeNull()
    expect(keep).not.toHaveBeenCalled()
    pending.resolve()
    await vi.waitFor(() => expect(root()).toBeNull())
    expect(keep).toHaveBeenCalledOnce()
  })

  it('shows the failure screen when the discard fails, with Keep as its only way out', async () => {
    const { keep } = open(sampleReview(), () => Promise.reject(new Error('Sample stale review')))
    press('Discard local pending copy…')
    await nextTick()
    press('Discard local pending copy')
    await vi.waitFor(() =>
      expect(paragraphs()).toEqual([
        'Sample stale review. Close and reopen the review; retained work has not been discarded by this obsolete choice.',
      ])
    )
    expect(labels()).toEqual(['Keep retained work'])
    expect(keep).not.toHaveBeenCalled()
    press('Keep retained work')
    expect(keep).toHaveBeenCalledOnce()
    expect(root()).toBeNull()
  })

  it('names a failure that is not an Error generically', async () => {
    open(sampleReview(), () => Promise.reject('sample'))
    press('Discard local pending copy…')
    await nextTick()
    press('Discard local pending copy')
    await vi.waitFor(() => expect(paragraphs()[0]).toMatch(/^Local choice could not complete\./))
  })

  it('stays closed when closed while the discard was still running', async () => {
    const pending = deferred<void>()
    const { modal, keep } = open(sampleReview(), () => pending.promise)
    press('Discard local pending copy…')
    await nextTick()
    press('Discard local pending copy')
    modal.close()
    expect(keep).toHaveBeenCalledOnce()
    pending.reject(new Error('Sample late failure'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(root()).toBeNull()
    expect(keep).toHaveBeenCalledOnce()
  })
})
