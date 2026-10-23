import { expect, it } from 'vitest'
import { settleStoppedInstallationsForDeletion } from '@/sync/external/pluginSafety'
import {
  connectionAdapter,
  connectionInspectionApp,
  connectionJournalApp,
} from '@/sync/vaultPathLinks'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { WriteJournal } from '@/sync/writeJournal'
import { buildFakeVault } from '../helpers/fakeVault'

it.each([
  { lost: false, published: false },
  { lost: true, published: false },
  { lost: false, published: true },
])(
  'preserves a drained receipt and its locator before departure (lost=$lost, published=$published)',
  async ({ lost, published }) => {
    const app = buildFakeVault([{ path: 'Shared/kept.md', content: 'local bytes' }])
    const owner = 'sample-connection',
      privateRoot = connectionPrivateRoot(owner)
    const view = connectionInspectionApp(
      connectionJournalApp(app as never, owner),
      connectionAdapter(app.vault.adapter, 'Shared', privateRoot),
      'Shared',
      privateRoot
    )
    const journal = new WriteJournal(view, undefined, owner)
    const temp = privateRoot + '/writes/.abele-receipt-sample-receipt.tmp'
    for (const path of [
      '.abele-sync',
      '.abele-sync/connections',
      privateRoot,
      privateRoot + '/writes',
    ])
      await app.vault.adapter.mkdir(path)
    await app.vault.adapter.write(temp, 'unpublished incoming bytes')
    await journal.persist(() =>
      journal.add({
        target: 'Shared/incoming.md',
        temp,
        conditionalReceipt: 'sample-receipt',
        replacementSha: 'a'.repeat(64),
      })
    )
    const foreign = new WriteJournal(app, undefined, 'other-connection')
    await foreign.persist(() =>
      foreign.add({
        target: 'Elsewhere/kept.md',
        temp: '.abele-sync/connections/other-connection/writes/.abele-receipt-other.tmp',
        conditionalReceipt: 'other',
        replacementSha: 'b'.repeat(64),
      })
    )
    if (published) await app.vault.adapter.rename(temp, 'Shared/incoming.md')
    const rename = app.vault.adapter.rename.bind(app.vault.adapter)
    let cut = lost
    app.vault.adapter.rename = async (from, to) => {
      await rename(from, to)
      if (cut && from === temp) {
        cut = false
        throw new Error('sample acknowledgement lost')
      }
    }
    if (lost)
      await expect(settleStoppedInstallationsForDeletion(view, () => {})).rejects.toThrow(
        'sample acknowledgement lost'
      )
    await settleStoppedInstallationsForDeletion(view, () => {})
    const entries = await journal.currentEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      target: 'Shared/incoming.md',
      retiredGeneration: 'server-deletion',
    })
    expect(entries[0].temp).toBe(
      published ? temp : privateRoot + '/recovery/.abele-receipt-sample-receipt.tmp'
    )
    expect(await app.vault.adapter.read(published ? 'Shared/incoming.md' : entries[0].temp!)).toBe(
      'unpublished incoming bytes'
    )
    expect(await app.vault.adapter.exists(temp)).toBe(false)
    expect(await app.vault.adapter.exists('Shared/incoming.md')).toBe(published)
    expect(await app.vault.adapter.read('Shared/kept.md')).toBe('local bytes')
    expect(await foreign.currentEntries()).toHaveLength(1)
    expect((await foreign.currentEntries())[0].retiredGeneration).toBeUndefined()
  }
)
