import { expect } from 'vitest'
import { sha256 } from '@abele/sync-sdk/core'
import { targets } from './helpers/target'
import { liveCase, liveSuite } from './helpers/syncLiveCases'
import { fixtureFetch } from './helpers/syncServer'
import { rawManifest } from '../helpers/rawManifest'

targets('phone')
const fixture = liveSuite(false)
const count = 1000
const pullCeilingMs = 180_000

liveCase(
  'syncPhoneFirstPull',
  'first-pulls a folder of 1000 small notes on the phone within three minutes',
  [36],
  async () => {
    const s = fixture(),
      a = s.primary,
      folder = s.root + '/Shared',
      client = s.client()
    const phases: Record<string, number> = {}
    const expected: { path: string; sha: string }[] = []
    let phase = Date.now()
    // Seed only the isolated server: no earlier connection can warm the phone ledger.
    for (let start = 0; start < count; start += 8) {
      const ops = await Promise.all(
        Array.from({ length: Math.min(8, count - start) }, async (_, n) => {
          const path = folder + '/sample-' + (start + n) + '.md'
          const bytes = new TextEncoder().encode(
            'Sample ' + (start + n) + '\n' + 'Synthetic note payload.\n'.repeat(900)
          )
          const sha = await sha256(bytes)
          await client.putBlob(sha, bytes)
          expected.push({ path, sha })
          return { op: 'create' as const, path, sha, size: bytes.length, mtime: 1000 }
        })
      )
      await s.commit(ops)
    }
    phases.seedMs = Date.now() - phase
    phase = Date.now()
    const root = (await rawManifest(s.server.rootToken, fixtureFetch)).find(
      (item) => item.kind === 'directory' && item.path === folder
    )
    expect(root).toBeDefined()
    const token = await s.server.issue({ kind: 'folder', id: root!.file_id })
    phases.tokenMs = Date.now() - phase
    expect(a.filesUnder(folder)).toHaveLength(0)
    a.timeoutMs = pullCeilingMs
    a.startupStallMs = 60_000
    const started = Date.now()
    let elapsedMs = 0
    let connection = ''
    try {
      connection = await s.connect(a, token, undefined, pullCeilingMs)
    } finally {
      elapsedMs = Date.now() - started
      phases.connectAndPullMs = elapsedMs
      // Print even when Connect fails so the before run still reports its elapsed time.
      console.log(
        '[phone first folder connection]',
        JSON.stringify({ files: count, elapsedMs, phases, ceilingMs: pullCeilingMs })
      )
    }
    expect(elapsedMs).toBeLessThan(pullCeilingMs)
    phase = Date.now()
    const actual = await a.long<{ path: string; sha: string }[]>(
      'verify phone first-pull bytes',
      `const root=${JSON.stringify(folder)},result=[];
      for(const file of app.vault.getFiles().filter(file=>file.path.startsWith(root+'/'))){
        const bytes=await app.vault.readBinary(file),digest=await crypto.subtle.digest('SHA-256',bytes);
        result.push({path:file.path,sha:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')})
      }return result`
    )
    phases.verifyMs = Date.now() - phase
    expect(actual.sort((x, y) => x.path.localeCompare(y.path))).toEqual(
      expected.sort((x, y) => x.path.localeCompare(y.path))
    )
    const startup = a.run<unknown>(
      `return svc.activity.value[${JSON.stringify(connection)}]?.startupTimings || []`
    )
    console.log(
      '[phone first folder phases]',
      JSON.stringify({ files: actual.length, elapsedMs, phases, startup })
    )
  },
  fixture,
  600_000
)
