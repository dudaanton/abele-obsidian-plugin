import { describe, it, expect, afterAll } from 'vitest'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  rmSync,
  statSync,
} from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { SyncClient, createScopedClient, sha256 } from '@abele/sync-core'
import { SponsoredAssetsHttpPort } from '@/sync/sharing/sponsoredHttp'
import { pasteNativeImage } from './helpers/nativePaste'
import { OwnerFolderHttpPort } from '@/sync/sharing/ownerHttp'
import { FolderSharingFlow } from '@/sync/sharing/folderSharing'
import { vaultCli, type VaultCli } from './helpers/obsidianCli'
import { waitFor } from './helpers/syncVault'
import {
  assertAgentStage,
  assertAgentCredential,
  spawnAgentStandServer,
  agentCommand,
} from './helpers/agentStandHarness'
let cli: VaultCli | undefined,
  server: Awaited<ReturnType<typeof spawnAgentStandServer>> | undefined,
  work = '',
  isolated = false,
  fixture = ''
const nodeFetch = globalThis.fetch
const svc = 'window.__abeleTest.SyncService.getInstance()'
const attachmentRoot = 'Вложения примера',
  sponsorPath = 'Agents/Пример заметки.md'
let images:
  | {
      agent: string
      grantId: string
      keyId: string
      keyToken: string
      vaultId: string
      owner: () => Promise<void>
      run: () => string
      personal: ReturnType<SyncClient['forVault']>
    }
  | undefined
