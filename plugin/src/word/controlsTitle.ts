import { t } from '@/i18n'
import type { WordPageBlock, WordPageModel } from './pageModel'

export function wordControlsTitle(number: number, picture: boolean, table: boolean): string {
  return picture
    ? t('streamC.9a1c54f55e7cfb1c')
    : table
      ? t('streamC.16d1c9050a0b32e8')
      : t('streamC.54c5c35aab75e0a4', { v1: String(number) })
}

/** Named for what was chosen: the picture when it was the picture, else the cell's table or the paragraph. */
export function pageControlsTitle(model: WordPageModel, number: number, picture: boolean): string {
  let table = false
  const visit = (blocks: WordPageBlock[]) => {
    for (const block of blocks) {
      if (block.kind !== 'table') continue
      for (const p of block.rows.flat()) {
        if (p.number === number) table = true
        visit(p.beforeTables ?? [])
        visit(p.afterTables ?? [])
      }
    }
  }
  visit(model.blocks)
  return wordControlsTitle(number, picture, table)
}
