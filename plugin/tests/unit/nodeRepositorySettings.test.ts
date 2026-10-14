import { describe, expect, it, vi } from 'vitest'
import { changeExternalBrowsing, changeProjectExternalBrowsing, externalBrowsingConfirm, projectExternalBrowsing } from '@/node/repositorySettings'
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
  it('asks the same from the side panel by project id, and changes nothing on a no', async () => {
    const client = { setRepositorySettings: vi.fn(async () => ({})) }
    expect(await changeProjectExternalBrowsing(client as any, 'sample-project', true, async () => false)).toBe(false)
    expect(client.setRepositorySettings).not.toHaveBeenCalled()
    expect(await changeProjectExternalBrowsing(client as any, 'sample-project', false, async () => true)).toBe(true)
    expect(client.setRepositorySettings).toHaveBeenCalledWith({ project_id: 'sample-project', external_read: false })
    expect(externalBrowsingConfirm(true).confirmText).toBe('Allow browsing')
    expect(externalBrowsingConfirm(false).confirmText).toBe('Stop browsing')
  })
  it('reads whether browsing is on, and knows nothing from a node that cannot say', async () => {
    const on = { request: vi.fn(async () => ({ project_id: 'sample-project', external_read: true, default_branch: null })) }
    expect(await projectExternalBrowsing(on as any, 'sample-project')).toBe(true)
    expect(on.request).toHaveBeenCalledWith('project.repository_settings.get', { project_id: 'sample-project' })
    const off = { request: vi.fn(async () => ({ project_id: 'sample-project', external_read: false, default_branch: null })) }
    expect(await projectExternalBrowsing(off as any, 'sample-project')).toBe(false)
    const older = { request: vi.fn(async () => { throw new Error('unsupported_method') }) }
    expect(await projectExternalBrowsing(older as any, 'sample-project')).toBeUndefined()
    const odd = { request: vi.fn(async () => ({ project_id: 'sample-project' })) }
    expect(await projectExternalBrowsing(odd as any, 'sample-project')).toBeUndefined()
  })
})
