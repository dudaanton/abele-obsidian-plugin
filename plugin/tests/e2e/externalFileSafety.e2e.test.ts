import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'
import { moveAndRetain, probeAdapter } from '../integration/externalFileSafetyProbe'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const ROOT = `sample-external-fs-${randomBytes(16).toString('hex')}`
const prelude = `
  const root=${JSON.stringify(ROOT)}, adapter=app.vault.adapter
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  const read=async path=>await adapter.exists(path)?await adapter.read(path):null
`
let layout: unknown
let owned = false

beforeAll(async () => {
  if (!available) return
  layout = evalJson('app.workspace.getLayout()')
  owned = JSON.parse(
    await evalLong(`(async()=>{
    await app.vault.createFolder(${JSON.stringify(ROOT)})
    window.__externalFsProbeOwner=${JSON.stringify(ROOT)}
    return true
  })()`)
  )
})

afterAll(async () => {
  if (!available) return
  await evalLong(`(async()=>{
    ${prelude}
    for(const leaf of app.workspace.getLeavesOfType('markdown'))
      if(leaf.view.file?.path.startsWith(root+'/'))leaf.detach()
    if(${owned}||window.__externalFsProbeOwner===root){
      const folder=app.vault.getAbstractFileByPath(root)
      if(folder)await app.vault.delete(folder,true)
    }
    delete window.__externalFsProbeOwner
    await app.workspace.changeLayout(${JSON.stringify(layout)})
    return true
  })()`)
})

