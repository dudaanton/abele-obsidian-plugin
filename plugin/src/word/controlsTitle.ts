import type { WordPageBlock, WordPageModel } from './pageModel'

export function wordControlsTitle(number: number, picture: boolean, table: boolean): string {
  return picture ? 'Picture' : table ? 'Table' : `Paragraph ${number}`
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
