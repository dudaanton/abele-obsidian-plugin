import { decodeAccessToken } from '@abele/sync-protocol'
import { AccessClient, sha256 } from '@abele/sync-core'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { TokenSyncLive } from './helpers/tokenSyncLive'
import { fixtureFetch } from './helpers/syncServer'
import { onPhone, targets } from './helpers/target'
import { allowFixtureAttachment } from './helpers/externalAttachmentFixture'

targets('desktop', 'phone')
const TIMEOUT = 600000
const MAXIMUM = 200 * 1024 * 1024
interface RoundTrip {
  evicted: { status: string; reclaimedBytes: number }
  missing: boolean
  sidecar: boolean
  retired: boolean
  identical: boolean
  disconnectReady: boolean
  baseline: number
  peakMemory: number
  samples: number
  memoryError: string | null
  peakDownloads: number
  downloadCount: number
  verificationCount: number
  verifiedRead: boolean | null
}
let live: TokenSyncLive
beforeEach(async () => {
  live = new TokenSyncLive(false)
  await live.start()
}, TIMEOUT)
afterEach(async () => {
  await live?.close()
}, TIMEOUT)

async function attachment(folderToken = false, size = 26) {
  const path = live.root + '/sample.bin'
  // Connect empty first: the large transfer has its own explicit operation budget.
  await live.put(live.root + '/seed.md', 'attachment fixture')
  const folder = decodeAccessToken(live.server.rootToken).scope.id
  const encoded = folderToken
    ? await live.server.issue({ kind: 'folder', id: folder })
    : live.server.rootToken
  const id = await live.connect(live.primary, encoded)
  await live.primary.pause(id, true)
  await live.primary.long(
    'allow fixture attachment size',
    `await (${allowFixtureAttachment.toString()})(svc,${JSON.stringify(id)},${size})`
  )
  const bytes = new Uint8Array(size).fill(90)
  const sha = await sha256(bytes)
  await live.client().putBlob(sha, bytes)
  await live.commit([{ op: 'create', path, sha, size, mtime: 1 }])
  const version = (await live.items()).find((one) => one.path === path)!.version_id
  return { id, path, sha, size, encoded, version }
}

async function roundTrip(folderToken = false, size = 26, departure = false) {
  const file = await attachment(folderToken, size)
  const outcome = await live.primary.long<RoundTrip>(
    'v2 attachment eviction and hydration',
    `
    const id=${JSON.stringify(file.id)},path=${JSON.stringify(file.path)},size=${size},maximum=size===${MAXIMUM}
    const memory=()=>typeof window.__abeleExternalMemoryBytes==='function'?window.__abeleExternalMemoryBytes():globalThis.process?.memoryUsage?.().rss
    const sampling=maximum&&(typeof window.__abeleExternalMemoryBytes==='function'||typeof globalThis.process?.memoryUsage==='function')
    let baseline=0,peakMemory=0,samples=0,memoryError=maximum&&!sampling?'Resident-memory sampler required':null,timer
    const sample=()=>{const value=memory();if(!Number.isFinite(value)||value<=0){memoryError='Resident-memory sampler required';return}peakMemory=Math.max(peakMemory,value);samples++}
    if(sampling){sample();baseline=peakMemory;timer=setInterval(sample,25)}
    const adapter=app.vault.adapter,api=window.__abeleTest
    let probe
    const phase=stage=>{window.__abeleAttachmentStage={stage,startedAt:Date.now(),size}}
    try {
      phase('Receiving attachment')
      await svc.pause(id,false)
      probe=api.tokenSyncProbe(id)
      await probe.sync()
      probe.reset()
      phase('Evicting attachment')
      const evicted=await host.evict(id,path)
      const missing=!await adapter.exists(path),sidecar=await adapter.exists(path+'.abele-ref')
      let verifiedRead=null
      if(!maximum){
        phase('Reading offloaded attachment')
        const record=svc.registry.records().find(one=>one.id===id)
        const store=await api.externalState.IndexedDbStateStore.open(indexedDB,record.ledgerId)
        const document=JSON.parse(await store.getExternalState())
        const state=await api.externalState.ExternalState.open(store,record.ledgerId,document.binding)
        const readHost=new api.ExternalFileHost(app,{platform:${JSON.stringify(onPhone() ? 'mobile' : 'desktop')},assertOwned:()=>probe.assertCurrent()})
        try{
          const reader=new api.AttachmentStore({state,ledger:store,host:readHost,binding:document.binding,assertOwned:()=>probe.assertCurrent(),serial:{run:work=>probe.runExclusive(work)},sync:()=>probe.sync(),scriptsFolder:()=> 'Scripts',verify:(file,input)=>probe.verify(file,input),download:(file,version)=>probe.download(file,version)})
          const head=await store.get(path),read=await reader.read(head.fileId,{expectedVersionId:head.versionId})
          verifiedRead=read.bytes?.length===size&&read.bytes.every(byte=>byte===90)&&!await adapter.exists(path)
        }finally{readHost.close();store.close()}
        probe.reset()
      }
      phase(${departure}?'Materializing before departure':'Hydrating concurrent requests')
      if(${departure})await svc.disconnect(id)
      else await Promise.all([host.hydrate(path),host.hydrate(path)])
      const externalHost=new api.ExternalFileHost(app,{platform:${JSON.stringify(onPhone() ? 'mobile' : 'desktop')},assertOwned:()=>{}})
      phase('Checking hydrated attachment')
      let fingerprint;try{fingerprint=await externalHost.fingerprint(path)}finally{externalHost.close()}
      const actual=maximum?null:new Uint8Array(await adapter.readBinary(path))
      if(sampling)sample()
      const {peakDownloads,downloadCount,verificationCount}=probe.stats()
      return {evicted,missing,sidecar,retired:!await adapter.exists(path+'.abele-ref'),identical:fingerprint.sha===${JSON.stringify(file.sha)}&&fingerprint.size===size&&(maximum||actual.length===size&&actual.every(byte=>byte===90)),disconnectReady:!svc.rows.value.some(one=>one.id===id),baseline,peakMemory,samples,memoryError,peakDownloads,downloadCount,verificationCount,verifiedRead}
    } finally {probe?.close();clearInterval(timer);delete window.__abeleAttachmentStage}
  `,
    false,
    TIMEOUT
  )
  expect((await live.items()).find((one) => one.path === file.path)?.version_id).toBe(file.version)
  return outcome
}

