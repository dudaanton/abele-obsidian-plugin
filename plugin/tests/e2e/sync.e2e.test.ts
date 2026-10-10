import { expect } from 'vitest'
import { liveSuite, liveCase } from './helpers/syncLiveCases'
const fixture = liveSuite()
liveCase(
  'sync',
  'edits renames moves deletes and empty folders travel both ways',
  [12, 35, 43, 44, 45, 46, 51, 53, 54, 56],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      path = s.root + '/shared/sample.md'
    await s.connect()
    a.create(path, 'one\ntwo\nthree\n')
    await a.syncNow()
    await s.connect(b, await a.share(s.ids.get(a)![0], 'Whole vault'))
    await s.cycle()
    expect(b.read(path)).toBe(a.read(path))
    b.create(path, 'remote\ntwo\nthree\n')
    await s.cycle()
    expect(a.read(path)).toBe(b.read(path))
    a.rename(path, s.root + '/shared/renamed.md')
    await s.cycle()
    expect(b.exists(path)).toBe(false)
    b.rename(s.root + '/shared/renamed.md', s.root + '/moved/sample.md')
    await s.cycle()
    expect(a.read(s.root + '/moved/sample.md')).toBe('remote\ntwo\nthree\n')
    a.run(
      `await app.vault.createFolder(${JSON.stringify(s.root + '/empty/child')}).catch(()=>{});return true`
    )
    await s.cycle()
    expect(b.exists(s.root + '/empty/child')).toBe(true)
    a.rename(s.root + '/moved', s.root + '/renamed-folder')
    await s.cycle()
    expect(b.exists(s.root + '/renamed-folder/sample.md')).toBe(true)
    b.remove([s.root + '/renamed-folder'])
    await s.cycle()
    expect(a.exists(s.root + '/renamed-folder/sample.md')).toBe(false)
    a.remove([s.root + '/empty'])
    await s.cycle()
    expect(b.exists(s.root + '/empty')).toBe(false)
  },
  fixture
)
liveCase(
  'sync',
  'disjoint lines merge and conflicting lines make exactly one stable copy',
  [91, 92, 94, 96, 100],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      path = s.root + '/merge.md'
    const aid = await s.connect(),
      bid = await s.connect(b, await a.share(aid, 'Whole vault'))
    a.create(path, 'one\ntwo\nthree\n')
    await s.cycle()
    await a.pause(aid, true)
    await b.pause(bid, true)
    a.create(path, 'local\ntwo\nthree\n')
    b.create(path, 'one\ntwo\nremote\n')
    await a.pause(aid, false)
    await a.syncNow()
    await b.pause(bid, false)
    await s.cycle()
    expect(a.read(path)).toBe('local\ntwo\nremote\n')
    expect(b.read(path)).toBe(a.read(path))
    await a.pause(aid, true)
    await b.pause(bid, true)
    a.create(path, 'first\nfirst second line\nremote\n')
    b.create(path, 'second\nsecond second line\nremote\n')
    await a.pause(aid, false)
    await a.syncNow()
    await b.pause(bid, false)
    await s.cycle()
    const copies = a.filesUnder(s.root).filter((one) => one.includes('(Conflicted copy'))
    expect(copies).toHaveLength(1)
    expect(b.filesUnder(s.root).filter((one) => one.includes('(Conflicted copy'))).toEqual(copies)
    expect([a.read(path), a.read(copies[0])].sort()).toEqual(
      ['first\nfirst second line\nremote\n', 'second\nsecond second line\nremote\n'].sort()
    )
    const unchanged = a.read(path)
    await s.cycle()
    await s.cycle()
    expect(a.filesUnder(s.root).filter((one) => one.includes('(Conflicted copy'))).toEqual(copies)
    expect(a.read(path)).toBe(unchanged)
  },
  fixture
)
liveCase(
  'sync',
  'binary bytes and original modification time arrive intact',
  [69, 70, 71, 73, 110],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      path = s.root + '/binary/sample.bin'
    await s.connect()
    await s.connect(b)
    a.create(path, 'binary fixture')
    a.run(
      `await app.vault.adapter.writeBinary(${JSON.stringify(path)},Uint8Array.from([0,255,1,2]).buffer,{mtime:1000});return true`
    )
    await s.cycle()
    expect(
      b.run(
        `return [...new Uint8Array(await app.vault.adapter.readBinary(${JSON.stringify(path)}))]`
      )
    ).toEqual([0, 255, 1, 2])
    expect((await s.items()).find((one) => one.path === path)?.mtime).toBe(1000)
    b.rename(path, s.root + '/binary/renamed.bin')
    await s.cycle()
    expect(a.exists(path)).toBe(false)
    b.remove([s.root + '/binary/renamed.bin'])
    await s.cycle()
    expect(a.exists(s.root + '/binary/renamed.bin')).toBe(false)
  },
  fixture
)
liveCase(
  'sync',
  'history and trash restore through the native dialogs',
  [44, 51],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      path = s.root + '/history.md'
    await s.connect()
    await s.connect(b)
    a.create(path, 'first version')
    await s.cycle()
    a.create(path, 'second version')
    await s.cycle()
    await a.history(path)
    await a.restore('.abele-version-history', '#1')
    await s.cycle()
    expect(a.read(path)).toBe('first version')
    expect(b.read(path)).toBe('first version')
    a.run(`document.querySelector('.modal-close-button')?.click();return true`)
    a.remove([path])
    await s.cycle()
    await a.trash()
    await a.restore('.abele-deleted-files', path)
    await s.cycle()
    expect(a.read(path)).toBe('first version')
    expect(b.read(path)).toBe('first version')
  },
  fixture
)