describe.skipIf(!available)('external-file filesystem guarantees on the live adapter', () => {
  it('demonstrates hash/delete losses and a reversible move without claiming safe cleanup', async () => {
    const out = JSON.parse(
      await evalLong(`(async()=>{
      ${prelude}
      const moveAndRetain=${moveAndRetain.toString()}
      return await (${probeAdapter.toString()})(adapter,root,moveAndRetain)
    })()`)
    )
    console.info('Portable adapter evidence', JSON.stringify(out))
    expect(out.hashRemove).toEqual({ checked: true, editLost: true })
    expect(out.cleanupRace).toEqual({ checked: true, editLost: true })
    expect(out.moveRace).toEqual({ state: 'local-changed', retained: true, sourceOccupied: false })
    expect(out.checkWrite).toEqual({ sawAbsent: true, occupantOverwritten: true })
    expect(out.renameOccupied).toEqual({
      refused: true,
      source: 'sample incoming',
      target: 'sample occupant',
    })
    expect(out.copy).toEqual({
      supported: true,
      refused: true,
      source: 'sample incoming',
      target: 'sample occupant',
      freeTarget: 'sample incoming',
    })
  })

  it('records the available queue, exclusive-install, handle and durability surfaces', async () => {
    const out = evalJson(`(()=>{
      ${prelude}
      const fsp=adapter.fsPromises
      return {
        adapter:adapter.constructor.name,
        queue:typeof adapter.queue==='function',
        nativeRename:typeof fsp?.rename==='function',
        exclusiveLink:typeof fsp?.link==='function',
        nativeOpen:typeof fsp?.open==='function',
        publicOpen:typeof adapter.open==='function',
        publicFsync:typeof adapter.fsync==='function'||typeof adapter.sync==='function',
        fullPath:typeof adapter.getFullPath==='function',
        process:typeof adapter.process==='function'
      }
    })()`)
    console.info('Adapter capabilities', JSON.stringify(out))
    expect(out.publicOpen).toBe(false)
    expect(out.publicFsync).toBe(false)
    expect(out.process).toBe(true)
    expect(out.nativeOpen).toBe(!onPhone())
    expect(out.exclusiveLink).toBe(!onPhone())
  })

  it.skipIf(onPhone())(
    'exercises real open handles, exclusive links and native atomic replacement',
    async () => {
      const out = JSON.parse(
        await evalLong(`(async()=>{
      ${prelude}
      const fsp=adapter.fsPromises, full=path=>adapter.getFullPath(path)
      const original=root+'/sample-handle.bin',backup=root+'/sample-handle-backup.bin'
      await adapter.write(original,'sample base')
      const handle=await fsp.open(full(original),'r+')
      let movedEdit,cleanupChecked,afterUnlink,handleSync
      try {
        await adapter.rename(original,backup)
        await handle.write(new TextEncoder().encode('sample edit'),0,11,0)
        movedEdit=await read(backup)
        const expected=await crypto.subtle.digest('SHA-256',await adapter.readBinary(backup))
        const current=await crypto.subtle.digest('SHA-256',await adapter.readBinary(backup))
        cleanupChecked=new Uint8Array(expected).every((b,i)=>b===new Uint8Array(current)[i])
        // A still-open descriptor is not protected by Obsidian's local-save queue.
        await handle.write(new TextEncoder().encode('sample late'),0,11,0)
        await handle.sync()
        handleSync=true
        await adapter.remove(backup)
        afterUnlink=(await handle.readFile({encoding:'utf8'}))
      } finally { await handle.close() }

      const incoming=root+'/sample-exclusive-source.bin',target=root+'/sample-exclusive-target.bin'
      await adapter.write(incoming,'sample incoming')
      await adapter.write(target,'sample occupant')
      const busyHandle=await fsp.open(full(target),'r+')
      let linkRefused,renameOverwrote,oldHandle
      try {
        try { await fsp.link(full(incoming),full(target)); linkRefused=false }
        catch(error) { linkRefused=error.code==='EEXIST' }
        await fsp.rename(full(incoming),full(target))
        renameOverwrote=await read(target)
        oldHandle=await busyHandle.readFile({encoding:'utf8'})
      } finally { await busyHandle.close() }
      await fsp.link(full(target),full(incoming))
      const a=await fsp.stat(full(target)),b=await fsp.stat(full(incoming))
      const exclusiveAlias=a.ino===b.ino&&a.dev===b.dev
      // Atomic replacement visibility to an already-open reader: old inode vs new name.
      const dirHandle=await fsp.open(full(root),'r')
      let directorySync
      try { await dirHandle.sync(); directorySync=true }
      catch { directorySync=false }
      finally { await dirHandle.close() }
      return {movedEdit,cleanupChecked,afterUnlink,handleSync,backupExists:await adapter.exists(backup),linkRefused,renameOverwrote,oldHandle,exclusiveAlias,directorySync}
    })()`)
      )
      console.info('Native handle/install evidence', JSON.stringify(out))
      expect(out.movedEdit).toBe('sample edit')
      expect(out.cleanupChecked).toBe(true)
      expect(out.afterUnlink).toBe('sample late')
      expect(out.backupExists).toBe(false)
      expect(out.linkRefused).toBe(true)
      expect(out.renameOverwrote).toBe('sample incoming')
      expect(out.oldHandle).toBe('sample occupant')
      expect(out.exclusiveAlias).toBe(true)
      expect(out.handleSync).toBe(true)
      expect(out.directorySync).toBe(true)
    }
  )

  it('records an open editor following a move and does not mistake it for a writer lock', async () => {
    const out = JSON.parse(
      await evalLong(`(async()=>{
      ${prelude}
      const original=root+'/sample-open.md',moved=root+'/sample-open-moved.md'
      const file=await app.vault.create(original,'sample editor base')
      const leaf=app.workspace.getLeaf('tab')
      await leaf.openFile(file)
      await app.workspace.revealLeaf(leaf)
      await wait(300)
      const openBefore={type:leaf.view.getViewType(),path:leaf.view.file?.path,editor:!!leaf.view.editor}
      await adapter.write(root+'/sample-editor-incoming.md','sample incoming')
      let occupiedRefused=false
      try { await adapter.rename(root+'/sample-editor-incoming.md',original) }
      catch { occupiedRefused=true }
      await adapter.rename(original,moved)
      for(let i=0;i<30&&!app.vault.getAbstractFileByPath(moved);i++)await wait(100)
      await wait(300)
      const openAfter={type:leaf.view.getViewType(),path:leaf.view.file?.path??null,editor:!!leaf.view.editor}
      if(leaf.view.editor){
        leaf.view.editor.setValue('sample editor edit')
        if(typeof leaf.view.save==='function')await leaf.view.save()
      }
      await wait(1500)
      const report={openBefore,openAfter,occupiedRefused,original:await read(original),moved:await read(moved)}
      leaf.detach()
      return report
    })()`)
    )
    console.info('Open editor evidence', JSON.stringify(out))
    expect(out.openBefore.editor).toBe(true)
    expect(out.occupiedRefused).toBe(true)
    // Busy-source rename is allowed. A live view/use lease is an engine responsibility.
    expect(out.openAfter.editor).toBe(true)
    expect([out.original, out.moved]).toContain('sample editor edit')
  })
})
