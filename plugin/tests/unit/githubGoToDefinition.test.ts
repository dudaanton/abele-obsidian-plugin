/**
 * Go to definition as a tab runs it: one candidate opens at its line, several are offered in a
 * picker, none is said — and a repository too large to download is looked up in what the tab
 * already has instead of failing. Plus the word a Mod-click lands on, and how a viewer finds the
 * tab it is in.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { Menu, Notice } from 'obsidian'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { TabCode, type TabCodeSource } from '@/github/search/tabCode'
import { clientWith } from '../helpers/githubTab'
import { indexes } from '@/github/search/source'
import { codeNavAddon, navFor, provideCodeNav, wordAt } from '@/github/search/navAddon'

const archive = new Uint8Array(
  readFileSync(resolve(__dirname, '../fixtures/github/widgets.tar.gz'))
)
const SHA = '9bafc7b0401748aa7ce64a89653af1a32c4c6143'

function source(size = 100, overrides: Partial<TabCodeSource> = {}) {
  const { client, request } = clientWith({
    [`/repos/acme/widgets/git/trees/${SHA}`]: {
      json: { truncated: false, tree: [{ path: 'src/app.ts', type: 'blob', size }] },
    },
    [`/repos/acme/widgets/tarball/${SHA}`]: { bytes: archive },
  })
  const open = vi.fn()
  const pick = vi.fn()
  const src: TabCodeSource = {
    client: () => client,
    repo: () => ({ host: 'github.com', owner: 'acme', repo: 'widgets' }),
    refLabel: () => 'main',
    sha: async () => SHA,
    changes: async () => null,
    blob: () => null,
    open,
    limitBytes: () => 1000,
    showReferences: vi.fn(),
    pick,
    ...overrides,
  }
  return { code: new TabCode(src), open, pick, request, src }
}

beforeEach(() => {
  indexes.clear()
  Notice.shown.length = 0
})

describe('go to definition', () => {
  it('opens the one place a name is declared, at its line and commit', async () => {
    const { code, open } = source()
    await code.goToDefinition('makeWidget', 'src/app.ts')
    expect(open).toHaveBeenCalledWith(
      `https://github.com/acme/widgets/blob/${SHA}/src/app.ts#L11`,
      false
    )
  })

  it('finds a class in another language, downloading the repository once for both lookups', async () => {
    const { code, open, request } = source()
    await code.goToDefinition('Deep', 'src/app.ts')
    await code.goToDefinition('Widget', 'src/app.ts')
    expect(open.mock.calls.map(([url]) => url.replace(/.*blob\/\w+\//, ''))).toEqual([
      'lib/deep/very/long/directory/name/that/keeps/going/and/going/until/it/passes/one/hundred/bytes/deep.py#L5',
      'src/app.ts#L3',
    ])
    expect(request.mock.calls.filter(([r]) => r.url.includes('tarball'))).toHaveLength(1)
  })

  it('says so when nothing looks like a declaration, and that it is a guess', async () => {
    const { code, open } = source()
    await code.goToDefinition('nowhere', 'src/app.ts')
    expect(open).not.toHaveBeenCalled()
    expect(Notice.shown.at(-1)).toMatch(/No definition of nowhere .*by pattern/)
  })

  it('looks in the file shown when the repository is too large to download', async () => {
    const { code, open, request } = source(10_000, {
      blob: () => ({ path: 'big/one.ts', text: 'a\nb\nexport function here() {}' }),
    })
    await code.goToDefinition('here', 'big/one.ts')
    expect(open).toHaveBeenCalledWith(
      `https://github.com/acme/widgets/blob/${SHA}/big/one.ts#L3`,
      false
    )
    expect(request.mock.calls.some(([r]) => r.url.includes('tarball'))).toBe(false)
  })

  it("offers the choice, from a pull request's changed lines numbered as in the file, when too large", async () => {
    const { code, pick } = source(10_000, {
      changes: async () => ({
        files: [
          {
            path: 'a.ts',
            status: 'modified',
            additions: 1,
            deletions: 1,
            hash: 'h',
            reviewComments: [],
            patch: '@@ -40,2 +40,2 @@\n ctx\n-function gone() {}\n+function twice() {}',
          },
          {
            path: 'b.ts',
            status: 'added',
            additions: 1,
            deletions: 0,
            hash: 'h2',
            reviewComments: [],
            patch: '@@ -0,0 +1,1 @@\n+const twice = () => 2',
          },
        ],
        lineUrl: () => '',
      }),
    })
    await code.goToDefinition('twice', 'a.ts')
    const [hits] = pick.mock.calls[0]
    expect(hits.map((h: { path: string; line: number }) => `${h.path}:${h.line}`)).toEqual([
      'a.ts:41',
      'b.ts:1',
    ])
  })

  it('asks the tab to show the references to a name', () => {
    const { code, src } = source()
    code.findReferences('Widget')
    expect(src.showReferences).toHaveBeenCalledWith('Widget')
  })
})

describe('the word under a Mod-click', () => {
  const view = (doc: string) => new EditorView({ state: EditorState.create({ doc }) })

  it('is the whole identifier around the position', () => {
    const v = view('return formatName(this.$el)')
    expect(wordAt(v, 10)?.text).toBe('formatName')
    expect(wordAt(v, 24)?.text).toBe('$el')
  })

  it('is nothing on punctuation or a number', () => {
    const v = view('a + 42')
    expect(wordAt(v, 2)).toBeNull()
    expect(wordAt(v, 5)).toBeNull()
  })
})

describe('a viewer finding its tab', () => {
  it('finds the navigation its tab provides, and none outside a tab', () => {
    const root = document.createElement('div')
    const inner = root.appendChild(document.createElement('div'))
    const nav = { pathOf: () => '', goToDefinition: vi.fn(), findReferences: vi.fn() }
    const undo = provideCodeNav(root, nav)
    expect(navFor(inner)).toBe(nav)
    undo()
    expect(navFor(inner)).toBeNull()
  })
})

describe('a long press on a name, where there is no right click', () => {
  afterEach(() => vi.useRealTimers())

  const setup = () => {
    const root = document.body.appendChild(document.createElement('div'))
    const nav = { pathOf: () => 'a.ts', goToDefinition: vi.fn(), findReferences: vi.fn() }
    provideCodeNav(root, nav)
    const view = new EditorView({
      parent: root,
      state: EditorState.create({ doc: 'return formatName(x)', extensions: [codeNavAddon()] }),
    })
    // happy-dom lays nothing out: the finger lands on "formatName".
    view.posAtCoords = () => 10
    const shown = vi.spyOn(Menu.prototype, 'showAtPosition')
    const touch = (type: string, x = 5, y = 5) =>
      view.contentDOM.dispatchEvent(
        Object.assign(new Event(type, { bubbles: true }), {
          touches: type === 'touchend' ? [] : [{ clientX: x, clientY: y }],
        })
      )
    return { view, nav, shown, touch }
  }

  it('opens the menu for that name after half a second', () => {
    vi.useFakeTimers()
    const { nav, shown, touch } = setup()
    touch('touchstart')
    vi.advanceTimersByTime(499)
    expect(shown).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(shown).toHaveBeenCalledTimes(1)
    const menu = shown.mock.contexts[0] as Menu & {
      items: { title: string; handler: () => void }[]
    }
    expect(menu.items.map((i) => i.title)).toEqual([
      'Go to definition of formatName',
      'Find references to formatName',
      'Copy formatName',
    ])
    menu.items[0].handler()
    expect(nav.goToDefinition).toHaveBeenCalledWith('formatName', 'a.ts')
    shown.mockRestore()
  })

  // The phone's own long press selects the word under the finger too; the menu is what the press
  // was for on a name, so the selection it started goes, and so does one starting just after.
  it('on a name, takes the press from the phone’s own text selection', () => {
    vi.useFakeTimers()
    const { view, shown, touch } = setup()
    const selection = document.getSelection()!
    const range = document.createRange()
    range.selectNodeContents(view.contentDOM)
    selection.removeAllRanges()
    selection.addRange(range)
    touch('touchstart')
    vi.advanceTimersByTime(500)
    expect(shown).toHaveBeenCalledTimes(1)
    expect(selection.isCollapsed).toBe(true)
    const start = new Event('selectstart', { bubbles: true, cancelable: true })
    view.contentDOM.dispatchEvent(start)
    expect(start.defaultPrevented).toBe(true)
    shown.mockRestore()
  })

  it('elsewhere, leaves the phone to select text', () => {
    vi.useFakeTimers()
    const { view, shown, touch } = setup()
    // After the closing parenthesis: no name there.
    view.posAtCoords = () => 20
    touch('touchstart')
    // Past the second in which what follows a press that did open a menu belongs to it.
    vi.advanceTimersByTime(2000)
    expect(shown).not.toHaveBeenCalled()
    const start = new Event('selectstart', { bubbles: true, cancelable: true })
    view.contentDOM.dispatchEvent(start)
    expect(start.defaultPrevented).toBe(false)
    shown.mockRestore()
  })

  it('offers to copy the name, which the press no longer selects', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { shown, touch } = setup()
    touch('touchstart')
    vi.advanceTimersByTime(500)
    const menu = shown.mock.contexts[0] as Menu & {
      items: { title: string; handler: () => void }[]
    }
    menu.items.find((i) => i.title === 'Copy formatName')!.handler()
    expect(writeText).toHaveBeenCalledWith('formatName')
    shown.mockRestore()
  })

  it('is not a press when the finger lifts or scrolls first', () => {
    vi.useFakeTimers()
    const { shown, touch } = setup()
    touch('touchstart')
    vi.advanceTimersByTime(200)
    touch('touchend')
    vi.advanceTimersByTime(1000)
    touch('touchstart')
    touch('touchmove', 5, 40)
    vi.advanceTimersByTime(1000)
    expect(shown).not.toHaveBeenCalled()
    shown.mockRestore()
  })
})
