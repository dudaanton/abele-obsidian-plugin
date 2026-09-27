/**
 * The first time this device's own `data.json` meets the server's, the server's wins.
 *
 * A device that has never synced the file — a fresh install, a device set up by a settings
 * transfer, one upgraded from a build that kept the file to itself — still has one, written at
 * its first launch. Sent as it is, it is a create against the vault's head, and the server gives
 * a create against a head to the newer mtime: the newcomer's defaults would replace everyone's
 * settings. So until the ledger holds the file, the engine is told it is as old as a file can
 * be: the server keeps its head, files this device's copy in the head's history, and the pull
 * writes the head here.
 */
import { describe, it, expect } from 'vitest'
import type { App } from 'obsidian'
import type { FileInfo, StateEntry } from '@abele/sync-core'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { OwnSettingsWatch } from '@/sync/ownSettings'
import { buildFakeVault } from '../helpers/fakeVault'

const DATA = '.obsidian/plugins/abele/data.json'

const VAULT = [
  { path: 'Note.md', content: 'first', mtime: 1000, ctime: 900 },
  { path: '.obsidian/app.json', content: '{"a":1}', mtime: 3000, ctime: 900 },
  { path: DATA, content: '{"b":2}', mtime: 4000, ctime: 900 },
]

/** A ledger holding entries for the paths given. */
function ledger(paths: string[]): { get(path: string): Promise<StateEntry | null> } {
  return {
    get: async (path) =>
      paths.includes(path) ? ({ path, wirePath: path } as unknown as StateEntry) : null,
  }
}

function build(held: string[] | null): ObsidianFileSystem {
  const app = buildFakeVault(VAULT)
  const watch = new OwnSettingsWatch(DATA, () => undefined)
  if (held !== null) watch.useLedger(ledger(held))
  return new ObsidianFileSystem(app as unknown as App, {
    yieldsToServer: (path) => watch.yields(path),
  })
}

async function listed(fs: ObsidianFileSystem): Promise<FileInfo[]> {
  const out: FileInfo[] = []
  for await (const info of fs.list()) out.push(info)
  return out
}

describe("this device's own settings file before the ledger holds it", () => {
  it('is listed and statted as the oldest file there is', async () => {
    const fs = build([])

    expect((await listed(fs)).find((info) => info.path === DATA)?.mtime).toBe(0)
    expect((await fs.stat(DATA))?.mtime).toBe(0)
  })

  it('is statted with its own mtime once it changed since it was listed, even at the same size', async () => {
    const app = buildFakeVault(VAULT)
    const watch = new OwnSettingsWatch(DATA, () => undefined)
    watch.useLedger(ledger([]))
    const fs = new ObsidianFileSystem(app as unknown as App, {
      yieldsToServer: (path) => watch.yields(path),
    })
    await listed(fs)
    expect((await fs.stat(DATA))?.mtime).toBe(0)

    // Saved again while a create listed as the oldest file is on its way: same size, new mtime.
    const bytes = new TextEncoder().encode('{"b":3}')
    await app.vault.adapter.writeBinary(DATA, bytes.buffer as ArrayBuffer, { mtime: 5000 })

    expect((await fs.stat(DATA))?.mtime).toBe(5000)
    // The next listing is a new scan: it yields again, and so does the stat after it.
    expect((await listed(fs)).find((info) => info.path === DATA)?.mtime).toBe(0)
    expect((await fs.stat(DATA))?.mtime).toBe(0)
  })

  it('leaves every other file as it is', async () => {
    const fs = build([])
    const infos = await listed(fs)

    expect(infos.find((info) => info.path === '.obsidian/app.json')?.mtime).toBe(3000)
    expect(infos.find((info) => info.path === 'Note.md')?.mtime).toBe(1000)
  })

  it('has its own mtime again once the ledger holds it', async () => {
    const fs = build([DATA])

    expect((await listed(fs)).find((info) => info.path === DATA)?.mtime).toBe(4000)
    expect((await fs.stat(DATA))?.mtime).toBe(4000)
  })

  it('has its own mtime while there is no ledger to ask', async () => {
    const fs = build(null)

    expect((await fs.stat(DATA))?.mtime).toBe(4000)
  })

  it('has its own mtime when the ledger will not answer', async () => {
    const app = buildFakeVault(VAULT)
    const watch = new OwnSettingsWatch(DATA, () => undefined)
    watch.useLedger({
      get: async () => {
        throw new Error('the database closed')
      },
    })
    const fs = new ObsidianFileSystem(app as unknown as App, {
      yieldsToServer: (path) => watch.yields(path),
    })

    expect((await fs.stat(DATA))?.mtime).toBe(4000)
  })
})
