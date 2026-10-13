import { expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import WordControls from '@/word/WordControls.vue'
import WordPage from '@/word/WordPage.vue'
import Modal from '@/components/obsidian/Modal.vue'
import { openDocx } from '@/word/package'
import { wordPageModel } from '@/word/pageAdapter'
import { sampleDocx } from '../fixtures/docx/sampleDocx'
import { useVault } from '../helpers/testEnv'

it.each([1, 3, 7])('renders paragraph %s on mobile without any editor controls', async (number) => {
  const app = useVault([])
  const doc = await openDocx(sampleDocx())
  const controls = mount(WordControls, {
    props: {
      doc,
      paragraph: doc.paragraphs[number - 1],
      editor: { app: app as never, readOnly: true, apply: vi.fn(), cancel: () => {} },
    },
    global: {
      stubs: { Modal: { props: ['size', 'phoneSheet'], template: '<div><slot /></div>' } },
    },
  })
  await vi.waitFor(() => expect(controls.find(`[data-paragraph="${number}"]`).exists()).toBe(true))
  expect(controls.text()).toContain(
    number === 1 ? 'Sample report' : number === 3 ? 'Cell sample' : 'Read only'
  )
  expect(controls.find('input,select,textarea,button,.abele-word-editor').exists()).toBe(false)
  expect(controls.findComponent(Modal).props('size')).toBeUndefined()
  expect(controls.findComponent(Modal).props('phoneSheet')).toBe(true)
  if (number === 7)
    expect(controls.find('img').attributes('src')).toMatch(/^data:image\/png;base64,/)
  controls.unmount()
})

it.each([
  [1, 'Paragraph 1'],
  [3, 'Table'],
  [7, 'Picture'],
] as const)('names paragraph %s controls for their subject', async (number, title) => {
  const app = useVault([])
  const doc = await openDocx(sampleDocx())
  const controls = mount(WordControls, {
    props: {
      doc,
      paragraph: doc.paragraphs[number - 1],
      editor: { app: app as never, apply: async () => {}, cancel: () => {} },
    },
    global: { stubs: { Modal: { props: ['title'], template: '<div><slot /></div>' } } },
  })
  expect(controls.findComponent(Modal).props('title')).toBe(title)
  controls.unmount()
})

it.each([
  [1, 'Paragraph 1'],
  [3, 'Table'],
  [7, 'Picture'],
] as const)('names the ribbon controls for paragraph %s', async (number, title) => {
  const doc = await openDocx(sampleDocx())
  const page = mount(WordPage, { props: { model: await wordPageModel(doc) } })
  if (number === 7) await page.find('img').trigger('click')
  else await page.find(`[data-paragraph="${number}"] .abele-word-line__text`).trigger('click')
  expect(page.find(`[aria-label="${title} controls"]`).exists()).toBe(true)
  page.unmount()
})

it('keeps the mobile controls inspector read only', async () => {
  const app = useVault([])
  const doc = await openDocx(sampleDocx())
  const controls = mount(WordControls, {
    props: {
      doc,
      paragraph: doc.paragraphs[0],
      editor: { app: app as never, apply: async () => {}, cancel: () => {}, readOnly: true },
    },
    global: { stubs: { Modal: { template: '<div><slot /></div>' } } },
  })
  await vi.waitFor(() => expect(controls.text()).toContain('Sample report'))
  expect(controls.findAll('input,select,textarea,button')).toHaveLength(0)
  controls.unmount()
})
