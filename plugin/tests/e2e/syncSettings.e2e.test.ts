import { expect } from 'vitest'
import { liveSuite, liveCase } from './helpers/syncLiveCases'
import { reloadAs } from './helpers/phoneWindow'
import { waitFor } from './helpers/syncVault'
const fixture = liveSuite()
liveCase(
  'syncSettings',
  'every incoming executable create change rename and delete waits for exact review',
  [85, 86, 87, 88, 89, 90],
  async () => {
    const s = fixture(),
      a = s.primary,
      path = s.root + '/sample.js',
      id = await s.connect()
    await s.put(path, '// reviewed candidate one')
    await a.syncNow()
    expect(a.exists(path)).toBe(false)
    const first = a.candidates().find((one) => one.path === path)!
    expect(first.source.id).toBe(id)
    expect(first.receivedAt).toBeGreaterThan(0)
    expect(first.mtime).toBeGreaterThan(0)
    await s.put(s.root + '/ordinary.md', 'ordinary receive')
    await a.syncNow()
    expect(a.read(s.root + '/ordinary.md')).toBe('ordinary receive')
    await a.review(path, 'Approve')
    expect(a.read(path)).toBe('// reviewed candidate one')
    expect(
      Math.abs(
        a.run<number>(`return (await app.vault.adapter.stat(${JSON.stringify(path)})).mtime`) -
          first.mtime
      )
    ).toBeLessThan(2)
    await s.put(path, '// candidate two')
    await a.syncNow()
    expect(a.read(path)).toBe('// reviewed candidate one')
    await a.review(path, 'Reject')
    expect(a.read(path)).toBe('// reviewed candidate one')
    await s.put(path, '// candidate three')
    await a.syncNow()
    a.run(
      `await app.plugins.disablePlugin('abele');await app.plugins.enablePlugin('abele');return true`
    )
    await a.waitIdle(id)
    expect(a.candidates().find((one) => one.path === path)?.source.id).toBe(id)
    await a.review(path, 'Approve')
    expect(a.read(path)).toBe('// candidate three')
    const file = (await s.items()).find((one) => one.path === path)!,
      to = s.root + '/renamed.js'
    await s.commit([
      { op: 'move', file_id: file.file_id, base_version_id: file.version_id, to_path: to },
    ])
    await a.syncNow()
    expect(a.exists(path)).toBe(true)
    expect(a.exists(to)).toBe(false)
    await a.review(to, 'Approve')
    expect(a.read(to)).toBe('// candidate three')
    const moved = (await s.items()).find((one) => one.path === to)!
    await s.commit([{ op: 'delete', file_id: moved.file_id, base_version_id: moved.version_id }])
    await a.syncNow()
    expect(a.exists(to)).toBe(true)
    await a.review(to, 'Reject')
    expect(a.exists(to)).toBe(true)
  },
  fixture
)
liveCase(
  'syncSettings',
  'approval of an open candidate never approves its later replacement',
  [87, 89],
  async () => {
    const s = fixture(),
      a = s.primary,
      path = s.root + '/review.js'
    await s.connect()
    await s.put(path, '// first immutable review')
    await a.syncNow()
    a.run(
      `const root=await openSyncTab();const row=[...root.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))===${JSON.stringify(path)});icon(row,'eye');await poll(()=>modal('Review incoming code'));return true`
    )
    await s.put(path, '// later candidate')
    await a.syncNow()
    a.run(`await press(modal('Review incoming code'),'Approve');return true`)
    expect(a.read(path)).toBe('// first immutable review')
    expect(a.candidates().some((one) => one.path === path)).toBe(true)
    await a.review(path, 'Approve')
    expect(a.read(path)).toBe('// later candidate')
  },
  fixture
)
liveCase(
  'syncSettings',
  'the plugin own code is staged with provenance while ordinary notes continue',
  [83, 85, 88, 90],
  async () => {
    const s = fixture(),
      a = s.primary,
      path = '.obsidian/plugins/abele/sample-review.js'
    a.run(
      `await app.vault.adapter.write('.abele-sync-ignore',${JSON.stringify('*\n!' + s.root + '/\n!' + s.root + '/**\n!.obsidian/\n!.obsidian/plugins/\n!.obsidian/plugins/abele/\n!' + path + '\n')});return true`
    )
    const id = await s.connect()
    await s.put(path, '// inert own-plugin fixture')
    await s.put(s.root + '/continues.md', 'ordinary content')
    await a.syncNow()
    const candidate = a.candidates().find((one) => one.path === path)
    expect(candidate?.source.id).toBe(id)
    expect(candidate?.source.address).toBe(s.server.url)
    expect(a.exists(path)).toBe(false)
    expect(a.read(s.root + '/continues.md')).toBe('ordinary content')
    await a.review(path, 'Reject')
    expect(a.exists(path)).toBe(false)
  },
  fixture
)
liveCase(
  'syncSettings',
  'partial folder and group connections never carry Obsidian configuration',
  [84],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      folder = s.root + '/shared'
    const id = await s.connect()
    a.create(folder + '/sample.md', 'shared')
    a.create(folder + '/sample.js', '// shared code')
    a.create(s.root + '/ConfigurationGroup.md', 'group root')
    a.create(
      s.root + '/member.md',
      '---\ngroups: ["[[' + s.root + '/ConfigurationGroup]]"]\n---\nmember'
    )
    await a.syncNow()
    const config = '.obsidian/plugins/abele/partial-sample-' + s.root.slice(-8) + '.js'
    await s.put(config, '// private server configuration')
    await s.connect(b, await a.share(id, 'Folder: ' + folder))
    await b.syncNow()
    expect(b.candidates().some((one) => one.path === folder + '/sample.js')).toBe(true)
    expect(b.candidates().some((one) => one.path.startsWith('.obsidian/'))).toBe(false)
    await s.connect(b, await a.share(id, 'Group: ConfigurationGroup'))
    await b.syncNow()
    expect(b.read(s.root + '/member.md')).toContain('member')
    expect(b.exists(config)).toBe(false)
    expect(b.candidates().some((one) => one.path.startsWith('.obsidian/'))).toBe(false)
    expect(
      (await s.items()).filter(
        (one) => one.path.startsWith('.obsidian/') && one.path.endsWith('data.json')
      )
    ).toEqual([])
  },
  fixture
)

