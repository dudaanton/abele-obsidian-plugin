/**
 * GitHub links in a note's properties.
 *
 * Obsidian draws a property value that is a URL — a text property, a markdown link in one, a
 * pill of a list property — not as an `<a>` but as a `div.external-link` with the address in
 * `data-href`, and opens it with `window.open` from its own click handler. The same markup is used
 * in Live Preview, in Reading view and in the Properties side panel. The DOM below is copied
 * from the running app, as it drew those three.
 *
 * With the properties shown as source (or in source mode) the front matter is plain YAML in the
 * editor, where Obsidian opens nothing; there a Mod-click on an address opens it, as for any link
 * in source mode.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EditorState } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import type { App } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_GITHUB_SETTINGS } from '@/github/settings'
import { useVault } from '../helpers/testEnv'

const opened = vi.hoisted(() => [] as Array<[string, unknown]>)
vi.mock('@/github/GithubService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/github/GithubService')>()),
  openGithubUrl: vi.fn(async (_app: unknown, url: string, pane: unknown = false) => {
    opened.push([url, pane])
    return true
  }),
}))

const { linkClickHandler } = await import('@/github/register')
const { linkAtClick } = await import('@/github/links')

const PR = 'https://github.com/acme/widgets/pull/7'
const ISSUE = 'https://github.com/acme/widgets/issues/5'

/** An element with its classes, attributes and children, as the markup below needs. */
function el(
  tag: string,
  cls: string,
  attrs: Record<string, string> = {},
  children: Array<Node | string> = []
): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  e.append(...children)
  return e
}

const pill = (url: string) =>
  el('div', 'multi-select-pill', {}, [
    el('div', 'multi-select-pill-content external-link', { 'data-href': url }, [url]),
    el('div', 'multi-select-pill-remove-button'),
  ])

/** A note's properties as Obsidian draws them, inside a leaf. */
function properties(): HTMLElement {
  const text = el('div', 'metadata-property', { 'data-property-key': 'link' }, [
    el('div', 'metadata-property-value', { 'data-property-type': 'text' }, [
      el('div', 'metadata-link', {}, [
        el('div', 'metadata-link-inner external-link', { 'data-href': PR }, [PR]),
        el('div', 'metadata-link-flair'),
      ]),
    ]),
  ])
  const list = el('div', 'metadata-property', { 'data-property-key': 'links' }, [
    el('div', 'metadata-property-value', { 'data-property-type': 'multitext' }, [
      el('div', 'multi-select-container', {}, [
        pill(ISSUE),
        pill('https://example.com/x'),
        el('div', 'multi-select-input', { contenteditable: 'true' }),
      ]),
    ]),
  ])
  const leaf = el('div', 'workspace-leaf-content', {}, [
    el('div', 'metadata-container', {}, [
      el('div', 'metadata-content', {}, [el('div', 'metadata-properties', {}, [text, list])]),
    ]),
  ])
  document.body.appendChild(leaf)
  return leaf
}

let handler: (evt: MouseEvent) => void

/** A click the way the capture listener on the document sees it, before Obsidian's own. */
function click(el: Element, mods: MouseEventInit = {}): MouseEvent {
  const evt = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...mods })
  const listener = (e: Event) => handler(e as MouseEvent)
  document.addEventListener('click', listener, { capture: true })
  el.dispatchEvent(evt)
  document.removeEventListener('click', listener, { capture: true })
  return evt
}

beforeEach(() => {
  useVault([])
  document.body.replaceChildren()
  opened.length = 0
  AbeleConfig.getInstance().github = { ...DEFAULT_GITHUB_SETTINGS, enabled: true, openLinks: true }
  handler = linkClickHandler({} as App)
})

describe('a GitHub link in a property', () => {
  it('opens in a tab on a plain click, and Obsidian does not open the browser', () => {
    const leaf = properties()
    const evt = click(leaf.querySelector('.metadata-link-inner')!)
    expect(opened).toEqual([[PR, false]])
    expect(evt.defaultPrevented).toBe(true)
  })

  it('opens from a pill of a list property', () => {
    const leaf = properties()
    click(leaf.querySelector('.multi-select-pill-content')!)
    expect(opened).toEqual([[ISSUE, false]])
  })

  it('opens in a new tab on a Mod-click, and goes to the browser on an Alt-click', () => {
    const leaf = properties()
    click(leaf.querySelector('.metadata-link-inner')!, { metaKey: true })
    expect(opened).toEqual([[PR, 'tab']])

    const alt = click(leaf.querySelector('.metadata-link-inner')!, { altKey: true })
    expect(opened).toHaveLength(1)
    expect(alt.defaultPrevented).toBe(false)
  })

  it('leaves a link that is not GitHub, the pencil, and the integration switched off alone', () => {
    const leaf = properties()
    const other = click(leaf.querySelectorAll('.multi-select-pill-content')[1])
    const flair = click(leaf.querySelector('.metadata-link-flair')!)
    AbeleConfig.getInstance().github = {
      ...DEFAULT_GITHUB_SETTINGS,
      enabled: true,
      openLinks: false,
    }
    const off = click(leaf.querySelector('.metadata-link-inner')!)

    expect(opened).toEqual([])
    expect([other, flair, off].map((e) => e.defaultPrevented)).toEqual([false, false, false])
  })
})

describe('front matter shown as source', () => {
  /** An editor holding the front matter, its lines marked as Obsidian's markdown mode marks them. */
  function editor(livePreview: boolean) {
    const doc = `---\nlink: ${PR}\n---\nBody`
    // Obsidian splits the value into spans of its own; the address is one of them.
    const from = doc.indexOf(PR)
    const leaf = document.createElement('div')
    leaf.className = `workspace-leaf-content${livePreview ? ' is-live-preview' : ''}`
    document.body.appendChild(leaf)
    const mark = Decoration.mark({ class: 'cm-hmd-frontmatter' })
    const view = new EditorView({
      parent: leaf,
      state: EditorState.create({
        doc,
        extensions: [
          EditorView.decorations.of(Decoration.set([mark.range(from, from + PR.length)])),
        ],
      }),
    })
    const span = [...view.dom.querySelectorAll('.cm-hmd-frontmatter')].find((s) =>
      s.textContent?.includes('github.com')
    )!
    return { view, span }
  }

  it('finds the address under a Mod-click, as for a link in source mode', () => {
    const { span } = editor(false)
    expect(linkAtClick(span)).toEqual({ url: PR, sourceMode: true })
  })

  it('treats Live Preview showing the front matter as source the same way', () => {
    const { span } = editor(true)
    expect(linkAtClick(span)).toEqual({ url: PR, sourceMode: true })
  })
})

describe('the two link handlers', () => {
  it('never both take one click: a GitHub address is not a note, and a note is not GitHub', async () => {
    const { noteLinkAt } = await import('@/lineLinks/register')
    const leaf = properties()
    const internal = el(
      'a',
      'internal-link',
      { 'data-href': 'Notes/Plan#L3-L5', href: 'Notes/Plan#L3-L5' },
      ['Plan']
    )
    leaf.appendChild(internal)
    const github = leaf.querySelector('.metadata-link-inner')!

    // Each handler sees only its own kind.
    expect(noteLinkAt(github)).toBeNull()
    expect(linkAtClick(internal)).toBeNull()

    const evt = click(internal)
    expect(opened).toEqual([])
    expect(evt.defaultPrevented).toBe(false)
  })
})
