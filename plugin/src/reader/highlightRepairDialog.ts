import type { App } from 'obsidian'
import { ShellModal } from '@/modal/ShellModal'
import type { PreparedHighlightRepair } from './companion'

/** No write or implicit confirmation: every way to close except the explicit button cancels. */
export function askToRepairLinks(app: App, items: PreparedHighlightRepair[]): {
  answer: Promise<boolean>; cancel: () => void
} {
  let settle: (accepted: boolean) => void = () => {}
  const answer = new Promise<boolean>((resolve) => { settle = resolve })
  let accepted = false
  const modal = new (class extends ShellModal {
    onClose(): void {
      super.onClose()
      settle(accepted)
    }
  })(app, { title: items.length === 1 ? 'Repair highlight link?' : `Repair ${items.length} highlight links?`, footer: true, size: 'tall' })
  modal.bodyEl.createEl('p', { text: 'These quoted words were found away from their saved links. Only the links will change, not the quotes or comments.' })
  modal.bodyEl.createEl('p', { text: 'Only mismatches found in chapters opened during this reading session are listed. Repeated words use the occurrence nearest the saved location when that location is available.' })
  for (const item of items) {
    const section = modal.bodyEl.createDiv()
    section.createEl('strong', { text: item.label || 'Untitled chapter' })
    section.createEl('p', { text: `“${item.text}”` })
    const { pre, match, post } = item.context
    section.createEl('p', { text: `${pre.slice(-70)}${match}${post.slice(0, 70)}` })
    if (!item.anchored) section.createEl('p', { text: 'Saved location unavailable; this is a found occurrence.' })
  }
  modal.addButton('Cancel', () => modal.close())
  modal.addButton(items.length === 1 ? 'Repair link' : `Repair ${items.length} links`, () => { accepted = true; modal.close() }, { cta: true })
  modal.open()
  return { answer, cancel: () => modal.close() }
}
