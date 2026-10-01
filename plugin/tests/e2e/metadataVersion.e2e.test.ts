import { describe, expect, it } from 'vitest'
import { vaultCli } from './helpers/obsidianCli'
import { waitFor } from './helpers/syncVault'
import { metadataVersionProbe } from './helpers/metadataVersionProbe'
import { assertVersionEvidence } from './helpers/metadataVersionAssertions'
import { withProbeFolder } from './helpers/probeFolder'

/** Feasibility gate: unavailable native evidence is a failure, never a skipped success. */
describe('desktop exact-version metadata feasibility', () => {
  it('binds parsed bytes rather than the latest cache and observes native paste ordering', () => {
    const vault = process.env.OBSIDIAN_TEST_VAULT
    if (!vault) throw new Error('OBSIDIAN_TEST_VAULT must name an exclusively leased pool vault')
    const result = vaultCli(vault).evalAwait<any>(metadataVersionProbe)
    console.info(JSON.stringify(result, null, 2))
    expect(result.pendingWasUnknown).toBe(true)
    expect(result.currentFileAdvancedDuringParse).toBe(true)
    expect(result.currentCacheIsNotOldVersion).toBe(true)
    expect(result.immutableAfterRename).toBe(true)
    for (const version of ['remote', 'applied', 'local', 'merged', 'pasted']) {
      expect(result.versions[version].evidence.sha).toBe(result.versions[version].sha)
      expect(result.versions[version].evidence.cacheHash).toMatch(/^[0-9a-f]{64}$/)
    }
    assertVersionEvidence(result)
    expect(result.versions.pasteBufferMatches).toBe(true)
    expect(result.pasteOrder[0].kind).toBe('create')
    expect(result.pasteOrder.some((event: any) => event.kind === 'note-save')).toBe(true)
  })

  it('retains a durable baseline across a window restart without inventing missed cache evidence', async () => {
    const vault = process.env.OBSIDIAN_TEST_VAULT
    if (!vault) throw new Error('OBSIDIAN_TEST_VAULT must name an exclusively leased pool vault')
    const cli = vaultCli(vault)
    await withProbeFolder(cli, 'CacheRestartProbe', async (root) => {
      const before = cli.evalAwait<any>(`(async () => {
        const v = app.vault, m = app.metadataCache, crypto = require('crypto')
        const sha = text => crypto.createHash('sha256').update(text).digest('hex')
        const text = 'Synced baseline\\n[[baseline-missing]]\\n'
        let resolve
        const captured = new Promise(r => { resolve = r })
        const ref = m.on('changed', (file, data, cache) => {
          if (file.path === '${root}/sample.md' && sha(data) === sha(text)) {
            resolve({ fileId: 'restart-file', versionId: 'settled-version', source: text, data, sha: sha(data), cache: JSON.parse(JSON.stringify(cache)) })
          }
        })
        try {
          const file = await v.create('${root}/sample.md', text)
          const baseline = await captured
          await v.adapter.write('${root}/baseline.json', JSON.stringify(baseline))
          m.offref(ref)
          // Listener suspension loses an intermediate generation. It must remain unknown.
          await v.modify(file, 'Missed intermediate\\n[[missed-link]]\\n')
          await v.modify(file, 'Advanced local bytes\\n[[latest-link]]\\n')
          return baseline
        } finally { m.offref(ref) }
      })()`)
      cli.evalRaw(`require('@electron/remote').getCurrentWindow().reload()`)
      await waitFor(
        'the leased window to reload',
        () => {
          try {
            return cli.evalAwait<boolean>('!!app.metadataCache.initialized && !!window.__abeleTest')
          } catch {
            return false
          }
        },
        30_000
      )
      const after = cli.evalAwait<any>(`(async () => {
        const v = app.vault, sha = text => require('crypto').createHash('sha256').update(text).digest('hex')
        const baseline = JSON.parse(await v.adapter.read('${root}/baseline.json'))
        const file = v.getAbstractFileByPath('${root}/sample.md')
        const data = await v.read(file)
        return { baseline, currentData: data, currentSha: sha(data), cache: app.metadataCache.getFileCache(file) }
      })()`)
      console.info(JSON.stringify({ restart: after }, null, 2))
      expect(after.baseline).toEqual(before)
      expect(after.currentSha).not.toBe(before.sha)
      expect(after.currentData).toBe('Advanced local bytes\n[[latest-link]]\n')
      expect(before.data).toBe(before.source)
      expect(
        after.cache.links.map((link: any) => ({ spelling: link.link, original: link.original }))
      ).toEqual([{ spelling: 'latest-link', original: '[[latest-link]]' }])
      expect(
        after.baseline.cache.links.map((link: any) => ({
          spelling: link.link,
          original: link.original,
        }))
      ).toEqual([{ spelling: 'baseline-missing', original: '[[baseline-missing]]' }])
      expect(after.cache.embeds ?? []).toEqual([])
      expect(after.baseline.cache.embeds ?? []).toEqual([])
      for (const [cache, data] of [
        [before.cache, before.data],
        [after.cache, after.currentData],
      ]) {
        for (const link of cache.links)
          expect(data.slice(link.position.start.offset, link.position.end.offset)).toBe(
            link.original
          )
      }
    })
  })
})
