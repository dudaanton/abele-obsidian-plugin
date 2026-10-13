/**
 * The bar over words selected in a GitHub tab's prose is the one place its actions are offered:
 * a right-click is left to the ordinary menu, so nothing is offered twice.
 */
import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { reactive } from 'vue'
import { Menu } from 'obsidian'
import GithubProseActions from '@/components/github/GithubProseActions.vue'
import { LINKER } from '@/github/linking'
import { SCREEN } from '@/github/screen'
import { useVault } from '../helpers/testEnv'

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

const settle = () => new Promise((r) => setTimeout(r, 400))
const bar = () => document.querySelector('.abele-github-prose')

function select(node: Node) {
  const range = document.createRange()
  range.selectNodeContents(node)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

it('offers its actions only in the bar: a right-click keeps the ordinary menu', async () => {
  useVault([])
  const root = document.body.createDiv()
  const words = root.createEl('p', { text: 'Notes on the station relay' })
  const linker = { canAsk: () => true, ask: vi.fn(), copy: vi.fn(), insertSnippet: vi.fn() }
  const screen = reactive({ kind: 'blob', link: 'https://github.com/sample/relay', prose: null })
  wrapper = mount(GithubProseActions, {
    props: { root },
    attachTo: document.body,
    global: { provide: { [LINKER as symbol]: linker, [SCREEN as symbol]: screen } },
  })
  select(words)
  await settle()
  await flushPromises()
  expect(bar()).not.toBeNull()
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  words.dispatchEvent(menu)
  expect(menu.defaultPrevented).toBe(false)
  expect(show).not.toHaveBeenCalled()
})
