import { expect, it } from 'vitest'
import { adapterPathGate, adapterEngineReceiver, ungatedAdapterMethod } from '@/sync/vaultPathLinks'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { buildFakeVault } from '../helpers/fakeVault'

const bytes = new TextEncoder().encode('saved').buffer
const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

it.each([
  'write',
  'writeBinary',
  'append',
  'appendBinary',
  'process',
  'rename',
  'copy',
  'remove',
  'rmdir',
  'trashSystem',
  'trashLocal',
])('serializes %s with an overlapping checked operation', async (name) => {
  let changed = false
  const adapter: Record<string, (...args: string[]) => Promise<void>> = {
    [name]: async () => {
      changed = true
    },
  }
  const gate = adapterPathGate(adapter)
  let release!: () => void
  const held = gate.run(
    ['folder/file.bin'],
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const pending = adapter[name]('folder', 'other')
  await tick()
  expect(changed).toBe(false)
  release()
  await Promise.all([held, pending])
  expect(changed).toBe(true)
})

it('locks both move paths but lets unrelated saves proceed', async () => {
  const moved: string[] = []
  const adapter = {
    rename: async (_from: string, to: string) => {
      moved.push(to)
    },
    write: async (path: string) => {
      moved.push(path)
    },
  }
  const gate = adapterPathGate(adapter)
  let release!: () => void
  const held = gate.run(
    ['destination/file'],
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
  )
  const pending = adapter.rename('source', 'destination')
  await adapter.write('unrelated')
  expect(moved).toEqual(['unrelated'])
  release()
  await Promise.all([held, pending])
  expect(moved).toEqual(['unrelated', 'destination'])
})

it.each(['before', 'after'] as const)(
  'keeps nested adapter writes live with tracking installed %s the gate',
  async (when) => {
    const app = buildFakeVault([])
    let tracker: ChangeTracker | undefined
    try {
      if (when === 'before') tracker = ChangeTracker.install(app as never)
      const gate = adapterPathGate(app.vault.adapter)
      if (when === 'after') tracker = ChangeTracker.install(app as never)
      await gate.run(['sample.md'], async () => {
        const method = ungatedAdapterMethod(app.vault.adapter.write as never)
        await method.call(adapterEngineReceiver(app.vault.adapter), 'sample.md', 'saved')
      })
      expect(await app.vault.adapter.read('sample.md')).toBe('saved')
      tracker!.uninstall()
      let release!: () => void
      const held = gate.run(
        ['sample.md'],
        () =>
          new Promise<void>((resolve) => {
            release = resolve
          })
      )
      let saved = false
      const pending = app.vault.adapter.writeBinary('sample.md', bytes).then(() => {
        saved = true
      })
      await tick()
      expect(saved).toBe(false)
      release()
      await Promise.all([held, pending])
      expect(saved).toBe(true)
    } finally {
      tracker?.uninstall()
    }
  }
)

it('releases exclusion after a rejected mutation', async () => {
  let fail = true
  const adapter = {
    write: async (_path: string) => {
      if (fail) throw new Error('cancelled')
    },
  }
  adapterPathGate(adapter)
  await expect(adapter.write('sample')).rejects.toThrow('cancelled')
  fail = false
  await adapter.write('sample')
})
