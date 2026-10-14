import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { CodeView } from '@/views/CodeView'
import { useVault } from '../helpers/testEnv'

const actions = vi.hoisted(() => ({ note: vi.fn(), chat: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/views/codeSelectionHost', () => ({
  insertCodeSelection: actions.note,
  chatCodeSelection: actions.chat,
}))
vi.mock('obsidian', async (original) => ({
  ...(await original<object>()),
  TextComponent: class {
    inputEl: HTMLInputElement
    constructor(host: HTMLElement) {
      this.inputEl = host.createEl('input')
    }
    setPlaceholder(text: string) {
      this.inputEl.placeholder = text
    }
  },
}))
let view: CodeView | undefined
afterEach(() => {
  view?.clear()
  view = undefined
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  vi.clearAllMocks()
  Reflect.deleteProperty(HTMLElement.prototype, 'setAttr')
})

it('routes local code word actions and tears down the bar when the editor is rebuilt or cleared', async () => {
  useVault([])
  Object.defineProperty(HTMLElement.prototype, 'setAttr', {
    configurable: true,
    value(this: HTMLElement, name: string, value: string) {
      this.setAttribute(name, value)
    },
  })
  // Exercise the adapter with the host fields supplied by Obsidian's TextFileView.
  view = Object.assign(Object.create(CodeView.prototype) as CodeView, {
    contentEl: document.body.createDiv(),
    file: { path: 'sample.ts', extension: 'ts' },
    app: {},
  })
  view.setViewData('const sample = 1', true)
  for (const action of ['ask', 'add', 'note']) {
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('.cm-line')!)
    // A selection that already holds a range ignores `addRange`, so the last pass's would stay.
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()
    document.querySelector<HTMLElement>(`[data-action="${action}"]`)!.click()
    if (action === 'note')
      expect(actions.note).toHaveBeenCalledWith({}, 'sample.ts', {
        text: 'const sample = 1',
        from: 1,
        to: 1,
        side: 'after',
      })
    else
      expect(actions.chat).toHaveBeenCalledWith(action, 'sample.ts', {
        text: 'const sample = 1',
        from: 1,
        to: 1,
        side: 'after',
      })
  }
  const select = async () => {
    const range = document.createRange()
    range.selectNodeContents(document.querySelector('.cm-line')!)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
    await new Promise((resolve) => setTimeout(resolve, 400))
    await flushPromises()
    expect(document.querySelector('.abele-selection-bar')).not.toBeNull()
  }
  await select()
  view.setViewData('const sample = 2', true)
  expect(document.querySelector('.abele-selection-bar')).toBeNull()
  await select()
  view.clear()
  expect(document.querySelector('.abele-selection-bar')).toBeNull()
})
