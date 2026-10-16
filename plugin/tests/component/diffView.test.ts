/**
 * The comparison drawn the way Obsidian draws its own: removed and added lines with a sign, the
 * changed words marked, long unchanged runs folded and opened on request.
 */
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import Diff from '@/components/Diff.vue'
import { loadedPrism } from '@/components/codeSyntax'

const before = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n')
const after = before.replace('line 6', 'line six')

// Code is coloured once Obsidian's Prism has loaded; the tests start with it in.
await loadedPrism()

describe('Diff', () => {
  it("uses Obsidian's diff lines, with a sign that says what colour says", () => {
    const view = mount(Diff, { props: { textLeft: 'a\nb', textRight: 'a\nB' } })

    const removed = view.get('.abele-diff__line_removed')
    expect(removed.classes()).toEqual(expect.arrayContaining(['diff-line', 'mod-left']))
    expect(removed.get('.abele-diff__sign').text()).toBe('−')
    const added = view.get('.abele-diff__line_added')
    expect(added.classes()).toContain('mod-right')
    expect(added.get('.diff-changed').text()).toBe('B')
  })

  it('folds a long unchanged run and opens it on a click or Enter', async () => {
    const view = mount(Diff, { props: { textLeft: before, textRight: after, context: 1 } })
    const folds = () => view.findAll('.abele-diff__fold')

    expect(folds()).toHaveLength(2)
    expect(folds()[0].text()).toBe('Show 4 unchanged lines')
    await folds()[0].trigger('click')
    expect(folds()).toHaveLength(1)
    await folds()[0].trigger('keydown', { key: 'Enter' })
    expect(folds()).toHaveLength(0)
    expect(view.findAll('.abele-diff__line')).toHaveLength(13)
  })

  it('says there are no changes instead of drawing equal texts', () => {
    const view = mount(Diff, {
      props: { textLeft: 'same', textRight: 'same', emptyText: 'Nothing changed' },
    })

    expect(view.classes()).toContain('abele-diff_empty')
    expect(view.get('.abele-diff__empty').text()).toBe('Nothing changed')
  })

  it('sets the versions side by side, under their headings', () => {
    const view = mount(Diff, {
      props: {
        textLeft: 'a\nb',
        textRight: 'a\nB\nC',
        layout: 'split',
        labelBefore: 'Before',
        labelAfter: 'After',
      },
    })

    expect(view.findAll('.abele-diff__label').map((l) => l.text())).toEqual(['Before', 'After'])
    expect(view.findAll('.abele-diff__line_left.abele-diff__line_removed')).toHaveLength(1)
    expect(view.findAll('.abele-diff__line_right.abele-diff__line_added')).toHaveLength(2)
    expect(view.findAll('.abele-diff__line_blank')).toHaveLength(1)
  })

  describe('of code', () => {
    // Obsidian's own code-block classes, which the theme colours.
    const keyword = 'token keyword'
    const string = 'token string'
    const tokens = (view: ReturnType<typeof mount>, selector: string) =>
      view
        .get(selector)
        .findAll('.abele-diff__text span[class]')
        .filter((s) => s.classes().length > 0 && !s.classes().includes('abele-diff__changed'))
        .map((s) => [s.element.textContent, s.classes().join(' ')])

    it("colours a file's code the way Obsidian's code blocks are, on both sides", () => {
      const view = mount(Diff, {
        props: {
          textLeft: 'const a = 1\nexport function f() {}',
          textRight: "const a = 'two'\nexport function f() {}",
          path: 'src/sample.ts',
        },
      })

      expect(view.classes()).toContain('abele-diff_code')
      expect(tokens(view, '.abele-diff__line_removed')).toContainEqual(['const', keyword])
      expect(tokens(view, '.abele-diff__line_added')).toContainEqual(["'two'", string])
      expect(tokens(view, '.abele-diff__line_same')).toContainEqual(['function', keyword])
      // The changed words keep their mark, with the colours inside it.
      const changed = view.get('.abele-diff__line_added .abele-diff__changed')
      expect(changed.text()).toBe("'two'")
      expect(changed.get('span').classes().join(' ')).toBe(string)
      // Copying a line still gives exactly its text.
      expect(view.get('.abele-diff__line_added .abele-diff__text').element.textContent).toBe(
        "const a = 'two'"
      )
    })

    it('colours a line by the comment that opened above it', () => {
      const comment = 'token comment'
      const view = mount(Diff, {
        props: {
          textLeft: '/* one\ntwo */\nlet x = 1',
          textRight: '/* one\nthree */\nlet x = 1',
          path: 'sample.ts',
        },
      })
      expect(tokens(view, '.abele-diff__line_added')).toEqual([
        ['three', comment],
        [' */', comment],
      ])
    })

    it('colours the side-by-side layout too', () => {
      const view = mount(Diff, {
        props: {
          textLeft: 'let x = 1',
          textRight: 'let x = 2',
          path: 'sample.js',
          layout: 'split',
        },
      })

      expect(tokens(view, '.abele-diff__line_left')).toContainEqual(['let', keyword])
      expect(tokens(view, '.abele-diff__line_right')).toContainEqual(['let', keyword])
    })

    it('colours a shell script, and code that arrives after Prism loads', async () => {
      const view = mount(Diff, {
        props: { textLeft: 'set -e\nexit 1', textRight: 'set -e\nexit 2', path: 'release.sh' },
      })
      await flushPromises()
      expect(tokens(view, '.abele-diff__line_added')).toContainEqual(['exit', keyword])
      expect(tokens(view, '.abele-diff__line_same')).toContainEqual(['set', keyword])
    })

    it('leaves prose and unknown files as they were', () => {
      for (const path of [undefined, 'notes/sample.md', 'sample.unknown']) {
        const view = mount(Diff, {
          props: { textLeft: 'const a = 1', textRight: 'const a = 2', path },
        })
        expect(view.classes()).not.toContain('abele-diff_code')
        expect(tokens(view, '.abele-diff__line_removed')).toEqual([])
      }
    })

    it('does not colour a text too large to parse at once', () => {
      const big = 'const a = 1\n'.repeat(60_000)
      const view = mount(Diff, {
        props: { textLeft: big, textRight: big + 'const b = 2', path: 'sample.ts' },
      })
      expect(view.classes()).not.toContain('abele-diff_code')
      expect(tokens(view, '.abele-diff__line_added')).toEqual([])
    })
  })
})
