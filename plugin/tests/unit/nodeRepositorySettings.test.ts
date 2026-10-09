import { describe, expect, it, vi } from 'vitest'
import { changeExternalBrowsing } from '@/node/repositorySettings'
import { NodeRepositorySource } from '@/repository/node'
import { nodeRepositoryFixture, identity } from '../helpers/nodeRepositoryFixture'

describe('owner external-workspace browsing approval', () => {
  it('does not opt in until the owner approves, and grants no workspace execution', async () => {
    const fixture = nodeRepositoryFixture(), source = new NodeRepositorySource(fixture.client, identity, { node: 'Sample', project: 'Sample' })
    const client = { setRepositorySettings: vi.fn(async () => ({})) }
    expect(await changeExternalBrowsing(client as any, source, true, async () => false)).toBe(false)
    expect(client.setRepositorySettings).not.toHaveBeenCalled()
    expect(await changeExternalBrowsing(client as any, source, true, async () => true)).toBe(true)
    expect(client.setRepositorySettings).toHaveBeenCalledWith({ project_id: identity.project, external_read: true })
    source.dispose()
  })
  it('rechecks the source after the owner prompt and supports explicit opt-out', async () => {
    const fixture = nodeRepositoryFixture(), source = new NodeRepositorySource(fixture.client, identity, { node: 'Sample', project: 'Sample' })
    const client = { setRepositorySettings: vi.fn(async () => ({})) }
    await changeExternalBrowsing(client as any, source, false, async () => true)
    expect(client.setRepositorySettings).toHaveBeenCalledWith({ project_id: identity.project, external_read: false })
    await expect(changeExternalBrowsing(client as any, source, true, async () => { source.dispose(); return true })).rejects.toThrow('no longer available')
    expect(client.setRepositorySettings).toHaveBeenCalledTimes(1)
  })
})
