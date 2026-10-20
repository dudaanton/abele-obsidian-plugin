import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ConnectionItems from '@/components/sync/ConnectionItems.vue'
import RemoveCopyModal from '@/components/sync/RemoveCopyModal.vue'
import SyncSettings from '@/components/settings/SyncSettings.vue'
import ConnectionWindow from '@/components/sync/ConnectionWindow.vue'
import TokenDialogs from '@/components/sync/TokenDialogs.vue'
import ShareDialog from '@/components/sync/ShareDialog.vue'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import {
  coveredBy,
  setTitle,
  setTone,
  shareSetSource,
  type ConnectionItem,
  type ShareSetSource,
} from '@/sync/shareSets'

const detached: ConnectionItem = {
  id: 'sample',
  kind: 'folder',
  path: 'Garden',
  state: { kind: 'detached' },
  files: 3,
  edited: 1,
}
describe('shared item screens', () => {
  it.each([false, true])(
    'gates the new Share dialog on server capability %s',
    async (supported) => {
      const noop = async () => {}
      const source: ShareSetSource = {
        several: () => supported,
        items: () => null,
        label: () => null,
        owner: () => false,
        choices: () => [],
        shares: async () => [],
        issue: async () => '',
        add: noop,
        remove: noop,
        revoke: noop,
        preview: () => null,
        pauseItem: noop,
        followItem: noop,
        removeCopy: noop,
        deleteFacts: () => null,
        deleteFromServer: noop,
      }
      shareSetSource.value = source
      const wrapper = mount(SyncSettings, {
        props: { model: tokenUiFixture() },
        global: { stubs: { ConnectionWindow: true, TokenDialogs: true, ShareDialog: true } },
      })
      try {
        await wrapper.get('.abele-sync-row').trigger('click')
        wrapper.getComponent(ConnectionWindow).vm.$emit('share')
        await wrapper.vm.$nextTick()
        expect(wrapper.findComponent(ShareDialog).exists()).toBe(supported)
        expect(wrapper.findComponent(TokenDialogs).exists()).toBe(!supported)
      } finally {
        wrapper.unmount()
        shareSetSource.value = null
      }
    }
  )
  it('shows retained copies distinctly from active errors', () => {
    const wrapper = mount(ConnectionItems, {
      props: {
        items: [
          detached,
          {
            ...detached,
            id: 'error',
            path: 'Library',
            state: { kind: 'error', reason: 'Offline' },
          },
        ],
      },
    })
    expect(wrapper.text()).toContain('No longer shared · copy kept')
    expect(wrapper.text()).toContain('Offline')
    expect(wrapper.findAll('.abele-connection-items__item_detached')).toHaveLength(1)
    wrapper.unmount()
  })
  it('names sets and aggregates live errors without treating detached items as errors', () => {
    expect(setTitle([detached, { ...detached, id: 'other' }])).toBe('Folder Garden + 1')
    expect(setTone([detached])).toBe('faint')
    expect(setTone([detached, { ...detached, state: { kind: 'error', reason: 'Offline' } }])).toBe(
      'red'
    )
  })
  it('refuses a path already covered by a folder while preserving path boundaries', () => {
    const parent = { id: 'parent', kind: 'folder' as const, path: 'Garden' }
    expect(coveredBy({ id: 'child', kind: 'file', path: 'Garden/note.md' }, [parent])).toEqual(
      parent
    )
    expect(coveredBy({ id: 'other', kind: 'file', path: 'Gardens/note.md' }, [parent])).toBe(null)
  })
  it('explains that edited copies are kept before removal', () => {
    const wrapper = mount(RemoveCopyModal, {
      props: { item: detached, remove: async () => {} },
      global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    expect(wrapper.text()).toMatch(/changed|edited/i)
    wrapper.unmount()
  })
})
