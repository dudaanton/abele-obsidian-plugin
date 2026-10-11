import { expect, it, vi } from 'vitest'
import { MOVE_DIAGNOSTICS } from '../e2e/helpers/moveDiagnostics'

it('captures the real hold inputs and reports without changing port behavior', async () => {
  const stat = { size: 6, mtime: 1000 },
    ledger = { sha: 'sample-digest' },
    failure = new Error('sample fingerprint refused'),
    fs = {
      stat: vi.fn(async () => stat),
      fingerprint: vi.fn(async () => {
        throw failure
      }),
    },
    onSync = vi.fn(),
    log = vi.fn(),
    opts = { fs, onSync, state: { get: async () => ledger, getMeta: async () => null } },
    context = { log },
    runtime = {
      engine: {
        opts,
        watch: {
          ctx: { fs },
          noticed: new Set(['sample/from.md']),
          reported: new Set(['sample/from.md']),
        },
        cycle: { ctx: context, kept: new Set(), unsettled: new Set() },
      },
    },
    app = {
      vault: {
        adapter: { exists: async () => true, stat: async () => stat },
        getFileByPath: () => ({ stat }),
      },
    },
    install = new Function('app', MOVE_DIAGNOSTICS + ';return installMoveDiagnostics')(app),
    probe = install(runtime, 'sample')
  expect(await opts.fs.stat('sample/from.md')).toBe(stat)
  await expect(opts.fs.fingerprint('sample/from.md')).rejects.toBe(failure)
  const report = { held: ['sample/to.md'] }
  opts.onSync(report)
  context.log('pull: holding move')
  const snapshot = await probe.snapshot(['sample/from.md'])
  expect(snapshot.lastReport).toBe(report)
  expect(snapshot.files[0]).toMatchObject({ exists: true, ledger, error: failure.message })
  expect(snapshot.calls).toContainEqual(
    expect.objectContaining({ method: 'fingerprint', error: failure.message })
  )
  expect(snapshot.calls).toContainEqual(
    expect.objectContaining({ hold: 'pull: holding move', reported: ['sample/from.md'] })
  )
  expect(onSync).toHaveBeenCalledWith(report)
  expect(log).toHaveBeenCalledWith('pull: holding move')
  probe.close()
  expect(opts.fs).toBe(fs)
  expect(opts.onSync).toBe(onSync)
  expect(context.log).toBe(log)
  expect(runtime.engine.watch.ctx.fs).toBe(fs)
})

it('lists hidden directory entries through the adapter and native filesystem', async () => {
  const fs = { stat: async () => null },
    runtime = {
      engine: {
        opts: { fs, state: { get: async () => null } },
        watch: { ctx: { fs }, noticed: new Set(), reported: new Set() },
        cycle: { ctx: { log: () => {} }, kept: new Set(), unsettled: new Set() },
      },
    },
    app = {
      vault: {
        adapter: {
          exists: async () => true,
          stat: async () => ({ type: 'folder' }),
          list: async () => ({ files: ['sample/.hidden.tmp'], folders: [] }),
          getFullPath: (path: string) => '/sample-vault/' + path,
          fsPromises: { readdir: vi.fn(async () => ['.hidden.tmp']) },
        },
        getFileByPath: () => null,
      },
    },
    install = new Function('app', MOVE_DIAGNOSTICS + ';return installMoveDiagnostics')(app),
    probe = install(runtime, 'sample')
  try {
    const snapshot = await probe.snapshot(['sample'])
    expect(snapshot.files[0].entries).toEqual({ files: ['sample/.hidden.tmp'], folders: [] })
    expect(snapshot.files[0].nativeEntries).toEqual(['.hidden.tmp'])
    expect(app.vault.adapter.fsPromises.readdir).toHaveBeenCalledWith('/sample-vault/sample')
  } finally {
    probe.close()
  }
})
