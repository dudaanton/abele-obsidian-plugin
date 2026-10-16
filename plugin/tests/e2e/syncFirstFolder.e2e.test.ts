import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { liveCase, liveSuite } from './helpers/syncLiveCases'
import { firstFolderFixture } from './helpers/syncFirstFolderFixture'
import type { SyncDriver } from './helpers/syncDriver'
import { syncProgressSamples } from './helpers/syncProgressSamples'

// CALIBRATE BEFORE LANDING: provisional, not a measured budget. Manager records the first
// live elapsedMs below and sets generous headroom, still below 60 directories * 10 seconds.
export const FIRST_FOLDER_PULL_LIMIT_MS = 120_000
const fixture = liveSuite()
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

async function verifyBytes(device: SyncDriver, root: string): Promise<void> {
  const actual = await device.long<{
    directories: string[]
    files: { path: string; sha: string }[]
  }>(
    'verify first folder connection bytes',
    `const root=${JSON.stringify(root)}, expected=(${firstFolderFixture.toString()})(42);
    const directories=[];for(const path of expected.directories){if((await app.vault.adapter.stat(root+'/'+path))?.type==='folder')directories.push(path)}
    const files=[];for(const file of app.vault.getFiles().filter(file=>file.path.startsWith(root+'/'))){const bytes=await app.vault.readBinary(file);const digest=await crypto.subtle.digest('SHA-256',bytes);files.push({path:file.path.slice(root.length+1),sha:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')})}return {directories,files}`
  )
  const expected = firstFolderFixture(42)
  expect(actual.directories.sort()).toEqual(expected.directories.sort())
  expect(actual.files.sort((a, b) => a.path.localeCompare(b.path))).toEqual(
    expected.files
      .map((file) => ({ path: file.path, sha: hash(file.bytes) }))
      .sort((a, b) => a.path.localeCompare(b.path))
  )
}

liveCase(
  'syncFirstFolder',
  'first folder connection pulls a multi-page notes folder into a large vault and keeps exchanging',
  [36],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      folder = s.root + '/Shared',
      unrelated = s.root + '/Unrelated'
    a.timeoutMs = b.timeoutMs = FIRST_FOLDER_PULL_LIMIT_MS + 30000
    await a.long(
      'seed first folder connection',
      `const root=${JSON.stringify(folder)}, fixture=(${firstFolderFixture.toString()})(42);
      await app.vault.createFolder(${JSON.stringify(s.root)});await app.vault.createFolder(root);for(const path of fixture.directories)await app.vault.createFolder(root+'/'+path);
      for(const file of fixture.files)await app.vault.createBinary(root+'/'+file.path,file.bytes.buffer);return true`
    )
    await b.long(
      'seed unrelated peer notes',
      `const root=${JSON.stringify(unrelated)};await app.vault.createFolder(${JSON.stringify(s.root)});await app.vault.createFolder(root);
      for(let i=0;i<40;i++){const dir=root+'/Bucket-'+i;await app.vault.createFolder(dir);for(let j=0;j<100;j++)await app.vault.create(dir+'/Sample-'+j+'.md','Unrelated local note '+i+' '+j)}return true`
    )
    expect(b.filesUnder(unrelated)).toHaveLength(4000)
    const owner = await s.connect()
    expect(
      (await s.client().manifest(null, 1000)).next,
      'fixture must span actual server manifest pages'
    ).toBeTruthy()
    expect((await s.items()).filter((item) => item.path.startsWith(folder + '/'))).toHaveLength(
      1024
    )
    const token = await a.share(owner, 'Folder: ' + folder)
    // Observe the rendered connection window during Connect, not an internal progress signal.
    b.run(`const samples=[], before=new Set(svc.rows.value.map(row=>row.id));let opened=false;window.__firstFolderSamples=samples;
      window.__firstFolderTimer=setInterval(()=>{const root=app.setting.activeTab?.containerEl, added=svc.rows.value.find(row=>!before.has(row.id));if(!opened&&added&&!modal('Connect to a server')&&root){opened=true;connectionRow(root,added.id).click()}
      samples.push(...(${syncProgressSamples.toString()})([document,settingsDoc()]))},50);return true`)
    let samples: { label: string; value: number; total: number }[] = []
    const started = Date.now()
    let elapsedMs = 0
    try {
      await s.connect(b, token, undefined, FIRST_FOLDER_PULL_LIMIT_MS + 30000)
    } finally {
      elapsedMs = Date.now() - started
      try {
        samples = b.run(
          `clearInterval(window.__firstFolderTimer);delete window.__firstFolderTimer;const samples=window.__firstFolderSamples||[];delete window.__firstFolderSamples;return samples`
        )
      } finally {
        console.log(
          '[first folder connection]',
          JSON.stringify({
            elapsedMs,
            limitMs: FIRST_FOLDER_PULL_LIMIT_MS,
            samples,
          })
        )
      }
    }
    expect(elapsedMs).toBeLessThan(FIRST_FOLDER_PULL_LIMIT_MS)
    expect(samples.some((sample) => sample.total > 0 && sample.value < sample.total)).toBe(true)
    expect(
      new Set(samples.map((sample) => sample.label)).size,
      'visible counts must advance'
    ).toBeGreaterThan(1)
    const script =
      folder + '/' + firstFolderFixture().files.find((file) => file.path.endsWith('.js'))!.path
    expect(b.exists(script)).toBe(false)
    expect(b.candidates().map((candidate) => candidate.path)).toContain(script)
    await b.review(script, 'Approve')
    await s.cycle()
    await verifyBytes(a, folder)
    await verifyBytes(b, folder)
    expect((await s.items()).some((item) => item.path.startsWith(unrelated + '/'))).toBe(false)

    for (const [source, target, label] of [
      [a, b, 'primary'],
      [b, a, 'peer'],
    ] as const) {
      const edit = folder + '/' + label + '-edit.md',
        renamed = folder + '/' + label + '-renamed.md'
      source.create(edit, 'original')
      await s.cycle()
      expect(target.read(edit)).toBe('original')
      source.create(edit, 'edited')
      await s.cycle()
      expect(target.read(edit)).toBe('edited')
      source.rename(edit, renamed)
      await s.cycle()
      expect(target.exists(edit)).toBe(false)
      expect(target.read(renamed)).toBe('edited')
      source.remove([renamed])
      await s.cycle()
      expect(target.exists(renamed)).toBe(false)
    }
    expect((await s.items()).some((item) => item.path.startsWith(unrelated + '/'))).toBe(false)
    expect(b.filesUnder(unrelated)).toHaveLength(4000)
  },
  fixture,
  600_000
)

it.skip('BUG: NFD task — decomposed Cyrillic names survive first folder connection byte-for-byte', async () => {
  const s = fixture(),
    a = s.primary,
    b = s.peer!,
    folder = s.root + '/Nfd',
    path = folder + '/Край.md'
  a.create(path, 'decomposed name')
  const owner = await s.connect()
  await s.connect(b, await a.share(owner, 'Folder: ' + folder))
  expect(b.filesUnder(folder)).toEqual([path])
  expect(b.read(path)).toBe('decomposed name')
})
