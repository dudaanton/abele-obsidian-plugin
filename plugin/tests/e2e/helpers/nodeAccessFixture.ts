import { expect } from 'vitest'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
/** A git folder on a node the app is connected to, and nothing in this vault that reaches it. */
export async function withNode(
  work: (node: {
    port: number
    token: string
    repo: string
    stop: () => Promise<void>
  }) => Promise<void>
) {
  const cli = process.env.ABELE_NODE_CLI
  if (!cli) throw new Error('Set ABELE_NODE_CLI to the built daemon CLI')
  mkdirSync('../.scratch', { recursive: true })
  const dir = realpathSync(mkdtempSync(resolve('../.scratch/node-access-'))),
    repo = resolve(dir, 'sample-app'),
    state = resolve(dir, 'state')
  mkdirSync(repo)
  writeFileSync(resolve(repo, 'sample.txt'), 'first line\nsecond line\n')
  const git = (...args: string[]) => {
    const r = spawnSync('/usr/bin/git', args, { cwd: repo, encoding: 'utf8' })
    if (r.status) throw Error(r.stderr)
  }
  git('init', '-b', 'main')
  git('add', '.')
  git(
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'fixture'
  )
  const fake = resolve('tests/fixtures/nodeClaude.mjs')
  const token = spawnSync(
    process.execPath,
    [cli, 'token', 'create', 'fixture', '--state-dir', state, '--claude-path', fake, '--json'],
    { encoding: 'utf8' }
  )
  expect(token.status, token.stderr).toBe(0)
  let child: ChildProcess | undefined
  try {
    child = spawn(
      process.execPath,
      [cli, 'start', '--state-dir', state, '--port', '0', '--claude-path', fake, '--json'],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
    let output = '',
      errors = ''
    child.stdout!.on('data', (b) => (output += b))
    child.stderr!.on('data', (b) => (errors += b))
    for (let i = 0; !output.includes('"listening"'); i++) {
      if (i > 500 || child.exitCode !== null) throw Error(errors || 'Daemon startup deadline')
      await wait(20)
    }
    const { port } = JSON.parse(output.split('\n').find((l) => l.includes('"listening"'))!) as {
      port: number
    }
    const stop = async () => {
      if (!child || child.exitCode !== null || child.signalCode !== null) return
      const stopped = new Promise<void>((resolve) => child!.once('exit', () => resolve()))
      child.kill('SIGTERM')
      await stopped
    }
    await work({ port, token: (JSON.parse(token.stdout) as { token: string }).token, repo, stop })
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise<void>((r) => child!.once('exit', () => r()))
      child.kill('SIGTERM')
      await stopped
    }
    rmSync(dir, { recursive: true, force: true })
  }
}
