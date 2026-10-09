import { expect, it } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, copyFileSync, chmodSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { IDBFactory } from 'fake-indexeddb'
import { NodeClient } from '@abele/node-client'
import { NodeClientStore } from '@/node/NodeClientStore'
import { NodeDelegationController } from '@/node/NodeDelegationController'
const cli = process.env.ABELE_NODE_CLI
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until<T>(fn: () => Promise<T>): Promise<NonNullable<T>> {
  for (let i = 0; i < 600; i++) {
    const value = await fn()
    if (value) return value as NonNullable<T>
    await wait(25)
  }
  throw new Error('Delegation fixture did not converge')
}
for (const provider of ['claude', 'pi'] as const)
  it(`delegates to fake ${provider} through the real daemon, completes offline and restores one durable result`, async () => {
    if (!cli) throw new Error('Set ABELE_NODE_CLI to the built daemon CLI')
    mkdirSync('../.scratch', { recursive: true })
    const dir = mkdtempSync(resolve('../.scratch/d-'))
    const repo = resolve(dir, 'repo')
    mkdirSync(repo)
    const fake = resolve(dir, 'claude.mjs')
    copyFileSync(resolve('tests/fixtures/nodeDelegationClaude.mjs'), fake)
    chmodSync(fake, 0o700)
    const env = {
      ...process.env,
      ABELE_CLAUDE_PATH: fake,
      ABELE_PI_HOST: resolve('tests/fixtures/nodeDelegationPi.mjs'),
    }
    const git = (...args: string[]) => {
      const r = spawnSync('/usr/bin/git', args, { cwd: repo, encoding: 'utf8' })
      expect(r.status, r.stderr).toBe(0)
    }
    git('init', '-b', 'main')
    writeFileSync(resolve(repo, 'sample.txt'), 'sample\n')
    git('add', '.')
    git(
      '-c',
      'user.name=Sample',
      '-c',
      'user.email=sample@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'sample'
    )
    const token = (label: string) => {
      const r = spawnSync(process.execPath, [cli, 'token', 'create', label, '--state-dir', dir], {
        encoding: 'utf8',
        env,
      })
      expect(r.status, r.stderr).toBe(0)
      return JSON.parse(r.stdout).token as string
    }
    const controllerToken = token('controller'),
      humanToken = token('human')
    let daemon: ChildProcess | undefined
    let parent: NodeClient | undefined, human: NodeClient | undefined
    const factory = new IDBFactory()
    const stores: NodeClientStore[] = []
    const start = async () => {
      daemon = spawn(
        process.execPath,
        [cli, 'start', '--state-dir', dir, '--port', '0', '--pi-profile', 'isolated'],
        { stdio: ['ignore', 'pipe', 'pipe'], env }
      )
      let output = '',
        error = ''
      daemon.stdout!.on('data', (b) => {
        output += b
      })
      daemon.stderr!.on('data', (b) => {
        error += b
      })
      await until(async () => {
        if (daemon!.exitCode !== null) throw Error(error)
        return output.includes('"listening"')
      })
      return JSON.parse(output.split('\n').find((l) => l.includes('"listening"'))!).port as number
    }
    const stop = async () => {
      if (!daemon || daemon.exitCode !== null) return
      daemon.kill('SIGTERM')
      await new Promise<void>((r) => daemon!.once('exit', () => r()))
    }
    const client = (port: number, token: string, namespace: string) => {
      const store = new NodeClientStore(namespace, factory)
      stores.push(store)
      return new NodeClient(
        { url: `ws://127.0.0.1:${port}/channel`, profile: 'local-token-v1', token },
        store
      )
    }
    try {
      let port = await start()
      parent = client(port, controllerToken, 'parent')
      await parent.connect()
      const project = await parent.registerProject(repo, 'trusted')
      let controller = new NodeDelegationController(parent, stores[0])
      await controller.approve({
        parent_id: 'parent-chat',
        project_ids: [project.project_id],
        providers: [provider],
      })
      const request = {
        task_key: 'sample-task',
        project_id: project.project_id,
        provider,
        title: 'Sample task',
        text: 'Sample offline task',
      }
      const child = await controller.create('parent-chat', request)
      await parent.disconnect()
      human = client(port, humanToken, 'human')
      await human.connect()
      await human.subscribe(child.session_id)
      const mailbox = (
        await stores[0].transaction((s) => Object.values(s.delegation!.tasks)[0].child!)
      ).mailbox_stream_id
      await expect(human.subscribe(mailbox)).rejects.toThrow(/unauthorized/)
      await until(async () => {
        const history = await human!.history(child.session_id)
        const failed = history.find((e) =>
          ['run.failed', 'run.interrupted', 'input.failed', 'input.delivery_unknown'].includes(
            e.type
          )
        )
        if (failed) throw new Error(JSON.stringify(history))
        return history.some((e) => e.type === 'run.completed')
      })
      await human.disconnect()
      await stop()
      port = await start()
      parent = client(port, controllerToken, 'parent')
      await parent.connect()
      controller = new NodeDelegationController(parent, stores.at(-1)!)
      await controller.restore()
      await until(async () => (await controller.cards('parent-chat'))[0]?.state === 'completed')
      expect(
        (await controller.cards('parent-chat'))[0].reports.filter((r) => r.kind === 'result')
      ).toEqual([
        {
          seq: 2,
          kind: 'result',
          text: `Sample ${provider === 'claude' ? 'Claude' : 'pi'} delegated result`,
        },
      ])
      const repeat = await controller.create('parent-chat', request)
      expect(repeat.delegation_id).toBe(child.delegation_id)
      await parent.disconnect()
      await parent.connect()
      await controller.restore()
      expect(
        (await controller.cards('parent-chat'))[0].reports.filter((r) => r.kind === 'result')
      ).toHaveLength(1)
      expect(await controller.cards('another-parent')).toEqual([])
      if (provider === 'pi') {
        // A fresh independent reader; only the controller's durable cache is under test here.
        human = client(port, humanToken, 'human-after-restart')
        await human.connect()
        const gated = await controller.create('parent-chat', {
          ...request,
          task_key: 'human-task',
          text: 'human-task',
        })
        await human.subscribe(gated.session_id)
        const prompt = await until(async () =>
          (await human!.prompts(gated.session_id)).find((p) => p.state === 'pending')
        )
        expect(
          (await controller.status('parent-chat', gated.delegation_id)).pending_human_prompts
        ).toBe(1)
        expect(
          (await controller.cards('parent-chat'))
            .find((c) => c.delegationId === gated.delegation_id)
            ?.reports.filter((r) => r.kind === 'result')
        ).toEqual([])
        const followup = await controller.send(
          'parent-chat',
          gated.delegation_id,
          'Sample follow-up'
        )
        expect(followup.input_id).toBeTruthy()
        expect(
          (await human.prompts(gated.session_id)).find((p) => p.prompt_id === prompt.prompt_id)
            ?.state
        ).toBe('pending')
        // Only the independent human owner answers via the ordinary child-session API.
        await human.answerPrompt(prompt, 'allow')
        await until(
          async () => (await parent!.delegationStatus(gated.delegation_id)).state === 'completed'
        )
        await until(
          async () =>
            (await controller.cards('parent-chat')).find(
              (c) => c.delegationId === gated.delegation_id
            )?.state === 'completed'
        )
        expect(
          (await controller.cards('parent-chat'))
            .find((c) => c.delegationId === gated.delegation_id)
            ?.reports.filter((r) => r.kind === 'result')
        ).toHaveLength(1)
        const cancellable = await controller.create('parent-chat', {
          ...request,
          task_key: 'cancel-task',
        })
        await controller.cancel('parent-chat', cancellable.delegation_id)
        expect((await parent.delegationStatus(cancellable.delegation_id)).state).toBe('cancelled')
        expect(
          (await controller.cards('parent-chat'))
            .find((c) => c.delegationId === cancellable.delegation_id)
            ?.reports.filter((r) => r.kind === 'result')
        ).toEqual([])
        const revocable = await controller.create('parent-chat', {
          ...request,
          task_key: 'revoke-task',
        })
        await controller.revoke((await controller.grants())[0].grant_id)
        await expect(controller.status('parent-chat', revocable.delegation_id)).rejects.toThrow(
          /grant/
        )
        expect((await human.getSession(revocable.session_id)).session_id).toBe(revocable.session_id)
      }
    } finally {
      await parent?.disconnect()
      await human?.disconnect()
      await stop()
      stores.forEach((s) => s.close())
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60000)
