import {
  decodeAccessToken,
  V2CommitRequestSchema,
  V2CommitResponseSchema,
} from '@abele/sync-sdk/protocol'
import { rawManifest } from '../../helpers/rawManifest'
import { fixtureFetch } from './syncServer'
import { expect } from 'vitest'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { TokenSyncLive } from './tokenSyncLive'
import { evidenceDirectory } from './syncLiveCases'
import { onPhone } from './target'
import { screenshot } from './phone'

function serverState(items: Awaited<ReturnType<TokenSyncLive['items']>>) {
  // seq identifies the manifest snapshot, not a file revision.
  return items.map((item) => ({
    file_id: item.file_id,
    path: item.path,
    kind: item.kind,
    version_id: item.version_id,
    ...(item.kind === 'directory' ? {} : { sha: item.sha, size: item.size }),
  }))
}

async function connectedFolder(s: TokenSyncLive) {
  const a = s.primary,
    folder = s.root + '/shared'
  const owner = await s.connect()
  a.create(folder + '/sample.md', 'root recovery content')
  a.create(folder + '/nested/second.md', 'nested recovery content')
  await a.syncNow(owner)
  const token = await a.share(owner, 'Folder: ' + folder)
  await a.disconnect(owner)
  const id = await s.connect(a, token)
  return { a, folder, id }
}

function capture(s: TokenSyncLive, state: string) {
  s.primary.run(
    `await poll(()=>![...new Set([document,settingsDoc()])].some(doc=>[...doc.querySelectorAll('.notice')].some(notice=>textOf(notice).includes('Connection saved'))),15000,'connection notice to disappear before screenshot');return true`
  )
  const directory = evidenceDirectory()
  mkdirSync(directory, { recursive: true })
  const path = join(
    directory,
    'root-folder-' + state + '-' + (onPhone() ? 'iPhone' : 'Mac') + '.png'
  )
  if (onPhone()) screenshot(path)
  else
    s.primary.run(
      `const doc=settingsDoc();const remote=(doc.defaultView.require||require)('@electron/remote');require('fs').writeFileSync(${JSON.stringify(path)},(await remote.getCurrentWindow().webContents.capturePage()).toPNG());return true`
    )
}

function stoppedRow(s: TokenSyncLive, id: string, reason: string) {
  return s.primary.run<{ line: string; disabled: boolean; state: string; lastSyncAt: number }>(
    `await poll(()=>svc.rows.value.find(row=>row.id===${JSON.stringify(id)})?.rootIssue);const root=await openSyncTab();const row=connectionRow(root,${JSON.stringify(id)});row.scrollIntoView({block:'center'});await poll(()=>textOf(row).includes(${JSON.stringify(reason)}));const button=row.querySelector('svg.lucide-refresh-cw').closest('.abele-obsidian-icon');const status=host.live.get(${JSON.stringify(id)}).engine.status;return {line:textOf(row),disabled:button.classList.contains('abele-obsidian-icon_disabled'),state:status.state,lastSyncAt:status.lastSyncAt}`
  )
}

function openAction(s: TokenSyncLive, id: string, title: string) {
  s.primary.run(
    `const root=await openSyncTab();icon(connectionRow(root,${JSON.stringify(id)}),'more-horizontal');await poll(()=>[...new Set([document,settingsDoc()])].some(doc=>[...doc.querySelectorAll('.menu-item')].some(item=>textOf(item)===${JSON.stringify(title)})));return true`
  )
}

async function chooseAction(s: TokenSyncLive, id: string, title: string) {
  await s.primary.long(
    'recover folder connection',
    `const item=[...new Set([document,settingsDoc()])].flatMap(doc=>[...doc.querySelectorAll('.menu-item')]).find(item=>textOf(item)===${JSON.stringify(title)});if(!item)throw new Error('Recovery action missing');item.click();await poll(()=>{const row=svc.rows.value.find(row=>row.id===${JSON.stringify(id)});return row&&!row.rootIssue&&!row.paused&&row.status==='idle'&&host.live.get(row.id).engine.status.state==='idle'});await closeSettings();return true`
  )
  await s.primary.syncNow(id)
}

