import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifySyncFixture } from '../../scripts/verify-sync-inputs.mjs'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { exposeToPhone } from './helpers/phone'
import { onPhone, targets } from './helpers/target'

targets('desktop', 'phone')
const folder = 'sample-attachment-roundtrip-' + randomBytes(16).toString('hex')
let layout: unknown, fixture: any, url: string, reader: any, head: any
let closeReverse: (() => void) | undefined
let folderOwned = false
const content = 'sample portable attachment'

beforeAll(async () => {
  if (!isObsidianRunning() || !hasTestApi()) throw Error('Live attachment API is required')
  const root = process.env.ABELE_SYNC_DIR
  if (!root) throw Error('ABELE_SYNC_DIR must name the pinned server fixture')
  verifySyncFixture(root)
  // Import only literal modules from the checksum-verified clean archive. Its test helper
  // enables the real scoped route assembly; verification and downloads are actual HTTP.
  // eslint-disable-next-line no-unsanitized/method -- The verified archive supplies literal module paths.
  const load = (file: string) => import(/* @vite-ignore */ pathToFileURL(join(root, file)).href)
  const { scopedFixture } = await load('packages/server/tests/helpers/scopedFixture.ts')
  const { createFolderGrant, issueFolderKey, updateFolderKey } = await load(
    'packages/server/src/auth/folderManagement.ts'
  )
  const { prepareFolderAdmissions } = await load('packages/server/src/scoped/admissions.ts')
  const { putBlob, commit, create } = await load('packages/server/tests/helpers/ops.ts')
  fixture = await scopedFixture('sqlite', true)
  fixture.grant = await createFolderGrant(fixture.deps, fixture.owner.accountToken, fixture.vault, {
    label: 'Sample attachments',
    prefix: folder + '/',
    role: 'reader',
  })
  await putBlob(fixture.t.app, fixture.device.deviceToken, content)
  head = (
    await commit(fixture.t.app, fixture.device.deviceToken, fixture.vault, [
      create(folder + '/sample.bin', content),
    ])
  ).results[0]
  await prepareFolderAdmissions(
    fixture.deps,
    fixture.owner.accountToken,
    fixture.vault,
    fixture.grant.id
  )
  reader = await issueFolderKey(
    fixture.deps,
    fixture.owner.accountToken,
    fixture.vault,
    fixture.grant.id,
    {
      attempt_id: 'sample-reader',
      name: 'Sample reader',
      role: 'reader',
      expires_at: '2030-01-02T00:00:00.000Z',
    }
  )
  fixture.revokeReader = () =>
    updateFolderKey(
      fixture.deps,
      fixture.owner.accountToken,
      fixture.vault,
      fixture.grant.id,
      reader.key_id,
      { expected_revision: 0, revoke: true }
    )
  url = await fixture.t.app.listen({ host: '127.0.0.1', port: 0 })
  if (onPhone()) closeReverse = exposeToPhone(Number(new URL(url).port))
  layout = JSON.parse(await evalLong('JSON.stringify(app.workspace.getLayout())'))
  await evalLong(`app.vault.createFolder(${JSON.stringify(folder)}).then(()=>true)`)
  folderOwned = true
})
afterAll(async () => {
  try {
    if (folderOwned)
      await evalLong(
        `(async()=>{const entry=app.vault.getAbstractFileByPath(${JSON.stringify(folder)});if(entry)await app.vault.delete(entry,true);await app.workspace.changeLayout(${JSON.stringify(layout)});return true})()`
      )
  } finally {
    closeReverse?.()
    await fixture?.close()
  }
})

