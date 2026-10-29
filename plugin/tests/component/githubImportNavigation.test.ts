import { expect, it, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { codeNavAddon, provideCodeNav } from '@/github/search/navAddon'
import { Menu } from 'obsidian'

it.each([
  ["import x from './target'", true],
  ["import './one'; import './two'", false],
  ["const value = './ordinary'", false],
])('offers the import action only for a single module path: %s', (doc, offered) => {
  const root = document.createElement('div')
  document.body.append(root)
  const openImport = vi.fn()
  const dispose = provideCodeNav(root, {
    pathOf: () => 'src/app.ts',
    openImport,
    goToDefinition: vi.fn(),
    findReferences: vi.fn(),
  })
  const view = new EditorView({
    parent: root,
    state: EditorState.create({ doc, extensions: [codeNavAddon()] }),
  })
  vi.spyOn(view, 'posAtCoords').mockReturnValue(2)
  const show = vi.spyOn(Menu.prototype, 'showAtMouseEvent')
  view.contentDOM.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }))
  const menu = show.mock.instances.at(-1) as unknown as Menu & {
    items: { title: string; handler: () => void }[]
  }
  const action = menu.items.find((item) => item.title === 'Open imported file')
  expect(!!action).toBe(offered)
  action?.handler()
  if (offered) expect(openImport).toHaveBeenCalledWith('./target', 'src/app.ts')
  view.destroy()
  dispose()
  root.remove()
  show.mockRestore()
})

it.each(['ctrlKey', 'metaKey', 'altKey'])('opens a module string with %s', (key) => {
  const root = document.createElement('div')
  document.body.append(root)
  const openImport = vi.fn()
  const definition = vi.fn()
  const dispose = provideCodeNav(root, {
    pathOf: () => 'src/app.ts',
    openImport,
    goToDefinition: definition,
    findReferences: vi.fn(),
  })
  const view = new EditorView({
    parent: root,
    state: EditorState.create({ doc: "import x from './target'", extensions: [codeNavAddon()] }),
  })
  vi.spyOn(view, 'posAtCoords').mockReturnValue(18)
  view.contentDOM.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, [key]: true }))
  expect(view.contentDOM.querySelector('.abele-github-code__definition')?.textContent).toBe(
    './target'
  )
  expect(openImport).not.toHaveBeenCalled()
  view.contentDOM.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, button: 0, [key]: true })
  )
  expect(openImport).toHaveBeenCalledWith('./target', 'src/app.ts')
  expect(definition).not.toHaveBeenCalled()
  view.destroy()
  dispose()
  root.remove()
})
