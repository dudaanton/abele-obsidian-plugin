import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import TimeSidebar from '@/components/TimeTrackingSidebar.vue'
import GalleryView from '@/components/Gallery.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import Chart from '@/components/obsidian/Chart.vue'
import { Gallery } from '@/entities/Gallery'
import { GlobalStore } from '@/stores/GlobalStore'
import { useVault } from '../helpers/testEnv'

vi.mock('@/composables/useMenu', () => ({ useMenu: () => ({ open: vi.fn(), unload: vi.fn() }) }))
let view: VueWrapper | undefined
afterEach(() => {
  view?.unmount()
  view = undefined
})

describe('small UI states', () => {
  it('shows no-data copy rather than a blank cleared chart in an empty time period', () => {
    useVault([])
    GlobalStore.getInstance().timeEntryList.value = null
    view = mount(TimeSidebar, { global: { stubs: { Chart: true } } })
    expect(view.findComponent(Chart).exists()).toBe(false)
    expect(view.findAllComponents(EmptyState).map((one) => one.props('text'))).toEqual([
      'No data',
      'No entries found',
    ])
  })
  it.each([false, true])(
    'offers a named add-image action only when editable (readonly=%s)',
    (readonly) => {
      useVault([])
      const gallery = new Gallery({
        file: null,
        sourcePath: 'Samples/Note.md',
        images: [],
        layout: 'grid',
        height: 300,
        bg: true,
        readonly,
      })
      view = mount(GalleryView, { props: { gallery } })
      expect(view.findComponent(EmptyState).props('text')).toBe('No images')
      expect(view.find('button[aria-label="Add images from the vault"]').exists()).toBe(!readonly)
    }
  )
})
