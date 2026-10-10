import { expect } from 'vitest'
import { liveSuite, liveCase } from './helpers/syncLiveCases'
const fixture = liveSuite()
async function heldFixture() {
  const s = fixture(),
    a = s.primary,
    b = s.peer!,
    id = await s.connect()
  await s.connect(b)
  const paths = Array.from({ length: 60 }, (_, i) => s.root + '/bulk/note-' + i + '.md')
  for (const path of paths) a.create(path, 'held fixture')
  await s.cycle()
  await a.pause(id, true)
  a.remove([s.root + '/bulk'])
  await a.pause(id, false)
  await a.syncNow()
  return { s, a, b, id, paths }
}
liveCase(
  'syncDeletes',
  'bulk deletions stay held until Put them back restores every file',
  [56, 103],
  async () => {
    const { s, a, b, paths } = await heldFixture()
    expect((await s.items()).filter((one) => paths.includes(one.path))).toHaveLength(60)
    a.run(
      `host.presentReviews();await poll(()=>document.querySelector('.abele-held-deletes'));await press(document.querySelector('.abele-held-deletes'),'Put them back');return true`
    )
    await s.cycle()
    expect(a.filesUnder(s.root + '/bulk')).toHaveLength(60)
    expect(b.filesUnder(s.root + '/bulk')).toHaveLength(60)
    expect((await s.client().trash()).filter((one) => paths.includes(one.path))).toHaveLength(0)
    for (const device of [a, b])
      expect(device.vault().run(['dev:errors'], 20000)).not.toMatch(
        /plugin:abele|\/plugins\/abele\//
      )
  },
  fixture
)
liveCase(
  'syncDeletes',
  'confirmed Delete everywhere and native bulk restore update both devices',
  [51, 56],
  async () => {
    const { s, a, b, paths } = await heldFixture()
    a.run(
      `host.presentReviews();await poll(()=>document.querySelector('.abele-held-deletes'));await press(document.querySelector('.abele-held-deletes'),'Delete everywhere');await poll(()=>document.querySelector('.abele-confirm__message'));await press(document.querySelector('.abele-confirm__message').closest('.modal'),'Delete everywhere');return true`
    )
    await s.cycle()
    expect(a.filesUnder(s.root + '/bulk')).toHaveLength(0)
    expect(b.filesUnder(s.root + '/bulk')).toHaveLength(0)
    await a.trash()
    a.run(
      `const root=document.querySelector('.abele-deleted-files');const row=root.querySelector('.abele-restore-since');const select=row.querySelector('select');select.value='hour';select.dispatchEvent(new Event('change',{bubbles:true}));await press(row,'Restore 60…');await poll(()=>document.querySelector('.abele-confirm__message'));await press(document.querySelector('.abele-confirm__message').closest('.modal'),'Restore');return true`
    )
    await s.cycle()
    expect(a.filesUnder(s.root + '/bulk')).toHaveLength(paths.length)
    expect(b.filesUnder(s.root + '/bulk')).toHaveLength(paths.length)
  },
  fixture
)
liveCase(
  'syncDeletes',
  'paused Sync now from the palette sends nothing and Resume sends saved edits',
  [101],
  async () => {
    const s = fixture(),
      a = s.primary,
      id = await s.connect(),
      path = s.root + '/paused.md'
    await a.pause(id, true)
    a.create(path, 'saved while paused')
    a.run(`app.commands.executeCommandById('abele:sync-now');return true`)
    expect((await s.items()).some((one) => one.path === path)).toBe(false)
    expect(a.read(path)).toBe('saved while paused')
    await a.pause(id, false)
    await a.syncNow()
    expect((await s.items()).some((one) => one.path === path)).toBe(true)
  },
  fixture
)
liveCase(
  'syncDeletes',
  'a second native Restore queues behind an unfinished first restore',
  [51, 103],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      id = await s.connect(),
      paths = [s.root + '/first.md', s.root + '/second.md']
    await s.connect(b)
    for (const path of paths) a.create(path, 'queued restore content')
    await s.cycle()
    a.remove(paths)
    await s.cycle()
    await a.trash()
    a.run(
      `const client=svc.runtimes.get(${JSON.stringify(id)}).historyClient;window.__abeleRestoreOriginal=client.restoreDeleted.bind(client);client.restoreDeleted=async(...args)=>{await new Promise(resolve=>window.__abeleRestoreRelease=resolve);client.restoreDeleted=window.__abeleRestoreOriginal;return client.restoreDeleted(...args)};const box=document.querySelector('.abele-deleted-files');const row=path=>[...box.querySelectorAll('.abele-card')].find(one=>textOf(one.querySelector('.abele-card__name'))===path);await press(row(${JSON.stringify(paths[0])}),'Restore');await poll(()=>window.__abeleRestoreRelease);await press(row(${JSON.stringify(paths[1])}),'Restore');return true`
    )
    try {
      expect(
        a.run(
          `const row=[...document.querySelectorAll('.abele-deleted-files .abele-card')].find(one=>textOf(one.querySelector('.abele-card__name'))===${JSON.stringify(paths[1])});return textOf(row.querySelector('button'))`
        )
      ).toBe('Queued')
    } finally {
      a.run(
        `window.__abeleRestoreRelease();delete window.__abeleRestoreRelease;delete window.__abeleRestoreOriginal;return true`
      )
    }
    await a.long(
      'queued restores finish',
      `await poll(()=>${JSON.stringify(paths)}.every(path=>app.vault.getFileByPath(path)));return true`
    )
    await s.cycle()
    expect(paths.map((path) => b.read(path))).toEqual([
      'queued restore content',
      'queued restore content',
    ])
  },
  fixture
)
liveCase(
  'syncDeletes',
  'paused held-delete answers wait for Resume and the later answer replaces the first',
  [56, 103],
  async () => {
    const { s, a, b, id, paths } = await heldFixture()
    a.run(`document.querySelector('.modal-close-button')?.click();return true`)
    await a.pause(id, true)
    a.run(
      `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(id)}),'settings');await poll(()=>settingsDoc().querySelector('.abele-held-deletes'));const box=settingsDoc().querySelector('.abele-held-deletes');await press(box,'Delete everywhere');await poll(()=>modal('Delete 60 files everywhere?'));await press(modal('Delete 60 files everywhere?'),'Delete everywhere');await press(box,'Put them back');await closeSettings();return true`
    )
    expect((await s.client().trash()).filter((one) => paths.includes(one.path))).toHaveLength(0)
    expect(a.filesUnder(s.root + '/bulk')).toHaveLength(0)
    await a.pause(id, false)
    await s.cycle()
    expect(a.filesUnder(s.root + '/bulk')).toHaveLength(60)
    expect(b.filesUnder(s.root + '/bulk')).toHaveLength(60)
    expect((await s.client().trash()).filter((one) => paths.includes(one.path))).toHaveLength(0)
  },
  fixture
)
liveCase(
  'syncDeletes',
  'deleting a large folder while running still holds every child until restored',
  [56],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      paths = Array.from({ length: 60 }, (_, i) => s.root + '/live-folder/' + i + '.md')
    await s.connect()
    await s.connect(b)
    for (const path of paths) a.create(path, 'folder guard content')
    await s.cycle()
    a.remove([s.root + '/live-folder'])
    await a.syncNow()
    expect((await s.items()).filter((one) => paths.includes(one.path))).toHaveLength(60)
    a.run(
      `host.presentReviews();await poll(()=>document.querySelector('.abele-held-deletes'));await press(document.querySelector('.abele-held-deletes'),'Put them back');return true`
    )
    await s.cycle()
    expect(a.filesUnder(s.root + '/live-folder')).toHaveLength(60)
    expect(b.filesUnder(s.root + '/live-folder')).toHaveLength(60)
    expect((await s.client().trash()).filter((one) => paths.includes(one.path))).toHaveLength(0)
  },
  fixture
)
liveCase(
  'syncDeletes',
  'small deletes and renamed directories leave no old file or empty folder',
  [45, 54, 56],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      path = s.root + '/from/sample.md'
    await s.connect()
    await s.connect(b)
    a.create(path, 'sample')
    await s.cycle()
    b.rename(s.root + '/from', s.root + '/to')
    await s.cycle()
    expect(a.exists(path)).toBe(false)
    expect(a.exists(s.root + '/from')).toBe(false)
    expect(a.read(s.root + '/to/sample.md')).toBe('sample')
    b.remove([s.root + '/to'])
    await s.cycle()
    expect(a.exists(s.root + '/to')).toBe(false)
  },
  fixture
)
