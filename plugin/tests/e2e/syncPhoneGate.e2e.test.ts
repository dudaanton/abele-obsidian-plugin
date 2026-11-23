import { expect } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { targets } from './helpers/target'
import { liveCase, liveSuite } from './helpers/syncLiveCases'
import { driver, phoneHome, beginPhoneCase, endPhoneCase, installPhoneHost } from './helpers/phone'
import { phoneGateBudgets, phoneGateWatchdog, runGatePhase } from './helpers/syncPhoneGatePhases'
import { fixtureFetch } from './helpers/syncServer'
import { waitFor } from './helpers/syncVault'
import {
  capturePhoneForegroundScene,
  terminatePhone,
  waitForPhoneBackground,
} from './helpers/phoneProcess'
import { residentMemorySampler } from './helpers/residentMemory'
import { allowFixtureAttachment } from './helpers/externalAttachmentFixture'
import {
  assertFreshPhoneLoad,
  assertPhoneGateInventory,
  phoneGateChunk,
  type GateFile,
} from './helpers/syncPhoneGate'
import {
  assertDesktopReplicaReady,
  findServerFolderId,
  syncDesktopGateReplica,
} from './helpers/syncPhoneDesktop'

targets('phone')
const fixture = liveSuite(false)
const chunk = 1024 * 1024
const largeSize = 16 * chunk

