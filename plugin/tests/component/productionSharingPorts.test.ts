import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref, toRaw } from 'vue'
import OwnerPublicationSettings from '@/components/settings/sync/OwnerPublicationSettings.vue'
import GroupSharingModal from '@/components/sync/GroupSharingModal.vue'
import ConnectCard from '@/components/settings/sync/ConnectCard.vue'
import ScopedInvitationModal from '@/components/sync/ScopedInvitationModal.vue'
import Button from '@/components/obsidian/Button.vue'
import { SyncService } from '@/sync/SyncService'
import { useVault } from '../helpers/testEnv'

it('passes the production root/version flow into the group sharing dialog', async () => {
  useVault([])
  const rootFlow = { review: vi.fn(), confirm: vi.fn(), close: vi.fn() }
  const screen = mount(OwnerPublicationSettings, {
    props: { groupRootFlow: rootFlow } as never,
    global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
  })
  try {
    await screen
      .findAllComponents(Button)
      .find((button) => button.props('text') === 'Review group sharing')!
      .trigger('click')
    expect(toRaw(screen.findComponent(GroupSharingModal).props('rootFlow'))).toBe(rootFlow)
  } finally {
    screen.unmount()
  }
})

it('supplies a production invitation factory instead of an inert preview', async () => {
  useVault([])
  const host = { invitation: vi.fn() }
  const spy = vi.spyOn(SyncService, 'getInstance').mockReturnValue({ sharing: ref(host) } as never)
  const screen = mount(ConnectCard, {
    props: { serverUrl: '' },
    global: { stubs: { ObsidianModal: { template: '<div><slot /></div>' } } },
  })
  try {
    await screen
      .findAllComponents(Button)
      .find((button) => /shared group/i.test(button.props('text') ?? ''))!
      .trigger('click')
    await flushPromises()
    expect(screen.findComponent(ScopedInvitationModal).props('factory')).toEqual(
      expect.any(Function)
    )
  } finally {
    screen.unmount()
    spy.mockRestore()
  }
})
