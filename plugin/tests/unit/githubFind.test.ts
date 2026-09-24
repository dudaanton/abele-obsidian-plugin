/**
 * Find in a GitHub tab, over the three kinds of text a tab holds: the page's own text, the code
 * viewers' documents, and diff files folded shut. happy-dom paints no highlights and lays nothing
 * out, so this counts and orders the matches and checks what becomes current; how they look is
 * the running app's question.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { EditorView } from '@codemirror/view'
import { mountCode } from '@/github/codeViewer'
import { TabFinder, FIND_SKIP_ATTR } from '@/github/find/finder'
import { findMarksField } from '@/github/find/cmMarks'

let root: HTMLElement

/** Static markup of the test's own, parsed into an element. */
const html = (s: string) =>
  new DOMParser().parseFromString(s.trim(), 'text/html').body.firstElementChild as HTMLElement

beforeEach(() => {
  document.body.replaceChildren()
  root = document.createElement('div')
  document.body.appendChild(root)
})

describe('finding in a tab', () => {
  it('counts matches in text, in code and in a folded diff, in page order', () => {
    root.append(html('<p>The <b>widget</b> renders.</p>'))
    const code = root.appendChild(document.createElement('div'))
    mountCode(code, 'const widget = 1\nwidget()', 'a.ts')
    const section = html(
      '<section data-diff="h1"><div role="button" aria-expanded="false">src/widget.ts</div></section>'
    )
    root.append(section)
    root.append(html('<p>Last widget.</p>'))

    const finder = new TabFinder(root, {
      foldedText: (h) => (h === 'h1' ? 'widget\nx widget' : null),
    })
    expect(finder.search('widget', false)).toBe(1 + 2 + 1 + 2 + 1)
    expect(finder.current).toBe(0)
  })

  it('matches across inline markup but never from one paragraph into the next', () => {
    root.append(html('<div><p>foo <em>bar</em></p><p>baz</p></div>'))
    const finder = new TabFinder(root, { foldedText: () => null })
    expect(finder.search('foo bar', false)).toBe(1)
    expect(finder.search('barbaz', false)).toBe(0)
  })

  it('respects letter case when asked', () => {
    root.append(html('<p>Widget widget</p>'))
    const finder = new TabFinder(root, { foldedText: () => null })
    expect(finder.search('widget', false)).toBe(2)
    expect(finder.search('widget', true)).toBe(1)
  })

  it('leaves out the find bar itself', () => {
    root.append(html(`<div ${FIND_SKIP_ATTR}><span>widget</span></div>`))
    root.append(html('<p>widget</p>'))
    const finder = new TabFinder(root, { foldedText: () => null })
    expect(finder.search('widget', false)).toBe(1)
  })

  it('walks forwards and backwards, wrapping at both ends', async () => {
    root.append(html('<p>a a a</p>'))
    const finder = new TabFinder(root, { foldedText: () => null })
    finder.search('a', false)
    await finder.move(1)
    expect(finder.current).toBe(1)
    await finder.move(1)
    await finder.move(1)
    expect(finder.current).toBe(0)
    await finder.move(-1)
    expect(finder.current).toBe(2)
  })

  it('marks the matches inside a code viewer, the current one apart', () => {
    const code = root.appendChild(document.createElement('div'))
    mountCode(code, 'x widget widget', 'a.ts')
    const finder = new TabFinder(root, { foldedText: () => null })
    finder.search('widget', false)
    const view = EditorView.findFromDOM(code.querySelector('.cm-editor') as HTMLElement)!
    const marks = view.state.field(findMarksField)
    const classes: string[] = []
    marks.between(0, view.state.doc.length, (_f, _t, d) => {
      classes.push(String(d.spec.class))
    })
    expect(classes).toEqual([
      'abele-github-find__match abele-github-find__match_current',
      'abele-github-find__match',
    ])
    finder.clear()
    expect(view.state.field(findMarksField).size).toBe(0)
  })

  it('opens a folded diff file when a match inside it becomes current', async () => {
    root.append(html('<p>widget</p>'))
    const section = html(
      '<section data-diff="h1"><div role="button" aria-expanded="false">file</div></section>'
    )
    const head = section.firstElementChild as HTMLElement
    // What the diff file component does when its head is clicked: draws the viewer.
    head.addEventListener('click', () => {
      head.setAttribute('aria-expanded', 'true')
      mountCode(section.appendChild(document.createElement('div')), 'a widget', 'f.ts')
    })
    root.append(section)

    const finder = new TabFinder(root, { foldedText: () => 'a widget' })
    expect(finder.search('widget', false)).toBe(2)
    await finder.move(1)
    expect(head.getAttribute('aria-expanded')).toBe('true')
    expect(section.querySelector('.cm-editor')).not.toBeNull()
    expect(finder.count).toBe(2)
    expect(finder.current).toBe(1)
  })

  it('finds nothing for an empty query', () => {
    root.append(html('<p>widget</p>'))
    const finder = new TabFinder(root, { foldedText: () => null })
    expect(finder.search('', false)).toBe(0)
    expect(finder.current).toBe(-1)
  })
})
