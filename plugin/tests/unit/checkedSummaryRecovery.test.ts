import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { connectionInspectionApp } from '@/sync/connectionScope'
import { connectionPrivateRoot } from '@/sync/connectionPaths'
import { buildFakeVault } from '../helpers/fakeVault'
import { deferred } from '../helpers/deferred'

it.each([0, 1, 2])(
  'keeps a portable summary victim owned through %s scoped recovery views',
  async (depth) => {
    const app = buildFakeVault([])
    const owner = 'sample-summary'
    const root = connectionPrivateRoot(owner)
    const path = root + '/retained-removals/summary.json'
    const before = new TextEncoder().encode('{"sample":1}')
    const after = new TextEncoder().encode('{"sample":2}')
    await app.vault.createFolder(root + '/retained-removals')
    await app.vault.adapter.writeBinary(path, before.buffer, { mtime: 1000 })
    const fs = new ObsidianFileSystem(app as never, { connectionId: owner, journalOwner: owner })
    let view = app as unknown as import('obsidian').App
    for (let i = 0; i < depth; i++)
      view = connectionInspectionApp(view, app.vault.adapter, 'Sample', root)
    const recovery = new ObsidianFileSystem(view as never, {
      connectionId: owner,
      journalOwner: owner,
    })
    const expected = await fs.fingerprint(path)
    const entered = deferred()
    const resume = deferred()
    const retired = deferred()
    const finishRetirement = deferred()
    const read = app.vault.adapter.readBinary.bind(app.vault.adapter)
    const remove = app.vault.adapter.remove.bind(app.vault.adapter)
    let recoveringActive = false
    let recovering: Promise<void> | undefined
    let victimReads = 0
    const calls = vi
      .spyOn(app.vault.adapter, 'readBinary')
      .mockImplementation(async (candidate) => {
        if (candidate.endsWith('/victim') && ++victimReads === 2) {
          // The first read authenticates capture. The second verifies retirement,
          // after the durable complete marker but before this read acknowledges.
          entered.resolve()
          await resume.promise
        }
        if (!(await app.vault.adapter.exists(candidate))) {
          console.debug('[sample missing private read]', candidate)
          throw Object.assign(new Error('Sample file is missing: ' + candidate), { code: 'ENOENT' })
        }
        return read(candidate)
      })
    const removals = vi.spyOn(app.vault.adapter, 'remove').mockImplementation(async (candidate) => {
      await remove(candidate)
      if (recoveringActive && candidate.endsWith('/victim')) {
        // Keep the intent/complete marker available, so a stolen victim is the
        // actual failure rather than a later missing-intent error masking it.
        retired.resolve()
        await finishRetirement.promise
      }
    })
    const writing = fs.conditionalFile({
      path,
      expected,
      effect: { kind: 'write', bytes: after, mtime: 2000 },
    })
    void writing.catch(() => {})
    try {
      await entered.promise
      recoveringActive = true
      recovering = recovery.recoverConditionalFiles()
      void recovering.catch(() => {})
      await Promise.race([recovering, retired.promise])
      recoveringActive = false
      resume.resolve()
      await expect(writing).resolves.toBe(true)
      // Only the writer's capture/retirement checks ran while it held ownership.
      expect(victimReads).toBe(3)
      expect(new Uint8Array(await read(path))).toEqual(after)
      await recovery.recoverConditionalFiles()
      expect((await app.vault.adapter.list(root + '/conditional/active')).files).toEqual([])
    } finally {
      recoveringActive = false
      resume.resolve()
      finishRetirement.resolve()
      await writing.catch(() => {})
      await recovering?.catch(() => {})
      calls.mockRestore()
      removals.mockRestore()
    }
  }
)