export async function deletedRootRecovery(s: TokenSyncLive) {
  const { a, folder, id } = await connectedFolder(s)
  const before = serverState(await s.items())
  a.remove([folder])
  const stopped = stoppedRow(s, id, 'Folder is gone; sync stopped')
  expect(stopped.disabled).toBe(true)
  expect(stopped.state).toBe('paused')
  capture(s, 'deleted-row')
  // Even an explicit request must leave the stopped connection and server alone.
  expect(
    a.run(
      `try{await svc.sync(${JSON.stringify(id)});return 'allowed'}catch(error){return error.message}`
    )
  ).toMatch(/paused|folder/i)
  expect(stoppedRow(s, id, 'Folder is gone; sync stopped').lastSyncAt).toBe(stopped.lastSyncAt)
  expect(serverState(await s.items())).toEqual(before)
  expect(a.exists(folder)).toBe(false)
  openAction(s, id, 'Restore from the server')
  capture(s, 'deleted-menu')
  await chooseAction(s, id, 'Restore from the server')
  expect(a.read(folder + '/sample.md')).toBe('root recovery content')
  expect(a.read(folder + '/nested/second.md')).toBe('nested recovery content')
  expect(serverState(await s.items())).toEqual(before)
  a.create(folder + '/resumed.md', 'sync resumed')
  await a.syncNow(id)
  expect((await s.items()).some((item) => item.path === folder + '/resumed.md')).toBe(true)
}

export async function movedRootRecovery(s: TokenSyncLive) {
  const { a, folder, id } = await connectedFolder(s)
  const moved = s.root + '/moved',
    before = serverState(await s.items())
  a.rename(folder, moved)
  const stopped = stoppedRow(s, id, 'Folder moved to ' + moved + '; sync stopped')
  expect(stopped.disabled).toBe(true)
  expect(stopped.state).toBe('paused')
  capture(s, 'moved-row')
  expect(serverState(await s.items())).toEqual(before)
  openAction(s, id, 'Follow moved folder')
  capture(s, 'moved-menu')
  await chooseAction(s, id, 'Follow moved folder')
  expect(serverState(await s.items())).toEqual(before)
  expect(a.exists(folder)).toBe(false)
  expect(a.read(moved + '/nested/second.md')).toBe('nested recovery content')
  a.create(moved + '/resumed.md', 'sync followed')
  await a.syncNow(id)
  const after = await s.items()
  expect(serverState(after.filter((item) => item.path !== folder + '/resumed.md'))).toEqual(before)
  expect(after.some((item) => item.path === folder + '/resumed.md')).toBe(true)
  expect(after.some((item) => item.path === moved || item.path.startsWith(moved + '/'))).toBe(false)
}

export async function serverRenamedRootRecovery(s: TokenSyncLive) {
  const { a, folder, id } = await connectedFolder(s)
  const renamed = s.root + '/renamed-on-server'
  a.create(renamed + '/private.md', 'unrelated local bytes')
  const root = (await rawManifest(s.server.rootToken, fixtureFetch)).find(
    (item) => item.kind === 'directory' && item.path === folder
  )
  if (!root) throw new Error('The shared directory is missing from the raw server manifest')
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
        ops: [
          {
            op: 'move_directory',
            file_id: root.file_id,
            base_version_id: root.version_id,
            to_path: renamed,
          },
        ],
      })
    ),
  })
  expect(response.ok).toBe(true)
  const outcome = V2CommitResponseSchema.parse(await response.json())
  expect(outcome.results.every((item) => item.status === 'applied')).toBe(true)
  const before = serverState(await s.items())
  a.run(`try{await svc.sync(${JSON.stringify(id)})}catch{}return true`)
  const reason =
    'Shared folder renamed on the server: ' + folder + ' → ' + renamed + '; sync stopped'
  const stopped = stoppedRow(s, id, reason)
  expect(stopped.disabled).toBe(true)
  capture(s, 'server-renamed-row')
  expect(a.read(folder + '/sample.md')).toBe('root recovery content')
  expect(a.read(renamed + '/private.md')).toBe('unrelated local bytes')
  expect(a.exists(renamed + '/sample.md')).toBe(false)
  openAction(s, id, 'Keep syncing into the same local folder')
  capture(s, 'server-renamed-menu')
  await chooseAction(s, id, 'Keep syncing into the same local folder')
  expect(serverState(await s.items())).toEqual(before)
  a.create(folder + '/after-server-rename.md', 'local edit after confirmation')
  await a.syncNow(id)
  const after = await s.items()
  expect(after.some((item) => item.path === renamed + '/after-server-rename.md')).toBe(true)
  expect(after.some((item) => item.path.endsWith('/private.md'))).toBe(false)
  expect(
    serverState(after.filter((item) => item.path !== renamed + '/after-server-rename.md'))
  ).toEqual(before)
  expect(a.read(renamed + '/private.md')).toBe('unrelated local bytes')
}
