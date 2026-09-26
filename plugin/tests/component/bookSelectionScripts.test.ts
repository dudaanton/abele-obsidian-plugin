/**
 * Scripts on the selection bar of the book reader: a button for each `@book` script and one that
 * picks from every script, on fresh words and on a highlight alike.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import BookSelectionBar from '@/components/reader/BookSelectionBar.vue'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))

describe('scripts on the selection bar', () => {
  it('has a button for each pinned script and one to pick any, which say which they run', async () => {
    const bar = mount(BookSelectionBar, {
      props: {
        highlight: null,
        scripts: [{ name: 'Word card', icon: 'languages' }],
        canRunScripts: true,
      },
    })
    await bar.find('[data-script="Word card"]').trigger('click')
    await bar.find('[aria-label="Run a script on these words…"]').trigger('click')
    expect(bar.emitted('script')).toEqual([['Word card'], []])
  })

  it('shows neither without scripts', () => {
    const bar = mount(BookSelectionBar, { props: { highlight: null } })
    expect(bar.find('.abele-book-selection__run-script').exists()).toBe(false)
    expect(bar.find('.abele-book-selection__script').exists()).toBe(false)
  })
})
