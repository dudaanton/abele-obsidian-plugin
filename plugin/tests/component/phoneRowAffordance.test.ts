/**
 * A row that opens ends in one glyph on a phone, its menu. Its details fold from their own words
 * under it, its opening arrow is kept only by a row that goes a level deeper. Which of them shows
 * is the stylesheet's call, by `body.is-phone`; here the parts it chooses between are checked.
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ListRow from '@/components/obsidian/ListRow.vue'

const row = (props: Record<string, unknown>) =>
  mount(ListRow, {
    props: { title: 'sample.md', interactive: true, expanded: false, ...props },
    slots: { actions: '<button class="sample-menu">…</button>', detail: 'Sample detail' },
  })

describe('a list row on a phone', () => {
  it('folds the details of a row that opens from their words, not from a second arrow', async () => {
    const w = row({ detailsLabel: 'Sources', detailsCount: 2 })
    expect(w.classes()).toContain('abele-list-row_opens')
    const inline = w.get('.abele-list-row__inline-fold')
    expect(inline.text()).toBe('Sources2')
    // The arrow at the row's end is the one the phone hides; both fold the same details.
    expect(w.find('.abele-list-row__actions .abele-list-row__fold').exists()).toBe(true)
    await inline.get('.abele-disclosure__control').trigger('click')
    expect(w.emitted('update:expanded')).toEqual([[true]])
    expect(w.emitted('open')).toBeUndefined()
  })
  it('marks only a drill-in row as keeping its opening arrow', () => {
    expect(row({}).classes()).not.toContain('abele-list-row_drill')
    expect(row({ drill: true }).classes()).toContain('abele-list-row_drill')
  })
  it('has a row that only unfolds keep its one arrow, with no words added under it', () => {
    const w = row({ interactive: false })
    expect(w.find('.abele-list-row__inline-fold').exists()).toBe(false)
    expect(w.find('.abele-list-row__fold').exists()).toBe(true)
  })
  it('hides the opening arrow and the end fold of a row that opens on a phone, and the words on a desktop', () => {
    const css = readFileSync(
      resolve(__dirname, '../../src/components/obsidian/ListRow.vue'),
      'utf8'
    )
    expect(css).toContain(
      'body.is-phone .abele-list-row:not(.abele-list-row_drill) .abele-list-row__opener'
    )
    expect(css).toContain('body.is-phone .abele-list-row_opens .abele-list-row__fold')
    expect(css).toContain('body:not(.is-phone) .abele-list-row__inline-fold')
  })
})
