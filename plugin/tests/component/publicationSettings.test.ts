import { mount } from '@vue/test-utils'
import { toRaw } from 'vue'
import InitialAssetBatchModal from '@/components/sync/InitialAssetBatchModal.vue'
import { describe, expect, it, vi } from 'vitest'
import OwnerPublicationSettings from '@/components/settings/sync/OwnerPublicationSettings.vue'
const view = {
  grantId: 'sample-audience',
  revision: 1,
  withdrawalGeneration: 0,
  active: true,
  role: 'editor' as const,
  entries: [
    {
      kind: 'owner-extra' as const,
      target: {
        fileId: 'sample-image',
        versionId: 'sample-version',
        sha: 'a'.repeat(64),
        path: 'Assets/sample.png',
        eligible: true,
      },
      sponsors: [
        {
          fileId: 'sample-note',
          versionId: 'note-v1',
          admissionGeneration: 1,
          inScope: true,
          intrinsic: true,
        },
      ],
      reason: 'confirmed-existing',
    },
  ],
}
const global = {
  stubs: {
    Section: { template: '<div><slot/></div>' },
    Setting: { template: '<div><slot/></div>' },
  },
}
describe('publication settings UI', () => {
  it.each(['missing flow', 'missing entries', 'missing shared groups'])(
    'hides an initial image batch with %s',
    (missing) => {
      const w = mount(OwnerPublicationSettings, {
        props: {
          batchFlow: missing === 'missing flow' ? undefined : { close: vi.fn() },
          batchEntries:
            missing === 'missing entries'
              ? []
              : [
                  {
                    target: view.entries[0].target,
                    sponsors: view.entries[0].sponsors,
                    reason: 'initial-batch',
                  },
                ],
          batchAudiences: missing === 'missing shared groups' ? [] : ['sample-audience'],
        } as never,
        global,
      })
      try {
        expect(w.findAll('button').some((button) => button.text() === 'Review images…')).toBe(false)
      } finally {
        w.unmount()
      }
    }
  )
  it('retains a wired initial image batch and passes its exact choices to the dialog', async () => {
    const batchFlow = { review: vi.fn(), confirm: vi.fn(), close: vi.fn() }
    const batchEntries = [
      {
        target: view.entries[0].target,
        sponsors: view.entries[0].sponsors,
        reason: 'initial-batch' as const,
      },
    ]
    const batchAudiences = ['sample-audience']
    const batchAudienceNames = { 'sample-audience': 'Sample shared group' }
    const w = mount(OwnerPublicationSettings, {
      props: { batchFlow, batchEntries, batchAudiences, batchAudienceNames } as never,
      global: { stubs: { ...global.stubs, ObsidianModal: { template: '<div><slot/></div>' } } },
    })
    try {
      const button = w.findAll('button').find((button) => button.text() === 'Review images…')!
      expect(button.attributes('disabled')).toBeUndefined()
      await button.trigger('click')
      const dialog = w.findComponent(InitialAssetBatchModal)
      expect(toRaw(dialog.props('flow'))).toBe(batchFlow)
      expect(dialog.props('entries')).toEqual(batchEntries)
      expect(dialog.props('audiences')).toEqual(batchAudiences)
      expect(dialog.props('audienceNames')).toEqual(batchAudienceNames)
      expect(dialog.text()).toContain('Sample shared group')
    } finally {
      w.unmount()
    }
  })
  it('keeps the activation hold truthful and never unshares with missing cache evidence', async () => {
    const model = { reviewUnshare: vi.fn() }
    const w = mount(OwnerPublicationSettings, {
      props: { view, model: model as any, enabled: false },
      global,
    })
    expect(w.text()).toContain('not active')
    expect(w.text()).toContain('Links have not been checked yet.')
    expect(w.text()).toContain('Shared through 1 shared note')
    expect(w.find('[title="sample-note"]').exists()).toBe(true)
    expect(w.text()).not.toContain('sample-note')
    await w.findAll('button')[1].trigger('click')
    expect(model.reviewUnshare).not.toHaveBeenCalled()
    w.unmount()
  })
  it('refuses an unshare action when the model belongs to another displayed audience', async () => {
    const model = { view: { ...view, grantId: 'other-audience' }, reviewUnshare: vi.fn() }
    const w = mount(OwnerPublicationSettings, {
      props: { view, model: model as any, enabled: true },
      global,
    })
    await w.findAll('button')[1].trigger('click')
    expect(model.reviewUnshare).not.toHaveBeenCalled()
    expect(w.text()).toContain('shared folder or group changed')
    w.unmount()
  })
  it('never renders private asset paths on a scoped connection', () => {
    const w = mount(OwnerPublicationSettings, {
      props: { view, facet: 'scoped', owner: false },
      global,
    })
    expect(w.text()).not.toContain('Assets/sample.png')
    expect(w.text()).toContain('Only the vault owner can change what is shared')
    w.unmount()
  })
  it('distinguishes a no-longer-referenced publication from revocation', () => {
    const w = mount(OwnerPublicationSettings, {
      props: { view, cacheComplete: true, referencedIds: [] },
      global,
    })
    expect(w.text()).toContain('It stays shared until you unshare it')
    w.unmount()
  })
})
