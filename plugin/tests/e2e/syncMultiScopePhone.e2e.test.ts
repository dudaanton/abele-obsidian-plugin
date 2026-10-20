import { expect, it } from 'vitest'
import { decodeAccessToken } from '@abele/sync-sdk/protocol'
import { V2Client } from '../../src/sync/v2/client'
import { targets } from './helpers/target'
import { liveSuite } from './helpers/syncLiveCases'
import { fixtureFetch } from './helpers/syncServer'
import { waitFor } from './helpers/syncVault'
import { driver, phoneHome, screenshot } from './helpers/phone'
import { shotDir } from './helpers/shots'
import { createServerFolder } from './helpers/syncServerFolder'

targets('phone')
const fixture = liveSuite(false)

it('multi-scope S7: scan three items, pick up an addition on foreground and retain a removed copy', async () => {
  const s = fixture(),
    phone = s.primary
  const folder = s.root + '/Phone collection',
    group = s.root + '/Phone group.md',
    single = s.root + '/Phone file.md'
  await s.put(folder + '/kept.md', 'keep this copy')
  await s.put(group, 'sample group')
  await s.put(single, 'sample single file')
  const ownerId = await s.connect()
  await phone.long(
    'item capability',
    `await poll(()=>svc.itemSets.several(${JSON.stringify(ownerId)}));return true`
  )
  const issued = await phone.shareSet(ownerId, [
    'Folder: ' + folder,
    'Group: Phone group',
    'File: ' + single,
  ])
  await phone.disconnect(ownerId)
  phone.remove([folder + '/kept.md', group, single])
  const id = await s.connect(phone, issued.token, issued.image)
  expect(phone.rows()).toHaveLength(1)
  expect(phone.read(folder + '/kept.md')).toBe('keep this copy')
  expect(phone.read(group)).toBe('sample group')
  expect(phone.read(single)).toBe('sample single file')
  const key = decodeAccessToken(issued.token),
    api = new V2Client(key, fixtureFetch)
  const owner = new V2Client(decodeAccessToken(s.server.rootToken), fixtureFetch)
  const tokenId = (await api.connection()).token_id
  const initial = (await api.itemClient().items()).items
  const addedFolder = await createServerFolder(s, s.root + '/Added while away')
  const addedPath = addedFolder.path + '/arrived.md'
  await s.put(addedPath, 'arrived on foreground')
  try {
    phoneHome()
    await owner.itemClient().addItem(tokenId, { kind: 'folder', id: addedFolder.file_id })
  } finally {
    driver(['launch', 'md.obsidian'])
  }
  await waitFor(
    'added item after foreground',
    () => phone.read(addedPath) === 'arrived on foreground',
    90000
  )
  const removed = initial.find((item) => item.scope.kind === 'folder')!
  await owner.itemClient().removeItem(tokenId, removed.id)
  await phone.syncNow(id)
  expect(phone.read(folder + '/kept.md')).toBe('keep this copy')
  const items = phone.run<{ state: { kind: string } }[]>(
    `return svc.itemSets.items(${JSON.stringify(id)})`
  )
  expect(items.some((item) => item.state.kind === 'detached')).toBe(true)
  phone.run(
    `const root=await openSyncTab();connectionRow(root,${JSON.stringify(id)}).click();await poll(()=>inWindows('.abele-connection-items__item_detached'));return true`
  )
  screenshot(shotDir('abele-sync-multi-scope-phone') + '/retained-item.png')
}, 240000)