describe('v2 external attachments on live adapters', () => {
  it.each([false, true])(
    'completes authenticated eviction and concurrent hydration (folder token=%s)',
    async (folderToken) => {
      const result = await roundTrip(folderToken)
      expect(result).toMatchObject({
        evicted: { status: 'complete', reclaimedBytes: 26 },
        missing: true,
        sidecar: true,
        retired: true,
        identical: true,
        verifiedRead: true,
        peakDownloads: 1,
        downloadCount: 1,
        verificationCount: 4,
      })
    },
    TIMEOUT
  )
  it.each([false, true])(
    'materializes before departure (folder token=%s)',
    async (folderToken) => {
      expect(await roundTrip(folderToken, 26, true)).toMatchObject({
        evicted: { status: 'complete' },
        missing: true,
        sidecar: true,
        retired: true,
        identical: true,
        disconnectReady: true,
      })
    },
    TIMEOUT
  )
  let maximum: Awaited<ReturnType<typeof roundTrip>>
  it(
    'transfers a 200 MiB attachment and hydrates concurrent requests',
    async () => {
      maximum = await roundTrip(false, MAXIMUM)
      expect(maximum).toMatchObject({
        evicted: { status: 'complete', reclaimedBytes: MAXIMUM },
        missing: true,
        sidecar: true,
        retired: true,
        identical: true,
        peakDownloads: 1,
        downloadCount: 1,
        verificationCount: 3,
      })
      console.info('v2 attachment memory', {
        target: onPhone() ? 'phone' : 'desktop',
        baseline: maximum.baseline,
        peak: maximum.peakMemory,
        samples: maximum.samples,
      })
    },
    TIMEOUT
  )
  // Preserve the existing expected phone failure until the driver supplies resident RSS.
  ;(onPhone() ? it.fails : it)(
    'bounds resident-memory growth for the 200 MiB transfer',
    async () => {
      maximum ??= await roundTrip(false, MAXIMUM)
      expect(maximum.memoryError).toBeNull()
      expect(maximum.samples).toBeGreaterThan(2)
      expect(maximum.peakMemory - maximum.baseline).toBeLessThanOrEqual(1024 * 1024 * 1024)
    }
  )
  it(
    'revoked folder authority preserves the original before eviction',
    async () => {
      const file = await attachment(true)
      await live.primary.long(
        'receive attachment',
        `await svc.pause(${JSON.stringify(file.id)},false);await svc.runtimes.get(${JSON.stringify(file.id)}).sync();return true`
      )
      const connection = await AccessClient.fromToken(file.encoded, {
        fetch: fixtureFetch,
      }).connection()
      await AccessClient.fromToken(live.server.rootToken, { fetch: fixtureFetch }).revoke(
        connection.token_id
      )
      const result = await live.primary.long<{
        refused: boolean
        original: boolean
        sidecar: boolean
      }>(
        'refuse revoked eviction',
        `let refused=false;try{const result=await host.evict(${JSON.stringify(file.id)},${JSON.stringify(file.path)});refused=result.status!=='complete'}catch{refused=true}return {refused,original:await app.vault.adapter.exists(${JSON.stringify(file.path)}),sidecar:await app.vault.adapter.exists(${JSON.stringify(file.path + '.abele-ref')})}`
      )
      expect(result).toEqual({ refused: true, original: true, sidecar: false })
    },
    TIMEOUT
  )
})
