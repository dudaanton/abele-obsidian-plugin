import { expect } from 'vitest'
import { AccessClient } from '@abele/sync-sdk/core'
import { fixtureFetch } from './helpers/syncServer'
import { liveSuite, liveCase } from './helpers/syncLiveCases'
import {
  exerciseTrustedWindow,
  openTrustedConnection,
  toggleTrusted,
  expectTrustedRow,
  expectDeviceLocalTrust,
} from './helpers/syncTrustedConnection'
import { closeSyncScreens } from './helpers/syncScreens'
const fixture = liveSuite()
liveCase(
  'syncDevices',
  'trusted folder connections persist a device-local toggle and approve only trusted incoming code',
  [85],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      folder = s.root + '/trusted-folder'
    const owner = await s.connect()
    a.create(folder + '/sample.md', 'folder marker')
    await a.syncNow()
    const token = await a.share(owner, 'Folder: ' + folder)
    await a.disconnect(owner)
    // Both vaults use the same token; trust must remain a preference of just one device.
    const sender = await s.connect(a, token),
      recipient = await s.connect(b, token)
    try {
      expect(
        b.run(
          `return svc.registry.records().find(one=>one.id===${JSON.stringify(recipient)}).scope`
        )
      ).toMatchObject({ kind: 'folder', path: folder })
      await exerciseTrustedWindow(b, recipient, 'trusted-connection-desktop')
      openTrustedConnection(b, recipient)
      toggleTrusted(b, recipient, true)
      const installed = folder + '/automatic.js',
        content = '// inert incoming code sample'
      a.create(installed, content)
      await s.cycle()
      b.run(
        `await poll(async()=>await app.vault.adapter.exists(${JSON.stringify(installed)})&&!svc.candidates.value.some(one=>one.path===${JSON.stringify(installed)})&&svc.activity.value[${JSON.stringify(recipient)}]?.events?.some(one=>one.text.includes('Installed code from ')&&one.text.includes(${JSON.stringify(installed)})),30000,'trusted incoming code installed and logged');return true`
      )
      expect(b.read(installed)).toBe(content)
      expect(b.run(`return !!modal('Review incoming code')`)).toBe(false)
      expectDeviceLocalTrust(b, recipient, true)
      expectDeviceLocalTrust(a, sender, false)
      openTrustedConnection(a, sender)
      expectTrustedRow(a, false)
      closeSyncScreens(a)
      openTrustedConnection(b, recipient)
      expectTrustedRow(b, true)
      expect(
        b.run(
          `const box=inWindows('.abele-sync-window');return [...box.querySelectorAll('.abele-sync-window__events li')].some(one=>textOf(one).includes('Installed code from ')&&textOf(one).includes(${JSON.stringify(installed)}))`
        )
      ).toBe(true)
      toggleTrusted(b, recipient, false)
      closeSyncScreens(b)
      const pending = folder + '/waiting.js'
      a.create(pending, '// inert code waiting for approval')
      await s.cycle()
      b.run(
        `await poll(()=>svc.candidates.value.some(one=>one.path===${JSON.stringify(pending)}&&one.source.id===${JSON.stringify(recipient)}),30000,'untrusted incoming code remains pending');return true`
      )
      expect(b.exists(pending)).toBe(false)
      // Another completed exchange must not silently approve the waiting code.
      await s.cycle()
      expect(b.exists(pending)).toBe(false)
      expect(b.candidates().filter((one) => one.path === pending)).toHaveLength(1)
      openTrustedConnection(b, recipient)
      expectTrustedRow(b, false)
    } finally {
      closeSyncScreens(a)
      closeSyncScreens(b)
    }
  },
  fixture
)
liveCase(
  'syncDevices',
  '117 a rendered sharing QR connects a desktop recipient and exchanges files',
  [117],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      id = await s.connect(),
      path = s.root + '/qr.md'
    const qr = await a.shareQr(id)
    expect(qr.image).toMatch(/^data:image\/png;base64,/)
    await s.connect(b, qr.token, qr.image)
    b.create(path, 'decoded QR recipient writes')
    await s.cycle()
    expect(a.read(path)).toBe('decoded QR recipient writes')
  },
  fixture
)
liveCase(
  'syncDevices',
  '21a revoking one own device keeps the other own device exchanging',
  [21],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      owner = await s.connect(),
      path = s.root + '/own-device.md'
    const ownToken = await a.share(owner, 'Whole vault', 'My other device')
    await s.connect(b, ownToken)
    a.create(path, 'before own-device revoke')
    await s.cycle()
    a.run(
      `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(owner)}),'share-2');await poll(()=>modal('Share access'));const box=modal('Share access');let row;await poll(()=>row=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='My other device'));icon(row,'ban');await press(box,'Revoke');await press(box,'Close');await closeSettings();return true`
    )
    await expect(b.syncNow()).rejects.toThrow()
    expect(b.read(path)).toBe('before own-device revoke')
    a.create(path, 'remaining own device edit')
    await a.syncNow(owner)
    const remote = (await s.items()).find((one) => one.path === path)!
    expect(
      new TextDecoder().decode(await s.client().versionBytes(remote.file_id, remote.version_id))
    ).toBe('remaining own device edit')
  },
  fixture
)
liveCase(
  'syncDevices',
  'folder departure keeps the owner file and return delivers its current bytes',
  [43, 45, 46, 47, 48, 49, 51],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      folder = s.root + '/shared',
      path = folder + '/note.md',
      outside = s.root + '/private/note.md',
      id = await s.connect()
    a.create(path, 'shared source')
    await a.syncNow()
    await s.connect(b, await a.share(id, 'Folder: ' + folder))
    await s.cycle()
    b.rename(path, folder + '/renamed.md')
    await s.cycle()
    expect(a.read(folder + '/renamed.md')).toBe('shared source')
    expect(a.exists(path)).toBe(false)
    a.rename(folder + '/renamed.md', outside)
    await s.cycle()
    expect(a.read(outside)).toBe('shared source')
    expect(b.exists(folder + '/renamed.md')).toBe(false)
    a.create(outside, 'current private edit')
    a.rename(outside, path)
    await s.cycle()
    expect(b.read(path)).toBe('current private edit')
    b.remove([path])
    await s.cycle()
    expect(a.exists(path)).toBe(false)
  },
  fixture
)
liveCase(
  'syncDevices',
  'group note arrival and background indexing never publish a private attachment',
  [74, 76, 77, 78, 79, 80, 81],
  async () => {
    const s = fixture(),
      a = s.primary,
      group = s.root + '/ConsentGroup.md',
      note = s.root + '/consent.md',
      asset = s.root + '/private.bin',
      neighbor = s.root + '/neighbor.bin'
    await s.put(group, 'consent group')
    await s.put(note, '---\ngroups: ["[[' + s.root + '/ConsentGroup]]"]\n---\n![[' + asset + ']]')
    const root = (await s.items()).find((one) => one.path === group)!
    a.create(asset, 'private immutable bytes')
    a.create(neighbor, 'private neighbor')
    await s.connect(a, await s.server.issue({ kind: 'group', id: root.file_id }))
    await a.syncNow()
    expect(a.questions()).toHaveLength(0)
    expect((await s.items()).some((one) => one.path === asset)).toBe(false)
    a.open(note)
    await a.consent('Allow')
    await a.syncNow()
    expect((await s.items()).some((one) => one.path === asset)).toBe(true)
    expect((await s.items()).some((one) => one.path === neighbor)).toBe(false)
    a.create(asset, 'future permitted edit')
    await a.syncNow()
    const sent = (await s.items()).find((one) => one.path === asset)!
    expect(
      new TextDecoder().decode(await s.client().versionBytes(sent.file_id, sent.version_id))
    ).toBe('future permitted edit')
    await s.connect(s.peer!, await s.server.issue({ kind: 'group', id: root.file_id }))
    await s.peer!.syncNow()
    expect(s.peer!.read(asset)).toBe('future permitted edit')
    expect(s.peer!.questions()).toHaveLength(0)
    const second = await s.addServer()
    await s.put(group, 'consent group', second)
    await s.put(
      note,
      '---\ngroups: ["[[' + s.root + '/ConsentGroup]]"]\n---\n![[' + asset + ']]',
      second
    )
    const otherRoot = (await s.items(second)).find((one) => one.path === group)!
    await s.connect(a, await second.issue({ kind: 'group', id: otherRoot.file_id }))
    await a.syncNow()
    expect(a.questions()).toHaveLength(0)
    expect((await s.items(second)).some((one) => one.path === asset)).toBe(false)
    a.open(s.root + '/ConsentGroup.md')
    a.open(note)
    await a.consent('Deny')
    await a.syncNow()
    expect((await s.items(second)).some((one) => one.path === asset)).toBe(false)
    expect(a.read(asset)).toBe('future permitted edit')
  },
  fixture
)
liveCase(
  'syncDevices',
  'two servers share one vault and an unavailable server does not stop the other',
  [24, 25, 26, 27, 28, 102],
  async () => {
    const s = fixture(),
      a = s.primary,
      second = await s.addServer(),
      path = s.root + '/both.md'
    const first = await s.connect(),
      other = await s.connect(a, second.rootToken)
    a.create(path, 'same local edit')
    await a.syncNow()
    expect((await s.items()).map((one) => one.path)).toContain(path)
    expect((await s.items(second)).map((one) => one.path)).toContain(path)
    await s.put(path, 'remote edit', second)
    await a.syncNow()
    await a.syncNow(first)
    const file = (await s.items()).find((one) => one.path === path)!
    expect(
      new TextDecoder().decode(await s.client().versionBytes(file.file_id, file.version_id))
    ).toBe('remote edit')
    await second.kill()
    a.create(path, 'offline edit')
    await expect(a.syncNow(other)).rejects.toThrow()
    await a.syncNow(first)
    expect(a.rows()).toHaveLength(2)
    expect((await s.items()).find((one) => one.path === path)?.version_id).not.toBe(file.version_id)
  },
  fixture
)
liveCase(
  'syncDevices',
  'folder and group tokens from Share connect the second pool vault',
  [6, 11, 13, 14, 15, 16, 21, 37, 42, 57, 58, 60, 61],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      folder = s.root + '/folder',
      group = s.root + '/Group.md',
      member = s.root + '/member.md'
    const id = await s.connect()
    a.create(folder + '/sample.md', 'folder content')
    a.create(folder + '/linked.md', '[[' + folder + '/sample|Shared target]]')
    a.create(group, 'group root')
    a.create(member, '---\ngroups: ["[[' + s.root + '/Group]]","[[Unrelated group]]"]\n---\nmember')
    a.create(s.root + '/private.md', 'private')
    await a.syncNow()
    const folderToken = await a.share(id, 'Folder: ' + folder),
      groupToken = await a.share(id, 'Group: Group')
    b.create(folder + '/local.md', 'local inside shared folder')
    b.create(s.root + '/outside.md', 'local outside shared folder')
    b.create(
      s.root + '/local-member.md',
      '---\ngroups: ["[[' + s.root + '/Group]]"]\n---\npre-existing local member'
    )
    await s.connect(b, folderToken)
    await s.connect(b, groupToken)
    await s.cycle()
    expect(b.read(folder + '/sample.md')).toBe('folder content')
    expect(b.read(member)).toContain('[[Unrelated group]]')
    expect(b.exists(s.root + '/private.md')).toBe(false)
    expect(a.read(folder + '/local.md')).toBe('local inside shared folder')
    expect(a.read(s.root + '/local-member.md')).toContain('pre-existing local member')
    expect(b.read(folder + '/linked.md')).toBe('[[' + folder + '/sample|Shared target]]')
    b.open(folder + '/linked.md')
    expect(
      b.run(
        `const leaf=app.workspace.getLeaf(false),state=leaf.getViewState();await leaf.setViewState({...state,state:{...state.state,mode:'preview'}});let link;await poll(()=>link=leaf.view.containerEl.querySelector('a.internal-link[data-href="'+${JSON.stringify(folder + '/sample')}+'"]'));link.click();await poll(()=>app.workspace.getActiveFile()?.path===${JSON.stringify(folder + '/sample.md')});return app.workspace.getActiveFile().path`
      )
    ).toBe(folder + '/sample.md')
    expect((await s.items()).some((one) => one.path === s.root + '/outside.md')).toBe(false)
    b.create(member, b.read(member)! + '\nrecipient edit')
    await s.cycle()
    expect(a.read(member)).toContain('recipient edit')
    const onward = await b.share(s.ids.get(b)![0], 'Folder: ' + folder)
    expect(onward).toMatch(/^[A-Za-z0-9+/=_-]+$/)
    await a.pause(id, true)
    const thirdPath = folder + '/onward-recipient.md'
    b.create(thirdPath, 'new content for third recipient')
    await b.syncNow()
    expect(a.exists(thirdPath)).toBe(false)
    const third = await s.connect(a, onward)
    expect(third).not.toBe(id)
    expect(a.read(thirdPath)).toBe('new content for third recipient')
    a.create(thirdPath, 'third recipient edit')
    await a.syncNow(third)
    await b.syncNow()
    expect(b.read(thirdPath)).toBe('third recipient edit')
    const friend = AccessClient.fromToken(folderToken, { fetch: fixtureFetch })
    await AccessClient.fromToken(s.server.rootToken, { fetch: fixtureFetch }).revoke(
      (await friend.connection()).token_id
    )
    await expect(b.syncNow(s.ids.get(b)![0])).rejects.toThrow()
    a.create(thirdPath, 'onward recipient still authorized after friend revoke')
    await a.syncNow(third)
    const forwarded = (await s.items()).find((one) => one.path === thirdPath)!
    expect(
      new TextDecoder().decode(
        await s.client().versionBytes(forwarded.file_id, forwarded.version_id)
      )
    ).toBe('onward recipient still authorized after friend revoke')
  },
  fixture
)
liveCase(
  'syncDevices',
  'root owner revokes access issued by another participant',
  [19],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      folder = s.root + '/delegated',
      path = folder + '/note.md'
    const owner = await s.connect()
    a.create(path, 'shared participant content')
    await a.syncNow()
    const participant = await s.connect(b, await a.share(owner, 'Folder: ' + folder))
    const onward = await b.share(participant, 'Folder: ' + folder, 'Issued by participant')
    await a.pause(owner, true)
    const recipient = await s.connect(a, onward)
    a.run(
      `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(owner)}),'share-2');await poll(()=>modal('Share access'));const box=modal('Share access');let row;await poll(()=>row=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='Issued by participant'));icon(row,'ban');await press(box,'Revoke');await press(box,'Close');await closeSettings();return true`
    )
    b.create(path, 'after root-owner revocation')
    await b.syncNow(participant)
    await expect(a.syncNow(recipient)).rejects.toThrow()
    expect(a.read(path)).toBe('shared participant content')
    expect(
      (
        await AccessClient.fromToken(s.server.rootToken, { fetch: fixtureFetch }).tokens()
      ).items.find((one) => one.label === 'Issued by participant')?.revoked_at
    ).toBeTruthy()
  },
  fixture
)
liveCase(
  'syncDevices',
  'several partial scopes on one server isolate private files while another root connection works',
  [24, 25, 26],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      owner = await s.connect(),
      left = s.root + '/left',
      right = s.root + '/right',
      group = s.root + '/IsolatedGroup.md'
    a.create(left + '/left.md', 'left scope')
    a.create(right + '/right.md', 'right scope')
    a.create(group, 'group definition')
    a.create(
      s.root + '/group-member.md',
      '---\ngroups: ["[[' + s.root + '/IsolatedGroup]]"]\n---\ngroup scope'
    )
    a.create(s.root + '/owner-private.md', 'owner private')
    await a.syncNow()
    const leftToken = await a.share(owner, 'Folder: ' + left),
      rightToken = await a.share(owner, 'Folder: ' + right),
      groupToken = await a.share(owner, 'Group: IsolatedGroup')
    await s.connect(b, leftToken)
    expect(b.read(left + '/left.md')).toBe('left scope')
    expect(b.exists(right + '/right.md')).toBe(false)
    await s.connect(b, rightToken)
    await s.connect(b, groupToken)
    expect(b.read(right + '/right.md')).toBe('right scope')
    expect(b.read(s.root + '/group-member.md')).toContain('group scope')
    expect(b.exists(s.root + '/owner-private.md')).toBe(false)
    b.create(s.root + '/recipient-private.md', 'recipient private')
    b.create(left + '/new.md', 'left edit')
    await b.syncNow()
    const own = await s.addServer()
    await s.connect(b, own.rootToken)
    await b.syncNow()
    expect((await s.items()).some((one) => one.path === s.root + '/recipient-private.md')).toBe(
      false
    )
    expect((await s.items(own)).some((one) => one.path === s.root + '/recipient-private.md')).toBe(
      true
    )
    expect((await s.items(own)).some((one) => one.path === s.root + '/owner-private.md')).toBe(
      false
    )
    const leftView = await new (await import('@abele/sync-sdk/core')).V2EngineClient(leftToken, {
      fetch: fixtureFetch,
    }).manifest(null)
    expect(
      leftView.items.some(
        (one) => one.path.startsWith(right + '/') || one.path === s.root + '/group-member.md'
      )
    ).toBe(false)
    const groupView = await new (await import('@abele/sync-sdk/core')).V2EngineClient(groupToken, {
      fetch: fixtureFetch,
    }).manifest(null)
    expect(
      groupView.items.some(
        (one) => one.path.startsWith(left + '/') || one.path.startsWith(right + '/')
      )
    ).toBe(false)
  },
  fixture
)
liveCase(
  'syncDevices',
  'revoke stops exchange but keeps files and other device tokens active',
  [18, 19, 22],
  async () => {
    const s = fixture(),
      a = s.primary,
      b = s.peer!,
      path = s.root + '/retained.md',
      id = await s.connect()
    const issued = await a.share(id, 'Whole vault', 'Sample revoked recipient')
    await s.connect(b, issued)
    a.create(path, 'retained local content')
    await s.cycle()
    a.run(
      `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(id)}),'share-2');await poll(()=>modal('Share access'));const box=modal('Share access');let row;await poll(()=>row=[...box.querySelectorAll('.setting-item')].find(one=>textOf(one.querySelector('.setting-item-name'))==='Sample revoked recipient'));icon(row,'ban');await press(box,'Revoke');await press(box,'Close');await closeSettings();return true`
    )
    await expect(b.syncNow()).rejects.toThrow()
    expect(b.read(path)).toBe('retained local content')
    a.create(s.root + '/active.md', 'still active')
    await a.syncNow()
    expect((await s.items()).map((one) => one.path)).toContain(s.root + '/active.md')
    const access = AccessClient.fromToken(s.server.rootToken, { fetch: fixtureFetch })
    expect(
      (await access.tokens()).items.some(
        (one) => one.label === 'Sample revoked recipient' && one.revoked_at
      )
    ).toBe(true)
  },
  fixture
)
liveCase(
  'syncDevices',
  'disconnect is local and leaves other connections and files intact',
  [22, 23, 34],
  async () => {
    const s = fixture(),
      a = s.primary,
      second = await s.addServer(),
      id = await s.connect(),
      other = await s.connect(a, second.rootToken),
      path = s.root + '/kept.md'
    a.create(path, 'kept')
    await a.syncNow()
    await a.disconnect(id)
    expect(a.read(path)).toBe('kept')
    expect(a.rows().map((one) => one.id)).toEqual([other])
    a.create(path, 'still active')
    await a.syncNow(other)
    expect((await s.items(second)).find((one) => one.path === path)).toBeDefined()
  },
  fixture
)
