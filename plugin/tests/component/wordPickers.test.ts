import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import WordLinkPrompt from '@/word/WordLinkPrompt.vue'
import { WordPicturePicker, isPicture } from '@/word/WordPicturePicker'

const stubs = { Modal: { template: '<div><slot /><slot name="footer" /></div>' } }

describe('WordLinkPrompt', () => {
  it('links the words once an address is typed', async () => {
    const view = mount(WordLinkPrompt, { props: { words: 'sample words' }, global: { stubs } })
    expect(view.text()).toContain('On «sample words»')
    const link = view.get('[aria-label="Link: type an address first"]')
    expect(link.attributes('disabled')).toBeDefined()
    await view.get('input[aria-label="Link address"]').setValue(' https://example.com/a ')
    await view.get('[aria-label="Link the words to this address"]').trigger('click')
    expect(view.emitted('link')).toEqual([['https://example.com/a']])
    expect(view.text()).not.toContain('Remove link')
  })

  it('links on Enter, and leaving the field alone does not', async () => {
    const view = mount(WordLinkPrompt, { global: { stubs } })
    const field = view.get('input[aria-label="Link address"]')
    await field.setValue('https://example.com/b')
    expect(view.emitted('link')).toBeUndefined()
    await field.trigger('keydown', { key: 'Enter' })
    expect(view.emitted('link')).toEqual([['https://example.com/b']])
  })

  it('offers to take off a link already there', async () => {
    const view = mount(WordLinkPrompt, {
      props: { words: 'sample words', current: 'https://example.com/a' },
      global: { stubs },
    })
    await view.get('[aria-label="Take the link off, keep the words"]').trigger('click')
    expect(view.emitted('link')).toEqual([['']])
  })
})

describe('WordPicturePicker', () => {
  const files = ['Attachments/sample-image.png', 'Pictures/2025/other-sample.jpg'].map((path) => ({
    path,
  }))

  it('finds pictures by any part of the path and names them as the quick switcher does', () => {
    const picker = new WordPicturePicker({} as never, files, 'to insert', () => {})
    expect(picker.getSuggestions('2025 other')).toEqual([files[1]])
    const el = document.createElement('div')
    picker.renderSuggestion(files[1], el)
    expect(el.querySelector('.suggestion-title')?.textContent).toBe('other-sample.jpg')
    expect(el.querySelector('.suggestion-note')?.textContent).toBe('Pictures/2025')
  })

  // A drawing is not offered: the document holds PNG, JPEG, GIF and WebP and refuses the rest.
  it('tells pictures a document can hold from other files', () => {
    expect(['a.PNG', 'b.jpeg', 'c.svg', 'd.md', 'e.docx', 'f.webp'].map(isPicture)).toEqual([
      true,
      true,
      false,
      false,
      false,
      true,
    ])
  })
})
