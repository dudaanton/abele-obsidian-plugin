import { describe, expect, it } from 'vitest'
import { vaultCli } from './helpers/obsidianCli'

/** Native app write queue, not a synthetic timeout-based conflict detector. */
describe('native local-save replacement boundary', () => {
  it('preserves native saves during the awaited provenance hold and before filesystem entry', () => {
    const name = process.env.OBSIDIAN_TEST_VAULT
    if (!name) throw new Error('Native replacement gate requires an exclusively leased vault')
    const result = vaultCli(name).evalAwait<any>(String.raw`(async()=>{
      const root='ReplacementBaseProbe-'+require('crypto').randomBytes(16).toString('hex'),path=root+'/sample.md',encode=s=>new TextEncoder().encode(s)
      let owned=false
      try{
        await app.vault.createFolder(root);owned=true
        const file=await app.vault.create(path,'authorized original')
        const fs=new window.__abeleTest.ObsidianFileSystem(app,{beforeEngineMutation:async()=>{await app.vault.modify(file,'native save during hold')}})
        await fs.read(path)
        let during=false
        try{await fs.writeAtomic(path,encode('remote'),Date.now())}catch(e){during=e.code==='conflict'}
        const duringBytes=await app.vault.read(file)
        await app.vault.modify(file,'second authorized original')
        const second=new window.__abeleTest.ObsidianFileSystem(app)
        await second.read(path)
        await app.vault.modify(file,'native save before entry')
        let before=false
        try{await second.writeAtomic(path,encode('second remote'),Date.now())}catch(e){before=e.code==='conflict'}
        return{during,duringBytes,before,beforeBytes:await app.vault.read(file)}
      }finally{if(owned){const folder=app.vault.getAbstractFileByPath(root);if(folder)await app.vault.delete(folder,true)}}
    })()`)
    expect(result).toEqual({
      during: true,
      duringBytes: 'native save during hold',
      before: true,
      beforeBytes: 'native save before entry',
    })
  })
  it('holds a changed queued source and retains a save queued at the native rename', () => {
    const name = process.env.OBSIDIAN_TEST_VAULT
    if (!name) throw new Error('Native replacement gate requires an exclusively leased vault')
    const result = vaultCli(name).evalAwait<any>(String.raw`(async () => {
      const root = 'ReplacementProbe-' + require('crypto').randomBytes(16).toString('hex')
      const path = root + '/sample.md', adapter = app.vault.adapter
      const original = adapter.fsPromises
      let owned = false
      try {
        await app.vault.createFolder(root); owned = true
        let resolveCache
        const cached = new Promise(resolve => { resolveCache = resolve })
        const ref = app.metadataCache.on('changed', (file, data) => { if (file.path === path && data === 'original') resolveCache() })
        let file
        try { file = await app.vault.create(path, 'original'); await cached }
        finally { app.metadataCache.offref(ref) }
        const full = adapter.getFullPath(path)
        let reads = 0
        adapter.fsPromises = { ...original, readFile: async function(target, ...args) {
          // Initial snapshot and temp-write check precede the fenced final native read.
          if (target === full && ++reads === 3) await original.writeFile(full, 'local-before-queued-compare')
          return original.readFile(target, ...args)
        } }
        const fs = new window.__abeleTest.ObsidianFileSystem(app)
        let held = false
        try { await fs.writeAtomic(path, new TextEncoder().encode('remote'), Date.now()) }
        catch (error) { held = error.code === 'conflict' }
        const before = String(await original.readFile(full, 'utf8'))
        adapter.fsPromises = original
        await app.vault.modify(file, 'original again')
        let save = null
        adapter.fsPromises = { ...original, rename: async function(from, to) {
          if (to === full) save = app.vault.modify(file, 'local-save-at-rename')
          return original.rename(from, to)
        } }
        const queued = new window.__abeleTest.ObsidianFileSystem(app)
        await queued.writeAtomic(path, new TextEncoder().encode('second remote'), Date.now())
        await save
        const after = String(await original.readFile(full, 'utf8'))
        return { held, before, after, saveQueued: !!save }
      } finally {
        adapter.fsPromises = original
        if (owned) { const folder = app.vault.getAbstractFileByPath(root); if (folder) await app.vault.delete(folder, true) }
      }
    })()`)
    console.info(JSON.stringify(result))
    expect(result).toEqual({
      held: true,
      before: 'local-before-queued-compare',
      after: 'local-save-at-rename',
      saveQueued: true,
    })
  })
})
