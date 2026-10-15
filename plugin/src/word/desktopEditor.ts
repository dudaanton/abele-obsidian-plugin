import type { App } from 'obsidian'
import { mountKit } from '@/components/obsidian/mount'
import type { WordEdit } from './edit'
import type { WordPackage, WordParagraph } from './package'
import WordParagraphEditor from './WordParagraphEditor.vue'

export interface DesktopEditHost {
  app: App
  apply(edit: WordEdit): Promise<void>
  cancel(): void
  range?: { from: number; to: number }
  readOnly?: boolean
}
/**
 * Plain desktop fields act on original package operations; never a lossy contenteditable model.
 * The form is `WordParagraphEditor`, added after whatever the row already holds; the returned
 * function takes it out again.
 */
export function mountWordEditor(
  row: HTMLElement,
  doc: WordPackage,
  p: WordParagraph,
  host: DesktopEditHost
): () => void {
  const kit = mountKit(
    row.createDiv(),
    WordParagraphEditor,
    { doc, paragraph: p, host },
    { remove: true }
  )
  return kit.unmount
}
