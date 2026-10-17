/**
 * The bar over selected words: it comes up for words inside its scope, only inside code when told
 * to, and says which action was picked with the words.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
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
  expect(bar()!.textContent).toContain(ASK.tooltip)
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

it('teleports outside a clipping pane, preserves a pressed selection and removes the bar on unmount', async () => {
  const { prose } = setup()
  select(prose)
  await settle()
  await flushPromises()
  const toolbar = bar()!
  expect(toolbar.parentElement).toBe(document.body)
  expect(toolbar.getAttribute('role')).toBe('toolbar')
  expect(toolbar.classList.contains('abele-selection-bar_placed')).toBe(true)
  const icon = toolbar.querySelector<HTMLElement>('[data-action="add"]')!
  const mouse = new MouseEvent('mousedown', { cancelable: true, bubbles: true })
  icon.dispatchEvent(mouse)
  expect(mouse.defaultPrevented).toBe(true)
  icon.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  window.getSelection()?.removeAllRanges()
  document.dispatchEvent(new Event('selectionchange'))
  await flushPromises()
  icon.click()
  expect(wrapper!.emitted('pick')?.[0]).toEqual(['add', { text: 'Sample words' }])
  select(prose)
  await settle()
  await flushPromises()
  expect(bar()).not.toBeNull()
  wrapper!.unmount()
  wrapper = undefined
  expect(bar()).toBeNull()
})

it('stands under words on the first line rather than over what sits above the text', async () => {
  const scope = document.body.createDiv()
  const header = scope.createDiv({ cls: 'sample-header', text: 'sample.ts' })
  const line = scope
    .createDiv({ cls: 'cm-content' })
    .createSpan({ text: 'export const sample = 1' })
  vi.spyOn(header, 'getBoundingClientRect').mockReturnValue({ top: 60, bottom: 100 } as DOMRect)
  wrapper = mount(SelectionBar, {
    props: { scope, actions: [ASK, ADD, NOTE], within: '.cm-content', under: '.sample-header' },
    attachTo: document.body,
  })
  const range = document.createRange()
  range.selectNodeContents(line)
  vi.spyOn(range, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    bottom: 120,
    left: 20,
  } as DOMRect)
  window.getSelection()!.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
  await settle()
  await flushPromises()
  expect(bar()!.style.top).toBe('126px')
})
