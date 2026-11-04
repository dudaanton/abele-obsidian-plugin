import { residentMemorySampler } from './helpers/residentMemory'
import { expect } from 'vitest'
import { sha256 } from '@noble/hashes/sha2'
import { targets } from './helpers/target'
import { liveSuite, liveCase } from './helpers/syncLiveCases'
import { allowFixtureAttachment } from './helpers/externalAttachmentFixture'
import { phoneCapabilities } from './helpers/phoneCapabilities'
import { requireLargeUploadSource, requireLargeUploadHead } from './helpers/syncLargeUploadEvidence'

targets('phone')
const fixture = liveSuite(false),
  chunk = 1024 * 1024,
  size = 200 * chunk,
  residentGrowthBudget = 16 * chunk
for (const offload of [false, true])
  liveCase(
    'syncPhoneLargeUpload',
    offload
      ? 'offloads and rehydrates a 200 MiB phone attachment after a bounded-memory upload'
      : 'uploads a 200 MiB phone attachment and pulls byte-identical content on desktop',
    [],
    async () => {
      const s = fixture(),
        a = s.primary,
        id = await s.connect(),
        path = s.root + '/sample-large.bin'
      a.traceMemory = true
      const reader = await a.long<{ available: boolean; mode: string; events: unknown[] }>(
        'verify bounded mobile file reader',
        `const Io=window.__abeleTest?.BoundedVaultIo;
        if(!Io)throw new Error('Filesystem test API unavailable');
        return await new Io(app.vault.adapter,undefined,undefined,undefined,app.vault.configDir).diagnoseMobile()`
      )
      console.info('large mobile reader capability', reader)
      expect(reader.available, 'bounded local resource reader required before large transfer').toBe(
        true
      )
      const beforeReads = a.run<{ bytesRead: number; chunks: number; wholeReads: number }>(
        `return host.live.get(${JSON.stringify(id)}).trace.snapshot().localReads`
      )
      const created = await a.long<{ type: string; size: number } | null>(
        'opt into the large fixture and create it in bounded chunks',
        `
      await (${allowFixtureAttachment.toString()})(svc,${JSON.stringify(id)},${size});
      const path=${JSON.stringify(path)},cut=path.lastIndexOf('/');if(!await app.vault.adapter.exists(path.slice(0,cut)))await app.vault.adapter.mkdir(path.slice(0,cut));
      await app.vault.adapter.writeBinary(path,new ArrayBuffer(0));
      for(let part=0;part<200;part++)await app.vault.adapter.appendBinary(path,new Uint8Array(${chunk}).fill(part).buffer);
      return await app.vault.adapter.stat(path)`,
        false,
        300000
      )
      requireLargeUploadSource(created, size, path)
      try {
        a.run(
          `const adapter=app.vault.adapter,original=adapter.readBinary;
        window.__largeUploadRead=original;window.__largeUploadReadCount=0;
        adapter.readBinary=function(path,...args){if(path===${JSON.stringify(path)})window.__largeUploadReadCount++;return original.call(this,path,...args)};
        const sampler=(${residentMemorySampler.toString()})(window);
        if(!sampler)throw new Error('Resident-memory sampler required');
        window.__abeleTest.mobileTransferMemory(true);
        const state=window.__largeUploadMemory={source:sampler.source,baseline:0,peak:0,samples:0,error:null,timer:null,flight:null,timeline:[],key:null};
        const sample=()=>state.flight??=Promise.resolve().then(sampler).then(bytes=>{if(!Number.isFinite(bytes)||bytes<=0)throw new Error('Invalid resident-memory sample');if(!state.samples)state.baseline=bytes;state.peak=Math.max(state.peak,bytes);state.samples++;const io=window.__abeleTest.mobileTransferMemory(),key=[io.activeNativeCopies,Math.floor(io.resourceRangeBytes/16777216),Math.floor(io.encodedBytes/16777216),Math.floor(bytes/4194304)].join(':');if(key!==state.key){state.key=key;state.timeline.push({at:Date.now(),resident:bytes,...io});if(state.timeline.length>64)state.timeline.splice(1,1)}}).catch(error=>{state.error=String(error)}).finally(()=>{state.flight=null});
        await sample();state.timer=setInterval(()=>void sample(),25);return true`
        )
        await a.syncNow(id)
        const uploaded = (await s.items()).find((one) => one.path === path)
        let evidence: unknown
        if (!uploaded) {
          evidence = await a
            .long(
              'diagnose missing large upload',
              `const path=${JSON.stringify(path)},id=${JSON.stringify(id)},record=svc.registry.records().find(one=>one.id===id),runtime=host.live.get(id),indexed=app.vault.getFileByPath(path);
            let probe;try{const Io=window.__abeleTest?.BoundedVaultIo;probe=Io?await new Io(app.vault.adapter,undefined,undefined,undefined,app.vault.configDir).diagnoseMobile():{error:'Filesystem test API unavailable'}}catch(error){probe={error:String(error)}}
            return {disk:await app.vault.adapter.stat(path),indexed:indexed?{size:indexed.stat.size,mtime:indexed.stat.mtime}:null,selective:record?.selective,log:runtime?.trace.snapshot().log.slice(-20),capabilities:(${phoneCapabilities.toString()})(window.Capacitor,app.vault.adapter),probe}`,
              true,
              180000
            )
            .catch((error) => ({ diagnosticError: String(error) }))
        }
        const head = requireLargeUploadHead(uploaded, path, evidence)
        const afterReads = a.run<{
          bytesRead: number
          chunks: number
          wholeReads: number
          maxChunkBytes: number
          peakReaderBytes: number
          maxOutputBytes: number
        }>(`return host.live.get(${JSON.stringify(id)}).trace.snapshot().localReads`)
        expect(afterReads.bytesRead - beforeReads.bytesRead).toBeGreaterThanOrEqual(size)
        // Streaming replaces the former one-whole-file allocation; no adapter-wide read.
        expect(a.run<number>('return window.__largeUploadReadCount')).toBe(0)
        expect(afterReads.wholeReads - beforeReads.wholeReads).toBe(0)
        const memory = await a.long<{
          baseline: number
          peak: number
          samples: number
          error: string | null
        }>(
          'collect upload resident-memory evidence',
          `const state=window.__largeUploadMemory;await state.flight;return {source:state.source,baseline:state.baseline,peak:state.peak,samples:state.samples,error:state.error,timeline:state.timeline}`
        )
        console.info('large upload resident bytes', {
          ...memory,
          growth: memory.peak - memory.baseline,
          localReads: afterReads,
        })
        expect(memory.error).toBeNull()
        expect(memory.samples).toBeGreaterThan(2)
        expect(memory.baseline).toBeGreaterThan(0)
        expect(memory.peak).toBeGreaterThanOrEqual(memory.baseline)
        expect(memory.peak - memory.baseline, 'upload resident-memory growth').toBeLessThanOrEqual(
          residentGrowthBudget
        )
        expect(afterReads.chunks - beforeReads.chunks).toBeGreaterThan(0)
        expect(afterReads.maxOutputBytes).toBeLessThanOrEqual(chunk)
        expect(afterReads.peakReaderBytes).toBeLessThanOrEqual(2 * chunk)
        expect(afterReads.maxChunkBytes).toBeLessThanOrEqual(chunk)
        console.info('large streaming bounds', {
          ...afterReads,
          wholeReadDelta: afterReads.wholeReads - beforeReads.wholeReads,
          fixtureReads: a.run<number>('return window.__largeUploadReadCount'),
        })
        expect(head.size).toBe(size)
        const source = await s
          .client()
          .openVersion(head.file_id, head.version_id!, { size, sha: head.sha! })
        const hash = sha256.create()
        try {
          for (let part = 0; part < 200; part++) {
            const bytes = await source.read(part * chunk, chunk)
            expect(bytes.length).toBe(chunk)
            expect(bytes.every((byte) => byte === part)).toBe(true)
            hash.update(bytes)
          }
          await source.assertUnchanged()
        } finally {
          await source.close()
        }
        expect(
          Array.from(hash.digest(), (byte) => byte.toString(16).padStart(2, '0')).join('')
        ).toBe(head.sha)
        if (offload) {
          expect(
            await a.long(
              'offload the large fixture',
              `return await host.evict(${JSON.stringify(id)},${JSON.stringify(path)})`,
              false,
              300000
            )
          ).toMatchObject({ status: 'complete' })
          expect(a.exists(path)).toBe(false)
          expect(a.exists(path + '.abele-ref')).toBe(true)
          await a.long(
            'rehydrate the large fixture',
            `await host.hydrate(${JSON.stringify(path)});return true`,
            false,
            300000
          )
          requireLargeUploadSource(
            a.run<{ type: string; size: number } | null>(
              `return await app.vault.adapter.stat(${JSON.stringify(path)})`
            ),
            size,
            path
          )
          // Eviction verifies the rehydrated bytes against the same server identity again.
          expect(
            await a.long(
              'verify rehydrated bytes before eviction',
              `return await host.evict(${JSON.stringify(id)},${JSON.stringify(path)})`,
              false,
              300000
            )
          ).toMatchObject({ status: 'complete' })
          expect((await s.items()).find((one) => one.file_id === head.file_id)).toMatchObject({
            sha: head.sha,
            version_id: head.version_id,
          })
          const finalReads = a.run<{
            maxChunkBytes: number
            peakReaderBytes: number
            maxOutputBytes: number
          }>(`return host.live.get(${JSON.stringify(id)}).trace.snapshot().localReads`)
          expect(finalReads.maxOutputBytes).toBeLessThanOrEqual(chunk)
          expect(finalReads.maxChunkBytes).toBeLessThanOrEqual(chunk)
          expect(finalReads.peakReaderBytes).toBeLessThanOrEqual(2 * chunk)
          console.info('large offload read bounds', finalReads)
          const offloadMemory = await a.long<{
            baseline: number
            peak: number
            samples: number
            error: string | null
          }>(
            'collect offload and rehydrate resident-memory evidence',
            `const state=window.__largeUploadMemory;await state.flight;return {source:state.source,baseline:state.baseline,peak:state.peak,samples:state.samples,error:state.error,timeline:state.timeline}`
          )
          console.info('large upload, offload and rehydrate resident bytes', {
            ...offloadMemory,
            growth: offloadMemory.peak - offloadMemory.baseline,
          })
          expect(offloadMemory.error).toBeNull()
          expect(offloadMemory.samples).toBeGreaterThan(memory.samples)
          expect(
            offloadMemory.peak - offloadMemory.baseline,
            'upload and rehydrate resident-memory growth'
          ).toBeLessThanOrEqual(residentGrowthBudget)
        }
      } finally {
        const allocation = a.run(
          `const allocation=window.__abeleTest.mobileTransferMemory("stop");if(window.__largeUploadRead){app.vault.adapter.readBinary=window.__largeUploadRead;delete window.__largeUploadRead}if(window.__largeUploadMemory){clearInterval(window.__largeUploadMemory.timer);await window.__largeUploadMemory.flight;delete window.__largeUploadMemory}delete window.__largeUploadReadCount;return allocation`,
          true
        )
        console.log('large upload final allocation evidence', allocation)
      }
    },
    fixture,
    900000
  )
