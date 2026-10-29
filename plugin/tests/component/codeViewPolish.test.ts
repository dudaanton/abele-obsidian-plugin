import { afterEach, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import GithubBlob from '@/components/github/GithubBlob.vue'
import SelectionBar from '@/components/obsidian/SelectionBar.vue'
import { LINKER } from '@/github/linking'
import { useVault } from '../helpers/testEnv'
let view: VueWrapper | undefined
afterEach(() => {
  view?.unmount()
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
})
async function open() {
  useVault([])
  view = mount(GithubBlob, {
    attachTo: document.body,
    props: {
      text: 'const sample = sample + sampleLong\nsample()',
      file: {
        host: 'github.com',
        owner: 'sample',
        repo: 'project',
        ref: 'main',
        path: 'sample.ts',
      },
    },
    global: { provide: { [LINKER as symbol]: { canAsk: () => true } } },
  })
  await flushPromises()
  return view
}
it('uses only the floating menu for gutter selection and retains insertion with code', async () => {
  const view = await open()
  await view.get('.cm-lineNumbers .cm-gutterElement').trigger('mousedown')
  await flushPromises()
  expect(view.find('.abele-github-code__bar').exists()).toBe(false)
  expect(window.getSelection()?.toString()).toBe('const sample = sample + sampleLong')
  expect(
    view
      .getComponent(SelectionBar)
      .props('actions')
      .map((a: { id: string }) => a.id)
  ).toContain('code')
  await view.get('.cm-lineNumbers .cm-gutterElement').trigger('mousedown')
  expect(window.getSelection()?.isCollapsed).toBe(true)
})
it('highlights whole identifier occurrences and clears them with the selection', async () => {
  const view = await open()
  // Supply the host theme token: the DOM shim has no Obsidian stylesheet.
  ;(view.element as HTMLElement).style.setProperty('--text-highlight-bg', 'rgb(255, 208, 0)')
  const walker = document.createTreeWalker(view.get('.cm-line').element, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    const at = node.textContent!.indexOf('sample')
    if (at < 0) continue
    const range = document.createRange()
    range.setStart(node, at)
    range.setEnd(node, at + 6)
    window.getSelection()!.addRange(range)
    break
  }
  document.dispatchEvent(new Event('selectionchange'))
  await new Promise((resolve) => setTimeout(resolve, 180))
  expect(view.findAll('.abele-code-occurrence').map((mark) => mark.text())).toEqual([
    'sample',
    'sample',
  ])
  for (const mark of view.findAll('.abele-code-occurrence')) {
    expect(mark.classes()).toContain('cm-selectionMatch')
    expect(getComputedStyle(mark.element).backgroundColor).toBe('rgb(255, 208, 0)')
  }
  window.getSelection()!.removeAllRanges()
  document.dispatchEvent(new Event('selectionchange'))
  await new Promise((resolve) => setTimeout(resolve, 180))
  expect(view.findAll('.abele-code-occurrence')).toHaveLength(0)
})
