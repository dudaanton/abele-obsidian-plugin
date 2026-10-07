import { beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import OwnerPublicationSettings from '@/components/settings/sync/OwnerPublicationSettings.vue'
import OwnerFolderSharingModal from '@/components/sync/OwnerFolderSharingModal.vue'
import GroupSharingModal from '@/components/sync/GroupSharingModal.vue'
import ScopedInvitationModal from '@/components/sync/ScopedInvitationModal.vue'
import ScopedCreationModal from '@/components/sync/ScopedCreationModal.vue'
import InitialAssetBatchModal from '@/components/sync/InitialAssetBatchModal.vue'
import PublicationConfirmModal from '@/components/sync/PublicationConfirmModal.vue'
import { useVault } from '../helpers/testEnv'
import { ref } from 'vue'
import SyncSettings from '@/components/settings/SyncSettings.vue'
import { SyncService } from '@/sync/SyncService'

const global = {
  stubs: { ObsidianModal: { template: '<section><slot/><slot name="footer"/></section>' } },
}
const target = {
  fileId: 'opaque-file',
  versionId: 'opaque-version',
  sha: 'a'.repeat(64),
  path: 'Images/sample.png',
  eligible: true,
}
const sponsor = {
  fileId: 'opaque-note',
  versionId: 'opaque-note-version',
  admissionGeneration: 1,
  intrinsic: true,
  inScope: true,
}
const root = {
  fileId: 'opaque-root',
  versionId: 'opaque-root-version',
  sha: 'b'.repeat(64),
  path: 'Notes/sample-group.md',
  eligible: true,
}
const view = {
  grantId: 'opaque-grant',
  revision: 7,
  withdrawalGeneration: 3,
  active: true,
  role: 'editor',
  entries: [{ kind: 'owner-extra', target, sponsors: [sponsor], reason: 'confirmed-existing' }],
}
const preview = {
  id: 'opaque-review',
  label: 'Sample group',
  role: 'editor',
  fingerprint: 'c'.repeat(64),
  preview: {
    root,
    notes: [root],
    anchors: [root],
    relations: [{}],
    uncertain: [],
    complete: true,
    certified: true,
    generation: 'opaque-generation',
  },
}
const flow = () => ({ review: vi.fn(), confirm: vi.fn(), close: vi.fn(), clear: vi.fn() })
const technical =
  /\b(?:grant|sponsors?|admission|intrinsic|authority|facet|audience|exposure|CAS|SHA|withdrawal generation)\b/i
function plain(text: string) {
  expect(text).not.toMatch(technical)
  for (const value of [
    'opaque-file',
    'opaque-version',
    'opaque-note',
    'opaque-root',
    'opaque-grant',
    'opaque-generation',
    'a'.repeat(64),
    'b'.repeat(64),
    'c'.repeat(64),
  ])
    expect(text).not.toContain(value)
}
beforeEach(() => useVault([]))

it('describes shared images and unsharing without showing protocol identities', async () => {
  const review = {
    ...target,
    grantId: view.grantId,
    revision: 7,
    withdrawalGeneration: 3,
    intentId: 'opaque-intent',
  }
  const model = { view, reviewUnshare: vi.fn(() => review), confirmUnshare: vi.fn() }
  const screen = mount(OwnerPublicationSettings, {
    props: { view, model, shareName: 'Sample group' } as never,
    global,
  })
  try {
    plain(screen.text())
    expect(screen.text()).toContain('Shared with: Sample group')
    expect(screen.text()).toContain(target.path)
    expect(screen.text()).toContain('Shared through 1 shared note')
    const unshare = screen.findAll('button').find((button) => button.text() === 'Unshare…')!
    expect(unshare.attributes('disabled')).toBeUndefined()
    await unshare.trigger('click')
    plain(screen.text())
    expect(screen.text()).toContain('Stop sharing Images/sample.png with Sample group?')
    expect(model.reviewUnshare).toHaveBeenCalledExactlyOnceWith(target.fileId)
    expect(model.confirmUnshare).not.toHaveBeenCalled()
    await screen
      .findAll('button')
      .find((button) => button.text() === 'Unshare')!
      .trigger('click')
    await flushPromises()
    expect(model.confirmUnshare).toHaveBeenCalledExactlyOnceWith(review)
  } finally {
    screen.unmount()
  }
})

it.each([
  [
    'folder',
    OwnerFolderSharingModal,
    {
      flow: flow(),
      preview: {
        prefix: 'Shared/',
        generation: 'opaque-generation',
        complete: true,
        files: [
          {
            path: 'Shared/sample.md',
            fileId: 'opaque-file',
            versionId: 'opaque-version',
            eligible: false,
            eligibility: 'unknown',
          },
        ],
      },
    },
  ],
  ['group preview', GroupSharingModal, { flow: flow(), preview }],
  [
    'image batch',
    InitialAssetBatchModal,
    {
      flow: flow(),
      audienceNames: { 'opaque-grant': 'Sample shared group' },
      preview: {
        id: 'opaque-review',
        entries: [{ target, sponsors: [sponsor], reason: 'initial-batch' }],
        audiences: [{ grantId: 'opaque-grant', revision: 7, withdrawalGeneration: 3 }],
      },
    },
  ],
  ['join', ScopedInvitationModal, { factory: vi.fn() }],
] as const)('uses everyday language in the %s screen', (_name, component, props) => {
  const screen = mount(component as never, { props: props as never, global })
  try {
    plain(screen.text())
  } finally {
    screen.unmount()
  }
})

it.each([
  ['joined', 'You have joined the shared group.'],
  ['waiting-view', 'The group is still getting ready.'],
  ['collision-hold', 'Some files already exist here. They were not replaced.'],
] as const)(
  'explains the %s join state without showing its protocol name',
  async (phase, message) => {
    const join = {
      begin: vi.fn(),
      resume: vi.fn(async () => ({
        phase,
        collisions: phase === 'collision-hold' ? ['Notes/sample.md'] : [],
      })),
      close: vi.fn(),
    }
    const screen = mount(ScopedInvitationModal, { props: { flow: join } as never, global })
    try {
      await screen
        .findAll('button')
        .find((button) => button.text() === 'Join group')!
        .trigger('click')
      await flushPromises()
      plain(screen.text())
      expect(screen.text()).toContain(message)
      expect(screen.text()).not.toContain(phase === 'joined' ? 'opaque-grant' : phase)
      if (phase === 'collision-hold') expect(screen.text()).toContain('Notes/sample.md')
      expect(join.resume).toHaveBeenCalledOnce()
    } finally {
      screen.unmount()
    }
  }
)

it.each([
  ['pending', 'Waiting for your sharing choice.'],
  ['offline', 'Reconnect to the server before sharing images.'],
  ['scope-updating', 'Getting shared files ready.'],
] as const)('keeps the %s image-batch state visible in plain language', (state, message) => {
  const screen = mount(InitialAssetBatchModal, {
    props: { state, flow: flow(), enabled: false } as never,
    global,
  })
  try {
    plain(screen.text())
    expect(screen.text()).toContain(message)
    for (const button of screen.findAll('button').filter((button) => button.text() !== 'Close'))
      expect(button.attributes('disabled')).toBeDefined()
  } finally {
    screen.unmount()
  }
})

it('shows group setup results by name and state, not grant or version IDs', async () => {
  const rootFlow = {
    review: vi.fn(async () => ({
      id: 'opaque-review',
      root,
      role: 'editor',
      label: 'Sample group',
    })),
    confirm: vi.fn(async () => ({
      id: 'opaque-grant',
      rootId: root.fileId,
      rootVersion: root.versionId,
      role: 'editor',
      revision: 7,
      state: 'active',
    })),
    close: vi.fn(),
  }
  const screen = mount(GroupSharingModal, { props: { rootFlow } as never, global })
  try {
    await screen.findAll('button')[0].trigger('click')
    await flushPromises()
    await screen.find('input[type="password"]').setValue('invented-password')
    await screen
      .findAll('button')
      .find((button) => button.text() === 'Share this group')!
      .trigger('click')
    await flushPromises()
    plain(screen.text())
    expect(screen.text()).toContain('This group is ready to share')
    expect(rootFlow.confirm).toHaveBeenCalledOnce()
  } finally {
    screen.unmount()
  }
})

it.each([
  ['preparing', 'The group is still getting ready.'],
  ['revoked', 'This group is no longer shared.'],
  ['expired', 'Sharing for this group has expired.'],
] as const)(
  'retains the %s group state without displaying raw state or grant IDs',
  async (state, message) => {
    const rootFlow = {
      review: vi.fn(async () => ({
        id: 'opaque-review',
        root,
        role: 'editor',
        label: 'Sample group',
      })),
      confirm: vi.fn(async () => ({
        id: 'opaque-grant',
        rootId: root.fileId,
        rootVersion: root.versionId,
        role: 'editor',
        revision: 7,
        state,
      })),
      close: vi.fn(),
    }
    const screen = mount(GroupSharingModal, { props: { rootFlow } as never, global })
    try {
      await screen.findAll('button')[0].trigger('click')
      await flushPromises()
      await screen.find('input[type="password"]').setValue('invented-password')
      await screen
        .findAll('button')
        .find((button) => button.text() === 'Share this group')!
        .trigger('click')
      await flushPromises()
      plain(screen.text())
      expect(screen.text()).toContain(message)
      expect(screen.findAll('button').some((button) => button.text() === 'Create invitation')).toBe(
        false
      )
    } finally {
      screen.unmount()
    }
  }
)

it('shows file paths and group names rather than creation hashes and IDs', async () => {
  const creation = {
    review: vi.fn(async () => ({
      id: 'opaque-review',
      path: 'Shared/new.md',
      sha: target.sha,
      kind: 'note',
      root: { ...root, label: root.path },
    })),
    confirm: vi.fn(),
    close: vi.fn(),
  }
  const screen = mount(ScopedCreationModal, {
    props: {
      flow: creation,
      roots: [{ ...root, label: root.path, spelling: root.path, approved: true }],
      sponsors: [{ ...sponsor, label: 'Notes/sample.md' }],
    } as never,
    global,
  })
  try {
    await screen.findAll('button')[0].trigger('click')
    await flushPromises()
    plain(screen.text())
    expect(screen.text()).toContain('Shared/new.md')
    expect(screen.text()).toContain(root.path)
    expect(creation.confirm).not.toHaveBeenCalled()
  } finally {
    screen.unmount()
  }
})

it('asks whether to share a private image while retaining the exact answer controls', () => {
  const question = {
    exposureKey: 'opaque-question',
    fingerprint: 'c'.repeat(64),
    observation: {
      target,
      sponsor: { ...sponsor, path: 'Notes/sample.md' },
      audience: { grantId: 'opaque-grant', label: 'Sample group' },
    },
  }
  const screen = mount(PublicationConfirmModal, {
    props: { question, busy: true } as never,
    global,
  })
  try {
    plain(screen.text())
    expect(screen.text()).toContain('This file is private')
    expect(screen.text()).toContain(target.path)
    expect(screen.text()).toContain('Sample group')
    for (const text of ['Share', 'Keep private'])
      expect(
        screen
          .findAll('button')
          .find((button) => button.text() === text)!
          .attributes('disabled')
      ).toBeDefined()
  } finally {
    screen.unmount()
  }
})

it('shows a joined connection and its edit permission without its internal ID', async () => {
  const sync = SyncService.getInstance()
  const previous = sync.sharing.value
  sync.sharing.value = {
    scope: ref({ grantId: 'opaque-grant', issuer: 'https://sync.example', role: 'editor' }),
    scoped: { role: ref('editor'), paused: ref(false) },
  } as never
  const screen = mount(SyncSettings, { global })
  try {
    plain(screen.text())
    expect(screen.text()).toContain('Joined shared group')
    expect(screen.text()).toContain('Can edit')
    expect(screen.text()).toContain('Scripts cannot run here')
    expect(screen.find('[title="opaque-grant"]').exists()).toBe(true)
    expect(
      screen
        .findAll('button')
        .find((button) => button.text() === 'New shared file…')!
        .attributes('disabled')
    ).toBeUndefined()
  } finally {
    screen.unmount()
    sync.sharing.value = previous
  }
})

it.each([
  [{ code: 'personal_connected' }, 'This vault is already connected to personal sync'],
  [{ code: 'invalid_invitation' }, 'The invitation code is invalid or expired'],
  [{ code: 'network_unavailable' }, 'Could not reach the server'],
])('explains the actual join failure in plain words', async (failure, message) => {
  const join = { begin: vi.fn(), resume: vi.fn().mockRejectedValue(failure), close: vi.fn() }
  const screen = mount(ScopedInvitationModal, { props: { flow: join } as never, global })
  try {
    await screen
      .findAll('button')
      .find((button) => button.text() === 'Join group')!
      .trigger('click')
    await flushPromises()
    expect(screen.find('[role="alert"]').text()).toContain(message)
  } finally {
    screen.unmount()
  }
})

it('calls a folder manifest an inventory, not a server sharing verdict', () => {
  const screen = mount(OwnerFolderSharingModal, {
    props: {
      preview: {
        prefix: 'Shared/',
        generation: 'sample-inventory',
        complete: true,
        files: [
          {
            path: 'Shared/sample-tool.exe',
            fileId: 'sample-tool',
            versionId: 'sample-version',
            eligible: false,
            eligibility: 'unknown',
          },
          {
            path: 'Shared/renamed-image.png',
            fileId: 'sample-image',
            versionId: 'sample-version',
            eligible: false,
            eligibility: 'unknown',
          },
        ],
      },
    } as never,
    global,
  })
  try {
    expect(screen.text()).toContain('2 synced files found')
    expect(screen.text()).toContain('The server decides which files can be shared')
    expect(screen.text()).not.toContain('files included')
  } finally {
    screen.unmount()
  }
})

it('does not pretend an unwired sharing view is still scanning links', () => {
  const screen = mount(OwnerPublicationSettings, { global })
  try {
    expect(screen.text()).not.toContain('Checking which images are linked')
    expect(screen.text()).not.toContain('Some links could not be checked yet')
  } finally {
    screen.unmount()
  }
})

it('keeps personal vault IDs and connection jargon out of visible settings', () => {
  const sync = SyncService.getInstance()
  const old = sync.connection.value,
    status = sync.status.value
  sync.connection.value = {
    ...old,
    vaultId: 'opaque-personal-vault',
    vaultName: 'Sample vault',
    deviceName: 'Sample device',
  }
  sync.status.value = { ...status, state: 'idle' }
  const screen = mount(SyncSettings, {
    global: {
      ...global,
      stubs: {
        ...global.stubs,
        DeviceList: true,
        VaultPolicy: true,
        UsageCard: true,
        SelectiveSync: true,
      },
    },
  })
  try {
    expect(screen.text()).not.toContain('opaque-personal-vault')
    expect(screen.text()).not.toMatch(/\b(?:enrolled|token|Rescan)\b/)
    expect(screen.text()).toContain('Sample vault')
  } finally {
    screen.unmount()
    sync.connection.value = old
    sync.status.value = status
  }
})

it.each(['folder', 'group'] as const)(
  'confirms stopping a shared %s by name before revoking it',
  async (kind) => {
    const share = {
      id: 'opaque-grant',
      kind,
      label: 'Sample sharing',
      prefix: kind === 'folder' ? 'Shared/' : null,
      rootId: kind === 'group' ? 'opaque-root' : null,
      role: 'editor',
      revision: 4,
      state: 'active',
    }
    const session = { facet: 'account' }
    const manager = {
      authorize: vi.fn(async () => session),
      list: vi.fn(async () => [share]),
      revoke: vi.fn(),
      close: vi.fn(),
    }
    const model = { view, load: vi.fn(async () => view) }
    const screen = mount(OwnerPublicationSettings, { props: { manager, model } as never, global })
    try {
      await screen.find('[aria-label="Sharing account email"]').setValue('sample@example.com')
      await screen.find('[aria-label="Sharing account password"]').setValue('invented-password')
      await screen
        .findAll('button')
        .find((button) => button.text() === 'Show shared folders and groups')!
        .trigger('click')
      await flushPromises()
      expect(screen.text()).toContain(share.label)
      expect(screen.text()).toContain(target.path)
      expect(screen.findAll('button').some((button) => button.text() === 'Unshare…')).toBe(true)
      await screen
        .findAll('button')
        .find((button) => button.text() === 'Stop sharing')!
        .trigger('click')
      plain(screen.text())
      expect(screen.text()).toContain('All collaborators and connected apps')
      expect(screen.text()).toContain(kind === 'folder' ? 'Shared/' : share.label)
      expect(manager.revoke).not.toHaveBeenCalled()
      await screen
        .findAll('button')
        .filter((button) => button.text() === 'Stop sharing')
        .at(-1)!
        .trigger('click')
      await flushPromises()
      expect(manager.revoke).toHaveBeenCalledExactlyOnceWith(session, share)
    } finally {
      screen.unmount()
    }
  }
)

it('keeps raw diagnostic strings out of a failed sharing review', async () => {
  const folder = {
    ...flow(),
    review: vi.fn(async () => {
      throw new Error('grant opaque-grant version opaque-version SHA ' + target.sha)
    }),
  }
  const screen = mount(OwnerFolderSharingModal, { props: { flow: folder } as never, global })
  try {
    await screen.findAll('button')[0].trigger('click')
    await flushPromises()
    plain(screen.text())
    expect(screen.find('[role="alert"]').text()).toContain('Could not review this folder')
    expect(folder.confirm).not.toHaveBeenCalled()
  } finally {
    screen.unmount()
  }
})
