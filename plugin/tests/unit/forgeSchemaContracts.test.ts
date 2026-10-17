import { describe, expect, it } from 'vitest'
import { schemaSupport } from '@/forge/schemaSupport'
import contracts from '../fixtures/forge/contracts.json'

describe('pinned forge schema contracts', () => {
  for (const contract of contracts) {
    it(`${contract.kind} ${contract.version} preserves API gaps`, () => {
      const support = schemaSupport(contract.kind, contract.version)
      expect(support.draftCreate.supported).toBe(false)
      expect(support.notificationDone.supported).toBe(false)
      expect(support.blame.supported).toBe(false)
      expect(support.compareFiles.supported).toBe(contract.compareProperties.includes('files'))
      expect(contract.createPullProperties).not.toContain('draft')
      expect(contract.changedFileProperties).not.toContain('patch')
      expect(contract.notificationStatuses).toEqual(['unread', 'read', 'pinned'])
      expect(contract.notificationStatusParameter.description).toContain(
        'unread, read and/or pinned'
      )
      expect(contract.notificationSnapshotParameter.name).toBe('last_read_at')
      expect(contract.blamePaths).toEqual([])
      expect(contract.compareParameters).toEqual(['owner', 'repo', 'basehead'])
      for (const key of Object.keys(contract.createPullExample))
        expect(contract.createPullProperties).toContain(key)
      for (const key of Object.keys(contract.changedFileExample))
        expect(contract.changedFileProperties).toContain(key)
      for (const key of Object.keys(contract.compareExample))
        expect(contract.compareProperties).toContain(key)
    })
  }
  it('does not infer support for an uninspected version', () => {
    expect(() => schemaSupport('forgejo', '999.0.0')).toThrow('schema')
  })
})
