// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import asyncHooks from 'node:async_hooks'
import { setupVault } from '../scale/run.mjs'
const require = createRequire(import.meta.url)

it('loads the installed ledger with its transitive host helper and records an async lifecycle', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sample-vault-deploy-'))
  try {
    const buildDir = join(root, 'build'), output = join(root, 'evidence'), vault = join(root, 'vault')
    await mkdir(buildDir); await mkdir(output)
    await writeFile(join(buildDir, 'main.js'), 'function durableHostOf() {}\nfunction storageOf() {}\nclass BoundedVaultIo {}\nmarkLoad("evalEnd");\n')
    await writeFile(join(buildDir, 'manifest.json'), JSON.stringify({ id: 'abele' }))
    await writeFile(join(buildDir, 'main.css'), '')
    await setupVault({ buildDir, output, continuousCpu: true, contentPrefix: 'Sample' }, vault, '0')
    const deployment = JSON.parse(await readFile(join(output, 'observer-deployment-0.json'), 'utf8'))
    expect(deployment).toMatchObject({ complete: true, device: '0' })
    expect(deployment.kinds).toEqual(expect.arrayContaining(['plugin:onload', 'async continuation']))
    const config = JSON.parse(await readFile(join(vault, '.scale-observer.json'), 'utf8'))
    const api = require(config.entryLedger)
    const rows: any[] = []
    const ledger = api.createEntryLedger({ device: '0', requireProductBridge: true,
      write: (text: string) => rows.push(...text.trim().split('\n').flatMap(line => api.decodeEntryBatch(JSON.parse(line)))) })
    const close = api.installEntryLedger({ ledger, target: {}, asyncHooks })
    class Sample {
      async onload() { await Promise.resolve(); expect(ledger.active()).toBe(true) }
    }
    try {
      const Product = api.wrapProductExport(Sample, ledger)
      await new Product().onload()
    } finally { await close() }
    expect(rows.filter(row => row.event === 'plugin-entry-start').map(row => row.kind))
      .toEqual(expect.arrayContaining(['plugin:onload', 'async continuation']))
    expect(rows.findLast(row => row.event === 'plugin-entry-ledger-checkpoint'))
      .toMatchObject({ complete: true, dropped: 0 })
  } finally { await rm(root, { recursive: true, force: true }) }
})
