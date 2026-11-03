import { expect, it } from 'vitest'
import type { App } from 'obsidian'
import { requireExternalEnrollmentSafety } from '@/sync/external/pluginSafety'
import { WriteJournal } from '@/sync/writeJournal'
import { buildFakeVault } from '../helpers/fakeVault'

for (const kind of ['installation', 'retained-byte'] as const)
  it(`identifies the missing ${kind} owner without forgetting it or changing user files`, async () => {
    const app = buildFakeVault([{ path: 'Notes/sample.md', content: 'keep current bytes' }])
    const journal = new WriteJournal(app)
    const entry = {
      target: 'Notes/sample.md',
      temp: '.obsidian/plugins/abele/sync-staging/sample.tmp',
      backup: '.obsidian/plugins/abele/sync-recovery/sample.old',
    }
    if (kind === 'installation') journal.add(entry)
    else journal.preserve(entry)
    const before = JSON.stringify([
      await journal.currentEntries(),
      await journal.currentRecovered(),
    ])
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(requireExternalEnrollmentSafety(app as unknown as App)).rejects.toMatchObject({
        recoveryRecord: {
          kind,
          id: kind === 'installation' ? 'sample.tmp' : 'sample.old',
          path: entry.target,
        },
      })
    }
    expect(JSON.stringify([await journal.currentEntries(), await journal.currentRecovered()])).toBe(
      before
    )
    expect(await app.vault.adapter.read(entry.target)).toBe('keep current bytes')
    expect(await app.vault.adapter.exists(entry.temp)).toBe(false)
    expect(await app.vault.adapter.exists(entry.backup)).toBe(false)
  })
