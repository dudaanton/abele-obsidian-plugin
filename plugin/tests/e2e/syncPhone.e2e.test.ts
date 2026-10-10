import { expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { targets } from './helpers/target'
import { driver } from './helpers/phone'
import { liveSuite, liveCase } from './helpers/syncLiveCases'
targets('phone')
const fixture = liveSuite(false)
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
    const background = process.env.ABELE_PHONE_BACKGROUND
    if (!background)
      throw new Error('The manager must supply ABELE_PHONE_BACKGROUND for a real Home action')
    try {
      execFileSync(background, [], { timeout: 30000 })
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
