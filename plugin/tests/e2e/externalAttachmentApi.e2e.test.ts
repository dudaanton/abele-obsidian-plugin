import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop', 'phone')
const available = isObsidianRunning() && hasTestApi()
const folder = 'sample-attachment-roundtrip-' + randomBytes(16).toString('hex')
let layout: unknown
beforeAll(async () => {
  if (!available) return
  layout = JSON.parse(await evalLong('JSON.stringify(app.workspace.getLayout())'))
  await evalLong(`app.vault.createFolder(${JSON.stringify(folder)}).then(()=>true)`)
})
afterAll(async () => {
  if (!available) return
  await evalLong(
    `(async()=>{const entry=app.vault.getAbstractFileByPath(${JSON.stringify(folder)});if(entry)await app.vault.delete(entry,true);await app.workspace.changeLayout(${JSON.stringify(layout)});return true})()`
  )
})

describe.skipIf(!available)('explicit attachment API on real desktop and mobile adapter', () => {
  it('removes the original and restores identical bytes without overwriting an occupied target', async () => {
    const outcome = JSON.parse(
      await evalLong(`(async()=>{
      const api=window.__abeleTest, folder=${JSON.stringify(folder)}, path=folder+'/sample.bin'
      const bytes=new TextEncoder().encode('sample portable attachment'), adapter=app.vault.adapter
      const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('')
      await adapter.writeBinary(path,bytes.buffer)
      const database='sample-attachment-'+crypto.randomUUID(),store=await api.externalState.IndexedDbStateStore.open(indexedDB,database)
      const binding={endpoint:'https://sync.example.invalid',vaultId:'sample-vault',mode:'personal',principalId:'sample-device',principalType:'device',grantId:null,generation:1,credentialAssociation:'sample-slot'}
      const state=await api.externalState.ExternalState.open(store,'sample-ledger',binding)
      const base={path,wirePath:path,fileId:'sample-file',versionId:'sample-v1',sha,size:bytes.length,mtime:1000}
      await store.put(base)
      const host=new api.ExternalFileHost(app,{platform:${JSON.stringify(process.env.E2E_TARGET === 'phone' ? 'mobile' : 'desktop')},assertOwned:()=>{}})
      const attachment=new api.AttachmentStore({state,ledger:store,host,binding,
        assertOwned:()=>{},serial:{run:async job=>job()},sync:async()=>{},scriptsFolder:()=> 'Scripts',
        verify:async(id,input)=>({...input,file_id:id,verified:true}),download:async()=>bytes})
      try{
        const evicted=await attachment.evict(base.fileId,{operationId:'sample-evict',expectedRevision:0,expectedVersionId:base.versionId})
        const missing=!await adapter.exists(path),sidecar=await adapter.exists(path+'.abele-ref')
        const hydrated=await attachment.hydrate(base.fileId,{operationId:'sample-hydrate',expectedVersionId:base.versionId})
        const actual=new Uint8Array(await adapter.readBinary(path))
        return JSON.stringify({evicted,missing,sidecar,hydrated,identical:actual.length===bytes.length&&actual.every((n,i)=>n===bytes[i])})
      }finally{host.close();store.close();await api.externalState.IndexedDbStateStore.delete(indexedDB,database)}
    })()`)
    )
    expect(outcome).toEqual({
      evicted: { status: 'complete', reclaimedBytes: 26 },
      missing: true,
      sidecar: true,
      hydrated: { status: 'cleanup-pending', reclaimedBytes: 0 },
      identical: true,
    })
  })
})
