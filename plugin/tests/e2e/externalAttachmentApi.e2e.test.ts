import { verifyBoundedAttachmentRead } from './helpers/boundedAttachmentRead'
import { decodeAccessToken } from '@abele/sync-sdk/protocol'
import { AccessClient, sha256 } from '@abele/sync-sdk/core'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { TokenSyncLive } from './helpers/tokenSyncLive'
import { fixtureFetch } from './helpers/syncServer'
import { interimRun, onPhone, targets } from './helpers/target'
import { MOBILE_MAX_FILE_BYTES } from '../../src/sync/connectionDefaults'
import { allowFixtureAttachment } from './helpers/externalAttachmentFixture'
import { residentMemorySampler } from './helpers/residentMemory'
import { wasReloaded } from './helpers/loadIdentity'

targets('desktop', 'phone')
const TIMEOUT = 600000
const MAXIMUM = 200 * 1024 * 1024
/**
 * The large transfer: the declared maximum at a release, a few MiB between releases. Both go
 * the same way (memory sampled, hydrated by fingerprint, not byte by byte); only the size, and
 * what it proves about the maximum, differs.
 */
const LARGE = interimRun() ? 8 * 1024 * 1024 : MAXIMUM
const LARGE_LABEL = `${LARGE / 1024 / 1024} MiB`
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

