import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalJson, evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const root = 'sample-external-representation-' + randomBytes(16).toString('hex')
let layout: unknown
const prelude = `
  const root=${JSON.stringify(root)}, adapter=app.vault.adapter, api=window.__abeleTest
  const ports=api.externalRepresentation, persistence=api.externalState
  const encode=value=>new TextEncoder().encode(value), decode=value=>new TextDecoder().decode(value)
  const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('')
  // This suite exercises real IndexedDB and filesystem ports. Server proofs are a synthetic
  // port here; the separate server-backed integration suite tests actual HTTP verification.
  async function fixture(label,scopedMode=false){
    const folder=root+'/'+label;await app.vault.createFolder(folder)
    const database='sample-representation-'+crypto.randomUUID(),ledgerId='sample-ledger'
    const store=await persistence.IndexedDbStateStore.open(indexedDB,database)
    const binding={endpoint:'https://sync.example.invalid',vaultId:'sample-vault',mode:scopedMode?'scoped':'personal',principalId:scopedMode?'sample-principal':'sample-device',principalType:scopedMode?'installation':'device',grantId:scopedMode?'sample-grant':null,generation:1,credentialAssociation:'sample-slot'}
    const path=folder+'/sample.bin',bytes=encode('sample base'),sha=await digest(bytes)
    const base={fileId:'sample-file',versionId:'sample-v1',path,sha,size:bytes.byteLength,mtime:1000}
    const scoped=scopedMode?await ports.ScopedState.open(store,{version:4,facet:'scoped',endpoint_identity:binding.endpoint,vault_id:binding.vaultId,grant_id:binding.grantId,principal_kind:'installation',principal_id:binding.principalId,credential_fingerprint:'c'.repeat(64)},{initialize:true}):null
    await store.put({...base,wirePath:path})
    if(scoped)await scoped.putKnown({file_id:base.fileId,version_id:base.versionId,path,sha,size:base.size,mtime:base.mtime,state:'materialized',dirty:false,native:true})
    const state=await persistence.ExternalState.open(store,ledgerId,binding)
    const projection=encode(JSON.stringify({format:'abele.external',schema:1,vaultId:binding.vaultId,fileId:base.fileId,path,observedVersionId:base.versionId,sha256:sha,size:base.size,mime:'application/octet-stream',mtime:base.mtime})+'\\n')
    const sidecar=path+'.abele-ref'
    await adapter.writeBinary(sidecar,projection.buffer)
    await state.commit({expectedRevision:0,files:[{expectedRevision:null,next:{schema:1,ledgerId,binding,fileId:base.fileId,representation:'remote-only',preference:'on-demand',pinned:false,projectionPath:sidecar,projectionSha:await digest(projection),localRevision:0,pendingOperationId:null,availability:'active',blockingReason:null,lastProvenLocalBase:base,retained:[]}}]})
    const physical=new api.ObsidianFileSystem(app)
    // Restrict observation to this owned fixture; no other vault content enters the scenario.
    const fs=new Proxy(physical,{get(target,key){if(key==='list')return async function*(){const listed=await adapter.list(folder);for(const path of listed.files){const stat=await adapter.stat(path);if(stat?.type==='file')yield{path,size:stat.size,mtime:stat.mtime}}};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value}})
    const context={folder,database,ledgerId,binding,store,state,base,path,sidecar,projection,scoped,fs,scripts:'Scripts',verifications:0}
    context.verify=async(id,input)=>{context.verifications++;return{...input,file_id:id,verified:true}}
    context.open=async()=>{
      context.fence=new ports.RuntimeFence(app,database,()=>window.__representationOwner===root)
      context.fence.activate()
      context.runtime=await ports.pluginRepresentation({app,store:context.store,ledger:scoped?scoped.placementStore():context.store,scoped:scoped??undefined,ledgerId,binding,fence:context.fence,fs,verify:(...args)=>context.verify(...args),scriptsFolder:()=>context.scripts})
    }
    await context.open()
    context.close=async()=>{context.fence.release();context.store.close();await persistence.IndexedDbStateStore.delete(indexedDB,database)}
    context.change=async(patch={})=>{const data=encode('sample next version');return{seq:2,file_id:base.fileId,version_id:'sample-v2',op:'modify',path,prev_path:null,sha:await digest(data),size:data.byteLength,mtime:2000,kind:'attachment',actor:{kind:'system',id:'sample-actor',name:'Sample'},at:'',...patch}}
    return context
  }
`
const probe = async (body: string) => JSON.parse(await evalLong(`(async()=>{${prelude}${body}})()`))
beforeAll(async () => {
  if (!available) return
  layout = evalJson('app.workspace.getLayout()')
  await evalLong(
    `(async()=>{await app.vault.createFolder(${JSON.stringify(root)});window.__representationOwner=${JSON.stringify(root)};return true})()`
  )
})
afterAll(async () => {
  if (!available) return
  await evalLong(`(async()=>{
    const root=${JSON.stringify(root)}
    if(window.__representationOwner===root){const folder=app.vault.getAbstractFileByPath(root);if(folder)await app.vault.delete(folder,true)}
    delete window.__representationOwner
    await app.workspace.changeLayout(${JSON.stringify(layout)})
    return true
  })()`)
})

