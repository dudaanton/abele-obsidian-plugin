import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const root = 'sample-external-ports-' + randomBytes(16).toString('hex')
let owned = false
let layout: unknown
const prelude = `
  const root=${JSON.stringify(root)},adapter=app.vault.adapter,api=window.__abeleTest
  const encode=s=>new TextEncoder().encode(s),decode=b=>new TextDecoder().decode(b)
  const hash=async b=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b))).map(x=>x.toString(16).padStart(2,'0')).join('')
  const read=async p=>decode(await adapter.readBinary(p))
  const host=new api.ExternalFileHost(app,{
    platform:${JSON.stringify(onPhone() ? 'mobile' : 'desktop')},
    assertOwned:()=>{if(window.__externalPortsOwner!==root)throw Error('Fixture ownership lost')}
  })
  const request=(paths,id='sample-operation')=>({operationId:id,fileId:'sample-file',paths,assertIntent:()=>{if(window.__externalPortsOwner!==root)throw Error('Fixture intent retired')}})
  // A test-only exclusive queue. These are minimal-port checks, not enabled attachment APIs
  // or a claim that server verification/publication and restart recovery are integrated.
  const serial={run:work=>work()}
  const artifact=async(path,data,role='incoming')=>({operationId:'sample-operation',path,sha:await hash(data),size:data.byteLength,role})
  const reason=async work=>{try{await work;return 'completed'}catch(e){return e.reason??e.code??String(e)}}
`

beforeAll(async () => {
  if (!available) return
  layout = evalJson('app.workspace.getLayout()')
  owned = JSON.parse(
    await evalLong(`(async()=>{
    await app.vault.createFolder(${JSON.stringify(root)})
    window.__externalPortsOwner=${JSON.stringify(root)}
    return true
  })()`)
  )
})
afterAll(async () => {
  if (!available) return
  await evalLong(`(async()=>{
    const root=${JSON.stringify(root)}
    const leaves=[];app.workspace.iterateAllLeaves(leaf=>{if(leaf.view.file?.path.startsWith(root+'/'))leaves.push(leaf)})
    for(const leaf of leaves)leaf.detach()
    if(${owned}&&window.__externalPortsOwner===root){
      const folder=app.vault.getAbstractFileByPath(root)
      if(folder)await app.vault.delete(folder,true)
    }
    delete window.__externalPortsOwner
    await app.workspace.changeLayout(${JSON.stringify(layout)})
    return true
  })()`)
})

const probe = async (body: string) =>
  JSON.parse(await evalLong(`(async()=>{${prelude}try{${body}}finally{host.close()}})()`))

