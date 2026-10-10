import PublicationConfirmModal from '@/components/sync/PublicationConfirmModal.vue'
import { mount } from '@vue/test-utils'
import { beforeEach, expect, it } from 'vitest'
import { useVault } from '../helpers/testEnv'

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
