import { afterEach, expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  copyFileSync,
  chmodSync,
  writeFileSync,
  readFileSync,
  realpathSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClient } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { reduceTranscript } from '@/node/NodeTranscriptReducer'
import { NodeWorkspaceModel } from '@/node/NodeWorkspaceModel'
import { NodeDocumentSource, NodeFilesModel } from '@/node/NodeFilesModel'

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
    env: { ...process.env, ABELE_CLAUDE_PATH: resolve(dir, 'fixture-claude.mjs') },
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
  copyFileSync(resolve('tests/fixtures/nodeClaude.mjs'), resolve(dir, 'fixture-claude.mjs'))
  chmodSync(resolve(dir, 'fixture-claude.mjs'), 0o700)
  const enroll = (label: string) => {
    const created = spawnSync(
      process.execPath,
      [cli!, 'token', 'create', label, '--state-dir', dir],
      {
        encoding: 'utf8',
        env: { ...process.env, ABELE_CLAUDE_PATH: resolve(dir, 'fixture-claude.mjs') },
      }
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

it('provisions two projects, renders gated fake CLI edits, reloads approvals, queues and resumes after daemon restart', async () => {
  // The daemon's recovery directory checks require a canonical state path, including on
  // systems where the temporary directory is a symlink.
  const dir = realpathSync(mkdtempSync('/tmp/abele-plugin-node-'))
  dirs.push(dir)
  copyFileSync(resolve('tests/fixtures/nodeClaude.mjs'), resolve(dir, 'fixture-claude.mjs'))
  chmodSync(resolve(dir, 'fixture-claude.mjs'), 0o700)
  const tokenResult = spawnSync(
    process.execPath,
    [cli!, 'token', 'create', 'sample-workspace-client', '--state-dir', dir],
    {
      encoding: 'utf8',
      env: { ...process.env, ABELE_CLAUDE_PATH: resolve(dir, 'fixture-claude.mjs') },
    }
  )
  expect(tokenResult.status, tokenResult.stderr).toBe(0)
  const { token } = JSON.parse(tokenResult.stdout)
  let daemon = await start(dir)
  const factory = new IDBFactory()
  const make = () => {
    const store = new NodeClientStore('sample-workspace-client', factory)
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
  let client = make()
  await client.connect()
  const projects = []
  for (const name of ['one', 'two']) {
    const path = resolve(dir, name)
    mkdirSync(path)
    const git = (args: string[]) => {
      const result = spawnSync('/usr/bin/git', args, { cwd: path, encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
      return result.stdout
    }
    git(['init', '--initial-branch=main'])
    writeFileSync(resolve(path, 'sample.txt'), 'before\n')
    git(['add', 'sample.txt'])
    git([
      '-c',
      'user.name=Sample',
      '-c',
      'user.email=sample@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'sample',
    ])
    projects.push(await client.registerProject(path, 'trusted'))
  }
  const model = new NodeWorkspaceModel(client)
  await model.load()
  expect(model.projects.value).toHaveLength(2)
  const sessions = []
  for (const project of projects) {
    model.projectId.value = project.project_id
    await model.createWorkspace('HEAD')
    await eventually(
      async () => (await client.getJob(model.reservation.value!.job_id)).state === 'succeeded'
    )
    await model.load()
    sessions.push(await model.startSession('Sample task', 'claude'))
  }
  const session = sessions[0]
  await client.subscribe(session.session_id)
  await client.send(session.session_id, 'edit', await client.cursor(session.session_id))
  await eventually(async () =>
    (await client.prompts(session.session_id)).some((p) => p.state === 'pending')
  )
  await client.send(session.session_id, 'followup', await client.cursor(session.session_id))
  await eventually(
    async () => reduceTranscript(await client.history(session.session_id)).queuedInputs.length === 1
  )
  await client.disconnect()
  client = make()
  await client.connect()
  await client.subscribe(session.session_id)
  await eventually(async () =>
    reduceTranscript(await client.history(session.session_id)).prompts.some(
      (p) => p.state === 'pending'
    )
  )
  const prompt = reduceTranscript(await client.history(session.session_id)).prompts.find(
    (p) => p.state === 'pending'
  )!
  expect(prompt).toMatchObject({ tool_name: 'Edit', input: { file_path: 'sample.txt' } })
  await client.answerPrompt(prompt, 'allow')
  await eventually(async () =>
    reduceTranscript(await client.history(session.session_id)).messages.some(
      (m) => m.content === '**Finished:** followup'
    )
  )
  const projected = reduceTranscript(await client.history(session.session_id))
  expect(projected.messages.find((m) => m.toolName === 'Edit')?.toolDiff).toEqual({
    old: 'before\n',
    new: 'after\n',
  })
  const native = (await client.getSession(session.session_id)).native_session_id
  await client.subscribe(sessions[1].session_id)
  await client.send(sessions[1].session_id, 'deny', 0)
  await eventually(async () =>
    (await client.prompts(sessions[1].session_id)).some((p) => p.state === 'pending')
  )
  await client.answerPrompt((await client.prompts(sessions[1].session_id))[0], 'deny')
  await eventually(
    async () => reduceTranscript(await client.history(sessions[1].session_id)).state === 'idle'
  )
  const denied = reduceTranscript(await client.history(sessions[1].session_id)).messages.find(
    (m) => m.toolName === 'Edit'
  )!
  expect(denied.toolStatus).toBe('rejected')
  expect(denied.toolDiff).toBeUndefined()
  await client.disconnect()
  await stop(daemon.child)
  daemon = await start(dir)
  client = make()
  await client.connect()
  await client.subscribe(session.session_id)
  await client.send(session.session_id, 'resumed', await client.cursor(session.session_id))
  await eventually(async () =>
    reduceTranscript(await client.history(session.session_id)).messages.some(
      (m) => m.content === '**Finished:** resumed'
    )
  )
  expect((await client.getSession(session.session_id)).native_session_id).toBe(native)
  model.workspaceId.value = session.workspace_id!
  // The old model is deliberately replaced after reconnect, just as a plugin reload replaces it.
  const review = new NodeWorkspaceModel(client)
  review.workspaceId.value = session.workspace_id!
  await review.load()
  await review.preview()
  expect(review.diff.value?.diff).toContain('+after')
  for (const project of projects) {
    expect(readFileSync(resolve(project.root_path, 'sample.txt'), 'utf8')).toBe('before\n')
    expect(
      spawnSync('/usr/bin/git', ['branch', '--show-current'], {
        cwd: project.root_path,
        encoding: 'utf8',
      }).stdout.trim()
    ).toBe('main')
    expect(
      spawnSync('/usr/bin/git', ['status', '--porcelain'], {
        cwd: project.root_path,
        encoding: 'utf8',
      }).stdout
    ).toBe('')
  }
  const unused = await client.createWorkspace(projects[0].project_id)
  await eventually(async () => (await client.getJob(unused.job_id)).state === 'succeeded')
  const removal = await client.removeWorkspace(unused.workspace_id)
  await eventually(async () => (await client.getJob(removal.job_id)).state === 'succeeded')
  expect((await client.getWorkspace(unused.workspace_id)).state).toBe('removed')
  const workspace = await client.getWorkspace(session.workspace_id!)
  expect(
    JSON.parse(
      readFileSync(resolve(workspace.path, 'fixture-turns.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .at(-1)!
    )
  ).toMatchObject({ text: 'resumed', resume: native })
  const files = new NodeFilesModel(
    client,
    daemon.node_id,
    workspace.workspace_id,
    session.session_id
  )
  await files.list()
  expect(files.entries.value.some((e) => e.name === 'sample.txt')).toBe(true)
  await files.openFile('sample.txt')
  expect(files.document.value?.text).toBe('after\n')
  // A second successful save must reuse the recovery directory after an external conflict.
  const source = new NodeDocumentSource(client, workspace.workspace_id)
  const loaded = await source.read('sample.txt')
  await source.edit('sample.txt', loaded, 'first draft\n')
  expect((await source.save('sample.txt'))?.status).toBe('saved')
  expect(readFileSync(resolve(workspace.path, 'sample.txt'), 'utf8')).toBe('first draft\n')
  await source.edit('sample.txt', await source.read('sample.txt'), 'retained draft\n')
  writeFileSync(resolve(workspace.path, 'sample.txt'), 'external change\n')
  expect((await source.save('sample.txt'))?.status).toBe('conflict')
  await source.rebase('sample.txt', await source.read('sample.txt'))
  expect(await source.save('sample.txt')).toMatchObject({ status: 'saved', error: undefined })
  expect(readFileSync(resolve(workspace.path, 'sample.txt'), 'utf8')).toBe('retained draft\n')
  await files.loadDiff('head')
  const snapshot = files.snapshot.value!
  await files.addComment(
    files.selectLines(files.files.value.find((file) => file.path === 'sample.txt')!, {
      side: 'R',
      start: 1,
      end: 1,
    }),
    'Explain the retained change'
  )
  writeFileSync(resolve(workspace.path, 'sample.txt'), 'later\n')
  await client.disconnect()
  await files.submit()
  const operation = files.pendingReview.value
  expect(operation).toBeTruthy()
  await stop(daemon.child)
  daemon = await start(dir)
  client = make()
  await client.connect()
  await client.subscribe(session.session_id)
  expect((await client.reviewResult(operation))?.stale).toEqual([true])
  expect((await client.getDiff(workspace.workspace_id, snapshot.diff_id)).content_id).toBe(
    snapshot.content_id
  )
  await eventually(async () =>
    reduceTranscript(await client.history(session.session_id)).messages.some(
      (m) => m.role === 'assistant' && m.content.includes('Review batch')
    )
  )
  expect(
    (await client.history(session.session_id)).filter((e) => e.type === 'review.submitted')
  ).toHaveLength(1)
  expect((await client.getSession(session.session_id)).native_session_id).toBe(native)
}, 20000)