async function roundTrip(scoped: boolean, materialize = false) {
  return JSON.parse(
    await evalLong(`(async()=>{
    const api=window.__abeleTest,path=${JSON.stringify(head.path)},bytes=new TextEncoder().encode(${JSON.stringify(content)}),adapter=app.vault.adapter
    const base=${JSON.stringify(head)},url=${JSON.stringify(url)},token=${JSON.stringify(scoped ? reader.key_token : fixture.device.deviceToken)}
    const grant=${JSON.stringify(fixture.grant.id)},vault=${JSON.stringify(fixture.vault)}
    const requests=[]
    async function http(route,method='GET',body){
      requests.push(route)
      const response=await requestUrl({url:url+route,method,headers:{authorization:'Bearer '+token,'x-abele-external-files-version':'1','x-abele-scoped-version':'4','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),throw:false})
      if(response.status!==200)throw Object.assign(Error('server refused '+response.status),{code:response.json?.error?.code})
      return response
    }
    await adapter.writeBinary(path,bytes.buffer)
    const database='sample-attachment-'+crypto.randomUUID(),store=await api.externalState.IndexedDbStateStore.open(indexedDB,database)
    const binding={endpoint:url,vaultId:vault,mode:${JSON.stringify(scoped ? 'scoped' : 'personal')},principalId:${JSON.stringify(scoped ? reader.key_id : fixture.device.deviceId)},principalType:${JSON.stringify(scoped ? 'key' : 'device')},grantId:${scoped ? 'grant' : 'null'},generation:1,credentialAssociation:'sample-slot'}
    const state=await api.externalState.ExternalState.open(store,'sample-ledger',binding)
    await store.put({path,wirePath:path,fileId:base.file_id,versionId:base.version_id,sha:base.sha,size:base.size,mtime:base.mtime})
    const host=new api.ExternalFileHost(app,{platform:${JSON.stringify(onPhone() ? 'mobile' : 'desktop')},assertOwned:()=>{}})
    const prefix=${scoped ? "'/v1/scoped/vaults/'+vault+'/grants/'+grant+'/files/'" : "'/v1/vaults/'+vault+'/files/'"}
    let consent=null
    const attachment=new api.AttachmentStore({state,ledger:store,host,binding,
      assertOwned:()=>{},serial:{run:async job=>job()},sync:async()=>{},scriptsFolder:()=> 'Scripts',
      scopedHead:async()=>({file_id:base.file_id,version_id:base.version_id,path,sha:base.sha,size:base.size,mtime:base.mtime}),
      consent:{read:async()=>consent,write:async value=>{consent=value}},
      verify:async(id,input)=>(await http(prefix+id+'/external/verify','POST',input)).json,
      download:async(id,version,sha)=>new Uint8Array((await http(${scoped ? "prefix+id+'/versions/'+version" : "'/v1/blobs/'+sha"})).arrayBuffer)})
    try{
      const options={operationId:crypto.randomUUID(),expectedRevision:0,expectedVersionId:base.version_id}
      const warning=${scoped ? '(await attachment.evict(base.file_id,options)).status' : 'null'}
      const evicted=await attachment.evict(base.file_id,{...options,acknowledgeScopedWarning:true})
      const missing=!await adapter.exists(path),sidecar=await adapter.exists(path+'.abele-ref')
      const read=await attachment.read(base.file_id,{expectedVersionId:base.version_id})
      const hydrated=${materialize ? 'await attachment.materializeForDisconnect({operationId:crypto.randomUUID()})' : 'await attachment.hydrate(base.file_id,{operationId:crypto.randomUUID(),expectedVersionId:base.version_id})'}
      const disconnectReady=(await attachment.inspectDisconnect()).safe
      const actual=new Uint8Array(await adapter.readBinary(path)),retired=!await adapter.exists(path+'.abele-ref')
      return JSON.stringify({evicted,missing,sidecar,hydrated,retired,warning,requests,disconnectReady,verifiedRead:read.bytes?.length===bytes.length&&read.bytes.every((n,i)=>n===bytes[i]),identical:actual.length===bytes.length&&actual.every((n,i)=>n===bytes[i])})
    }finally{host.close();store.close();await api.externalState.IndexedDbStateStore.delete(indexedDB,database)}
  })()`)
  )
}

describe('attachment API with the pinned real server on live adapters', () => {
  it.each([false, true])('materializes before departure (scoped reader=%s)', async (scoped) => {
    expect(await roundTrip(scoped, true)).toMatchObject({
      evicted: { status: 'complete' },
      missing: true,
      sidecar: true,
      hydrated: { status: 'complete' },
      disconnectReady: true,
      identical: true,
      retired: true,
    })
  })
  it.each([false, true])(
    'completes HTTP-backed eviction/read/hydration (scoped reader=%s)',
    async (scoped) => {
      const outcome = await roundTrip(scoped)
      expect(outcome).toMatchObject({
        evicted: { status: 'complete', reclaimedBytes: 26 },
        missing: true,
        sidecar: true,
        hydrated: { status: 'complete', reclaimedBytes: 0 },
        identical: true,
        retired: true,
        verifiedRead: true,
        warning: scoped ? 'warning-required' : null,
      })
      expect(
        outcome.requests.filter((route: string) => route.endsWith('/external/verify'))
      ).toHaveLength(3)
      if (scoped)
        expect(outcome.requests.every((route: string) => route.startsWith('/v1/scoped/'))).toBe(
          true
        )
      expect(
        (
          await fixture.t.app.inject({
            method: 'GET',
            url: `/v1/vaults/${fixture.vault}/files/${head.file_id}/head`,
            headers: {
              authorization: 'Bearer ' + fixture.device.deviceToken,
              'x-abele-external-files-version': '1',
            },
          })
        ).json().version_id
      ).toBe(head.version_id)
    }
  )

  it('lost scoped reader rights preserve the original before any external filesystem mutation', async () => {
    await fixture.revokeReader()
    const outcome = await roundTrip(true)
    expect(outcome.evicted).toEqual({ status: 'unavailable', reclaimedBytes: 0 })
    expect(outcome.missing).toBe(false)
    expect(outcome.sidecar).toBe(false)
    expect(outcome.requests.every((route: string) => route.startsWith('/v1/scoped/'))).toBe(true)
  })
})
