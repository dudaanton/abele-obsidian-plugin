import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import WordPage from '@/word/WordPage.vue'
import type { WordPageModel } from '@/word/pageModel'

const model = (): WordPageModel => ({
  styles: [{ id: 'Heading1', name: 'Heading 1' }],
  blocks: [
    {
      kind: 'paragraph',
      number: 1,
      runs: [{ text: 'Sample', marks: ['bold'] }, { text: ' text here' }],
    },
    { kind: 'paragraph', number: 2, runs: [{ text: 'Kept as written' }], locked: true },
  ],
})

const open = async () => {
  const page = mount(WordPage, { props: { model: model() }, attachTo: document.body })
  await page.find('[data-paragraph="1"] .abele-word-line__text').trigger('click')
  await nextTick()
  await nextTick()
  return page
}

const edits = (page: ReturnType<typeof mount>) =>
  (page.emitted('edit') ?? []).map(([edit]) => edit as Record<string, unknown>)

describe('the Word page', () => {
  it('saves typing in an empty paragraph as an insertion', async () => {
    const page = mount(WordPage, {
      props: { model: { styles: [], blocks: [{ kind: 'paragraph', number: 1, runs: [] }] } },
    })
    await page.find('.abele-word-line__text').trigger('click')
    await page.find('textarea').setValue('Sample new text')
    await page.find('textarea').trigger('keydown', { key: 'Escape' })
    expect(edits(page)).toEqual([
      { operation: 'insert', paragraph: 1, offset: 0, text: 'Sample new text' },
    ])
    page.unmount()
  })

  it('keeps a failed text save in its field for correction or retry', async () => {
    const page = await open()
    await page.find('textarea').setValue('Sample draft here')
    await page.find('textarea').trigger('keydown', { key: 'Escape' })
    await page.setProps({ save: { state: 'failed', reason: 'Sample write failure' } })
    await nextTick()
    expect(page.find<HTMLTextAreaElement>('textarea').element.value).toBe('Sample draft here')
    expect(page.text()).toContain('Not saved: Sample write failure')
    page.unmount()
  })

  it('retains both drafts when moving between paragraphs before a save fails', async () => {
    const page = mount(WordPage, {
      props: {
        model: {
          styles: [],
          blocks: [
            { kind: 'paragraph', number: 1, runs: [{ text: 'Sample one' }] },
            { kind: 'paragraph', number: 2, runs: [{ text: 'Sample two' }] },
          ],
        },
      },
    })
    await page.find('[data-paragraph="1"] .abele-word-line__text').trigger('click')
    await page.find('textarea').setValue('Sample first draft')
    await page.find('[data-paragraph="2"] .abele-word-line__text').trigger('click')
    await page.find('textarea').setValue('Sample second draft')
    await page.find('textarea').trigger('keydown', { key: 'Escape' })
    await page.setProps({ save: { state: 'failed', reason: 'Sample failure' } })
    expect(page.find<HTMLTextAreaElement>('[data-paragraph="1"] textarea').element.value).toBe(
      'Sample first draft'
    )
    await page.find('[data-paragraph="2"] .abele-word-line__text').trigger('click')
    expect(page.find<HTMLTextAreaElement>('[data-paragraph="2"] textarea').element.value).toBe(
      'Sample second draft'
    )
    page.unmount()
  })
  it('turns the pressed paragraph into a field holding its text', async () => {
    const page = await open()
    const field = page.find<HTMLTextAreaElement>('[data-paragraph="1"] textarea')
    expect(field.element.value).toBe('Sample text here')
    page.unmount()
  })

  it('hands what was typed back as one replacement when the paragraph is left', async () => {
    const page = await open()
    const field = page.find('[data-paragraph="1"] textarea')
    await field.setValue('Sample words here')
    await field.trigger('keydown', { key: 'Escape' })
    expect(edits(page)).toEqual([
      {
        operation: 'replace',
        paragraph: 1,
        old_text: 'text',
        offset: 7,
        new_text: 'words',
      },
    ])
    page.unmount()
  })

  it('splits the paragraph where Enter is pressed', async () => {
    const page = await open()
    const field = page.find<HTMLTextAreaElement>('[data-paragraph="1"] textarea')
    field.element.setSelectionRange(6, 6)
    await field.trigger('select')
    await field.trigger('keydown', { key: 'Enter' })
    expect(edits(page)).toContainEqual({ operation: 'paragraph_split', paragraph: 1, offset: 6 })
    page.unmount()
  })

  it('marks the selected words, and takes the mark off words that already carry it', async () => {
    const page = await open()
    const field = page.find<HTMLTextAreaElement>('[data-paragraph="1"] textarea')
    field.element.setSelectionRange(0, 6)
    await field.trigger('select')
    await field.trigger('keydown', { key: 'b', metaKey: true })
    expect(edits(page).at(-1)).toEqual({
      operation: 'format',
      paragraph: 1,
      format: 'bold',
      from: 0,
      to: 6,
      enabled: false,
    })
    page.unmount()
  })

  it('leaves a paragraph Word keeps as it is closed to writing', async () => {
    const page = await open()
    await page.find('[data-paragraph="2"] .abele-word-line__text').trigger('click')
    await nextTick()
    expect(page.find('[data-paragraph="2"] textarea').exists()).toBe(false)
    page.unmount()
  })

  it('shows no ribbon on a document that cannot be changed here', () => {
    const page = mount(WordPage, {
      props: { model: { ...model(), readOnly: 'the file is protected' } },
    })
    expect(page.find('[role="toolbar"]').exists()).toBe(false)
    expect(page.text()).toContain('Read only: the file is protected')
    page.unmount()
  })
})
