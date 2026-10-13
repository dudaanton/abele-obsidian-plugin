import type { WordPageBlock, WordPageModel } from './pageModel'

export function wordControlsTitle(number: number, picture: boolean, table: boolean): string {
  return picture ? 'Picture' : table ? 'Table' : `Paragraph ${number}`
}

export function pageControlsTitle(model: WordPageModel, number: number): string {
  let picture = false
  let table = false
  const visit = (blocks: WordPageBlock[]) => {
    for (const block of blocks) {
      if (block.kind === 'image' && block.paragraph === number) picture = true
      if (block.kind !== 'table') continue
      for (const p of block.rows.flat()) {
        if (p.number === number) {
          table = true
          if (p.images?.length) picture = true
        }
        visit(p.beforeTables ?? [])
        visit(p.afterTables ?? [])
      }
    }
  }
  visit(model.blocks)
  return wordControlsTitle(number, picture, table)
}