describe.skipIf(!available)('external-file production filesystem ports on the live adapter', () => {
  it('refuses preexisting and newly created installation targets, preserving verified staging', async () => {
    const out = await probe(`
      const result=[]
      for(const when of ['before','during']){
        const target=root+'/sample-'+when+'.bin',stage=root+'/.abele-external-'+when+'.incoming',data=encode('sample incoming'),a=await artifact(stage,data)
        if(when==='before')await adapter.writeBinary(target,encode('sample occupant').buffer)
        const exists=adapter.exists.bind(adapter)
        let armed=false,checks=0
        if(when==='during')adapter.exists=async path=>{
          const out=await exists(path)
          if(armed&&path===target&&++checks===1)await adapter.writeBinary(target,encode('sample occupant').buffer)
          return out
        }
        try{
          await host.run(serial,request([target,stage]),async op=>{
            await op.stage(a,data);armed=true
            const refused=await reason(op.install(a,target))
            result.push({when,refused,target:await read(target),staging:await read(stage),checks})
          })
        }finally{adapter.exists=exists}
      }
      return result
    `)
    expect(
      out.map((item: { refused: string; target: string; staging: string }) => ({
        refused: item.refused,
        target: item.target,
        staging: item.staging,
      }))
    ).toEqual([
      { refused: 'collision', target: 'sample occupant', staging: 'sample incoming' },
      { refused: 'collision', target: 'sample occupant', staging: 'sample incoming' },
    ])
  })

  it('installs a free target using the selected primitive, never final-target write or adapter copy', async () => {
    const out = await probe(`
      const target=root+'/sample-free.bin',stage=root+'/.abele-external-free.incoming',data=encode('sample incoming'),a=await artifact(stage,data)
      const write=adapter.writeBinary.bind(adapter),copy=adapter.copy.bind(adapter),rename=adapter.rename.bind(adapter)
      let writes=[],copies=0,renames=0
      adapter.writeBinary=async(path,...args)=>{writes.push(path);return write(path,...args)}
      adapter.copy=async(...args)=>{copies++;throw Error('Copy is not an installer')}
      adapter.rename=async(...args)=>{renames++;return rename(...args)}
      try{
        return await host.run(serial,request([target,stage]),async op=>{
          await op.stage(a,data)
          const result=await op.install(a,target)
          return {result,target:await read(target),stagingPresent:await adapter.exists(stage),writes,copies,renames}
        })
      }finally{adapter.writeBinary=write;adapter.copy=copy;adapter.rename=rename}
    `)
    expect(out.result).toEqual({
      status: 'installed',
      method: onPhone() ? 'adapter-rename' : 'native-link',
      sourceRetained: !onPhone(),
    })
    expect(out.target).toBe('sample incoming')
    expect(out.stagingPresent).toBe(!onPhone())
    expect(out.copies).toBe(0)
    expect(out.renames).toBe(onPhone() ? 1 : 0)
    expect(out.writes).toEqual([root + '/.abele-external-free.incoming'])
  })

  it('refuses an attachment in a nonactive image leaf and invalidates an operation when that leaf opens', async () => {
    const out = await probe(`
      const target=root+'/sample-image.svg',stage=root+'/.abele-external-image.incoming'
      const file=await app.vault.create(target,'<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>')
      const note=await app.vault.create(root+'/sample-active.md','sample active note')
      const image=app.workspace.getLeaf('tab')
      // Obsidian can reuse an empty tab: populate it before requesting the second leaf.
      await image.openFile(file)
      const active=app.workspace.getLeaf('tab')
      try{
        await active.openFile(note);await app.workspace.revealLeaf(active)
        const view=image.view.getViewType(),notActive=app.workspace.activeLeaf!==image
        const before=await reason(host.run(serial,request([target,stage]),async()=>{}))
        image.detach()
        const sha=await hash(await adapter.readBinary(target)),size=(await adapter.stat(target)).size
        let during
        await host.run(serial,request([target,stage]),async op=>{
          const newlyOpen=app.workspace.getLeaf('tab')
          await newlyOpen.openFile(file)
          // Opening invalidates, not merely postpones, permission for this operation.
          newlyOpen.detach()
          during=await reason(op.deleteOriginal({path:target,sha,size}))
        })
        return {before,during,view,notActive,preserved:await adapter.exists(target)}
      }finally{image.detach();active.detach()}
    `)
    expect(out.view).toBe('image')
    expect(out.notActive).toBe(true)
    expect(out.before).toBe('busy')
    expect(out.during).toBe('busy')
    expect(out.preserved).toBe(true)
  })

  it('guards sync apply/rename/delete and keeps mismatching original bytes', async () => {
    const out = await probe(`
      const target=root+'/sample-reserved.bin',stage=root+'/.abele-external-reserved.incoming',data=encode('sample base'),a=await artifact(stage,data)
      await adapter.writeBinary(target,data.buffer)
      const fs=new api.ObsidianFileSystem(app),lease=host.acquireUse('sample-file')
      const leased=await reason(host.run(serial,request([target,stage]),async()=>{}));lease.release()
      return await host.run(serial,request([target,stage]),async op=>{
        const apply=await reason(fs.writeAtomic(target,encode('sample remote'),1000))
        const rename=await reason(fs.move(target,root+'/sample-moved.bin'))
        const remove=await reason(fs.remove(target))
        await adapter.writeBinary(target,encode('sample edit').buffer)
        const changed=await reason(op.deleteOriginal({path:target,sha:a.sha,size:a.size}))
        return {leased,apply,rename,remove,changed,original:await read(target)}
      })
    `)
    expect(out).toEqual({
      leased: 'busy',
      apply: 'busy',
      rename: 'busy',
      remove: 'busy',
      changed: 'local-changed',
      original: 'sample edit',
    })
  })

  it('removes only an unchanged selected original and keeps ambiguous installation evidence', async () => {
    const out = await probe(`
      const target=root+'/sample-delete.bin',stage=root+'/.abele-external-delete.incoming',data=encode('sample base'),a=await artifact(stage,data)
      await adapter.writeBinary(target,data.buffer)
      const deleted=await host.run(serial,request([target,stage]),op=>op.deleteOriginal({path:target,sha:a.sha,size:a.size}))
      const installTarget=root+'/sample-uncertain.bin',incoming=root+'/.abele-external-uncertain.incoming',b=await artifact(incoming,data)
      const raw=${onPhone() ? 'adapter' : 'adapter.fsPromises'},method=${JSON.stringify(onPhone() ? 'rename' : 'link')},real=raw[method].bind(raw)
      raw[method]=async(...args)=>{await real(...args);throw Error('Sample lost acknowledgement')}
      try{
        const result=await host.run(serial,request([installTarget,incoming]),async op=>{
          await op.stage(b,data)
          const outcome=await op.install(b,installTarget)
          const retry=await reason(op.install(b,installTarget))
          return {outcome,retry}
        })
        return {deleted,originalPresent:await adapter.exists(target),result,installed:await read(installTarget)}
      }finally{raw[method]=real}
    `)
    expect(out.deleted).toEqual({ status: 'deleted', reclaimedBytes: 11 })
    expect(out.originalPresent).toBe(false)
    expect(out.result.outcome.status).toBe('outcome-unknown')
    expect(out.result.outcome.artifacts).toHaveLength(1)
    expect(out.result.retry).toBe('recovery-required')
    expect(out.installed).toBe('sample base')
  })
})
