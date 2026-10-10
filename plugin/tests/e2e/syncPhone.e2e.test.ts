import { expect } from 'vitest'
import { targets } from './helpers/target'
import { driver, phoneHome } from './helpers/phone'
import { liveSuite, liveCase } from './helpers/syncLiveCases'
targets('phone')
const fixture = liveSuite(false)
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
    s.server.suspend()
    try {
      await a.pause(id, false)
      await expect(a.syncNow(id)).rejects.toThrow()
      expect(a.read(path)).toBe('phone bytes awaiting transfer')
      expect(
        a.run(
          `const root=await openSyncTab();return [...root.querySelectorAll('[role=alert]')].some(one=>/unavailable|interrupted|reachable|timed out/i.test(textOf(one)))`
        )
      ).toBe(true)
      expect(a.rows().find((one) => one.id === id)?.error).toMatch(
        /unavailable|interrupted|reachable|timed out/i
      )
      expect(
        a.run(
          `const root=await openSyncTab();let refused;await poll(()=>refused=[...root.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))===${JSON.stringify(path)}&&textOf(one).includes('Not sent:')));return textOf(refused)`
        )
      ).toMatch(/Not sent:.*(?:unavailable|interrupted|reachable|timed out)/i)
    } finally {
      s.server.resume()
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
    s.server.suspend()
    try {
      a.create(path, 'offline phone edit')
      await expect(a.syncNow(id)).rejects.toThrow()
      expect(a.read(path)).toBe('offline phone edit')
    } finally {
      s.server.resume()
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
      `const candidate=svc.candidates.value.find(one=>one.path===${JSON.stringify(path)});if(!candidate)throw new Error('Review missing');const root=await openSyncTab();const row=[...root.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))===${JSON.stringify(path)});icon(row,'eye');await poll(()=>modal('Review incoming code'));const box=modal('Review incoming code');const received=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='Received');const actual=textOf(received?.querySelector('.setting-item-description')),expected=new Date(candidate.receivedAt).toLocaleString();await press(box,'Close');await closeSettings();return {actual,expected,finite:Number.isFinite(candidate.receivedAt)}`
    )
    expect(receipt.finite).toBe(true)
    expect(receipt.actual).toBe(receipt.expected)
    expect(receipt.actual).not.toBe('')
    await a.review(path, 'Approve')
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
    second.suspend()
    try {
      a.create(path, 'one server unavailable')
      await expect(a.syncNow(other)).rejects.toThrow()
      await a.syncNow(first)
      expect(a.rows()).toHaveLength(2)
    } finally {
      second.resume()
    }
    await a.syncNow(other)
    const file = (await s.items(second)).find((one) => one.path === path)!
    expect(
      new TextDecoder().decode(await s.client(second).versionBytes(file.file_id, file.version_id))
    ).toBe('one server unavailable')
  },
  fixture
)
