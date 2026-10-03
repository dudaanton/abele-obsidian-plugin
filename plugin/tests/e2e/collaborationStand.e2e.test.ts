import { describe, it, expect, afterAll } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { SyncClient, createScopedClient, sha256 } from '@abele/sync-core'
import { OwnerFolderHttpPort } from '@/sync/sharing/ownerHttp'
import { SponsoredAssetsHttpPort } from '@/sync/sharing/sponsoredHttp'
import { InitialAssetBatch } from '@/sync/sharing/groupSharing'
import { GroupJoinHttp } from '@/sync/scoped/groupJoinHttp'
import { vaultCli, type VaultCli } from './helpers/obsidianCli'
import { waitFor } from './helpers/syncVault'
import { spawnCollaborationStandServer } from './helpers/collaborationStandHarness'
import {
  writeCollaborationPeerProgram,
  runCollaborationPeer,
  type CollaborationPeer,
} from './helpers/collaborationPeers'
import { pasteNativeImage } from './helpers/nativePaste'
const COMMIT = 'b5357cff918028e1e58b443ccc22eed0093eb689',
  ROOT = 'Agents/Проект примера.md',
  NOTE = 'Agents/Разрозненные/Общая заметка.md',
  PRIVATE = 'Agents/Личное/Закрытая заметка.md',
  ASSETS = 'Вложения совместного примера',
  IMAGE = ASSETS + '/Иллюстрация примера.png',
  svc = 'window.__abeleTest.SyncService.getInstance()',
  fetcher = globalThis.fetch,
  encode = (s: string) => new TextEncoder().encode(s),
  text = (b: Uint8Array) => new TextDecoder().decode(b)
let cli: VaultCli | undefined,
  server: Awaited<ReturnType<typeof spawnCollaborationStandServer>> | undefined,
  work = '',
  fixture = '',
  program = '',
  isolated = false,
  assetsOwned = false,
  config: unknown = null,
  account = '',
  vault = '',
  ownerToken = '',
  ownerId = '',
  grant: any,
  rootHead: any,
  noteHead: any,
  oldImage: any,
  peers: CollaborationPeer[] = [],
  mirror: CollaborationPeer | undefined
let ownerClient: ReturnType<SyncClient['forVault']>, ownerApi: SponsoredAssetsHttpPort
const ownedMeta = new Map<string, string>(),
  meta = {
    getMeta: (k: string) => ownedMeta.get(k) ?? null,
    setMeta: (k: string, v: string | null) => {
      if (v === null) ownedMeta.delete(k)
      else ownedMeta.set(k, v)
    },
  }