liveCase(
  'syncPhoneGate',
  'backgrounds and kills active uploads and pulls in a 3000-file phone vault',
  [],
  async () => {
    const s = fixture(),
      a = s.primary
    assertDesktopReplicaReady()
    const phase = <T>(
      name: keyof typeof phoneGateBudgets,
      work: (signal: AbortSignal) => Promise<T>
    ) =>
      runGatePhase(name, phoneGateBudgets[name], async (signal) => {
        const previous = a.timeoutMs
        const deadline = Date.now() + phoneGateBudgets[name]
        // Every page action consumes this phase's remaining time, rather than
        // receiving a fresh full timeout after the preceding action completed.
        Object.defineProperty(a, 'timeoutMs', {
          configurable: true,
          get: () => Math.max(1, deadline - Date.now()),
        })
        try {
          return await work(signal)
        } finally {
          Object.defineProperty(a, 'timeoutMs', {
            configurable: true,
            writable: true,
            value: previous,
          })
        }
      })
    const id = await phase('connect', () => s.connect())
    const desktopRoot = mkdtempSync(join(tmpdir(), 'sync-phone-gate-'))
    const own: GateFile[] = [],
      remote: GateFile[] = []
    const files = Array.from({ length: 3000 }, (_, i) => ({
      path: s.root + '/own/sample-' + i + (i < 2997 ? '.md' : '.bin'),
      seed: i + 1,
      size: i < 2997 ? 4096 : largeSize,
    }))
    for (const file of files) {
      const hash = createHash('sha256')
      for (let offset = 0; offset < file.size; offset += chunk)
        hash.update(phoneGateChunk(file.seed, offset, Math.min(chunk, file.size - offset)))
      own.push({ path: file.path, size: file.size, sha: hash.digest('hex') })
    }
    const memory: unknown[] = []
    let remoteHeads: { path: string; sha: string; size: number; key: string }[] = []
    const startMemory = async () => {
      await a.long(
        'sample native resident memory',
        `
        const sample=(${residentMemorySampler.toString()})(window);
        if(!sample)throw new Error('Native resident-memory sampler required');
        const state=window.__phoneGateMemory={source:sample.source,baseline:await sample(),peak:0,samples:0,error:null,timer:null,flight:null};
        state.peak=state.baseline;
        state.timer=setInterval(()=>{if(state.flight)return;state.flight=sample().then(bytes=>{if(!Number.isFinite(bytes)||bytes<=0)throw new Error('Invalid resident sample');state.peak=Math.max(state.peak,bytes);state.samples++}).catch(error=>state.error=String(error)).finally(()=>state.flight=null)},100);return true`
      )
    }
    const stopMemory = async () => {
      const sample = await a.long<{
        baseline: number
        peak: number
        samples: number
        error: string | null
      }>(
        'collect native resident memory',
        `
        const state=window.__phoneGateMemory;if(!state)throw new Error('Memory sampler missing');
        clearInterval(state.timer);await state.flight;delete window.__phoneGateMemory;
        return {source:state.source,baseline:state.baseline,peak:state.peak,samples:state.samples,error:state.error}`
      )
      memory.push(sample)
      expect(sample.error).toBeNull()
      expect(sample.baseline).toBeGreaterThan(0)
      expect(sample.samples).toBeGreaterThan(0)
    }
    const interrupt = async (phase: 'upload' | 'pull') => {
      let heldKeys: string[] = []
      let beforeRelaunch = 0
      const pattern =
        phase === 'upload' ? '^(PUT|POST) /v2/uploads' : '^GET /v2/files/[^/]+/content$'
      // Inventory only while paused. Hashing after the hold can let the native
      // request expire before the kill, and obscures what was actually interrupted.
      if (phase === 'pull') {
        // A completed remote file is now local too. Resuming may finish a partial
        // stage, but must not download any complete bytes the phone already holds.
        heldKeys = await a.long<string[]>(
          'inventory complete remote bytes before relaunch',
          `
            const keys=[];
            for(const file of ${JSON.stringify(remoteHeads)}){
              if(!await app.vault.adapter.exists(file.path))continue;
              const bytes=await app.vault.adapter.readBinary(file.path);
              if(bytes.byteLength!==file.size)continue;
              const digest=await crypto.subtle.digest('SHA-256',bytes),sha=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
              if(sha===file.sha)keys.push(file.key);
            }return keys`
        )
      }
      let phoneAway = false
      const foreground = capturePhoneForegroundScene()
      s.server.holdTransfer(phase)
      try {
        a.run(
          `void svc.pause(${JSON.stringify(id)},false).then(()=>svc.sync(${JSON.stringify(id)})).catch(error=>console.debug('gate interrupted sync',String(error)));return true`
        )
        await waitFor('server-held ' + phase + ' arrival', () => s.server.transferHeld(), 60_000)
        const before = await a.long<number>(
          'confirm interrupted ' + phase,
          `await poll(()=>host.live.get(${JSON.stringify(id)})?.trace.snapshot().active.some(one=>new RegExp(${JSON.stringify(pattern)}).test(one.operation)),10000,'held ${phase} request');return performance.timeOrigin`
        )
        await stopMemory()
        beforeRelaunch = s.server.contentFiles().length
        expect(
          a.run<boolean>(
            `return host.live.get(${JSON.stringify(id)})?.trace.snapshot().active.some(one=>new RegExp(${JSON.stringify(pattern)}).test(one.operation))`
          ),
          'transfer must still be outstanding immediately before background and kill'
        ).toBe(true)
        phoneHome()
        phoneAway = true
        // The SpringBoard scene frame witnesses that this app left the foreground.
        const backgroundWitness = await waitForPhoneBackground({ foreground })
        endPhoneCase()
        const kill = terminatePhone()
        // The next launch must be cold. Let startup networking work immediately;
        // a request held through cold startup only manufactures another timeout.
        s.server.resume()
        driver(['launch', 'md.obsidian'])
        installPhoneHost()
        beginPhoneCase()
        phoneAway = false
        const after = await a.long<number>(
          'wait for replacement token host',
          'return performance.timeOrigin'
        )
        assertFreshPhoneLoad(before, after)
        await startMemory()
        console.info('[phone gate interruption]', {
          phase,
          before,
          after,
          backgroundWitness,
          ...kill,
        })
      } finally {
        s.server.resume()
        if (phoneAway) {
          endPhoneCase()
          driver(['launch', 'md.obsidian'])
          installPhoneHost()
          beginPhoneCase()
        }
      }
      await a.syncNow(id)
      expect(
        s.server
          .contentFiles()
          .slice(beforeRelaunch)
          .filter((key) => heldKeys.includes(key)),
        'complete remote bytes must not be downloaded again after relaunch'
      ).toEqual([])
    }
    try {
      await phase('create phone files', async () => {
        await a.pause(id, true)
        // A nested file path alone does not create a shareable directory item.
        await s.commit([{ op: 'mkdir', path: s.root }])
        await startMemory()
        await a.long(
          'create synthetic large phone vault in bounded chunks',
          `
        await (${allowFixtureAttachment.toString()})(svc,${JSON.stringify(id)},${largeSize});
        const make=${phoneGateChunk.toString()};
        if(!await app.vault.adapter.exists(${JSON.stringify(s.root)}))await app.vault.adapter.mkdir(${JSON.stringify(s.root)});
        for(const file of ${JSON.stringify(files)}){
          const parent=file.path.slice(0,file.path.lastIndexOf('/'));
          if(!await app.vault.adapter.exists(parent))await app.vault.adapter.mkdir(parent);
          await app.vault.adapter.writeBinary(file.path,new ArrayBuffer(0));
          for(let offset=0;offset<file.size;offset+=${chunk})await app.vault.adapter.appendBinary(file.path,make(file.seed,offset,Math.min(${chunk},file.size-offset)).buffer);
        }return true`
        )
      })
      await phase('upload interruption', () => interrupt('upload'))
      expect(
        s.server.contentGets(),
        'phone must never download its own upload, including before relaunch'
      ).toBe(0)
      const { ownIds, beforePull } = await phase('prepare remote files', async () => {
        const ownIds = new Set(
          (await s.items())
            .filter((row) => own.some((file) => file.path === row.path))
            .map((row) => createHash('sha256').update(row.file_id).digest('hex'))
        )
        expect(ownIds.size).toBe(own.length)
        await a.pause(id, true)
        const beforePull = s.server.contentFiles().length
        for (let i = 0; i < 128; i++) {
          const bytes = phoneGateChunk(4000 + i, 0, i === 127 ? largeSize : 4096)
          const sha = createHash('sha256').update(bytes).digest('hex')
          const path = s.root + '/remote/sample-' + i + '.bin'
          await s.client().putBlob(sha, bytes)
          await s.commit([{ op: 'create', path, sha, size: bytes.length, mtime: 1000 }])
          remote.push({ path, sha, size: bytes.length })
        }
        remoteHeads = (await s.items()).flatMap((row) =>
          row.kind !== 'directory' && remote.some((file) => file.path === row.path)
            ? [
                {
                  path: row.path,
                  sha: row.sha,
                  size: row.size,
                  key: createHash('sha256').update(row.file_id).digest('hex'),
                },
              ]
            : []
        )
        expect(remoteHeads).toHaveLength(remote.length)
        return { ownIds, beforePull }
      })
      await phase('pull interruption', () => interrupt('pull'))
      expect(
        s.server
          .contentFiles()
          .slice(beforePull)
          .filter((file) => ownIds.has(file))
      ).toEqual([])
      await stopMemory()
      const expected = [...own, ...remote]
      await phase('verify phone bytes', async () => {
        const actual = await a.long<GateFile[]>(
          'hash every phone file from disk',
          `
        const root=${JSON.stringify(s.root)},result=[],walk=async dir=>{
          const listing=await app.vault.adapter.list(dir);
          for(const path of listing.files){const bytes=await app.vault.adapter.readBinary(path),digest=await crypto.subtle.digest('SHA-256',bytes);result.push({path,size:bytes.byteLength,sha:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')})}
          for(const folder of listing.folders)await walk(folder);
        };await walk(root);return result`
        )
        assertPhoneGateInventory(expected, actual)
      })
      // A real desktop SDK replica, separate disk and durable ledger; no phone CLI routing.
      await phase('desktop replica', async (signal) => {
        mkdirSync(join(desktopRoot, 'files'))
        const folderId = await findServerFolderId(s.server.rootToken, s.root, fixtureFetch)
        const desktopKey = await s.server.issue({ kind: 'folder', id: folderId })
        await syncDesktopGateReplica({
          key: desktopKey,
          dir: join(desktopRoot, 'files'),
          stateDir: join(desktopRoot, 'state'),
          fetch: fixtureFetch,
          signal,
        })
        const desktopFiles: GateFile[] = []
        const walk = (dir: string) => {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name)
            if (entry.isDirectory()) walk(path)
            else {
              const bytes = readFileSync(path)
              desktopFiles.push({
                path: relative(join(desktopRoot, 'files'), path),
                size: bytes.length,
                sha: createHash('sha256').update(bytes).digest('hex'),
              })
            }
          }
        }
        walk(join(desktopRoot, 'files'))
        assertPhoneGateInventory(expected, desktopFiles)
      })
      await phase('verify server bytes', async (signal) => {
        const serverFiles: GateFile[] = []
        for (const row of await s.items()) {
          signal.throwIfAborted()
          if (row.kind === 'directory' || !row.path.startsWith(s.root + '/')) continue
          const source = await s
            .client()
            .openVersion(row.file_id, row.version_id!, { size: row.size!, sha: row.sha! })
          const hash = createHash('sha256')
          try {
            for (let offset = 0; offset < row.size!; offset += chunk)
              hash.update(await source.read(offset, Math.min(chunk, row.size! - offset), signal))
            await source.assertUnchanged()
          } finally {
            await source.close()
          }
          serverFiles.push({ path: row.path, size: row.size!, sha: hash.digest('hex') })
        }
        assertPhoneGateInventory(expected, serverFiles)
      })
      console.info('[phone gate result]', {
        files: expected.length,
        bytes: expected.reduce((n, file) => n + file.size, 0),
        mismatches: 0,
        ownDownloads: 0,
        desktop: 'SDK disk replica',
        memory,
      })
    } finally {
      s.server.resume()
      try {
        await a.long(
          'stop gate memory timer',
          'const state=window.__phoneGateMemory;if(state){clearInterval(state.timer);await state.flight;delete window.__phoneGateMemory}return true',
          true
        )
      } finally {
        rmSync(desktopRoot, { recursive: true, force: true })
      }
    }
  },
  fixture,
  phoneGateWatchdog
)
