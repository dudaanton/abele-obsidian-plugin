import { expect } from 'vitest'
import { liveSuite, liveCase } from './helpers/syncLiveCases'
const fixture = liveSuite()
liveCase(
  'syncTransfer',
  'copying ordinary settings never transfers live token credentials or ledger identity',
  [10, 22],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!
    await s.connect()
    const settings = a.run<Record<string, unknown>>(
      `return JSON.parse(await app.vault.adapter.read('.obsidian/plugins/abele/data.json'))`
    )
    expect(JSON.stringify(settings)).not.toContain(s.server.rootToken)
    const ids = a.run<string[]>(
      `return svc.registry.records().flatMap(one=>[one.id,one.ledgerId,one.secretReference]).filter(Boolean)`
    )
    for (const id of ids) expect(JSON.stringify(settings)).not.toContain(id)
    const before = b.rows()
    expect(before).toHaveLength(0)
    // Only transfer ordinary preferences; importing data.json wholesale would overwrite the pool configuration.
    const exported = a.run<{ section: string }[]>(
      `return window.__abeleTest.collectTransferEntries(JSON.parse(await app.vault.adapter.read('.obsidian/plugins/abele/data.json')))`
    )
    expect(exported.some((one) => one.section === 'connection')).toBe(false)
    for (const id of ids) expect(JSON.stringify(exported).includes(id)).toBe(false)
    expect(JSON.stringify(exported)).not.toContain(s.server.rootToken)
    expect(b.rows()).toEqual(before)
  },
  fixture
)
