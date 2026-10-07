import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import OwnerPublicationSettings from '@/components/settings/sync/OwnerPublicationSettings.vue'

const global = {
  stubs: { ObsidianModal: { template: '<section><slot/><slot name="footer"/></section>' } },
}
const share = { id: 'sample-group', kind: 'group', label: 'Sample group', state: 'active' }
async function signIn(screen: ReturnType<typeof mount>) {
  await screen.find('[aria-label="Sharing account email"]').setValue('sample@example.com')
  await screen.find('[aria-label="Sharing account password"]').setValue('invented-password')
  await screen
    .findAll('button')
    .find((button) => button.text() === 'Show shared folders and groups')!
    .trigger('click')
}
it('does not list or retain a late account session after the Sharing section closes', async () => {
  let finish!: (session: any) => void
  const manager = {
    authorize: vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    ),
    list: vi.fn(async () => [share]),
    close: vi.fn(),
  }
  const screen = mount(OwnerPublicationSettings, { props: { manager } as never, global })
  await signIn(screen)
  screen.unmount()
  finish({ facet: 'account' })
  await flushPromises()
  expect(manager.list).not.toHaveBeenCalled()
  expect(manager.close).toHaveBeenCalled()
})
it('does not display an old vault image response after its publication model changes', async () => {
  let finish!: (value: any) => void
  const manager = {
    authorize: vi.fn(async () => ({ facet: 'account' })),
    list: vi.fn(async () => [share]),
    close: vi.fn(),
  }
  const model = {
    load: vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    ),
  }
  const screen = mount(OwnerPublicationSettings, { props: { manager, model } as never, global })
  try {
    await signIn(screen)
    await flushPromises()
    await screen.setProps({ model: { load: vi.fn() } } as never)
    finish({
      grantId: share.id,
      entries: [
        {
          kind: 'owner-extra',
          sponsors: [],
          target: {
            path: 'Previous-vault/sample-image.png',
            fileId: 'sample-image',
            versionId: 'sample-version',
          },
        },
      ],
    })
    await flushPromises()
    expect(screen.text()).not.toContain('Previous-vault/sample-image.png')
  } finally {
    screen.unmount()
  }
})
