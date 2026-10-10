/**
 * The comparison drawn the way Obsidian draws its own: removed and added lines with a sign, the
 * changed words marked, long unchanged runs folded and opened on request.
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import Diff from '@/components/Diff.vue'

const before = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join('\n')
const after = before.replace('line 6', 'line six')

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
})