async function json(path: string, token: string, method = 'GET', body?: unknown) {
  const r = await fetcher(server!.url + path, {
    method,
    headers: {
      authorization: 'Bearer ' + token,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!r.ok) throw new Error('Fixture request refused ' + method + ' ' + path + ' ' + r.status)
  return r.json()
}
async function ownerSync() {
  await cli!.evalAwait(svc + '.syncNow().then(()=>true)')
  await waitFor(
    'native group-owner exact personal settlement',
    () => {
      const s = cli!.evalAwait<any>(svc + '.status.value')
      if (['error', 'offline'].includes(s.state)) throw new Error('Native owner unavailable')
      return s.state === 'idle' && s.pending === 0
    },
    30000
  )
}
async function personalReference(
  base: string,
  left: string,
  right: string,
  scopedFirst: boolean,
  mtimeLeft: number,
  mtimeRight: number,
  tag = 'disjoint'
) {
  const path = 'Agents/Контроль-' + tag + '-' + String(scopedFirst) + '.md',
    shaBase = await sha256(encode(base))
  await ownerClient.putBlob(shaBase, encode(base))
  const created = await ownerClient.commit([
      { op: 'create', path, sha: shaBase, size: encode(base).length, mtime: 1 },
    ]),
    item = created.results[0] as any,
    second = new SyncClient({
      baseUrl: server!.url,
      fetch: fetcher,
      token: mirror!.token,
    }).forVault(vault),
    shaLeft = await sha256(encode(left)),
    shaRight = await sha256(encode(right))
  await ownerClient.putBlob(shaLeft, encode(left))
  await second.putBlob(shaRight, encode(right))
  const ownerOp = {
      op: 'modify' as const,
      file_id: item.file_id,
      base_version_id: item.version_id,
      sha: shaLeft,
      size: encode(left).length,
      mtime: mtimeLeft,
    },
    peerOp = {
      op: 'modify' as const,
      file_id: item.file_id,
      base_version_id: item.version_id,
      sha: shaRight,
      size: encode(right).length,
      mtime: mtimeRight,
    }
  if (scopedFirst) {
    await second.commit([peerOp])
    await ownerClient.commit([ownerOp])
  } else {
    await ownerClient.commit([ownerOp])
    await second.commit([peerOp])
  }
  const current = await head(path)
  return {
    text: text(await ownerClient.getBlob(current.sha)),
    history: await ownerClient.versions(current.file_id),
  }
}
async function head(path: string) {
  const m = await ownerClient.manifest(null)
  const item = m.items.find((i) => i.path === path)
  if (!item) throw new Error('Expected fixture path absent')
  return item
}
function peerRun(index: number, action: 'init' | 'pull' | 'push' = 'pull') {
  return runCollaborationPeer(program, server!.url, peers[index], action)
}
async function peerPush(index: number) {
  let result: any
  await waitFor(
    'same SQLite scoped journal settled after certified worker catches up',
    async () => {
      try {
        result = peerRun(index, 'push')
        return true
      } catch (e) {
        if ((e as { code?: string }).code !== 'scope_updating') throw e
        await settleGroup()
        return false
      }
    },
    30000
  )
  return result
}
async function settleGroup() {
  await waitFor(
    'certified group ready at current version',
    async () => {
      try {
        const c = await createScopedClient({
          baseUrl: server!.url,
          fetch: fetcher,
          token: peers[0].token,
          vaultId: vault,
          grantId: grant.id,
          principalId: peers[0].principalId!,
          principalKind: 'installation',
        })
        if ((await c.negotiate()).state.state !== 'active') return false
        const proof = await ownerApi.sponsorProof(grant.id, noteHead.file_id),
          current = await head(NOTE)
        return proof.versionId === current.version_id
      } catch (e) {
        if (['scope_updating', 'scope_unavailable'].includes((e as any).code)) return false
        throw e
      }
    },
    30000
  )
}
afterAll(async () => {
  const errors: unknown[] = []
  if (isolated && cli)
    try {
      await cli.evalAwait('window.__abeleTest.disableOwnerPublicationFixture(app)')
      if (config)
        cli.evalAwait(
          `(()=>{for(const [k,v] of Object.entries(${JSON.stringify(config)}))app.vault.setConfig(k,v);return true})()`
        )
      if (assetsOwned)
        cli.evalAwait(
          `(async()=>{if(await app.vault.adapter.exists(${JSON.stringify(ASSETS)}))await app.vault.adapter.rmdir(${JSON.stringify(ASSETS)},true);return true})()`
        )
      const result = await cli.evalAwait<any>('window.__abeleTest.restoreFixtureContext(app)')
      if (!result.restored) throw new Error('Group original restore incomplete')
    } catch (e) {
      errors.push(e)
    }
  if (server)
    try {
      await server.stop()
    } catch (e) {
      errors.push(e)
    }
  if (work && !errors.length) rmSync(work, { recursive: true, force: true })
  if (errors.length) throw new AggregateError(errors, 'Group fixture cleanup incomplete')
})
describe.skipIf(!process.env.ABELE_COLLAB_STAND_STAGE)(
  'desktop group collaboration scenario C',
  () => {
    it('joins two independent scoped installations with exact Cyrillic/scattered paths and no owner second connection', async () => {
      expect(process.env.ABELE_COLLAB_STAND_STAGE).toBe('disposable')
      const name = process.env.OBSIDIAN_TEST_VAULT
      if (!name) throw new Error('Owned pool required')
      expect(
        readFileSync(join(homedir(), '.local/state/abele/vaults', name + '.lock/owner'), 'utf8')
      ).toMatch(/^sync-agent-stand /)
      fixture = process.env.ABELE_AGENT_STAND_FIXTURE!
      const scratch = join(process.cwd(), '../.scratch/collaboration-stand')
      mkdirSync(scratch, { recursive: true })
      work = mkdtempSync(join(scratch, 'sample-'))
      server = await spawnCollaborationStandServer(fixture, COMMIT, work)
      program = writeCollaborationPeerProgram(fixture, work)
      const email = 'sample-collaboration-owner@example.com',
        password = 'sample-disposable-password'
      server.createAccount(email, password)
      cli = vaultCli(name)
      expect(cli.evalAwait("app.loadLocalStorage('task14-isolated-fixture')")).toBeNull()
      isolated = true
      await cli.evalAwait('window.__abeleTest.prepareFixtureContext(app,"Agents")')
      await cli.evalAwaitPrivate(
        `(async()=>{await ${svc}.connect(${JSON.stringify(server.url)},${JSON.stringify(email)},${JSON.stringify(password)});await ${svc}.chooseVault({create:'Sample group owner'},'Sample desktop owner');return true})()`
      )
      await ownerSync()
      vault = cli.evalAwait<any>(svc + '.connection.value').vaultId
      account = (await json('/v1/auth/login', '', 'POST', { email, password })).account_token
      const device = await json('/v1/devices', account, 'POST', {
        vault_id: vault,
        name: 'Sample personal verifier',
        platform: 'desktop',
      })
      ownerToken = device.device_token
      ownerId = device.device_id
      ownerClient = new SyncClient({
        baseUrl: server.url,
        fetch: fetcher,
        token: ownerToken,
      }).forVault(vault)
      expect(cli.evalAwait(`app.vault.adapter.exists(${JSON.stringify(ASSETS)})`)).toBe(false)
      assetsOwned = true
      await cli.evalAwait(
        `(async()=>{await app.vault.createFolder('Agents');await app.vault.createFolder('Agents/Разрозненные');await app.vault.createFolder('Agents/Личное');await app.vault.createFolder(${JSON.stringify(ASSETS)});await app.vault.adapter.write('.abele-sync-ignore',${JSON.stringify('*\n!Agents/\n!Agents/**\n!' + ASSETS + '/\n!' + ASSETS + '/**\n')});await app.vault.create(${JSON.stringify(ROOT)},${JSON.stringify('sample project root\n')});await app.vault.create(${JSON.stringify(NOTE)},${JSON.stringify('---\ngroups: ["[[Agents/Проект примера]]"]\n---\none\ntwo\nthree\n')});await app.vault.create(${JSON.stringify(PRIVATE)},'sample private content');await app.vault.createBinary(${JSON.stringify(IMAGE)},new Uint8Array([1,2,3]).buffer);return true})()`
      )
      await cli.evalAwait(
        `(()=>{const s=${svc};return s.serialise(()=>s.runner.reconcile()).then(()=>true)})()`
      )
      await ownerSync()
      rootHead = await head(ROOT)
      noteHead = await head(NOTE)
      oldImage = await head(IMAGE)
      await cli.evalAwait(
        `app.vault.modifyBinary(app.vault.getAbstractFileByPath(${JSON.stringify(IMAGE)}),new Uint8Array([4,5,6]).buffer).then(()=>true)`
      )
      await ownerSync()
      const management = new OwnerFolderHttpPort({
          baseUrl: server.url,
          vaultId: vault,
          email,
          deviceToken: () => ownerToken,
          fetch: fetcher,
          enabled: () => true,
        }),
        session = await management.authorize(password)
      grant = await management.createGroup(session, {
        label: 'Проект примера',
        rootId: rootHead.file_id,
        rootVersion: rootHead.version_id,
        role: 'editor',
      })
      await server.prepareGroup(account, vault)
      for (let index = 0; index < 2; index++) {
        const recipient = 'sample-collaborator-' + index + '@example.com'
        server.createAccount(recipient, password)
        const joinPort = new GroupJoinHttp({
            baseUrl: server.url,
            fetch: fetcher,
            enabled: () => true,
          }),
          token = await joinPort.login(server.url, recipient, password),
          invite = await json(
            '/v1/vaults/' + vault + '/grants/groups/' + grant.id + '/invitations',
            account,
            'POST',
            {
              role: 'editor',
              expires_at: new Date(Date.now() + 3600000).toISOString(),
            }
          ),
          accepted = await joinPort.accept(server.url, token, invite.invitation_token),
          installed = await joinPort.enrol(server.url, token, {
            grantId: grant.id,
            attemptId: 'sample-join-' + index,
            name: 'Sample collaborator ' + index,
            platform: 'desktop',
            role: 'editor',
          }),
          dir = join(work, 'recipient-' + index)
        mkdirSync(dir)
        peers.push({
          dir,
          facet: 'installation',
          token: installed.token,
          vaultId: vault,
          grantId: grant.id,
          principalId: installed.installationId,
        })
        expect(accepted.memberId).toBe(installed.memberId)
        expect(installed.token).toMatch(/^absi_/)
        expect((await joinPort.discover(server.url, token))[0].grantId).toBe(grant.id)
        const pulled = peerRun(index, 'init')
        expect(pulled.known.map((x: any) => x.path)).toContain(NOTE)
        expect(existsSync(join(dir, PRIVATE))).toBe(false)
        expect(readFileSync(join(dir, NOTE), 'utf8')).toContain('one\ntwo\nthree')
      }
      expect(peers[0].principalId).not.toBe(peers[1].principalId)
      expect(cli.evalAwait('app.loadLocalStorage("abele-scoped-connection")')).toBeNull()
      const mirrored = await json('/v1/devices', account, 'POST', {
          vault_id: vault,
          name: 'Sample personal mirror',
          platform: 'desktop',
        }),
        dir = join(work, 'personal-mirror')
      mkdirSync(dir)
      mirror = { dir, facet: 'personal', token: mirrored.device_token, vaultId: vault }
      runCollaborationPeer(program, server.url, mirror)
      expect(readFileSync(join(dir, PRIVATE), 'utf8')).toBe('sample private content')
      ownerApi = new SponsoredAssetsHttpPort({
        baseUrl: server.url,
        fetch: fetcher,
        context: {
          facet: 'personal',
          vaultId: vault,
          principalId: ownerId,
          token: () => ownerToken,
        },
        enabled: () => true,
      })
      console.info(
        JSON.stringify({
          case: 'C-join',
          groupPaths: [ROOT, NOTE, PRIVATE],
          facets: peers.map((p) => p.facet),
          native: 'desktop owner',
          mirrors: 'archived CLI Node/SQLite personal',
        })
      )
    })
    it('approves existing illustrations once and excludes private earlier image history', async () => {
      const target = await head(IMAGE),
        proof = await ownerApi.sponsorProof(grant.id, noteHead.file_id),
        entry = {
          target: {
            fileId: target.file_id,
            versionId: target.version_id,
            sha: target.sha,
            path: IMAGE,
            eligible: true,
          },
          sponsors: [proof],
          reason: 'initial-batch' as const,
        },
        port = {
          view: (g: string) => ownerApi.read(g),
          target: async () => entry.target,
          sponsors: async () => [await ownerApi.sponsorProof(grant.id, noteHead.file_id)],
          lookup: async () => false,
          add: (r: any) => ownerApi.add(r),
        },
        batch = new InitialAssetBatch(
          meta,
          { vaultId: vault, principal: ownerId },
          port,
          () => true
        ),
        review = await batch.review([entry], [grant.id])
      await batch.confirm(review)
      await batch.confirm(review)
      for (let i = 0; i < 2; i++) {
        peerRun(i)
        expect([...readFileSync(join(peers[i].dir, IMAGE))]).toEqual([4, 5, 6])
        const client = await createScopedClient({
          baseUrl: server!.url,
          fetch: fetcher,
          token: peers[i].token,
          vaultId: vault,
          grantId: grant.id,
          principalId: peers[i].principalId!,
          principalKind: 'installation',
        })
        await expect(client.version(target.file_id, oldImage.version_id)).rejects.toMatchObject({
          code: 'not_found',
        })
      }
      expect(
        (await ownerApi.read(grant.id)).entries.filter((e) => e.target.fileId === target.file_id)
      ).toHaveLength(1)
    })
    it('ordinary disjoint edits merge identically to the personal reference in both arrival orders', async () => {
      for (const scopedFirst of [true, false]) {
        const prefix = '---\ngroups: ["[[Agents/Проект примера]]"]\n---\n',
          base = prefix + 'one\ntwo\nthree\n'
        await cli!.evalAwait(
          `app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),${JSON.stringify(base)}).then(()=>true)`
        )
        await ownerSync()
        await settleGroup()
        peerRun(0)
        peerRun(1)
        const before = await head(NOTE),
          left = prefix + 'owner-one\ntwo\nthree\n',
          right = prefix + 'one\ntwo\npeer-three\n'
        writeFileSync(join(peers[0].dir, NOTE), right)
        cli!.evalAwait(`(()=>{${svc}.setPaused(true);return true})()`)
        await cli!.evalAwait(
          `app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),${JSON.stringify(left)}).then(()=>true)`
        )
        const ownerMtime = cli!.evalAwait<any>(
            `app.vault.adapter.stat(${JSON.stringify(NOTE)})`
          ).mtime,
          peerMtime = statSync(join(peers[0].dir, NOTE)).mtimeMs,
          reference = await personalReference(
            base,
            left,
            right,
            scopedFirst,
            ownerMtime,
            Math.round(peerMtime)
          )
        if (scopedFirst) {
          await peerPush(0)
          cli!.evalAwait(`(()=>{${svc}.setPaused(false);return true})()`)
          await ownerSync()
        } else {
          cli!.evalAwait(`(()=>{${svc}.setPaused(false);return true})()`)
          await ownerSync()
          await peerPush(0)
          await ownerSync()
        }
        await settleGroup()
        peerRun(0)
        peerRun(1)
        runCollaborationPeer(program, server!.url, mirror!)
        const result = cli!.evalAwait<string>(
          `app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))`
        )
        expect(result).toBe(prefix + 'owner-one\ntwo\npeer-three\n')
        expect(result).toBe(reference.text)
        const history = await ownerClient.versions(before.file_id)
        expect(history.slice(0, 2).map((v) => ({ op: v.op, sha: v.sha }))).toEqual(
          reference.history.slice(0, 2).map((v) => ({ op: v.op, sha: v.sha }))
        )
        for (const p of [...peers, mirror!])
          expect(readFileSync(join(p.dir, NOTE), 'utf8')).toBe(result)
        expect(
          (await ownerClient.manifest(null)).items.filter((i) => i.path.includes('conflict'))
        ).toEqual([])
        expect((await head(NOTE)).file_id).toBe(before.file_id)
      }
    })
    it('overlapping edits match personal conflict/merge bytes and history in both arrival orders', async () => {
      for (const scopedFirst of [true, false]) {
        const prefix = '---\ngroups: ["[[Agents/Проект примера]]"]\n---\n',
          base = prefix + 'one\ntwo\nthree\n',
          left = prefix + 'owner paragraph\ntwo\nthree\n',
          right = prefix + 'peer paragraph\ntwo\nthree\n'
        await cli!.evalAwait(
          `app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),${JSON.stringify(base)}).then(()=>true)`
        )
        await ownerSync()
        await settleGroup()
        peerRun(0)
        peerRun(1)
        const before = await head(NOTE)
        writeFileSync(join(peers[0].dir, NOTE), right)
        cli!.evalAwait(`(()=>{${svc}.setPaused(true);return true})()`)
        try {
          await cli!.evalAwait(
            `app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),${JSON.stringify(left)}).then(()=>true)`
          )
          const mtime = cli!.evalAwait<any>(
              `app.vault.adapter.stat(${JSON.stringify(NOTE)})`
            ).mtime,
            reference = await personalReference(
              base,
              left,
              right,
              scopedFirst,
              mtime,
              Math.round(statSync(join(peers[0].dir, NOTE)).mtimeMs),
              'overlap'
            )
          if (scopedFirst) {
            await peerPush(0)
            cli!.evalAwait(`(()=>{${svc}.setPaused(false);return true})()`)
            await ownerSync()
          } else {
            cli!.evalAwait(`(()=>{${svc}.setPaused(false);return true})()`)
            await ownerSync()
            await peerPush(0)
            await ownerSync()
          }
          await settleGroup()
          peerRun(0)
          peerRun(1)
          const actual = cli!.evalAwait<string>(
              `app.vault.read(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}))`
            ),
            history = await ownerClient.versions(before.file_id)
          expect(actual).toBe(reference.text)
          expect(history.slice(0, 2).map((v) => ({ op: v.op, sha: v.sha }))).toEqual(
            reference.history.slice(0, 2).map((v) => ({ op: v.op, sha: v.sha }))
          )
          for (const p of peers) expect(readFileSync(join(p.dir, NOTE), 'utf8')).toBe(actual)
        } finally {
          cli!.evalAwait(`(()=>{${svc}.setPaused(false);return true})()`)
        }
      }
    })
    it('a collaborator creates attributed note/image while owner is offline and another collaborator continues', async () => {
      const client = await createScopedClient({
          baseUrl: server!.url,
          fetch: fetcher,
          token: peers[0].token,
          vaultId: vault,
          grantId: grant.id,
          principalId: peers[0].principalId!,
          principalKind: 'installation',
        }),
        api = new SponsoredAssetsHttpPort({
          baseUrl: server!.url,
          fetch: fetcher,
          context: {
            facet: 'scoped',
            vaultId: vault,
            principalId: peers[0].principalId!,
            token: () => peers[0].token,
          },
          enabled: () => true,
        }),
        newPath = 'Agents/Новая заметка участника.md',
        body = '---\ngroups: ["[[Agents/Проект примера]]"]\n---\nscoped native note\n',
        bytes = encode(body),
        sha = await sha256(bytes)
      cli!.evalAwait(`(()=>{${svc}.setPaused(true);return true})()`)
      try {
        writeFileSync(
          join(peers[1].dir, NOTE),
          readFileSync(join(peers[1].dir, NOTE), 'utf8') + '\nsecond collaborator edit\n'
        )
        await peerPush(1)
        await settleGroup()
        await client.putBlob(sha, bytes)
        const created = await client.commit({
          request_id: crypto.randomUUID(),
          ops: [{ op: 'create', path: newPath, sha, size: bytes.length, mtime: Date.now() }],
        })
        expect(created.results[0]).toMatchObject({ status: 'applied', path: newPath })
        await settleGroup()
        const proof = await api.sponsorProof(grant.id, noteHead.file_id),
          binary = new Uint8Array([0, 255, 128, 17]),
          assetSha = await sha256(binary)
        await client.putBlob(assetSha, binary)
        const upload = await api.proof(grant.id, assetSha),
          path = ASSETS + '/Изображение участника.png',
          request = {
            grantId: grant.id,
            path,
            localCreateHandle: 'sample-group-native-' + crypto.randomUUID(),
            sha: assetSha,
            eligible: true,
            sponsor: proof,
            upload,
          }
        let image: Awaited<ReturnType<typeof api.nativeCreate>> | undefined
        await waitFor(
          'certified output of stable group-native create',
          async () => {
            try {
              image = await api.nativeCreate(grant.id, request)
              return true
            } catch (e) {
              if (!['scope_updating', 'scope_unavailable'].includes((e as any).code)) throw e
              await settleGroup()
              return false
            }
          },
          30000
        )
        await settleGroup()
        expect(await api.nativeCreate(grant.id, request)).toEqual(image)
        peerRun(0)
        peerRun(1)
        for (const p of peers) {
          expect(readFileSync(join(p.dir, newPath), 'utf8')).toBe(body)
          expect([...readFileSync(join(p.dir, path))]).toEqual([...binary])
        }
      } finally {
        cli!.evalAwait(`(()=>{${svc}.setPaused(false);return true})()`)
      }
      await ownerSync()
      runCollaborationPeer(program, server!.url, mirror!)
      expect(cli!.evalAwait(`app.vault.adapter.read(${JSON.stringify(newPath)})`)).toBe(body)
      expect(readFileSync(join(mirror!.dir, newPath), 'utf8')).toBe(body)
    })
    it('recipient-planted image links stay inert across owner resave and rename', async () => {
      const planted = readFileSync(join(peers[0].dir, NOTE), 'utf8') + '\n![[Неполучаемое.png]]\n'
      writeFileSync(join(peers[0].dir, NOTE), planted)
      await peerPush(0)
      await ownerSync()
      const privatePath = ASSETS + '/Неполучаемое.png'
      await cli!.evalAwait(
        `(async()=>{await app.vault.createBinary(${JSON.stringify(privatePath)},new Uint8Array([44,45,46]).buffer);await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),${JSON.stringify(planted + '\nordinary owner sentence\n')});return true})()`
      )
      await ownerSync()
      await settleGroup()
      const renamed = 'Agents/Разрозненные/Переименованный пример.md'
      await cli!.evalAwait(
        `app.vault.rename(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),${JSON.stringify(renamed)}).then(()=>true)`
      )
      await ownerSync()
      await cli!.evalAwait(
        `app.vault.rename(app.vault.getAbstractFileByPath(${JSON.stringify(renamed)}),${JSON.stringify(NOTE)}).then(()=>true)`
      )
      await ownerSync()
      await settleGroup()
      for (let i = 0; i < 2; i++) {
        peerRun(i)
        expect(existsSync(join(peers[i].dir, privatePath))).toBe(false)
        expect(readFileSync(join(peers[i].dir, NOTE), 'utf8')).toContain('![[Неполучаемое.png]]')
      }
      expect(
        (await ownerApi.read(grant.id)).entries.some((e) => e.target.path === privatePath)
      ).toBe(false)
    })
    it('a genuine native owner link to an existing private asset offers one exact audience confirmation', async () => {
      await cli!.evalAwait(
        `window.__abeleTest.enableOwnerPublicationFixture(app,${JSON.stringify([grant.id])})`
      )
      const path = ASSETS + '/sample-existing.png'
      await cli!.evalAwait(
        `(async()=>{await app.vault.createBinary(${JSON.stringify(path)},new Uint8Array([66,67,68]).buffer);await app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),${JSON.stringify('---\ngroups: ["[[Agents/Проект примера]]"]\n---\nowner baseline before existing link\n')});return true})()`
      )
      await ownerSync()
      await settleGroup()
      const inputProof = await cli!.evalAwait<{ trusted: boolean }>(
        `(async()=>{await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),{state:{mode:'source'}});const view=app.workspace.getMostRecentLeaf().view;view.editor.setCursor({line:view.editor.lastLine(),ch:view.editor.getLine(view.editor.lastLine()).length});view.contentEl.querySelector('.cm-content').focus();const wc=require('@electron/remote').getCurrentWebContents();let trusted=false;const capture=e=>{trusted=trusted||e.isTrusted};view.contentEl.addEventListener('input',capture,true);try{await wc.insertText(${JSON.stringify('\n![[' + path + ']]\n')});return{trusted}}finally{view.contentEl.removeEventListener('input',capture,true)}})()`
      )
      expect(inputProof.trusted).toBe(true)
      await waitFor(
        'native existing link saved',
        () =>
          cli!
            .evalAwait<string>(`app.vault.adapter.read(${JSON.stringify(NOTE)})`)
            .includes('![[' + path + ']]'),
        30000
      )
      await ownerSync()
      await settleGroup()
      const snapshot = cli!.evalAwait<any>(
        `(()=>{const dialogs=[...document.querySelectorAll('.modal-content,[role=dialog]')].map(el=>el.textContent||'');return{source:app.metadataCache.getCache(${JSON.stringify(NOTE)})?.embeds?.map(e=>e.link)||[],dialogs:dialogs.filter(body=>body.includes(${JSON.stringify(path)})&&body.includes('Проект примера')),publisher:window.__abeleTest.ownerPublicationDiagnostics(app)}})()`
      )
      console.info(JSON.stringify({ case: 'C-existing-private-confirmation', ...snapshot }))
      expect(snapshot.source).toContain(path)
      expect(snapshot.dialogs).toHaveLength(1)
      expect((await ownerApi.read(grant.id)).entries.some((e) => e.target.path === path)).toBe(
        false
      )
    })
    it('native owner paste is automatic after group collaboration and preserves exact root asset paths', async () => {
      await cli!.evalAwait(
        `window.__abeleTest.enableOwnerPublicationFixture(app,${JSON.stringify([grant.id])})`
      )
      await cli!.evalAwait(
        `app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),${JSON.stringify('---\ngroups: ["[[Agents/Проект примера]]"]\n---\nready native paste\n')}).then(()=>true)`
      )
      await ownerSync()
      await settleGroup()
      config = cli!.evalAwait(
        `Object.fromEntries(['attachmentFolderPath','newLinkFormat','useMarkdownLinks'].map(k=>[k,app.vault.getConfig(k)]))`
      )
      await cli!.evalAwait(
        `(async()=>{app.vault.setConfig('attachmentFolderPath',${JSON.stringify(ASSETS)});app.vault.setConfig('newLinkFormat','shortest');app.vault.setConfig('useMarkdownLinks',false);await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(${JSON.stringify(NOTE)}),{state:{mode:'source'}});return true})()`
      )
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
        'base64'
      )
      expect(
        (await pasteNativeImage(cli!, process.env.OBSIDIAN_TEST_VAULT!, [...png])).trusted
      ).toBe(true)
      let path = ''
      await waitFor(
        'group native owner-extra exact daemon materialization',
        async () => {
          await ownerSync()
          await settleGroup()
          peerRun(0)
          peerRun(1)
          const view = await ownerApi.read(grant.id),
            entry = view.entries.find((e) => e.target.path !== IMAGE && e.kind === 'owner-extra')
          if (!entry) return false
          path = entry.target.path
          return peers.every((p) => existsSync(join(p.dir, path)))
        },
        30000
      )
      expect(path.startsWith(ASSETS + '/')).toBe(true)
      expect(path.split('/')).toHaveLength(2)
      const native = cli!.evalAwait<number[]>(
        `app.vault.adapter.readBinary(${JSON.stringify(path)}).then(b=>[...new Uint8Array(b)])`
      )
      for (const p of peers) expect([...readFileSync(join(p.dir, path))]).toEqual(native)
    })
  }
)
