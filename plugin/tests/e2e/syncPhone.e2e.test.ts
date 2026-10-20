import { expect } from 'vitest'
import { targets } from './helpers/target'
import { driver, phoneHome } from './helpers/phone'
import { liveSuite, liveCase } from './helpers/syncLiveCases'
import { exerciseTrustedWindow } from './helpers/syncTrustedConnection'
import { sha256 } from '@abele/sync-sdk/core'
import { syncProgressSamples } from './helpers/syncProgressSamples'
import { collectSyncProgressShots, syncProgressShotsPrelude } from './helpers/syncProgressShots'
import { shotDir } from './helpers/shots'
import { deletedRootRecovery, serverRenamedRootRecovery } from './helpers/syncRootRecovery'
import {
  decodeAccessToken,
  V2CommitRequestSchema,
  V2CommitResponseSchema,
} from '@abele/sync-sdk/protocol'
import { rawManifest } from '../helpers/rawManifest'
import { fixtureFetch } from './helpers/syncServer'
targets('phone')
const fixture = liveSuite(false)
liveCase(
  'syncPhone',
  '122 trusted folder toggle stays visible and persists both states on the phone',
  [122],
  async () => {
    const s = fixture(),
      a = s.primary,
      folder = s.root + '/trusted-folder'
    const owner = await s.connect()
    a.create(folder + '/sample.md', 'phone folder marker')
    await a.syncNow()
    const token = await a.share(owner, 'Folder: ' + folder)
    await a.disconnect(owner)
    const id = await s.connect(a, token)
    expect(
      a.run(`return svc.registry.records().find(one=>one.id===${JSON.stringify(id)}).scope`)
    ).toMatchObject({ kind: 'folder', path: folder })
    await exerciseTrustedWindow(a, id, 'trusted-connection-phone')
  },
  fixture
)
liveCase(
  'syncPhone',
  'phone shows file and byte progress during a multi-file first pull',
  [117],
  async () => {
    const s = fixture(),
      a = s.primary,
      client = s.client()
    const ops = []
    for (let i = 0; i < 384; i++) {
      const bytes = new TextEncoder().encode('Sample ' + i + '\n' + 'Synthetic note.\n'.repeat(512))
      const sha = await sha256(bytes)
      await client.putBlob(sha, bytes)
      ops.push({
        op: 'create' as const,
        path: s.root + '/progress/sample-' + i + '.md',
        sha,
        size: bytes.length,
        mtime: 1000,
      })
    }
    await s.commit(ops)
    a.run(`${syncProgressShotsPrelude(shotDir('abele-sync-progress'), true)}
      const samples=[],before=new Set(svc.rows.value.map(row=>row.id));let opened=false;window.__phoneProgressSamples=samples;
      window.__phoneProgressTimer=setInterval(()=>{const root=app.setting.activeTab?.containerEl,added=svc.rows.value.find(row=>!before.has(row.id));
        if(!opened&&added&&!modal('Connect to a server')&&root){opened=true;connectionRow(root,added.id).click()}
        const current=(${syncProgressSamples.toString()})([document,settingsDoc()]);samples.push(...current.map(sample=>({...sample,at:Date.now()})));progressShots.sample(current)},50);return true`)
    const started = Date.now()
    let samples: { value: number; total: number; text: string; at: number }[] = []
    let shots: { label: string; path?: string; error?: string }[] = []
    try {
      await s.connect()
    } finally {
      samples = a.run(
        `clearInterval(window.__phoneProgressTimer);delete window.__phoneProgressTimer;const samples=window.__phoneProgressSamples||[];delete window.__phoneProgressSamples;return samples`
      )
      console.log('[phone pull progress]', { elapsedMs: Date.now() - started, samples })
      shots = await collectSyncProgressShots(a, true)
    }
    const downloading = samples.filter(
      (sample) =>
        sample.text.startsWith('Downloading') && sample.value > 0 && sample.value < sample.total
    )
    expect(downloading.some((sample) => /files.*\b(?:KB|MB)\b/.test(sample.text))).toBe(true)
    expect(downloading.at(-1)!.at - downloading[0].at).toBeGreaterThanOrEqual(1000)
    expect(
      shots.some((shot) => shot.label === 'phone-downloading-window' && shot.path?.endsWith('.png'))
    ).toBe(true)
    expect(a.filesUnder(s.root + '/progress')).toHaveLength(384)
    expect(a.read(s.root + '/progress/sample-383.md')).toContain('Sample 383')
  },
  fixture
)
liveCase(
  'syncPhone',
  '118 deleted folder root stops phone sync and Restore from the server resumes it',
  [118],
  async () => deletedRootRecovery(fixture()),
  fixture
)
liveCase(
  'syncPhone',
  '117 phone decodes a rendered sharing QR through the image scanner and connects',
  [117],
  async () => {
    const s = fixture(),
      a = s.primary,
      owner = await s.connect(),
      path = s.root + '/qr-phone.md'
    const qr = await a.shareQr(owner)
    expect(qr.image).toMatch(/^data:image\/png;base64,/)
    await a.disconnect(owner)
    await s.put(path, 'phone scanned QR receipt')
    await s.connect(a, qr.token, qr.image)
    expect(a.read(path)).toBe('phone scanned QR receipt')
  },
  fixture
)
liveCase(
  'syncPhone',
  '121 Deny keeps a private attachment local on the phone',
  [121],
  async () => {
    const s = fixture(),
      a = s.primary,
      group = s.root + '/DenyGroup.md',
      note = s.root + '/deny-member.md',
      asset = s.root + '/denied.bin'
    await s.put(group, 'deny group')
    await s.put(note, '---\ngroups: ["[[' + s.root + '/DenyGroup]]"]\n---\n![[' + asset + ']]')
    const root = (await s.items()).find((one) => one.path === group)!
    a.create(asset, 'private denied bytes')
    await s.connect(a, await s.server.issue({ kind: 'group', id: root.file_id }))
    a.open(note)
    await a.consent('Deny')
    await a.syncNow()
    expect(a.questions()).toHaveLength(0)
    expect(a.read(asset)).toBe('private denied bytes')
    expect((await s.items()).some((one) => one.path === asset)).toBe(false)
    a.create(asset, 'private edit after denial')
    await a.syncNow()
    expect((await s.items()).some((one) => one.path === asset)).toBe(false)
  },
  fixture
)
liveCase(
  'syncPhone',
  '123 a phone transfer failure names the error and retains unsent bytes for retry',
  [123],
  async () => {
    const s = fixture(),
      a = s.primary,
      path = s.root + '/unsent-phone.bin',
      id = await s.connect()
    await a.pause(id, true)
    a.create(path, 'phone bytes awaiting transfer')
    // The stopped server is waited out for 5 s per request rather than 30: still the hung path.
    a.run('window.__abeleTest.setNativeSyncTimeout(5000);return true')
    s.server.suspend()
    try {
      await a.pause(id, false)
      await expect(a.syncNow(id)).rejects.toThrow()
      expect(a.read(path)).toBe('phone bytes awaiting transfer')
      expect(
        a.run(
          `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(id)}),'settings');await poll(()=>inWindows('.abele-sync-window'));return [...inWindows('.abele-sync-window').querySelectorAll('[role=alert]')].some(one=>/unavailable|interrupted|reachable|timed out/i.test(textOf(one)))`
        )
      ).toBe(true)
      expect(a.rows().find((one) => one.id === id)?.error).toMatch(
        /unavailable|interrupted|reachable|timed out/i
      )
      expect(
        a.run(
          `const root=inWindows('.abele-sync-window');let refused;await poll(()=>refused=[...root.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))===${JSON.stringify(path)}),20000,'unsent phone file stays visible during retry');const section=refused.closest('.abele-section');return textOf(section.querySelector('.abele-section__heading'))+': '+textOf(refused)`
        )
      ).toMatch(/Not sent:.*(?:unavailable|interrupted|reachable|timed out)/i)
    } finally {
      s.server.resume()
      a.run('window.__abeleTest.setNativeSyncTimeout(null);return true')
    }
    await a.syncNow(id)
    const remote = (await s.items()).find((one) => one.path === path)!
    expect(
      new TextDecoder().decode(await s.client().versionBytes(remote.file_id, remote.version_id))
    ).toBe('phone bytes awaiting transfer')
  },
  fixture
)
liveCase(
  'syncPhone',
  '117 phone pastes a token and receives files without separate credentials',
  [117],
  async () => {
    const s = fixture(),
      path = s.root + '/phone.md'
    await s.put(path, 'phone token content')
    await s.connect()
    expect(s.primary.read(path)).toBe('phone token content')
    expect(s.primary.rows()).toHaveLength(1)
  },
  fixture
)
liveCase(
  'syncPhone',
  '118 phone creates edits renames moves deletes and receives remote changes',
  [118],
  async () => {
    const s = fixture(),
      a = s.primary,
      path = s.root + '/from/phone.md'
    await s.connect()
    a.create(path, 'phone create')
    await a.syncNow()
    let file = (await s.items()).find((one) => one.path === path)!
    expect(file).toBeDefined()
    a.create(path, 'phone edit')
    a.rename(path, s.root + '/to/renamed.md')
    await a.syncNow()
    file = (await s.items()).find((one) => one.path === s.root + '/to/renamed.md')!
    expect(file).toBeDefined()
    expect((await s.items()).some((one) => one.path === path)).toBe(false)
    await s.put(file.path, 'remote edit')
    await a.syncNow()
    expect(a.read(file.path)).toBe('remote edit')
    a.remove([file.path])
    await a.syncNow()
    expect((await s.items()).some((one) => one.file_id === file.file_id)).toBe(false)
    await s.put(s.root + '/remote.md', 'remote create')
    await a.syncNow()
    expect(a.read(s.root + '/remote.md')).toBe('remote create')
    const remote = (await s.items()).find((one) => one.path === s.root + '/remote.md')!
    await s.commit([
      {
        op: 'move',
        file_id: remote.file_id,
        base_version_id: remote.version_id,
        to_path: s.root + '/remote-renamed.md',
      },
    ])
    await a.syncNow()
    expect(a.exists(remote.path)).toBe(false)
    const renamed = (await s.items()).find((one) => one.file_id === remote.file_id)!
    await s.commit([
      { op: 'delete', file_id: renamed.file_id, base_version_id: renamed.version_id },
    ])
    await a.syncNow()
    expect(a.exists(renamed.path)).toBe(false)
  },
  fixture
)
liveCase(
  'syncPhone',
  '118 ordinary folders deleted on the phone reach server trash and remote folder deletes reach the phone',
  [118],
  async () => {
    const s = fixture(),
      a = s.primary,
      folder = s.root + '/phone-folder',
      paths = [folder + '/first.md', folder + '/nested/second.md', folder + '/nested/sample.bin'],
      bytes = [0, 255, 17, 128, 10, 0]
    const id = await s.connect()
    a.create(paths[0], 'first folder note')
    a.create(paths[1], 'nested folder note')
    a.run(
      `await app.vault.createBinary(${JSON.stringify(paths[2])},new Uint8Array(${JSON.stringify(bytes)}).buffer);return true`
    )
    await a.syncNow()
    const uploaded = (await s.items()).filter((one) => paths.includes(one.path))
    expect(uploaded.map((one) => one.path).sort()).toEqual([...paths].sort())
    const binary = uploaded.find((one) => one.path === paths[2])!
    expect([
      ...new Uint8Array(await s.client().versionBytes(binary.file_id, binary.version_id)),
    ]).toEqual(bytes)

    a.remove([folder])
    expect(a.exists(folder)).toBe(false)
    await a.syncNow()
    // Three files are below the mass-deletion guard's minimum of ten.
    expect(a.run(`return svc.activity.value[${JSON.stringify(id)}]?.heldDeletes`)).toBe(0)
    expect((await s.items()).filter((one) => paths.includes(one.path))).toHaveLength(0)
    const trashed = (await s.client().trash()).filter((one) => paths.includes(one.path))
    expect(trashed.map((one) => one.file_id).sort()).toEqual(
      uploaded.map((one) => one.file_id).sort()
    )
    expect([
      ...new Uint8Array(await s.client().versionBytes(binary.file_id, binary.version_id)),
    ]).toEqual(bytes)
    await a.syncNow()
    expect(a.exists(folder)).toBe(false)
    expect(paths.map((path) => a.exists(path))).toEqual([false, false, false])

    const remoteFolder = s.root + '/remote-folder',
      remotePaths = [remoteFolder + '/first.md', remoteFolder + '/nested/second.md']
    for (const path of remotePaths) await s.put(path, 'remote folder note')
    await a.syncNow()
    expect(remotePaths.map((path) => a.read(path))).toEqual([
      'remote folder note',
      'remote folder note',
    ])
    const remote = (await rawManifest(s.server.rootToken, fixtureFetch)).filter(
      (one) => one.path === remoteFolder || one.path.startsWith(remoteFolder + '/')
    )
    expect(
      remote
        .filter((one) => one.kind !== 'directory')
        .map((one) => one.path)
        .sort()
    ).toEqual([...remotePaths].sort())
    expect(remote.filter((one) => one.kind === 'directory')).toHaveLength(2)
    const token = decodeAccessToken(s.server.rootToken)
    const response = await fixtureFetch(new URL('/v2/commit', token.address), {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token.key,
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(
        V2CommitRequestSchema.parse({
          ops: remote
            .sort((left, right) => right.path.length - left.path.length)
            .map((one) => ({
              op: one.kind === 'directory' ? 'delete_directory' : 'delete',
              file_id: one.file_id,
              base_version_id: one.version_id,
            })),
        })
      ),
    })
    expect(response.ok).toBe(true)
    const outcome = V2CommitResponseSchema.parse(await response.json())
    expect(outcome.results).toHaveLength(remote.length)
    expect(outcome.results.every((one) => one.status === 'applied')).toBe(true)
    await a.syncNow()
    expect(remotePaths.map((path) => a.exists(path))).toEqual([false, false])
    expect(a.exists(remoteFolder)).toBe(false)
  },
  fixture
)
liveCase(
  'syncPhone',
  '119 returning from real background receives changes without requiring background sync',
  [119],
  async () => {
    const s = fixture(),
      a = s.primary,
      path = s.root + '/background.md'
    await s.connect()
    await s.put(path, 'before background')
    await a.syncNow()
    try {
      phoneHome()
      await s.put(path, 'while backgrounded')
    } finally {
      driver(['launch', 'md.obsidian'])
    }
    await a.waitIdle()
    await a.syncNow()
    expect(a.read(path)).toBe('while backgrounded')
  },
  fixture
)
liveCase(
  'syncPhone',
  '120 unavailable network retains edits until the real server returns',
  [120],
  async () => {
    const s = fixture(),
      a = s.primary,
      path = s.root + '/offline.md'
    const id = await s.connect()
    a.run('window.__abeleTest.setNativeSyncTimeout(5000);return true')
    s.server.suspend()
    try {
      a.create(path, 'offline phone edit')
      await expect(a.syncNow(id)).rejects.toThrow()
      expect(a.read(path)).toBe('offline phone edit')
    } finally {
      s.server.resume()
      a.run('window.__abeleTest.setNativeSyncTimeout(null);return true')
    }
    await a.syncNow(id)
    expect((await s.items()).some((one) => one.path === path)).toBe(true)
  },
  fixture
)
liveCase(
  'syncPhone',
  '121 opening a group note asks before publishing a private attachment',
  [121],
  async () => {
    const s = fixture(),
      a = s.primary,
      group = s.root + '/Group.md',
      note = s.root + '/member.md',
      asset = s.root + '/private.bin'
    await s.put(group, 'group root')
    await s.put(note, '---\ngroups: ["[[' + s.root + '/Group]]"]\n---\n![[' + asset + ']]')
    const root = (await s.items()).find((one) => one.path === group)!
    a.create(asset, 'private bytes')
    await s.connect(a, await s.server.issue({ kind: 'group', id: root.file_id }))
    await a.syncNow()
    expect(a.questions()).toHaveLength(0)
    expect((await s.items()).some((one) => one.path === asset)).toBe(false)
    a.open(note)
    a.run(
      `await poll(()=>svc.questions.value.some(one=>one.path===${JSON.stringify(asset)}));return true`
    )
    expect(a.questions().map((one) => one.path)).toEqual([asset])
    await a.consent('Allow')
    await a.syncNow()
    expect((await s.items()).some((one) => one.path === asset)).toBe(true)
  },
  fixture
)
liveCase(
  'syncPhone',
  '122 script provenance and exact content are visible before approval or rejection',
  [122],
  async () => {
    const s = fixture(),
      a = s.primary,
      path = s.root + '/script.js'
    const id = await s.connect()
    await s.put(path, '// phone review one')
    await a.syncNow()
    expect(a.exists(path)).toBe(false)
    expect(a.candidates().find((one) => one.path === path)?.source.id).toBe(id)
    const receipt = a.run<{ actual: string; expected: string; finite: boolean }>(
      `const candidate=svc.candidates.value.find(one=>one.path===${JSON.stringify(path)});if(!candidate)throw new Error('Review missing');const root=await openSyncTab();const row=[...root.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))===${JSON.stringify(path)});icon(row,'eye');await poll(()=>modal('Review incoming code'));const box=modal('Review incoming code');const received=[...box.querySelectorAll('.abele-token-dialog__facts dt')].find(one=>textOf(one)==='Received');const actual=textOf(received?.nextElementSibling),expected=new Date(candidate.receivedAt).toLocaleString();await press(box,'Close');await closeSettings();return {actual,expected,finite:Number.isFinite(candidate.receivedAt)}`
    )
    expect(receipt.finite).toBe(true)
    expect(receipt.actual).toBe(receipt.expected)
    expect(receipt.actual).not.toBe('')
    await a.review(path, 'Approve', true)
    expect(a.read(path)).toBe('// phone review one')
    await s.put(path, '// rejected phone update')
    await a.syncNow()
    await a.review(path, 'Reject')
    expect(a.read(path)).toBe('// phone review one')
  },
  fixture
)
liveCase(
  'syncPhone',
  '123 a phone conflict keeps both variants in exactly one discoverable copy',
  [123],
  async () => {
    const s = fixture(),
      a = s.primary,
      path = s.root + '/conflict.md'
    const id = await s.connect()
    await s.put(path, 'baseline\n')
    await a.syncNow()
    await a.pause(id, true)
    a.create(path, 'phone edit\n')
    await s.put(path, 'remote edit\n')
    await a.pause(id, false)
    await a.syncNow()
    const copies = a.filesUnder(s.root).filter((one) => one.includes('(Conflicted copy'))
    expect(copies).toHaveLength(1)
    expect([a.read(path), a.read(copies[0])].sort()).toEqual(
      ['phone edit\n', 'remote edit\n'].sort()
    )
    a.open(copies[0])
  },
  fixture
)
liveCase(
  'syncPhone',
  '124 two phone connections continue through one unreachable server',
  [124],
  async () => {
    const s = fixture(),
      a = s.primary,
      second = await s.addServer(),
      path = s.root + '/two-servers.md'
    const first = await s.connect(),
      other = await s.connect(a, second.rootToken)
    a.create(path, 'both servers')
    await a.syncNow()
    expect((await s.items()).some((one) => one.path === path)).toBe(true)
    expect((await s.items(second)).some((one) => one.path === path)).toBe(true)
    a.run('window.__abeleTest.setNativeSyncTimeout(5000);return true')
    second.suspend()
    try {
      a.create(path, 'one server unavailable')
      await expect(a.syncNow(other)).rejects.toThrow()
      await a.syncNow(first)
      expect(a.rows()).toHaveLength(2)
    } finally {
      second.resume()
      a.run('window.__abeleTest.setNativeSyncTimeout(null);return true')
    }
    await a.syncNow(other)
    const file = (await s.items(second)).find((one) => one.path === path)!
    expect(
      new TextDecoder().decode(await s.client(second).versionBytes(file.file_id, file.version_id))
    ).toBe('one server unavailable')
  },
  fixture
)

liveCase(
  'syncPhone',
  '118 server-renamed folder keeps phone placement after explicit follow',
  [118],
  async () => serverRenamedRootRecovery(fixture()),
  fixture
)
