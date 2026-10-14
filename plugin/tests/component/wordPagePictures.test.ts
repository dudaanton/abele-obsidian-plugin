import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WordPage from '@/word/WordPage.vue'
import type { WordPageModel } from '@/word/pageModel'

it.each(['body', 'table'])(
  'selects a %s picture through its paragraph and keeps the page free of glyphs',
  async (location) => {
    const p = { kind: 'paragraph' as const, number: 1, runs: [], locked: true }
    const image = {
      kind: 'image' as const,
      number: 1,
      paragraph: 1,
      src: 'data:image/png;base64,',
      alt: 'Sample picture',
      width: 40,
      height: 30,
    }
    const pictureModel: WordPageModel = {
      styles: [],
      blocks:
        location === 'body'
          ? [p, image]
          : [{ kind: 'table', number: 1, rows: [[{ ...p, images: [image] }]] }],
    }
    const page = mount(WordPage, { props: { model: pictureModel } })
    expect(page.find('figure .clickable-icon').exists()).toBe(false)
    await page.find('img').trigger('click')
    expect(page.emitted('context')?.at(-1)).toEqual([1])
    expect(page.find('textarea').exists()).toBe(false)
    await page.find('[aria-label="Picture controls"]').trigger('click')
    expect(page.emitted('advanced')?.at(-1)).toEqual([1, true])
    expect(page.emitted('edit')).toBeUndefined()
    page.unmount()
  }
)
