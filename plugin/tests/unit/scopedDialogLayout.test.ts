// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
describe('scoped sheet scrolling keeps the fixed close row separate', () => {
  it.each([
    'ScopedInvitationModal',
    'ScopedCreationModal',
    'OwnerFolderSharingModal',
    'GroupSharingModal',
    'InitialAssetBatchModal',
  ])('%s owns a scroll body rather than letting content overlap footer', (name) => {
    const source = readFileSync(
      new URL('../../src/components/sync/' + name + '.vue', import.meta.url),
      'utf8'
    )
    expect(source).toContain('overflow-y: auto')
    expect(source).toContain('flex: 0 0 auto')
  })
})
