/**
 * The bar over selected words: it comes up for words inside its scope, only inside code when told
 * to, and says which action was picked with the words.
 */
import { afterEach, beforeEach, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import SelectionBar from '@/components/obsidian/SelectionBar.vue'
import { ADD, ASK, NOTE } from '@/components/obsidian/selectionActions'
import { useVault } from '../helpers/testEnv'

let wrapper: VueWrapper | undefined
beforeEach(() => useVault([]))
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})

const settle = () => new Promise((r) => setTimeout(r, 400))

function select(node: Node) {
  const range = document.createRange()
  range.selectNodeContents(node)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

function setup(within?: string) {
  const scope = document.body.createDiv()
  const code = scope.createDiv({ cls: 'cm-editor' }).createSpan({ text: 'let total = 0' })
  const prose = scope.createEl('p', { text: 'Sample words' })
  const outside = document.body.createEl('p', { text: 'Elsewhere' })
  wrapper = mount(SelectionBar, {
    props: { scope, actions: [ASK, ADD, NOTE], within },
    attachTo: document.body,
  })
  return { code, prose, outside }
}

const bar = () => document.querySelector<HTMLElement>('.abele-selection-bar')

it('comes up over words in its scope and names the picked action with them', async () => {
  const { prose } = setup()
  select(prose)
  await settle()
  await flushPromises()
  expect(
    [...bar()!.querySelectorAll('[data-action]')].map((e) => (e as HTMLElement).dataset.action)
  ).toEqual(['ask', 'add', 'note'])
  bar()!.querySelector<HTMLElement>('[data-action="note"]')!.click()
  await flushPromises()
  expect(wrapper!.emitted('pick')?.[0]).toEqual(['note', { text: 'Sample words' }])
  expect(bar()).toBeNull()
})

it('stays away for words outside its scope, or outside code when it is for code alone', async () => {
  const { outside, prose, code } = setup('.cm-editor')
  select(outside)
  await settle()
  expect(bar()).toBeNull()
  select(prose)
  await settle()
  expect(bar()).toBeNull()
  select(code)
  await settle()
  await flushPromises()
  expect(bar()).not.toBeNull()
})

it('offers its actions only in the bar: a right-click keeps the ordinary menu', async () => {
  const { prose } = setup()
  select(prose)
  await settle()
  await flushPromises()
  expect(bar()).not.toBeNull()
  const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  prose.dispatchEvent(menu)
  expect(menu.defaultPrevented).toBe(false)
})
