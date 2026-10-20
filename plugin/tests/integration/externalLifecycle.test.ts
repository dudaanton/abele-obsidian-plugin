import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeAccessToken } from '@abele/sync-sdk/protocol'
import { tokenHostFixture } from '../helpers/tokenHostFixture'
import { openTokenLedger } from '@/sync/tokenLedger'
import { tokenExternalBinding } from '@/sync/tokenExternalBinding'
import { ExternalState } from '@/sync/external/state'
import { requireExternalLifecycleSafety } from '@/sync/external/pluginSafety'
import { EXTERNAL_STATE_KEY } from '@abele/sync-sdk/core'

const close: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const one of close.splice(0).reverse()) await one()
  vi.restoreAllMocks()
})
async function fixture(availability: 'active' | 'deleted' | 'detached' | 'unavailable' = 'active') {
  const fetcher = vi.fn(async () => {
      throw new Error('Unexpected network before preparation')
    }),
    s = tokenHostFixture(fetcher as never)
  close.push(() => s.host.close())
  const record = s.registry.records()[0],
    raw = await openTokenLedger(s.factory, s.registry, record, () => {})
  close.push(async () => raw.close())
  const binding = await tokenExternalBinding(record, s.keys.get(record.secretReference)!),
    state = await ExternalState.open(raw, record.ledgerId, binding)
  await state.commit({
    expectedRevision: 0,
    files: [
      {
        expectedRevision: null,
        next: {
          schema: 1,
          ledgerId: record.ledgerId,
          binding,
          fileId: 'sample-file',
          representation: 'remote-only',
          preference: 'on-demand',
          pinned: false,
          projectionPath: 'Media/sample.bin.abele-ref',
          projectionSha: 'b'.repeat(64),
          localRevision: 0,
          pendingOperationId: null,
          availability,
          blockingReason: 'recovery-required',
          lastProvenLocalBase: null,
          retained: [],
        },
      },
    ],
  })
  return { ...s, raw, state, record: s.registry.records()[0], fetcher }
}
describe('token connection external dependency lifecycle', () => {
  it.each(['active', 'deleted', 'detached', 'unavailable'] as const)(
    'disconnect retains %s dependencies and its credential before preparation',
    async (availability) => {
      const s = await fixture(availability),
        before = await s.raw.getMeta(EXTERNAL_STATE_KEY)
      await expect(s.ui.disconnect(s.id)).rejects.toThrow(/external|recovery|preparation/i)
      expect(s.registry.records()).toEqual([s.record])
      expect(s.keys.get(s.record.secretReference)).toBe('a'.repeat(43))
      expect(await s.raw.getMeta(EXTERNAL_STATE_KEY)).toBe(before)
      expect(s.fetcher).not.toHaveBeenCalled()
    }
  )
  it('checks a copied or renamed orphan projection before forgetting the last credential', async () => {
    const s = await fixture()
    await s.raw.setMeta(EXTERNAL_STATE_KEY, null)
    await s.app.vault.adapter.write('sample-moved.txt', '{"format":"abele.external", broken')
    await expect(s.ui.disconnect(s.id)).rejects.toThrow(/external|recovery/i)
    expect(s.registry.records()).toEqual([s.record])
    expect(s.keys.size).toBe(1)
    expect(s.fetcher).not.toHaveBeenCalled()
  })
  it('inspects retained installation bytes even without an external document', async () => {
    const s = await fixture()
    await s.raw.setMeta(EXTERNAL_STATE_KEY, null)
    const evidence = [
      { owner: s.id, target: 'Media/sample.bin', backup: 'Media/.abele-sync-abcd1234.old' },
    ]
    s.app.saveLocalStorage('abele-sync-recovered-writes', evidence)
    await expect(s.ui.disconnect(s.id)).rejects.toThrow(/external|recovery/i)
    expect(s.app.loadLocalStorage('abele-sync-recovered-writes')).toEqual(evidence)
    expect(s.keys.size).toBe(1)
  })
  it('one successful disconnect performs one evidence inventory and keeps ordinary files and its ledger', async () => {
    const s = await fixture()
    await s.raw.setMeta(EXTERNAL_STATE_KEY, null)
    await s.app.vault.adapter.write('sample.md', 'ordinary bytes')
    const list = vi.spyOn(s.app.vault.adapter, 'list'),
      read = vi.spyOn(s.app.vault.adapter, 'readBinary')
    await s.ui.disconnect(s.id)
    expect(list).toHaveBeenCalledOnce()
    expect(read).toHaveBeenCalledOnce()
    expect(await s.app.vault.adapter.read('sample.md')).toBe('ordinary bytes')
    expect(await s.factory.databases()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: s.record.ledgerId })])
    )
    expect(s.keys.size).toBe(0)
  })
  it('does not add a connection over unresolved recovery evidence', async () => {
    const s = await fixture(),
      before = s.registry.records()
    await expect(
      s.ui.connect(
        encodeAccessToken({
          v: 1,
          address: 'https://other.example',
          key: 'b'.repeat(43),
          scope: { kind: 'folder', id: 'other-root', path: '/' },
        })
      )
    ).rejects.toThrow(/external|recovery/i)
    expect(s.registry.records()).toEqual(before)
    expect(s.keys.size).toBe(1)
    expect(s.fetcher).not.toHaveBeenCalled()
  })
  it('does not erase an unreadable activated journal or switch marker on disconnect', async () => {
    const s = await fixture()
    await s.raw.setMeta(EXTERNAL_STATE_KEY, 'broken journal')
    await expect(s.ui.disconnect(s.id)).rejects.toThrow()
    await s.raw.setMeta(EXTERNAL_STATE_KEY, null)
    for (const key of [
      'abele-sync-external-activation-v1',
      'abele-sync-external-connection-switch-v1',
    ]) {
      s.app.saveLocalStorage(key, { interrupted: true })
      await expect(s.ui.disconnect(s.id)).rejects.toThrow(/external|recovery/i)
      s.app.saveLocalStorage(key, null)
    }
    expect(s.keys.size).toBe(1)
    expect(s.registry.records()).toEqual([s.record])
  })
  it('a failed evidence read permits a safe later retry without erasing the connection', async () => {
    const s = await fixture()
    await s.raw.setMeta(EXTERNAL_STATE_KEY, null)
    await s.app.vault.adapter.write('sample.md', 'ordinary bytes')
    const read = vi
      .spyOn(s.app.vault.adapter, 'readBinary')
      .mockRejectedValueOnce(new Error('sample read failure'))
    await expect(s.ui.disconnect(s.id)).rejects.toThrow('sample read failure')
    expect(s.keys.size).toBe(1)
    read.mockRestore()
    await s.ui.disconnect(s.id)
    expect(s.keys.size).toBe(0)
  })
  it('the shared read-only safety port finds device-local token ledgers', async () => {
    const s = await fixture()
    await expect(requireExternalLifecycleSafety(s.app as never, s.factory)).rejects.toThrow(
      /external|recovery/i
    )
    expect(s.keys.size).toBe(1)
  })
})
