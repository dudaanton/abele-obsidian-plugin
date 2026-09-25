/**
 * The kit's search field. A field that appears because an icon was pressed is there to be typed
 * into, so `autofocus` puts the cursor in it; left unset, a field in a form takes no focus.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import Search from '@/components/obsidian/Search.vue'

let wrapper: VueWrapper | null = null

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('Search', () => {
  it('takes the cursor when asked to', () => {
    wrapper = mount(Search, { props: { modelValue: '', autofocus: true }, attachTo: document.body })
    expect(document.activeElement).toBe(wrapper.find('input').element)
  })

  it('leaves the cursor where it was otherwise', () => {
    wrapper = mount(Search, { props: { modelValue: '' }, attachTo: document.body })
    expect(document.activeElement).not.toBe(wrapper.find('input').element)
  })
})
