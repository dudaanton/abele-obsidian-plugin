import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, ref } from 'vue'
import ListSectionHeader from '@/components/obsidian/ListSectionHeader.vue'

describe('shared list section header', () => {
  it('keeps fold, add actions and search state independent', async () => {
    const collapsed = ref(false)
    const toggle = vi.fn(() => {
      collapsed.value = !collapsed.value
    })
    const open = ref(false),
      query = ref('')
    const search = {
      open,
      query,
      toggle: () => {
        open.value = !open.value
      },
      close: () => {
        open.value = false
      },
    }
    const view = mount(ListSectionHeader, {
      props: {
        classPrefix: 'sample-list',
        text: 'Samples',
        count: 7,
        fold: { enabled: true, collapsed: computed(() => collapsed.value), toggle },
        search,
        searchTooltip: 'Search samples',
        placeholder: 'Find samples',
      },
      slots: { leading: '<button class="sample-add">Add</button>' },
    })
    expect(view.find('.sample-list__header-left .abele-fold-heading__count').text()).toBe('7')
    await view.find('.sample-list__search-toggle').trigger('click')
    await view.find('input').setValue('sample query')
    expect(query.value).toBe('sample query')
    await view.find('.abele-fold-heading').trigger('keydown', { key: ' ' })
    expect(toggle).toHaveBeenCalledOnce()
    expect(view.find('input').exists()).toBe(false)
    expect(view.find('.sample-add').exists()).toBe(true)
    await view.find('.abele-fold-heading').trigger('click')
    expect(view.find('input').element.getAttribute('placeholder')).toBe('Find samples')
    expect(query.value).toBe('sample query')
    await view.find('input').trigger('keydown', { key: 'Escape' })
    expect(open.value).toBe(false)
    view.unmount()
  })

  it('names its parts and states whatever prefix a caller gives', () => {
    const collapsed = ref(true)
    const view = mount(ListSectionHeader, {
      props: {
        classPrefix: 'sample-list',
        text: 'Samples',
        count: 2,
        loading: true,
        fold: { enabled: true, collapsed, toggle: () => {} },
      },
    })
    const header = view.get('.abele-list-section-header')

    expect(header.classes()).toEqual(
      expect.arrayContaining([
        'sample-list__header',
        'abele-list-section-header_collapsed',
        'abele-list-section-header_loading',
      ])
    )
    expect(header.find('.abele-list-section-header__leading').exists()).toBe(true)
    expect(header.find('.abele-list-section-header__title').exists()).toBe(true)
    expect(header.get('.abele-list-section-header__loading').attributes('role')).toBe('status')
  })
})
