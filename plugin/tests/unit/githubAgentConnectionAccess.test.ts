import { describe, expect, it, vi } from 'vitest'
import {
  connectionMode,
  authorizeConnection,
  migrateLegacyConnectionAccess,
} from '@/github/agentAccess'

const row = {
  id: 'sample',
  name: 'Sample',
  server: '',
  keyId: 'sample-key',
  owners: [],
  isDefault: true,
}

describe('per-agent connection access', () => {
  it('defaults new and missing connections to Off, like unconfigured feature tools, regardless of host', () => {
    expect(connectionMode({ githubConnections: {} }, row.id)).toBe('off')
    expect(connectionMode(null, row.id)).toBe('off')
    expect(connectionMode({ githubConnections: { sample: 'auto' } }, row.id)).toBe('auto')
  })
  it('migrates only the original credential once, retaining tool approvals and every explicit map', () => {
    const agents = [
      { id: 'old-auto', toolModes: { github_read: 'auto', github_pr_files: 'ask' } },
      { id: 'old-ask', toolModes: { github_read: 'ask' } },
      { id: 'old-off', toolModes: { github_read: 'off' } },
      {
        id: 'explicit-off',
        toolModes: { github_read: 'auto' },
        githubConnections: { 'github-legacy': 'off' },
      },
      { id: 'explicit-empty', toolModes: { github_read: 'auto' }, githubConnections: {} },
    ] as Parameters<typeof migrateLegacyConnectionAccess>[0]
    expect(migrateLegacyConnectionAccess(agents, [{ ...row, id: 'github-legacy' }, row])).toBe(true)
    expect(agents.map((a) => a.githubConnections)).toEqual([
      { 'github-legacy': 'auto' },
      { 'github-legacy': 'ask' },
      {},
      { 'github-legacy': 'off' },
      {},
    ])
    expect(migrateLegacyConnectionAccess(agents, [{ ...row, id: 'github-legacy' }, row])).toBe(
      false
    )
  })
  it('never grants an unrelated connection when no migrated credential remains', () => {
    const agents = [{ toolModes: { github_read: 'auto' as const } }] as Parameters<
      typeof migrateLegacyConnectionAccess
    >[0]
    expect(migrateLegacyConnectionAccess(agents, [row])).toBe(true)
    expect(agents[0].githubConnections).toEqual({})
    expect(migrateLegacyConnectionAccess(agents, [{ ...row, id: 'github-legacy' }])).toBe(false)
    expect(agents[0].githubConnections).toEqual({})
  })
  it('Ask authorizes one operation only, and unattended execution refuses it', async () => {
    const agent = { id: 'agent', githubConnections: { sample: 'ask' as const } }
    const approve = vi.fn(async () => true)
    await authorizeConnection(() => agent, row, approve)
    expect(approve).toHaveBeenCalledOnce()
    await expect(authorizeConnection(() => agent, row)).rejects.toThrow(/approval/i)
    await authorizeConnection(() => agent, row, approve)
    expect(approve).toHaveBeenCalledTimes(2)
  })
  it('rechecks live permissions after an approval, and Off cannot be bypassed by a callback', async () => {
    const agent = { id: 'agent', githubConnections: { sample: 'ask' as 'ask' | 'off' } }
    const approve = vi.fn(async () => {
      agent.githubConnections.sample = 'off'
      return true
    })
    await expect(authorizeConnection(() => agent, row, approve)).rejects.toThrow(/access|disabled/i)
    approve.mockClear()
    await expect(authorizeConnection(() => agent, row, approve)).rejects.toThrow(/access|disabled/i)
    expect(approve).not.toHaveBeenCalled()
  })
})