liveCase(
  'syncSettings',
  'settings review keeps local bytes on Later and Keep and applies incoming bytes with one reload',
  [83, 103],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      path = '.obsidian/hotkeys.json',
      devices = [a, b]
    const saved = devices.map((one) => one.read(path))
    const incoming = JSON.stringify({ 'editor:toggle-bold': [{ modifiers: ['Mod'], key: 'B' }] })
    const local = JSON.stringify({ 'editor:toggle-italic': [{ modifiers: ['Mod'], key: 'I' }] })
    try {
      for (const device of devices)
        device.run(
          `await app.vault.adapter.write('.abele-sync-ignore',${JSON.stringify('*\n!' + s.root + '/\n!' + s.root + '/**\n!.obsidian/\n!.obsidian/hotkeys.json\n')});return true`
        )
      a.run(
        `await app.vault.adapter.write(${JSON.stringify(path)},${JSON.stringify(incoming)});return true`
      )
      b.run(
        `await app.vault.adapter.write(${JSON.stringify(path)},${JSON.stringify(local)});return true`
      )
      await s.connect()
      await s.connect(b)
      b.run(
        `host.presentReviews();await poll(()=>document.querySelector('.abele-staged-settings'));await press(document.querySelector('.abele-staged-settings'),'Later');return true`
      )
      expect(b.read(path)).toBe(local)
      b.run(
        `const root=await openSyncTab();icon(connectionRow(root,svc.rows.value[0].id),'settings');await poll(()=>settingsDoc().querySelector('.abele-staged-settings'));await press(settingsDoc().querySelector('.abele-staged-settings'),"Keep this device's");await closeSettings();return true`
      )
      await b.syncNow()
      expect(b.read(path)).toBe(local)
      await s.put(path, incoming)
      await b.syncNow()
      b.run(
        `host.presentReviews();await poll(()=>document.querySelector('.abele-staged-settings'));const root=document.querySelector('.abele-staged-settings');let button=[...root.querySelectorAll('button')].find(one=>/Reload now|Apply and reload/.test(textOf(one)));if(!button)throw new Error('Reload action unavailable');window.__abeleReviewBeforeReload=true;button.click();return true`
      )
      await waitFor(
        'reviewed settings reload to finish',
        () => {
          try {
            return b
              .vault()
              .evalAwait<boolean>(
                `Boolean(!window.__abeleReviewBeforeReload&&window.__abeleTest&&app.plugins.plugins.abele?.tokenEngines)`
              )
          } catch {
            return false
          }
        },
        60000
      )
      await b.waitIdle()
      expect(b.read(path)).toBe(incoming)
    } finally {
      for (const device of devices) {
        for (const id of s.ids.get(device) || [])
          if (device.rows().some((one) => one.id === id)) await device.disconnect(id)
      }
      for (let i = 0; i < devices.length; i++)
        devices[i].run(
          `const path=${JSON.stringify(path)};if(${JSON.stringify(saved[i])}===null){if(await app.vault.adapter.exists(path))await app.vault.adapter.remove(path)}else await app.vault.adapter.write(path,${JSON.stringify(saved[i])});return true`
        )
      for (const device of devices) await reloadAs(device.vault(), false)
    }
  },
  fixture
)
