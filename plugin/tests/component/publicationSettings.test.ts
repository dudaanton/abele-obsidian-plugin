import { mount } from '@vue/test-utils'
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
  it('keeps the activation hold truthful and never unshares with missing cache evidence', async () => {
    const model = { reviewUnshare: vi.fn() }
    const w = mount(OwnerPublicationSettings, { props: { view, model: model as any }, global })
    expect(w.text()).toContain('not active')
    expect(w.text()).toContain('Reference status unknown')
    expect(w.text()).toContain('sample-note')
    await w.findAll('button')[1].trigger('click')
    expect(model.reviewUnshare).not.toHaveBeenCalled()
    w.unmount()
  })
  it('never renders private asset paths on a scoped connection', () => {
    const w = mount(OwnerPublicationSettings, {
      props: { view, facet: 'scoped', owner: false },
      global,
    })
    expect(w.text()).not.toContain('Assets/sample.png')
    expect(w.text()).toContain('cannot manage')
    w.unmount()
  })
  it('distinguishes a no-longer-referenced publication from revocation', () => {
    const w = mount(OwnerPublicationSettings, {
      props: { view, cacheComplete: true, referencedIds: [] },
      global,
    })
    expect(w.text()).toContain('no automatic withdrawal')
    w.unmount()
  })
})
