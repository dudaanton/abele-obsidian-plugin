import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WordDetails from '@/word/WordDetails.vue'
import type { WordPageModel, WordPageParagraph } from '@/word/pageModel'

const p = (
  number: number,
  text: string,
  more: Partial<WordPageParagraph> = {}
): WordPageParagraph => ({
  kind: 'paragraph',
  number,
  runs: [{ text }],
  ...more,
})

const sample = (): WordPageModel => ({
  styles: [],
  blocks: [
    p(1, 'Sample intro'),
    {
      kind: 'paragraph',
      number: 2,
      runs: [{ text: 'Read the ' }, { text: 'sample guide', link: 'https://example.com/guide' }],
    },
    p(3, 'Sample closing'),
    {
      kind: 'image',
      number: 1,
      paragraph: 3,
      src: 'sample-image.png',
      alt: 'Sample picture',
      width: 200,
      height: 100,
    },
    {
      kind: 'table',
      number: 1,
      rows: [
        [p(4, 'A1'), p(5, 'B1', { cell: 5, colSpan: 2 })],
        [p(6, 'A2'), p(7, 'B2'), p(8, 'C2')],
      ],
    },
  ],
})

const open = (paragraph: number, more: Record<string, unknown> = {}) =>
  mount(WordDetails, { props: { model: sample(), paragraph, ...more } })

describe('WordDetails', () => {
  it('changes and removes a link without touching its words', async () => {
    const view = open(2)
    const field = view.get('input[aria-label="Address of the link on sample guide"]')
    await field.setValue('https://example.com/other')
    await field.trigger('change')
    await view.get('[aria-label="Remove the link, keep the words"]').trigger('click')

    expect(view.emitted('edit')).toEqual([
      [{ operation: 'link', paragraph: 2, from: 9, to: 21, url: 'https://example.com/other' }],
      [{ operation: 'link', paragraph: 2, from: 9, to: 21, url: '' }],
    ])
  })

  it('joins only with a paragraph that stands beside it', async () => {
    await open(1).get('[aria-label="Join the next paragraph onto this one"]').trigger('click')
    const last = open(3)
    expect(last.text()).toContain('The next one is in a table')
    expect(last.find('[aria-label="Join the next paragraph onto this one"]').exists()).toBe(false)
  })

  it('resizes a picture keeping its proportions unless unlocked', async () => {
    const view = open(3, { pictureOnly: true })
    const width = view.get('input[aria-label="Width in pixels"]')
    await width.setValue('100')
    await width.trigger('change')
    await view.get('[aria-label="Width and height change together"]').trigger('click')
    const height = view.get('input[aria-label="Height in pixels"]')
    await height.setValue('80')
    await height.trigger('change')

    expect(view.emitted('edit')).toEqual([
      [{ operation: 'image_resize', paragraph: 3, image: 1, width: 100, height: 50 }],
      [{ operation: 'image_resize', paragraph: 3, image: 1, width: 100, height: 80 }],
    ])
    expect(view.text()).not.toContain('Join with the next paragraph')
  })

  it("works a cell by the table's grid and says what cannot be merged", async () => {
    const merged = open(5)
    expect(merged.text()).toContain('Row 1')
    expect(merged.text()).toContain('Merged across 2 columns')
    await merged.get('[aria-label="Split back into single cells"]').trigger('click')
    await merged.get('[aria-label="Merge with the cell below"]').trigger('click')
    expect(merged.emitted('edit')).toEqual([
      [{ operation: 'cells_split', paragraph: 5, table: 1, row: 1, column: 2 }],
      [
        {
          operation: 'cells_merge',
          paragraph: 5,
          table: 1,
          row: 1,
          column: 2,
          to_row: 2,
          to_column: 2,
        },
      ],
    ])

    const corner = open(8)
    await corner.get('[aria-label^="Merge with the cell to the right"]').trigger('click')
    await corner.get('[aria-label="Add a row below"]').trigger('click')
    expect(corner.emitted('edit')).toEqual([
      [{ operation: 'row_add', paragraph: 8, table: 1, row: 2, column: 3 }],
    ])
  })

  it('only says what is there when the document cannot change', async () => {
    const view = open(2, { readOnly: 'the file is protected' })
    expect(view.text()).toContain('Read only: the file is protected')
    expect(view.text()).toContain('https://example.com/guide')
    expect(view.find('input').exists()).toBe(false)
    expect(view.find('.clickable-icon').exists()).toBe(false)
  })
})