let attachmentOwned = false
let nativeConfig: unknown = null
afterAll(async () => {
  const errors: unknown[] = []
  if (isolated && cli) {
    try {
      await cli.evalAwait('window.__abeleTest.disableOwnerPublicationFixture(app)')
      if (nativeConfig !== null)
        cli.evalAwait(
          `(()=>{const config=${JSON.stringify(nativeConfig)};for(const [key,value] of Object.entries(config))app.vault.setConfig(key,value);return true})()`
        )
      if (attachmentOwned)
        cli.evalAwait(
          `(async()=>{if(await app.vault.adapter.exists(${JSON.stringify(attachmentRoot)}))await app.vault.adapter.rmdir(${JSON.stringify(attachmentRoot)},true);return true})()`
        )
      const backup = cli.evalAwait<{ root?: string } | null>(
        "app.loadLocalStorage('task14-isolated-fixture')"
      )
      if (backup && backup.root !== 'Agents')
        throw new Error('Unexpected isolated fixture ownership')
      const result = backup
        ? cli.evalAwait<any>('window.__abeleTest.restoreFixtureContext(app)')
        : { restored: true, errors: [] }
      if (!result.restored)
        throw new Error('Owner fixture restore incomplete: ' + result.errors.join(', '))
    } catch (e) {
      errors.push(e)
    }
  }
  if (server)
    try {
      await server.stop()
    } catch (e) {
      errors.push(e)
    }
  if (work && errors.length === 0) rmSync(work, { recursive: true, force: true })
  if (errors.length) throw new AggregateError(errors, 'Agent stand cleanup incomplete')
})
/** No stage = explicit opt-out. A stage invocation includes genuinely failing pending image gates. */
describe.skipIf(!process.env.ABELE_AGENT_STAND_STAGE)('agent disposable stand gate 43', () => {
  it('folder lifecycle with the native desktop owner and real scoped daemon', async () => {
    assertAgentStage(process.env.ABELE_AGENT_STAND_STAGE)
    const name = process.env.OBSIDIAN_TEST_VAULT
    if (!name) throw new Error('Agent stand requires an exclusively leased pool vault')
    const lease = readFileSync(
      join(homedir(), '.local/state/abele/vaults', name + '.lock/owner'),
      'utf8'
    )
    if (!lease.startsWith('sync-agent-stand '))
      throw new Error('Agent stand pool lease is not owned')
    fixture = process.env.ABELE_AGENT_STAND_FIXTURE ?? ''
    const commit = process.env.ABELE_AGENT_STAND_COMMIT ?? ''
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Exact archived server commit required')
    const scratch = fileURLToPath(new URL('../../../.scratch/agent-stand/', import.meta.url))
    mkdirSync(scratch, { recursive: true })
    work = mkdtempSync(join(scratch, 'sample-'))
    const agent = join(work, 'agent')
    mkdirSync(agent)
    server = await spawnAgentStandServer(fixture, commit, work)
    const email = 'sample-agent-owner@example.com',
      password = 'sample-disposable-password'
    server.createAccount(email, password)
    cli = vaultCli(name)
    if (cli.evalAwait("app.loadLocalStorage('task14-isolated-fixture')!==null"))
      throw new Error('Existing fixture backup left untouched')
    isolated = true // Arm cleanup before preparation can durably write its first hold/backup.
    await cli.evalAwait('window.__abeleTest.prepareFixtureContext(app,"Agents")')
    cli.evalAwaitPrivate(
      `(async()=>{const s=${svc};await s.connect(${JSON.stringify(server.url)},${JSON.stringify(email)},${JSON.stringify(password)});await s.chooseVault({create:'Sample agent owner'},'Sample desktop owner');return true})()`
    )
    const settled = () =>
      waitFor(
        'desktop owner personal content settlement',
        () => {
          const state = cli!.evalAwait<any>(svc + '.status.value')
          if (state.state === 'error' || state.state === 'offline')
            throw new Error('Owner settlement failed')
          return state.state === 'idle' && state.pending === 0
        },
        30000
      )
    await settled()
    cli.evalAwait(
      `(async()=>{await app.vault.createFolder('Agents');await app.vault.create('Agents/sample.md',${JSON.stringify('one\ntwo\nthree\n')});await ${svc}.syncNow();return true})()`
    )
    await settled()
    const connection = cli.evalAwait<{ vaultId: string }>(svc + '.connection.value')
    const login = await nodeFetch(server.url + '/v1/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    expect(login.status).toBe(200)
    const account = (await login.json()).account_token as string
    const enrolled = await nodeFetch(server.url + '/v1/devices', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + account, 'content-type': 'application/json' },
      body: JSON.stringify({
        vault_id: connection.vaultId,
        name: 'Sample verifier',
        platform: 'desktop',
      }),
    })
    expect(enrolled.status).toBe(201)
    const verifier = (await enrolled.json()).device_token as string
    const ownerPort = new OwnerFolderHttpPort({
        baseUrl: server.url,
        vaultId: connection.vaultId,
        email,
        deviceToken: () => verifier,
        fetch: nodeFetch,
        enabled: () => true,
      }),
      flow = new FolderSharingFlow(connection.vaultId, ownerPort, () => true)
    const preview = await flow.review('Agents/', 'editor', 'Sample agent grant')
    expect(preview.files.map((f) => f.path)).toContain('Agents/sample.md')
    const key = await flow.confirm(password, undefined, preview)
    assertAgentCredential(key.token)
    const keysResponse = await nodeFetch(
        server.url + '/v1/vaults/' + connection.vaultId + '/grants/' + key.grantId + '/keys',
        { headers: { authorization: 'Bearer ' + account } }
      ),
      keys = (await keysResponse.json()) as { id: string }[]
    expect(keys).toHaveLength(1)
    await server.prepare(account, connection.vaultId, key.grantId)
    agentCommand(
      fixture,
      agent,
      [
        'setup',
        '--server',
        server.url,
        '--vault',
        connection.vaultId,
        '--grant',
        key.grantId,
        '--principal',
        keys[0].id,
      ],
      key.token
    )
    expect(statSync(join(agent, '.abele-sync/agent.json')).mode & 0o777).toBe(0o600)
    const descriptor = JSON.parse(readFileSync(join(agent, '.abele-sync/agent.json'), 'utf8'))
    expect(JSON.stringify(descriptor)).not.toMatch(/abs[td]_/)
    expect(existsSync(join(agent, '.abele-sync/config.json'))).toBe(false)
    const run = () => agentCommand(fixture, agent, ['run', '--once']),
      owner = async () => {
        cli!.evalAwait(svc + '.syncNow().then(()=>true)')
        await settled()
      }
    run()
    expect(readFileSync(join(agent, 'Agents/sample.md'), 'utf8')).toBe('one\ntwo\nthree\n')
    expect(existsSync(join(agent, 'sample.md'))).toBe(false)
    writeFileSync(
      join(agent, 'Agents/from-agent.md'),
      '---\ngroups: ["[[Sample internal]]"]\n---\nagent content'
    )
    run()
    await owner()
    expect(cli.evalAwait("app.vault.adapter.read('Agents/from-agent.md')")).toContain(
      'agent content'
    )
    writeFileSync(join(agent, 'outside.md'), 'must stay local')
    writeFileSync(join(agent, 'Agents/sample.js'), 'sample code')
    run()
    const personal = new SyncClient({
      baseUrl: server.url,
      token: verifier,
      fetch: nodeFetch,
    }).forVault(connection.vaultId)
    let manifest = await personal.manifest(null)
    expect(manifest.items.map((i) => i.path)).not.toContain('outside.md')
    expect(manifest.items.map((i) => i.path)).not.toContain('Agents/sample.js')
    cli.evalAwait(
      `(async()=>{await app.vault.rename(app.vault.getAbstractFileByPath('Agents/from-agent.md'),'Agents/moved.md');await ${svc}.syncNow();return true})()`
    )
    await settled()
    run()
    expect(existsSync(join(agent, 'Agents/from-agent.md'))).toBe(false)
    expect(readFileSync(join(agent, 'Agents/moved.md'), 'utf8')).toContain('agent content')
    const history = JSON.parse(agentCommand(fixture, agent, ['history', 'Agents/moved.md']))
    const items = history.items ?? history.versions
    if (!Array.isArray(items) || !items.length)
      throw new Error('No authorized version in scoped history')
    const version = items[0].version_id
    unlinkSync(join(agent, 'Agents/moved.md'))
    const deletion = JSON.parse(agentCommand(fixture, agent, ['deletes']))
    expect(deletion.missing.map((v: any) => v.path)).toContain('Agents/moved.md')
    agentCommand(fixture, agent, ['deletes', '--confirm', '--expect', deletion.fingerprint])
    await owner()
    expect(cli.evalAwait("app.vault.adapter.exists('Agents/moved.md')")).toBe(false)
    agentCommand(fixture, agent, ['restore', 'Agents/moved.md', '--version', version])
    await owner()
    expect(readFileSync(join(agent, 'Agents/moved.md'), 'utf8')).toContain('agent content')
    expect(cli.evalAwait("app.vault.adapter.read('Agents/moved.md')")).toContain('agent content')
    const update = await nodeFetch(
      server.url +
        '/v1/vaults/' +
        connection.vaultId +
        '/grants/' +
        key.grantId +
        '/keys/' +
        keys[0].id,
      {
        method: 'PATCH',
        headers: { authorization: 'Bearer ' + account, 'content-type': 'application/json' },
        body: JSON.stringify({ expected_revision: 0, revoke: true }),
      }
    )
    expect(update.status).toBe(200)
    expect(() => run()).toThrow(/refused/)
    expect(readFileSync(join(agent, 'Agents/moved.md'), 'utf8')).toContain('agent content')
    expect(existsSync(join(agent, '.abele-sync/agent.sqlite'))).toBe(true)
    flow.clear()
    ownerPort.close()
    // Keep every original revoked-key assertion. Images use an independent scoped principal.
    const next = await nodeFetch(
      server.url + '/v1/vaults/' + connection.vaultId + '/grants/' + key.grantId + '/keys',
      {
        method: 'POST',
        headers: { authorization: 'Bearer ' + account, 'content-type': 'application/json' },
        body: JSON.stringify({
          attempt_id: crypto.randomUUID(),
          name: 'Sample image agent',
          role: 'editor',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        }),
      }
    )
    expect(next.status).toBe(201)
    const imageKey = await next.json()
    assertAgentCredential(imageKey.key_token)
    const imageAgent = join(work, 'image-agent')
    mkdirSync(imageAgent)
    agentCommand(
      fixture,
      imageAgent,
      [
        'setup',
        '--server',
        server.url,
        '--vault',
        connection.vaultId,
        '--grant',
        key.grantId,
        '--principal',
        imageKey.key_id,
      ],
      imageKey.key_token
    )
    images = {
      agent: imageAgent,
      grantId: key.grantId,
      keyId: imageKey.key_id,
      keyToken: imageKey.key_token,
      vaultId: connection.vaultId,
      owner,
      personal,
      run: () => agentCommand(fixture, imageAgent, ['run', '--once']),
    }
  })
  it('owner extras and automatic root-folder paste publication are mandatory pending holds', async () => {
    if (!images || !cli || !server) throw new Error('Owned folder lifecycle prerequisite missing')
    expect(cli.evalAwait(`app.vault.adapter.exists(${JSON.stringify(attachmentRoot)})`)).toBe(false)
    nativeConfig = cli.evalAwait(
      `Object.fromEntries(['attachmentFolderPath','newLinkFormat','useMarkdownLinks'].map(k=>[k,app.vault.getConfig(k)]))`
    )
    attachmentOwned = true
    cli.evalAwait(
      `(async()=>{await app.vault.createFolder(${JSON.stringify(attachmentRoot)});await app.vault.adapter.write('.abele-sync-ignore',${JSON.stringify('*\n!Agents/\n!Agents/**\n!Agents-private/\n!Agents-private/**\n!' + attachmentRoot + '/\n!' + attachmentRoot + '/**\n')});app.vault.setConfig('attachmentFolderPath',${JSON.stringify(attachmentRoot)});app.vault.setConfig('newLinkFormat','shortest');app.vault.setConfig('useMarkdownLinks',false);return true})()`
    )
    await images.owner()
    await cli.evalAwait(
      `window.__abeleTest.enableOwnerPublicationFixture(app,${JSON.stringify([images.grantId])})`
    )
    cli.evalAwait(
      `(async()=>{const file=await app.vault.create(${JSON.stringify(sponsorPath)},${JSON.stringify('Пример исходной заметки\n')});await ${svc}.syncNow();const leaf=app.workspace.getLeaf(false);await leaf.openFile(file,{state:{mode:'source'}});return true})()`
    )
    await images.owner()
    // Exit/re-entry invalidates generation-one guesses. Both owner add and native create must
    // consume the authorized current intrinsic-note proof, including Unicode path keys.
    const outside = 'Agents-private/Пример заметки.md'
    cli.evalAwait(
      `(async()=>{if(!await app.vault.adapter.exists('Agents-private'))await app.vault.createFolder('Agents-private');await app.vault.rename(app.vault.getAbstractFileByPath(${JSON.stringify(sponsorPath)}),${JSON.stringify(outside)});return true})()`
    )
    await images.owner()
    cli.evalAwait(
      `app.vault.rename(app.vault.getAbstractFileByPath(${JSON.stringify(outside)}),${JSON.stringify(sponsorPath)}).then(()=>true)`
    )
    await images.owner()
    cli.evalAwait(
      `app.vault.modify(app.vault.getAbstractFileByPath(${JSON.stringify(sponsorPath)}),${JSON.stringify('Пример исходной заметки\nВернулась в область\n')}).then(()=>true)`
    )
    await images.owner()
    const proofReader = new SponsoredAssetsHttpPort({
      baseUrl: server.url,
      fetch: nodeFetch,
      enabled: () => true,
      context: {
        facet: 'scoped',
        vaultId: images.vaultId,
        principalId: images.keyId,
        token: () => images!.keyToken,
      },
    })
    const noteIdentity = (await images.personal.manifest(null)).items.find(
      (i) => i.path === sponsorPath
    )!
    expect(
      (await proofReader.sponsorProof(images.grantId, noteIdentity.file_id)).admissionGeneration
    ).toBeGreaterThan(1)
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
      'base64'
    )
    expect((await pasteNativeImage(cli, process.env.OBSIDIAN_TEST_VAULT!, [...png])).trusted).toBe(
      true
    )
    let publishedPath = ''
    await waitFor(
      () =>
        'native automatic paste publication: ' +
        JSON.stringify(cli!.evalAwait('window.__abeleTest.ownerPublicationDiagnostics(app)')),
      async () => {
        await images!.owner()
        images!.run()
        const paths = cli!.evalAwait<string[]>(
          `app.vault.getFiles().filter(f=>f.path.startsWith(${JSON.stringify(attachmentRoot + '/')})).map(f=>f.path)`
        )
        if (paths.length !== 1) return false
        publishedPath = paths[0]
        return existsSync(join(images!.agent, publishedPath))
      },
      30000
    )
    expect(publishedPath.split('/')).toHaveLength(2)
    const nativeBytes = cli.evalAwait<number[]>(
      `app.vault.adapter.readBinary(${JSON.stringify(publishedPath)}).then(b=>[...new Uint8Array(b)])`
    )
    expect([...readFileSync(join(images.agent, publishedPath))]).toEqual(nativeBytes)
    expect(cli.evalAwait(`app.vault.adapter.read(${JSON.stringify(sponsorPath)})`)).toContain('![[')
    expect(
      cli
        .evalAwait<any>('window.__abeleTest.ownerPublicationDiagnostics(app)')
        .pastes.some((p: any) => p.done)
    ).toBe(true)
    const reader = new SponsoredAssetsHttpPort({
      baseUrl: server.url,
      fetch: nodeFetch,
      enabled: () => true,
      context: {
        facet: 'scoped',
        vaultId: images.vaultId,
        principalId: images.keyId,
        token: () => images!.keyToken,
      },
    })
    expect(
      (await reader.read(images.grantId)).entries.some(
        (e) => e.kind === 'owner-extra' && e.target.path === publishedPath
      )
    ).toBe(true)
  })
  it('agent native root-folder image create/private-collision checks are mandatory pending holds', async () => {
    if (!images || !cli || !server) throw new Error('Owned image prerequisite missing')
    const note = (await images.personal.manifest(null)).items.find((i) => i.path === sponsorPath)
    expect(note).toBeDefined()
    const scopeClient = await createScopedClient({
      baseUrl: server.url,
      fetch: nodeFetch,
      token: images.keyToken,
      vaultId: images.vaultId,
      grantId: images.grantId,
      principalId: images.keyId,
      principalKind: 'key',
    })
    const api = new SponsoredAssetsHttpPort({
        baseUrl: server.url,
        fetch: nodeFetch,
        enabled: () => true,
        context: {
          facet: 'scoped',
          vaultId: images.vaultId,
          principalId: images.keyId,
          token: () => images!.keyToken,
        },
      }),
      bytes = new Uint8Array([0, 255, 128, 4]),
      sha = await sha256(bytes)
    const sponsor = await api.sponsorProof(images.grantId, note!.file_id)
    expect(sponsor.versionId).toBe(note!.version_id)
    await scopeClient.putBlob(sha, bytes)
    const upload = await api.proof(images.grantId, sha),
      path = attachmentRoot + '/Картинка агента.png',
      request = {
        grantId: images.grantId,
        path,
        localCreateHandle: 'sample-native-' + crypto.randomUUID(),
        sha,
        eligible: true,
        sponsor,
        upload,
      }
    const created = await api.nativeCreate(images.grantId, request)
    expect(await api.nativeCreate(images.grantId, request)).toEqual(created)
    images.run()
    await images.owner()
    expect([...readFileSync(join(images.agent, path))]).toEqual([...bytes])
    expect(
      cli.evalAwait<number[]>(
        `app.vault.adapter.readBinary(${JSON.stringify(path)}).then(b=>[...new Uint8Array(b)])`
      )
    ).toEqual([...bytes])
    const privatePath = attachmentRoot + '/Частная картинка.png'
    cli.evalAwait(
      `app.vault.createBinary(${JSON.stringify(privatePath)},new Uint8Array([9,8,7]).buffer).then(()=>true)`
    )
    await images.owner()
    images.run()
    expect(existsSync(join(images.agent, privatePath))).toBe(false)
    const old = (await images.personal.manifest(null)).items.find((i) => i.path === privatePath)!
    await scopeClient.putBlob(sha, bytes)
    const fresh = await api.proof(images.grantId, sha)
    await expect(
      api.nativeCreate(images.grantId, {
        ...request,
        path: privatePath,
        localCreateHandle: 'sample-private-collision-' + crypto.randomUUID(),
        upload: fresh,
      })
    ).rejects.toMatchObject({ status: 404, code: 'not_found' })
    expect(
      (await images.personal.manifest(null)).items.find((i) => i.path === privatePath)!.file_id
    ).toBe(old.file_id)
    expect(
      cli.evalAwait<number[]>(
        `app.vault.adapter.readBinary(${JSON.stringify(privatePath)}).then(b=>[...new Uint8Array(b)])`
      )
    ).toEqual([9, 8, 7])
    images.run()
    expect(existsSync(join(images.agent, privatePath))).toBe(false)
  })
})
