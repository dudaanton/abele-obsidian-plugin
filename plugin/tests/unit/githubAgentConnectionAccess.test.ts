import { describe, expect, it, vi } from 'vitest'
import { connectionMode, authorizeConnection } from '@/github/agentAccess'

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
