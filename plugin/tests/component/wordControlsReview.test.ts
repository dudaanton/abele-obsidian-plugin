import { expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import WordControls from '@/word/WordControls.vue'
import WordPage from '@/word/WordPage.vue'
import Modal from '@/components/obsidian/Modal.vue'
import { openDocx } from '@/word/package'
import { wordPageModel } from '@/word/pageAdapter'
import { sampleDocx } from '../fixtures/docx/sampleDocx'
import { useVault } from '../helpers/testEnv'

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
  await nextTick()
  const fields = controls.findAll<HTMLInputElement>('input,select,textarea')
  expect(fields.length).toBeGreaterThan(0)
  expect(fields.every((field) => field.element.disabled)).toBe(true)
  expect(
    controls
      .findAll<HTMLButtonElement>('button')
      .filter((button) => button.text() !== 'Cancel')
      .every((button) => button.element.disabled)
  ).toBe(true)
  controls.unmount()
})