describe.skipIf(!available)('external representation and durable jobs on live host ports', () => {
  it('recreates a missing projection through recorded staging without downloading or publishing the original', async () => {
    const out = await probe(`
      const c=await fixture('sample-missing')
      try{
        await adapter.remove(c.sidecar)
        await c.runtime.accept(await c.change())
        const document=await c.state.snapshot(),projection=JSON.parse(await adapter.read(c.sidecar))
        const scan=await ports.scan(c.runtime.fileSystem(),c.runtime.stateStore(),{excluded:()=>false})
        return{projectionVersion:projection.observedVersionId,phase:document.operations[0].phase,artifactCount:document.operations[0].ownedArtifacts.length,localBase:document.files[0].lastProvenLocalBase.versionId,head:(await c.store.byFileId(c.base.fileId)).versionId,originalPresent:await adapter.exists(c.path),ops:scan.ops,dirty:[...scan.dirty],verifications:c.verifications}
      }finally{await c.close()}
    `)
    expect(out).toEqual({
      projectionVersion: 'sample-v2',
      phase: 'projection-written',
      artifactCount: 1,
      localBase: 'sample-v1',
      head: 'sample-v2',
      originalPresent: false,
      ops: [],
      dirty: [],
      verifications: 1,
    })
  })

  it('holds renamed/damaged projections during folder-native scan, while ordinary sidecars remain ordinary', async () => {
    const out = await probe(`
      const c=await fixture('sample-scoped',true)
      try{
        const renamed=c.folder+'/sample-renamed.txt'
        await adapter.rename(c.sidecar,renamed)
        await adapter.writeBinary(c.sidecar,encode('sample damaged sidecar').buffer)
        await adapter.writeBinary(c.folder+'/sample-user.abele-ref',encode('sample ordinary file').buffer)
        const ops=await ports.scanScopedChanges(c.runtime.fileSystem(),c.runtime.scopedState(c.scoped),c.folder+'/')
        const held=await c.runtime.classify(renamed)
        return{ops:ops.map(op=>({op:op.op,path:op.path})),held:held.kind,originalPresent:await adapter.exists(c.path),damaged:await adapter.read(c.sidecar)}
      }finally{await c.close()}
    `)
    expect(out.ops).toEqual([{ op: 'create', path: out.ops[0].path }])
    expect(out.ops[0].path).toBe(root + '/sample-scoped/sample-user.abele-ref')
    expect(out.held).toBe('hold')
    expect(out.originalPresent).toBe(false)
    expect(out.damaged).toBe('sample damaged sidecar')
  })

  it('keeps preferences, earlier base and unexpected bytes through rename/delete/detach/restore', async () => {
    const out = await probe(`
      const c=await fixture('sample-transitions')
      try{
        const next=c.folder+'/sample-new.bin'
        await c.runtime.accept(await c.change({op:'move',path:next,prev_path:c.path}))
        await adapter.writeBinary(c.path,encode('sample unexpected edit').buffer)
        await c.runtime.accept(await c.change({op:'delete',path:next,sha:null,size:null,mtime:null,version_id:'sample-deleted'}))
        await c.runtime.detach(c.base.fileId)
        const detached=(await c.state.snapshot()).files[0].availability
        await c.runtime.accept(await c.change({op:'restore',path:next,version_id:'sample-restored'}))
        const file=(await c.state.snapshot()).files[0],decision=await c.runtime.classify(c.path)
        return{detached,availability:file.availability,identity:file.fileId,preference:file.preference,localBase:file.lastProvenLocalBase.versionId,dirty:decision.dirty,bytes:await adapter.read(c.path),operations:(await c.state.snapshot()).operations.length}
      }finally{await c.close()}
    `)
    expect(out).toEqual({
      detached: 'detached',
      availability: 'active',
      identity: 'sample-file',
      preference: 'on-demand',
      localBase: 'sample-v1',
      dirty: true,
      bytes: 'sample unexpected edit',
      operations: 4,
    })
  })

  it('reopens cursor-advanced work without another event and retains the unchanged old sidecar', async () => {
    const out = await probe(`
      const c=await fixture('sample-reopen')
      try{
        await c.runtime.accept(await c.change());await c.store.setCursor(2)
        const identity=c.store.databaseIdentity
        c.fence.release();c.store.close()
        c.store=await persistence.IndexedDbStateStore.open(indexedDB,c.database)
        c.state=await persistence.ExternalState.open(c.store,c.ledgerId,c.binding)
        await c.open();await c.runtime.recoverJobs()
        const document=await c.state.snapshot()
        return{identityPreserved:c.store.databaseIdentity===identity,cursor:await c.store.getCursor(),phase:document.operations[0].phase,pending:document.files[0].pendingOperationId===document.operations[0].operationId,sidecarPreserved:await adapter.read(c.sidecar)===decode(c.projection),verifications:c.verifications}
      }finally{await c.close()}
    `)
    expect(out).toEqual({
      identityPreserved: true,
      cursor: 2,
      phase: 'cleanup-pending',
      pending: true,
      sidecarPreserved: true,
      verifications: 2,
    })
  })

  it('rechecks scripts_folder after verification and never uses the attachment installer as code approval', async () => {
    const out = await probe(`
      const c=await fixture('sample-approval')
      try{
        c.verify=async(id,input)=>{c.verifications++;c.scripts=c.folder;return{...input,file_id:id,verified:true}}
        await c.runtime.accept(await c.change())
        const file=(await c.state.snapshot()).files[0],operation=(await c.state.snapshot()).operations[0]
        return{blocker:file.blockingReason,phase:operation.phase,originalPresent:await adapter.exists(c.path),sidecarPreserved:await adapter.read(c.sidecar)===decode(c.projection),stagingPresent:await adapter.exists(operation.ownedArtifacts[0].path)}
      }finally{await c.close()}
    `)
    expect(out).toEqual({
      blocker: 'approval-required',
      phase: 'held',
      originalPresent: false,
      sidecarPreserved: true,
      stagingPresent: false,
    })
  })
})
