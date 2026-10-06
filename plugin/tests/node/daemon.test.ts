import { afterEach, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClient } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'

const cli = process.env.ABELE_NODE_CLI
if (!cli)
  throw new Error('Set ABELE_NODE_CLI to the built AbeleNode CLI to run real daemon integration')
const children: ChildProcess[] = []
const clients: NodeClient[] = []
const stores: NodeClientStore[] = []
const dirs: string[] = []
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function eventually(test: () => Promise<boolean>) {
  for (let i = 0; i < 200; i++) {
    if (await test()) return
    await delay(20)
  }
  throw new Error('Daemon state did not converge')
}
async function start(dir: string) {
  const child = spawn(process.execPath, [cli!, 'start', '--state-dir', dir, '--port', '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.push(child)
  let output = '',
    errors = ''
  child.stdout!.on('data', (data) => {
    output += data
  })
  child.stderr!.on('data', (data) => {
    errors += data
  })
  await eventually(async () => {
    if (child.exitCode !== null) throw new Error(errors)
    return output.includes('"listening"')
  })
  return {
    child,
    ...(JSON.parse(
      output
        .trim()
        .split('\n')
        .find((line) => line.includes('"listening"'))!
    ) as { node_id: string; port: number }),
  }
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>((resolve) => child.once('exit', () => resolve()))
}
afterEach(async () => {
  for (const client of clients.splice(0)) await client.disconnect()
  for (const store of stores.splice(0)) store.close()
  for (const child of children.splice(0)) await stop(child)
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('persists offline outbox, replay/cursor, approval and renderer history across client and real daemon restart', async () => {
  // Keep the protected Unix control socket below macOS's sockaddr_un path limit.
  mkdirSync('../.scratch', { recursive: true })
  const dir = mkdtempSync(resolve('../.scratch/n-'))
  dirs.push(dir)
  const enroll = (label: string) => {
    const created = spawnSync(
      process.execPath,
      [cli!, 'token', 'create', label, '--state-dir', dir],
      { encoding: 'utf8' }
    )
    expect(created.status, created.stderr).toBe(0)
    return JSON.parse(created.stdout) as { token: string }
  }
  const first = enroll('sample-one'),
    second = enroll('sample-two')
  let daemon = await start(dir)
  const factory = new IDBFactory()
  const make = (token: string, namespace = 'sample-one') => {
    const store = new NodeClientStore(namespace, factory)
    stores.push(store)
    const client = new NodeClient(
      {
        url: `ws://127.0.0.1:${daemon.port}/channel`,
        profile: 'local-token-v1',
        token,
        expected_node_id: daemon.node_id,
      },
      store
    )
    clients.push(client)
    return client
  }
  let client = make(first.token)
  await client.connect()
  const session = await client.createSession('Sample integration session')
  await client.subscribe(session.session_id)
  await client.disconnect()
  const queued = await client.send(session.session_id, 'Queued before reload', 0, [
    { kind: 'permission', ttl_ms: 60000 },
    { kind: 'echo' },
  ])
  expect(await client.pending()).toHaveLength(1)
  stores[0].close()
  client = make(first.token)
  await client.connect()
  await eventually(async () =>
    (await client.prompts(session.session_id)).some((p) => p.state === 'pending')
  )
  expect(await client.operationResult(queued.operation_id)).toHaveProperty('result')
  expect(await client.pending()).toHaveLength(0)
  await eventually(
    async () =>
      reduceTranscript(await client.history(session.session_id)).state === 'needs-attention'
  )
  const prompt = (await client.prompts(session.session_id))[0]
  await client.answerPrompt(prompt, 'allow')
  await eventually(async () =>
    reduceTranscript(await client.history(session.session_id)).messages.some(
      (m) => m.role === 'assistant' && m.content === 'Queued before reload'
    )
  )
  const before = await client.history(session.session_id)
  await client.disconnect()
  await stop(daemon.child)
  daemon = await start(dir)
  client = make(first.token)
  await client.connect()
  await client.subscribe(session.session_id)
  expect(await client.history(session.session_id)).toEqual(before)
  const wrongPrincipal = make(second.token)
  await expect(wrongPrincipal.connect()).rejects.toThrow('installation_identity_mismatch')
  const other = make(second.token, 'sample-two')
  await other.connect()
  await other.subscribe(session.session_id)
  await eventually(
    async () =>
      (await other.cursor(session.session_id)) === (await client.cursor(session.session_id))
  )
  expect(await other.history(session.session_id)).toEqual(await client.history(session.session_id))
  expect(reduceTranscript(before).messages.filter((m) => m.role === 'user')).toHaveLength(1)
  await client.disconnect()
  const rejected = await client.send('missing-session', 'Sample offline rejection', 0)
  await client.connect()
  expect(await client.operationResult(rejected.operation_id)).toEqual({
    error: 'not_found',
    input: { sessionId: 'missing-session', text: 'Sample offline rejection' },
  })
}, 20000)