async function attachment(folderToken = false, size = 26, raiseCap = true) {
  const path = live.root + '/sample.bin'
  // Connect empty first: the large transfer has its own explicit operation budget.
  await live.put(live.root + '/seed.md', 'attachment fixture')
  const folder = decodeAccessToken(live.server.rootToken).scope.id
  const encoded = folderToken
    ? await live.server.issue({ kind: 'folder', id: folder })
    : live.server.rootToken
  const id = await live.connect(live.primary, encoded)
  await live.primary.pause(id, true)
  if (!raiseCap) {
    const cap = live.primary.run<number | null>(
      `return svc.registry.records().find(one=>one.id===${JSON.stringify(id)}).selective.maxFileBytes`
    )
    expect(cap).toBe(onPhone() ? MOBILE_MAX_FILE_BYTES : null)
  }
  if (raiseCap)
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

async function roundTrip(
  folderToken = false,
  size = 26,
  departure = false,
  raiseCap = true,
  verifyRead = size <= 50 * 1024 * 1024
) {
  const file = await attachment(folderToken, size, raiseCap)
  const outcome = await live.primary.long<RoundTrip>(
    'v2 attachment eviction and hydration',
    `
    const id=${JSON.stringify(file.id)},path=${JSON.stringify(file.path)},size=${size},maximum=size===${LARGE}||size>50*1024*1024
    const memory=(${residentMemorySampler.toString()})(window)
    const sampling=maximum&&memory!==null
    let baseline=0,peakMemory=0,samples=0,memoryError=maximum&&!sampling?'Resident-memory sampler required':null,timer,samplingFlight=null
    const sample=()=>samplingFlight??=Promise.resolve().then(memory).then(value=>{if(!Number.isFinite(value)||value<=0){memoryError='Resident-memory sampler required';return}peakMemory=Math.max(peakMemory,value);samples++}).catch(()=>{memoryError='Resident-memory sampler required'}).finally(()=>{samplingFlight=null})
    if(sampling){await sample();baseline=peakMemory;timer=setInterval(()=>void sample(),25)}
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
      if(${verifyRead}){
        phase('Reading offloaded attachment')
        const record=svc.registry.records().find(one=>one.id===id)
        const store=await api.externalState.IndexedDbStateStore.open(indexedDB,record.ledgerId)
        const document=JSON.parse(await store.getExternalState())
        const state=await api.externalState.ExternalState.open(store,record.ledgerId,document.binding)
        const readHost=new api.ExternalFileHost(app,{platform:${JSON.stringify(onPhone() ? 'mobile' : 'desktop')},assertOwned:()=>probe.assertCurrent()})
        try{
          if(size>50*1024*1024){
            const head=await store.get(path);
            verifiedRead=await (${verifyBoundedAttachmentRead.toString()})(probe,head,90)&&!await adapter.exists(path);
          }else{
          const reader=new api.AttachmentStore({state,ledger:store,host:readHost,binding:document.binding,assertOwned:()=>probe.assertCurrent(),serial:{run:work=>probe.runExclusive(work)},sync:()=>probe.sync(),scriptsFolder:()=> 'Scripts',verify:(file,input)=>probe.verify(file,input),download:(file,version)=>probe.download(file,version)})
          const head=await store.get(path),read=await reader.read(head.fileId,{expectedVersionId:head.versionId})
          verifiedRead=read.bytes?.length===size&&read.bytes.every(byte=>byte===90)&&!await adapter.exists(path)
          }
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
      if(sampling)await sample()
      const {peakDownloads,downloadCount,verificationCount}=probe.stats()
      return {evicted,missing,sidecar,retired:!await adapter.exists(path+'.abele-ref'),identical:fingerprint.sha===${JSON.stringify(file.sha)}&&fingerprint.size===size&&(maximum||actual.length===size&&actual.every(byte=>byte===90)),disconnectReady:!svc.rows.value.some(one=>one.id===id),baseline,peakMemory,samples,memoryError,peakDownloads,downloadCount,verificationCount,verifiedRead}
    } finally {probe?.close();clearInterval(timer);await samplingFlight;delete window.__abeleAttachmentStage}
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
  it(
    'receives and hydrates the default phone size limit without raising the cap or reloading',
    async () => {
      const identity = () =>
        live.primary.run<{ timeOrigin: number; loadId: string }>(`
        window.__abeleAttachmentLoadId ??= crypto.randomUUID()
        return {timeOrigin:performance.timeOrigin,loadId:window.__abeleAttachmentLoadId}
      `)
      const before = identity()
      const result = await roundTrip(false, MOBILE_MAX_FILE_BYTES, false, false, true)
      expect(wasReloaded(before, identity()), 'Obsidian was reloaded during the case').toBe(false)
      expect(result).toMatchObject({
        evicted: { status: 'complete', reclaimedBytes: MOBILE_MAX_FILE_BYTES },
        missing: true,
        sidecar: true,
        retired: true,
        identical: true,
        verifiedRead: true,
      })
      const cap = live.primary.run<number | null>(
        'return svc.registry.records()[0].selective.maxFileBytes'
      )
      expect(cap).toBe(onPhone() ? MOBILE_MAX_FILE_BYTES : null)
      console.info(
        '[attachment-default-limit]',
        JSON.stringify({ size: MOBILE_MAX_FILE_BYTES, cap, before, after: identity() })
      )
    },
    TIMEOUT
  )
  let maximum: Awaited<ReturnType<typeof roundTrip>>
  let maximumFlight: ReturnType<typeof roundTrip> | undefined
  const maximumResult = () => (maximumFlight ??= roundTrip(false, LARGE, false, true, false))
  it(
    `transfers a ${LARGE_LABEL} attachment and hydrates concurrent requests`,
    async () => {
      maximum = await maximumResult()
      expect(maximum).toMatchObject({
        evicted: { status: 'complete', reclaimedBytes: LARGE },
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
        size: LARGE_LABEL,
        baseline: maximum.baseline,
        peak: maximum.peakMemory,
        samples: maximum.samples,
      })
    },
    TIMEOUT
  )
  // BUG: runtimes without native or injected resident RSS cannot prove this bound.
  ;(onPhone() ? it.fails : it)(
    `bounds resident-memory growth for the ${LARGE_LABEL} transfer`,
    async (context) => {
      maximum ??= await maximumResult()
      if (onPhone() && maximum.memoryError === null)
        context.skip('The available native sampler is checked by the ordinary assertion below')
      expect(maximum.memoryError).toBeNull()
      expect(maximum.samples).toBeGreaterThan(2)
      expect(maximum.peakMemory - maximum.baseline).toBeLessThanOrEqual(1024 * 1024 * 1024)
    }
  )
  it.skipIf(!onPhone())(
    'bounds resident-memory growth with the available native sampler',
    async (context) => {
      maximum ??= await maximumResult()
      if (maximum.memoryError !== null) context.skip('BUG: resident-memory sampler is unavailable')
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
