import { beforeAll, afterAll, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { productionPluginCode, bootProductionPlugin } from '../helpers/productionPlugin'
import { spawnCollaborationStandServer } from '../e2e/helpers/collaborationStandHarness'
import { verifySyncFixture } from '../../scripts/verify-sync-inputs.mjs'
import { readFileSync } from 'node:fs'

let code: string
let native: Awaited<ReturnType<typeof bootProductionPlugin>>
let server: Awaited<ReturnType<typeof spawnCollaborationStandServer>>
let work: string
let peer: Awaited<ReturnType<typeof bootProductionPlugin>>
let unshared: Awaited<ReturnType<typeof bootProductionPlugin>>
let group: any
let groupFlow: any
let groupReview: any
const password = 'invented-owner-password'
const email = 'sample-production-owner@example.com'
beforeAll(async () => {
  const root = verifySyncFixture(process.env.ABELE_SYNC_DIR)
  const commit = JSON.parse(readFileSync('vendor/sync/provenance.json', 'utf8')).commit
  const scratch = resolve('../.scratch/production-sharing')
  mkdirSync(scratch, { recursive: true })
  work = mkdtempSync(join(scratch, 'run-'))
  server = await spawnCollaborationStandServer(root, commit, work)
  server.createAccount(email, password)
  code = await productionPluginCode()
  native = await bootProductionPlugin(code)
}, 120000)
afterAll(async () => {
  try {
    await native?.close()
  } finally {
    await peer?.close()
    await unshared?.close()
    await server?.stop()
    if (work) await rm(work, { recursive: true, force: true })
  }
})

it('installs sharing from the production plugin rather than a test API', async () => {
  expect(code).not.toContain('__abeleTest')
  expect((window as any).__abeleTest).toBeUndefined()
  expect(native.plugin.syncSharing).toBeDefined()
  expect(typeof native.plugin.syncSharing.ownerFolder).toBe('function')
  expect(typeof native.plugin.syncSharing.ownerGroup).toBe('function')
  expect(typeof native.plugin.syncSharing.invitation).toBe('function')
  expect(typeof native.plugin.syncSharing.createScoped).toBe('function')
})

function buttonIn(root: ParentNode, text: string) {
  const button = [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent?.trim() === text
  )
  expect(button).toBeDefined()
  return button!
}
async function syncSettings() {
  const root = native.settings()
  const tab = () =>
    [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find(
      (element) => element.textContent?.trim() === 'Sync'
    )
  await expect.poll(() => !!tab()).toBe(true)
  tab()!.click()
  return root
}
it('enables invitation controls rendered by the unmodified production settings UI', async () => {
  const root = await syncSettings()
  await expect.poll(() => root.textContent).toContain('Join a shared group')
  buttonIn(root, 'Join a shared group…').click()
  await expect.poll(() => !!document.querySelector('.abele-scoped-join')).toBe(true)
  const dialog = document.querySelector('.abele-scoped-join')!
  expect(dialog.textContent).not.toContain('not active')
  expect(buttonIn(dialog, 'Accept invitation and join').disabled).toBe(false)
  for (const input of dialog.querySelectorAll<HTMLInputElement>('input'))
    expect(input.disabled).toBe(false)
  buttonIn(dialog.closest('.modal')!, 'Close').click()
})

it('shares a folder and a prepared group through the production owner ports', async () => {
  const host = native.plugin.syncSharing
  await host.sync.connect(server.url, email, password)
  await host.sync.chooseVault({ create: 'Sample production vault' }, 'Sample owner')
  await native.app.vault.createFolder('Folder share')
  await native.app.vault.createFolder('Notes')
  await native.app.vault.createFolder('Elsewhere')
  await native.app.vault.createFolder('Assets')
  await native.app.vault.create('Folder share/example.md', 'Sample folder note')
  await native.app.vault.create('Notes/Project.md', 'Sample root')
  // The root must exist on the server before a new groups token is introduced.
  await host.sync.syncNow()
  await native.app.vault.create(
    'Elsewhere/member.md',
    '---\ngroups: ["[[Notes/Project]]"]\n---\nSample shared note\n'
  )
  await native.app.vault.createBinary('Assets/private.png', new Uint8Array([21, 22, 23]).buffer)
  await host.sync.syncNow()
  const folder = host.ownerFolder()
  await folder.review('Folder share/', 'reader', 'Sample folder audience')
  const credential = await folder.confirm(password, email)
  expect(credential.token).toMatch(/^absk_/)
  groupFlow = host.ownerGroup()
  groupReview = await groupFlow.review('Notes/Project.md', 'editor', 'Sample project audience')
  for (let page = 0; page < 100; page++) {
    group = await groupFlow.confirm(groupReview, password, email)
    if (group.state === 'active') break
  }
  expect(group.state).toBe('active')
  expect(host.audiences.value).toContain(group.id)
}, 30000)

it('enables owner review controls rendered by the unmodified production settings UI', async () => {
  const root = await syncSettings()
  await expect.poll(() => root.textContent).toContain('Review folder sharing')
  expect(root.textContent).not.toContain('Sharing is not active')
  for (const [action, selector, review] of [
    ['Review folder sharing', '.abele-folder-sharing', 'Review current folder'],
    ['Review group sharing', '.abele-group-review', 'Review root and current scope'],
    ['Review initial asset batch', '.abele-initial-batch', null],
  ] as const) {
    expect(buttonIn(root, action).disabled).toBe(false)
    buttonIn(root, action).click()
    await expect.poll(() => !!document.querySelector(selector)).toBe(true)
    const dialog = document.querySelector(selector)!
    expect(dialog.textContent).not.toContain('not active')
    if (review) expect(buttonIn(dialog, review).disabled).toBe(false)
    buttonIn(dialog.closest('.modal')!, 'Close').click()
    await expect.poll(() => !!document.querySelector(selector)).toBe(false)
  }
})

it('joins a collaborator with the production scoped host and no personal credential fallback', async () => {
  const collaborator = 'sample-production-collaborator@example.com'
  server.createAccount(collaborator, password)
  const invitation = await groupFlow.invitation('editor')
  peer = await bootProductionPlugin(code)
  const host = peer.plugin.syncSharing
  const flow = host.invitation(server.url)
  await flow.begin({
    issuer: server.url,
    token: invitation,
    email: collaborator,
    name: 'Sample scoped collaborator',
    role: 'editor',
    platform: 'desktop',
  })
  const joined = await flow.resume(password)
  expect(joined.phase).toBe('joined')
  expect(host.scope.value).toMatchObject({
    facet: 'scoped',
    principalKind: 'installation',
    scriptPolicy: 'refuse',
  })
  expect(await peer.app.vault.adapter.read('Elsewhere/member.md')).toContain('Sample shared note')
  expect(await peer.app.vault.adapter.exists('Assets/private.png')).toBe(false)
  expect(host.sync.connection.value.deviceTokenId).toBe('')
}, 30000)

it('creates a reviewed scoped note through the production scoped creation ports', async () => {
  const host = peer.plugin.syncSharing
  const flow = await host.createScoped()
  const review = await flow.review({
    kind: 'note',
    path: 'Elsewhere/new-scoped.md',
    text: 'Sample collaborator-created note',
    rootId: group.rootId,
  })
  await expect
    .poll(
      async () => {
        try {
          await flow.confirm(review)
          return true
        } catch (error) {
          if ((error as { code?: string }).code === 'scope_updating') return false
          throw error
        }
      },
      { timeout: 10000 }
    )
    .toBe(true)
  await host.scoped.sync()
  await native.plugin.syncSharing.sync.syncNow()
  expect(await peer.app.vault.adapter.read('Elsewhere/new-scoped.md')).toContain(
    'Sample collaborator-created note'
  )
  expect(await native.app.vault.adapter.read('Elsewhere/new-scoped.md')).toContain(
    'Sample collaborator-created note'
  )
}, 30000)

it('creates a scoped image with its own upload proof and an exact intrinsic sponsor', async () => {
  const host = peer.plugin.syncSharing
  const flow = await host.createScoped()
  const selected = flow.sponsors.find(
    (candidate: { fileId: string }) => candidate.fileId === group.rootId
  )
  expect(selected).toBeDefined()
  const { label: _label, ...sponsor } = selected
  const review = await flow.review({
    kind: 'asset',
    path: 'Assets/scoped-new.png',
    bytes: new Uint8Array([7, 8, 9]),
    sponsor,
  })
  await expect
    .poll(
      async () => {
        try {
          await flow.confirm(review)
          return true
        } catch (error) {
          if ((error as { code?: string }).code === 'scope_updating') return false
          throw error
        }
      },
      { timeout: 10000 }
    )
    .toBe(true)
  await expect
    .poll(
      async () => {
        try {
          await host.scoped.sync()
          return true
        } catch (error) {
          if ((error as { code?: string }).code === 'scope_updating') return false
          throw error
        }
      },
      { timeout: 10000 }
    )
    .toBe(true)
  await native.plugin.syncSharing.sync.syncNow()
  expect([
    ...new Uint8Array(await peer.app.vault.adapter.readBinary('Assets/scoped-new.png')),
  ]).toEqual([7, 8, 9])
  expect(await peer.app.vault.adapter.read('Notes/Project.md')).toContain('scoped-new.png')
}, 30000)

it('publishes an existing private target only after the production confirmation dialog accepts', async () => {
  const host = native.plugin.syncSharing
  const file = native.app.vault.getAbstractFileByPath('Elsewhere/member.md')
  await native.metadata(file)
  await host.sync.syncNow()
  expect(host.publicationPrompt.asking.value).toBeNull()
  await native.app.vault.modify(
    file,
    (await native.app.vault.read(file)) + '\n![[Assets/private.png]]\n'
  )
  await host.sync.syncNow()
  await expect
    .poll(
      async () => {
        await host.sync.syncNow()
        return document.querySelector('.abele-publication-confirm')?.textContent ?? ''
      },
      { timeout: 10000 }
    )
    .toContain('Assets/private.png')
  await peer.plugin.syncSharing.scoped.sync()
  expect(await peer.app.vault.adapter.exists('Assets/private.png')).toBe(false)
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>('.abele-publication-confirm button'),
  ].find((element) => element.textContent?.trim() === 'Publish')!
  expect(button).toBeDefined()
  button.click()
  await expect.poll(() => host.publicationPrompt.asking.value, { timeout: 10000 }).toBeNull()
  await peer.plugin.syncSharing.scoped.sync()
  expect([
    ...new Uint8Array(await peer.app.vault.adapter.readBinary('Assets/private.png')),
  ]).toEqual([21, 22, 23])
  expect((window as any).__abeleTest).toBeUndefined()
}, 30000)

it('retains a creation receipt when background sync replays a successful lost reply', async () => {
  const host = peer.plugin.syncSharing
  const flow = await host.createScoped()
  const review = await flow.review({
    kind: 'note',
    path: 'Elsewhere/lost-response.md',
    text: 'Sample lost-response note',
    rootId: group.rootId,
  })
  host.scoped.setPaused(true)
  peer.network.loseScopedCommit = true
  try {
    await expect(flow.confirm(review)).rejects.toThrow(/never reached|lost|server/i)
    expect(peer.network.loseScopedCommit).toBe(false)
    host.scoped.setPaused(false)
    await expect
      .poll(
        async () => {
          try {
            await host.scoped.sync()
            return (await (host.scoped as any).runtime.state.getJournal()) === null
          } catch (error) {
            if ((error as { code?: string }).code === 'scope_updating') return false
            throw error
          }
        },
        { timeout: 10000 }
      )
      .toBe(true)
    const runtime = (host.scoped as any).runtime
    expect(await runtime.state.getJournal()).toBeNull()
    expect(await runtime.meta.getMeta('scoped-creation-receipt-v1:' + review.id)).not.toBeNull()
    // The ordinary timer/watcher entry point already retired the journal. Confirmation
    // must complete from that exact retained receipt, never another CREATE or byte adoption.
    await expect
      .poll(
        async () => {
          try {
            await flow.confirm(review)
            return true
          } catch (error) {
            if ((error as { code?: string }).code === 'scope_updating') return false
            throw error
          }
        },
        { timeout: 10000 }
      )
      .toBe(true)
    await native.plugin.syncSharing.sync.syncNow()
    const entry = await native.plugin.syncSharing.sync.entryFor('Elsewhere/lost-response.md')
    expect(entry).not.toBeNull()
    expect(await native.plugin.syncSharing.sync.client().versions(entry.fileId)).toHaveLength(1)
  } finally {
    peer.network.loseScopedCommit = false
    host.scoped.setPaused(false)
  }
}, 30000)

it('keeps personal sync working through disconnect, re-enrolment, Forget and another vault without sharing', async () => {
  unshared = await bootProductionPlugin(code)
  const host = unshared.plugin.syncSharing
  const sync = host.sync
  const connect = async (choice: string | { create: string }) => {
    await sync.connect(server.url, email, password)
    await sync.chooseVault(choice, 'Sample unshared device')
    await sync.syncNow()
    expect(sync.status.value.state).toBe('idle')
    expect(host.audiences.value).toEqual([])
  }
  await connect({ create: 'Sample unshared vault' })
  const first = sync.connection.value
  await unshared.app.vault.create('sample-before.md', 'Sample before reconnect')
  await sync.syncNow()
  await sync.disconnect()
  await connect(first.vaultId)
  expect(sync.connection.value.deviceId).not.toBe(first.deviceId)
  await unshared.app.vault.create('sample-after.md', 'Sample after reconnect')
  await sync.syncNow()
  expect(await sync.entryFor('sample-after.md')).not.toBeNull()
  await sync.forget()
  await connect(first.vaultId)
  await sync.disconnect()
  await connect({ create: 'Sample other vault' })
  expect(sync.connection.value.vaultId).not.toBe(first.vaultId)
  await unshared.app.vault.create('sample-other.md', 'Sample on another vault')
  await sync.syncNow()
  expect(await sync.entryFor('sample-other.md')).not.toBeNull()
}, 30000)

it('does not publish a recipient-planted private link when the owner resaves it', async () => {
  const host = native.plugin.syncSharing
  await native.app.vault.createBinary(
    'Assets/planted-private.png',
    new Uint8Array([31, 32, 33]).buffer
  )
  await host.sync.syncNow()
  const remote = peer.app.vault.getAbstractFileByPath('Elsewhere/member.md')
  await peer.app.vault.modify(
    remote,
    (await peer.app.vault.read(remote)) + '\n![[Assets/planted-private.png]]\n'
  )
  await expect
    .poll(
      async () => {
        try {
          await peer.plugin.syncSharing.scoped.sync()
          return true
        } catch (error) {
          if ((error as { code?: string }).code === 'scope_updating') return false
          throw error
        }
      },
      { timeout: 10000 }
    )
    .toBe(true)
  await host.sync.syncNow()
  const local = native.app.vault.getAbstractFileByPath('Elsewhere/member.md')
  await native.metadata(local)
  await native.app.vault.modify(
    local,
    (await native.app.vault.read(local)) + '\nOrdinary owner sentence.\n'
  )
  await host.sync.syncNow()
  await expect
    .poll(
      async () => {
        try {
          await host.refreshPublication()
          return true
        } catch (error) {
          if ((error as { code?: string }).code === 'scope_updating') return false
          throw error
        }
      },
      { timeout: 10000 }
    )
    .toBe(true)
  expect(host.publicationPrompt.pending.value).toEqual([])
  expect(host.publicationPrompt.asking.value).toBeNull()
  await peer.plugin.syncSharing.scoped.sync()
  expect(await peer.app.vault.adapter.exists('Assets/planted-private.png')).toBe(false)
}, 30000)

it('continues production personal sync with a copied script marker and no local provenance descriptor', async () => {
  const device = await bootProductionPlugin(code)
  try {
    await device.app.vault.adapter.write('.abele-script-managed', 'Untrusted copied marker')
    await device.app.vault.create('sample-arrived.md', 'Sample arriving vault contents')
    const sync = device.plugin.syncSharing.sync
    await sync.connect(server.url, email, password)
    await sync.chooseVault({ create: 'Sample marker recovery vault' }, 'Sample new device')
    await sync.syncNow()
    expect(sync.status.value.state).toBe('idle')
    expect(await sync.entryFor('sample-arrived.md')).not.toBeNull()
    expect(device.app.loadLocalStorage('abele-script-provenance')).toMatchObject({
      binding: { facet: 'personal', principal: sync.connection.value.deviceId },
    })
  } finally {
    await device.close()
  }
}, 30000)
