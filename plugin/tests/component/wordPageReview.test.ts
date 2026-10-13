import { expect, it } from 'vitest'
import source from '@/word/WordPage.vue?raw'
import { mount } from '@vue/test-utils'
import WordPage from '@/word/WordPage.vue'
import type { WordPageModel } from '@/word/pageModel'

const model = (): WordPageModel => ({
  styles: [{ id: 'Heading1', name: 'Heading 1' }],
  blocks: [{ kind: 'paragraph', number: 1, runs: [{ text: 'Sample paragraph' }] }],
})

it('does not paint-contain the table and clip the edited cell focus ring', () => {
  const tableStyle = source.match(/\.abele-word-page__table\s*\{([^}]+)\}/)?.[1]
  expect(tableStyle).toBeDefined()
  expect(tableStyle).not.toMatch(/content-visibility|contain-intrinsic-size|contain\s*:/)
})

it('names an implicit Normal paragraph and puts the missing Normal style first', async () => {
  const page = mount(WordPage, { props: { model: model() } })
  await page.find('.abele-word-line__text').trigger('click')
  const select = page.find<HTMLSelectElement>('select').element
  expect(select.options[0].textContent).toBe('Normal')
  expect(select.selectedOptions[0]?.textContent).toBe('Normal')
  page.unmount()
})

it('uses the document Normal entry without duplicating it', async () => {
  const page = mount(WordPage, {
    props: {
      model: {
        ...model(),
        styles: [
          { id: 'Normal', name: 'Normal' },
          { id: 'Heading1', name: 'Heading 1' },
        ],
      },
    },
  })
  await page.find('.abele-word-line__text').trigger('click')
  const select = page.find<HTMLSelectElement>('select').element
  expect(
    Array.from(select.options).filter((option) => option.textContent === 'Normal')
  ).toHaveLength(1)
  expect(select.selectedOptions[0]?.textContent).toBe('Normal')
  page.unmount()
})

