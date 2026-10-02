// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({
  connection: { value: { vaultId: '', deviceTokenId: '', pendingRevoke: [] as unknown[] } },
  adoptTransferred: vi.fn(),
  answerJoin: vi.fn(),
}))
vi.mock('@/sync/SyncService', () => ({ SyncService: { getInstance: () => fake } }))
import { joinFixtureTransfer } from '@/testing/joinFixtureTransfer'
import { encodePayload } from '@/transfer/payload'
import { toText } from '@/transfer/frames'
import type { App } from 'obsidian'
const app = { loadLocalStorage: () => null } as unknown as App
beforeEach(() => {
  fake.connection.value = { vaultId: '', deviceTokenId: '', pendingRevoke: [] }
  fake.adoptTransferred.mockReset()
  fake.answerJoin.mockReset()
})
describe('development encrypted fixture join', () => {
  it('uses the real adoption and explicit null merge choice, returning no secret', async () => {
    const payload = {
      v: 1 as const,
      at: '2026-01-01T00:00:00Z',
      entries: [
        {
          section: 'connection' as const,
          id: 'connection',
          label: 'Sync connection',
          data: {
            serverUrl: 'https://sync.example',
            vaultId: 'sample-vault',
            vaultName: 'Sample',
            deviceId: 'sample-device',
            deviceName: 'Sample receiver',
            selective: {},
          },
          secretIds: ['sync-connection-token'],
        },
      ],
      secrets: { 'sync-connection-token': 'invented-fixture-token' },
    }
    const text = toText(await encodePayload(payload, 'ABCDEFGH'), 'ABCD')
    expect(await joinFixtureTransfer(app, text, 'ABCDEFGH')).toBe(true)
    expect(fake.adoptTransferred).toHaveBeenCalledTimes(1)
    expect(fake.answerJoin).toHaveBeenCalledWith(null)
  })
  it('refuses preexisting connection/state and invalid ciphertext before adoption', async () => {
    fake.connection.value.vaultId = 'sample-original'
    await expect(joinFixtureTransfer(app, 'invalid', 'code')).rejects.toThrow(/Existing/)
    fake.connection.value.vaultId = ''
    await expect(
      joinFixtureTransfer(
        { loadLocalStorage: () => ({ stateId: 'old' }) } as unknown as App,
        'invalid',
        'code'
      )
    ).rejects.toThrow(/Retained/)
    await expect(joinFixtureTransfer(app, 'invalid', 'code')).rejects.toThrow(/Invalid/)
    expect(fake.adoptTransferred).not.toHaveBeenCalled()
  })
})
