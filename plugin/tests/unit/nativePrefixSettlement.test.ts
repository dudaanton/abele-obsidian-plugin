// @vitest-environment node
import { desktopFsPort } from '../helpers/desktopRequire'
import { promises as disk } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import type { DataAdapter } from 'obsidian'
import { guardedVaultAdapter } from '@/sync/vaultPathLinks'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { ExchangeTrace } from '@/sync/exchangeTrace'
import { deferred } from '../helpers/deferred'

it('traces a held host lstat through real guarded prefix validation and observes late completion after disconnect', async () => {
  const root = await disk.realpath(await disk.mkdtemp(join(tmpdir(), 'sample-prefix-')))
  const entered = deferred()
  const release = deferred()
  const controller = new AbortController()
  const target = join(root, '.config/settings.json')
  let held = false
  const port = new Proxy(disk, {
    get(host, key) {
      if (key !== 'lstat') return Reflect.get(host, key)
      return async (...args: Parameters<typeof disk.lstat>) => {
        if (args[0] === target && !held) {
          held = true
          entered.resolve()
          await release.promise
        }
        return disk.lstat(...args)
      }
    },
  })
  desktopFsPort(port)
  await disk.mkdir(join(root, '.config'))
  await disk.writeFile(target, '{}')
  const fs = Object.create(ObsidianFileSystem.prototype) as ObsidianFileSystem
  Object.defineProperty(fs, 'disk', {
    value: guardedVaultAdapter({
      fsPromises: port,
      getFullPath: (path: string) => join(root, path),
    } as unknown as DataAdapter),
  })
  Reflect.get(fs, Symbol.for('abele.sync.index-wait-signal-v1')).call(fs, controller.signal)
  const reading = fs.readPrefix('.config/settings.json', 16)
  const rejected = expect(reading).rejects.toThrow('sample disconnect')
  const snapshot = () => Reflect.get(new ExchangeTrace().snapshot(), 'nativeLstat')
  try {
    await entered.promise
    expect(Reflect.get(fs, Symbol.for('abele.sync.prefix-read-wait-v1')).call(fs)).toMatchObject({
      step: 'native open',
    })
    expect(snapshot().pending).toContainEqual(
      expect.objectContaining({
        path: target,
        source: 'host-fs.promises',
        site: 'path-validation',
        returnedAt: expect.any(Number),
        settledAt: null,
      })
    )
    controller.abort(new Error('sample disconnect'))
    await rejected
    // Disconnect cancels the consumer, not the host's outstanding read-only request.
    expect(snapshot().pending).toHaveLength(1)
  } finally {
    controller.abort(new Error('sample disconnect'))
    release.resolve()
    await rejected
    // Drain the owned continuation (including the handle acquired after cancellation).
    for (
      let n = 0;
      n < 100 && Reflect.get(fs, Symbol.for('abele.sync.prefix-read-wait-v1')).call(fs);
      n++
    )
      await new Promise((resolve) => setTimeout(resolve, 1))
    await disk.rm(root, { recursive: true, force: true })
  }
  expect(Reflect.get(fs, Symbol.for('abele.sync.prefix-read-wait-v1')).call(fs)).toBeUndefined()
  expect(snapshot().pending).toEqual([])
  expect(snapshot().recent).toContainEqual(
    expect.objectContaining({ path: target, outcome: 'fulfilled' })
  )
})
