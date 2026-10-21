import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { AbstractInputSuggest, Platform, Menu } from 'obsidian'
import SharePicker from '@/components/sync/SharePicker.vue'
import Button from '@/components/obsidian/Button.vue'
import Modal from '@/components/obsidian/Modal.vue'
import ConnectionItems from '@/components/sync/ConnectionItems.vue'
import RemoveCopyModal from '@/components/sync/RemoveCopyModal.vue'
import SyncSettings from '@/components/settings/SyncSettings.vue'
import ConnectionWindow from '@/components/sync/ConnectionWindow.vue'
import TokenDialogs from '@/components/sync/TokenDialogs.vue'
import ShareDialog from '@/components/sync/ShareDialog.vue'
import ShareDetail from '@/components/sync/ShareDetail.vue'
import ServerDeleteModal from '@/components/sync/ServerDeleteModal.vue'
import { tokenUiFixture } from '@/testing/tokenUiFixture'
import ShareSetsFixture from '@/testing/ShareSetsFixture.vue'
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
  it('omits the Access closed row when no share loses its scope', () => {
    const wrapper = mount(ServerDeleteModal, {
      props: {
        name: 'Example',
        host: 'sync.example',
        facts: { files: 1, bytes: 10, access: [], canWrite: true },
        remove: async () => {},
      },
      global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    try {
      expect(wrapper.findAll('dt').some((one) => one.text() === 'Access closed')).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })
  it.each(['share', 'connection'] as const)(
    'uses the shared DOM menu in %s item actions',
    async (screen) => {
      const native = vi.spyOn(Menu.prototype, 'setUseNativeMenu')
      const wrapper =
        screen === 'share'
          ? mount(ShareDetail, {
              props: {
                share: {
                  id: 'share-a',
                  label: 'Sample share',
                  readOnly: false,
                  createdAt: '2025-01-01T00:00:00Z',
                  revokedAt: null,
                  items: [{ id: 'item-a', kind: 'file', path: 'Garden/Flowers.md' }],
                },
                choices: [],
                add: async () => {},
                remove: async () => {},
                revoke: async () => {},
              },
              global: {
                stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } },
              },
            })
          : mount(ConnectionItems, { props: { items: [detached] } })
      try {
        wrapper.get('[data-icon="more-horizontal"]').element.closest('button')!.click()
        expect(native).toHaveBeenCalledWith(false)
      } finally {
        wrapper.unmount()
        native.mockRestore()
      }
    }
  )
  it('keeps the desktop picker on the native suggester', () => {
    const wrapper = mount(SharePicker, { props: { modelValue: [], choices: [] } })
    try {
      const native = AbstractInputSuggest as unknown as { attachedTo: WeakMap<Element, unknown> }
      expect(native.attachedTo.get(wrapper.get('input').element)).toBeDefined()
      expect(wrapper.find('.abele-share-picker__results').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })
  it('refuses covered phone results and hides already selected items', async () => {
    const platform = Platform as { isPhone: boolean }
    const wasPhone = platform.isPhone
    platform.isPhone = true
    const wrapper = mount(SharePicker, {
      props: {
        modelValue: [],
        inShare: [{ id: 'parent', kind: 'folder', path: 'Garden' }],
        choices: [
          { id: 'parent', kind: 'folder', path: 'Garden' },
          { id: 'nested', kind: 'folder', path: 'Garden/Flowers' },
        ],
      },
    })
    try {
      await wrapper.get('input').trigger('focusin')
      await wrapper.get('input').setValue('Garden')
      expect(wrapper.emitted('searching')?.at(-1)).toEqual([true])
      const rows = wrapper.findAll('.suggestion-item')
      expect(rows).toHaveLength(1)
      expect(rows[0].attributes('aria-disabled')).toBe('true')
      expect(rows[0].text()).toContain('In Garden')
      const results = wrapper.get('.abele-share-picker__results')
      Object.defineProperties(results.element, {
        scrollHeight: { value: 300 },
        clientHeight: { value: 100 },
      })
      await results.trigger('scroll')
      expect(wrapper.get('.abele-share-picker__more').text()).toBe('Scroll for more')
      results.element.scrollTop = 200
      await results.trigger('scroll')
      expect(wrapper.find('.abele-share-picker__more').exists()).toBe(false)
      await rows[0].trigger('click')
      expect(wrapper.emitted('update:modelValue')).toBeUndefined()
    } finally {
      wrapper.unmount()
      platform.isPhone = wasPhone
    }
  })
  it('hides the phone share introduction while searching and restores it on blur', async () => {
    const platform = Platform as { isPhone: boolean },
      previous = platform.isPhone
    platform.isPhone = true
    const wrapper = mount(ShareSetsFixture, {
      props: { screen: 'empty' },
      global: {
        stubs: {
          Modal: { template: '<main><slot /><slot name="footer" /></main>' },
        },
      },
    })
    try {
      expect(wrapper.text()).toContain('Give someone folders')
      const input = wrapper.get('input[type="search"]')
      await input.trigger('focusin')
      await input.setValue('Example')
      expect(wrapper.text()).not.toContain('Give someone folders')
      expect(wrapper.get('.abele-share-picker').attributes('data-searching')).toBe('true')
      expect(wrapper.getComponent(ShareDialog).getComponent(Modal).attributes('modal-class')).toBe(
        'abele-share-dialog'
      )
      await input.trigger('focusout')
      expect(wrapper.text()).toContain('Give someone folders')
    } finally {
      wrapper.unmount()
      platform.isPhone = previous
    }
  })
  it.each(['platform', 'body'] as const)(
    'keeps phone search results inside the sheet without a native popup (%s)',
    async (flag) => {
      const platform = Platform as { isPhone: boolean }
      const wasPhone = platform.isPhone
      platform.isPhone = flag === 'platform'
      const bodyClass = document.body.className
      if (flag === 'body') document.body.classList.add('is-mobile', 'is-phone')
      const sheet = document.createElement('div')
      sheet.className = 'modal-content'
      document.body.append(sheet)
      const wrapper = mount(SharePicker, {
        attachTo: sheet,
        props: {
          modelValue: [],
          choices: [{ id: 'sample-folder', kind: 'folder', path: 'Garden/Flowers' }],
        },
      })
      try {
        const input = wrapper.get('input')
        await input.trigger('focusin')
        await input.setValue('Garden/Flowers')
        const result = wrapper.get('.suggestion-item')
        expect(result.text()).toContain('Flowers')
        expect(result.element.closest('.abele-share-picker')).toBe(wrapper.element)
        const native = AbstractInputSuggest as unknown as { attachedTo: WeakMap<Element, unknown> }
        expect(native.attachedTo.get(input.element)).toBeUndefined()
        vi.spyOn(sheet, 'getBoundingClientRect').mockReturnValue({
          top: 50,
          bottom: 800,
        } as DOMRect)
        vi.spyOn(input.element, 'getBoundingClientRect').mockReturnValue({
          top: 300,
          bottom: 340,
        } as DOMRect)
        vi.spyOn(result.element, 'getBoundingClientRect').mockReturnValue({
          top: 550,
          bottom: 600,
        } as DOMRect)
        document.documentElement.style.setProperty(
          '--keyboard-height',
          `${window.innerHeight - 450}px`
        )
        window.dispatchEvent(new Event('keyboardDidShow'))
        await flushPromises()
        expect(sheet.scrollTop).toBeGreaterThan(0)
        await result.trigger('click')
        expect(wrapper.emitted('update:modelValue')?.[0]).toEqual([
          [{ id: 'sample-folder', kind: 'folder', path: 'Garden/Flowers' }],
        ])
        await input.setValue('Missing/Example')
        expect(wrapper.findAll('.suggestion-item')).toHaveLength(0)
        expect(wrapper.text()).toContain('No matching folders, groups or files.')
      } finally {
        wrapper.unmount()
        sheet.remove()
        document.documentElement.style.removeProperty('--keyboard-height')
        platform.isPhone = wasPhone
        document.body.className = bodyClass
      }
    }
  )
  it('warns about count-only overlaps without inventing a group name', () => {
    const wrapper = mount(ServerDeleteModal, {
      props: {
        name: 'Sample share',
        host: 'sync.example',
        facts: {
          files: 1,
          bytes: 10,
          access: [],
          canWrite: true,
          also: [{ path: 'Notes/Sample.md', overlapCount: 2 }],
        },
        remove: async () => {},
      },
      global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    try {
      const warning = wrapper.get('.abele-server-delete__also').text()
      expect(warning).toContain('Sample is also shared through 2 other accesses.')
      expect(warning).not.toContain('group')
      expect(warning).not.toContain('undefined')
    } finally {
      wrapper.unmount()
    }
  })
  it('shows each overlapping group and discloses capped preview details', () => {
    const wrapper = mount(ServerDeleteModal, {
      props: {
        name: 'Sample share',
        host: 'sync.example',
        facts: {
          files: 501,
          bytes: 12345,
          access: [],
          canWrite: true,
          also: [
            { path: 'Notes/Sample.md', group: 'First group' },
            { path: 'Notes/Sample.md', group: 'Other group' },
            { path: 'Notes/Second.md', group: 'Other group' },
            { path: 'Notes/Third.md', group: 'Other group' },
            { path: 'Notes/Third.md', group: 'Other group' },
          ],
          alsoMore: true,
        },
        remove: async () => {},
      },
      global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    try {
      const warnings = wrapper.findAll('.abele-server-delete__also').map((one) => one.text())
      expect(warnings).toHaveLength(3)
      expect(warnings[0]).toBe('Sample is also in group First group. It goes from there too.')
      expect(warnings[1]).toBe('3 files are also in group Other group. They go from there too.')
      expect(warnings[2]).toContain('More shared files or groups may also be affected')
      expect(wrapper.get('.abele-server-delete__facts').text()).toContain('501')
    } finally {
      wrapper.unmount()
    }
  })
  it.each(['settings', 'window'] as const)(
    'does not label an offline set as synced after its first item detaches (%s)',
    async (screen) => {
      const ui = tokenUiFixture()
      ui.rows.value = ui.rows.value.map((row) => ({ ...row, status: 'offline' }))
      const source = {
        items: () => [
          detached,
          { ...detached, id: 'active', state: { kind: 'error', reason: 'Offline' } },
        ],
        label: () => null,
        several: () => true,
        owner: () => false,
      } as unknown as ShareSetSource
      const before = shareSetSource.value
      shareSetSource.value = source
      const wrapper =
        screen === 'settings'
          ? mount(SyncSettings, { props: { model: ui } })
          : mount(ConnectionWindow, {
              props: { ui, connectionId: ui.rows.value[0].id },
              global: {
                stubs: {
                  Modal: { template: '<div><slot /><slot name="footer" /></div>' },
                  SelectiveSync: true,
                },
              },
            })
      try {
        await flushPromises()
        const line =
          screen === 'settings'
            ? wrapper.get('.abele-sync-row').text()
            : wrapper.get('.abele-sync-window__line').text()
        expect(line).not.toContain('Synced')
        expect(line).toContain('1 of 2 needs attention')
      } finally {
        wrapper.unmount()
        shareSetSource.value = before
      }
    }
  )
  it('invalidates a failed deletion preview when its confirmation closes', async () => {
    const item = { id: 'file-a', kind: 'file' as const, path: 'Sample.md' }
    const closeDeletePreview = vi.fn()
    const source = {
      choices: () => [],
      shares: async () => [
        {
          id: 'share-a',
          label: 'Sample share',
          readOnly: false,
          createdAt: '2025-01-01T00:00:00Z',
          revokedAt: null,
          items: [item],
        },
      ],
      deleteFacts: () => ({
        files: 0,
        bytes: 0,
        access: [],
        canWrite: false,
        unavailableReason: 'Unavailable',
      }),
      closeDeletePreview,
    } as unknown as ShareSetSource
    const wrapper = mount(ShareDialog, {
      props: { source, host: 'sync.example' },
      global: {
        stubs: {
          Modal: { template: '<div><slot /><slot name="footer" /></div>' },
          Search: true,
          ShareDetail: true,
          ServerDeleteModal: true,
        },
      },
    })
    try {
      await flushPromises()
      wrapper.vm.open('share-a')
      await wrapper.vm.$nextTick()
      wrapper.getComponent(ShareDetail).vm.$emit('delete', item)
      await wrapper.vm.$nextTick()
      expect(wrapper.getComponent(ServerDeleteModal).props('note')).toContain(
        'Your other connected devices remove theirs'
      )
      wrapper.getComponent(ServerDeleteModal).vm.$emit('close')
      await wrapper.vm.$nextTick()
      expect(closeDeletePreview).toHaveBeenCalledWith('share-a')
      expect(wrapper.findComponent(ServerDeleteModal).exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  })
  it('prevents duplicate local removal while the first request is pending', async () => {
    let finish!: () => void
    const wait = new Promise<void>((resolve) => {
      finish = resolve
    })
    const remove = vi.fn(() => wait)
    const wrapper = mount(RemoveCopyModal, {
      props: { item: detached, remove },
      global: { stubs: { Modal: { template: '<div><slot /><slot name="footer" /></div>' } } },
    })
    try {
      const button = wrapper.findAllComponents(Button).find((one) => one.props('warning'))!
      button.vm.$emit('click')
      button.vm.$emit('click')
      expect(remove).toHaveBeenCalledOnce()
    } finally {
      finish()
      await flushPromises()
      wrapper.unmount()
    }
  })
  it.each(['empty', 'long', 'readonly', 'removed', 'delete', 'states'] as const)(
    'mounts the synthetic %s screenshot state using the actual components',
    (screen) => {
      const wrapper = mount(ShareSetsFixture, {
        props: { screen },
        global: {
          stubs: {
            Modal: { template: '<main><slot /><slot name="footer" /></main>' },
            Search: true,
          },
        },
      })
      try {
        expect(wrapper.text().length).toBeGreaterThan(30)
      } finally {
        wrapper.unmount()
      }
    }
  )
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
    expect(wrapper.text()).toContain('No longer shared · your copy stays')
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
  it.each([1, 3])(
    'fits a short remove-copy sheet and uses correct kept-file wording (%s)',
    (edited) => {
      const wrapper = mount(RemoveCopyModal, {
        props: { item: { ...detached, files: 5, edited, kept: 1 }, remove: async () => {} },
        global: {
          stubs: {
            Modal: {
              props: { contentSized: Boolean },
              template: '<div><slot /><slot name="footer" /></div>',
            },
          },
        },
      })
      try {
        expect(wrapper.findComponent(Modal).props('contentSized')).toBe(true)
        const values = wrapper.findAll('dd').map((one) => one.text())
        expect(values[1]).toBe(edited === 1 ? '1, it stays' : '3, they stay')
        expect(values.at(-1)).toBe('1, it stays')
      } finally {
        wrapper.unmount()
      }
    }
  )
})
