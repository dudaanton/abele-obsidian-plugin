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
import { SyncClient } from '@abele/sync-core'
import { OwnerFolderHttpPort } from '@/sync/sharing/ownerHttp'
import { FolderSharingFlow } from '@/sync/sharing/folderSharing'
import { vaultCli, type VaultCli } from './helpers/obsidianCli'
import { waitFor } from './helpers/syncVault'
import {
  assertAgentStage,
  assertAgentCredential,
  spawnAgentStandServer,
  agentCommand,
  requireAgentImageGate,
} from './helpers/agentStandHarness'
let cli: VaultCli | undefined,
  server: Awaited<ReturnType<typeof spawnAgentStandServer>> | undefined,
  work = '',
  isolated = false,
  fixture = ''
const nodeFetch = globalThis.fetch
const svc = 'window.__abeleTest.SyncService.getInstance()'
afterAll(async () => {
  const errors: unknown[] = []
  if (isolated && cli) {
    try {
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
  })
  it('owner extras and automatic root-folder paste publication are mandatory pending holds', () =>
    requireAgentImageGate('owner-extras'))
  it('agent native root-folder image create/private-collision checks are mandatory pending holds', () =>
    requireAgentImageGate('native-image'))
})
