import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'

const runner = fileURLToPath(new URL('../scale/attempt.py', import.meta.url))
const roots: string[] = []
const controllers: ReturnType<typeof spawn>[] = []

function cli(...args: string[]) {
  const result = spawnSync('python3', [runner, ...args, '--json'], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || result.stdout)
  return JSON.parse(result.stdout)
}

async function fixture(command: string, seconds = 8) {
  const root = await mkdtemp(join(tmpdir(), 'scale-attempt-'))
  roots.push(root)
  const work = join(root, 'work')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(work)
  const directory = join(root, 'attempt')
  const spec = {
    command: ['python3', '-c', command],
    cwd: work,
    deadlineAt: Date.now() + seconds * 1000,
    terminateGraceSeconds: 0.1,
    cleanupTimeoutSeconds: 2,
    evidenceTimeoutSeconds: 2,
    cleanupCommand: ['python3', '-c', 'from pathlib import Path;Path("cleaned").write_text("yes")'],
    progressFile: join(work, 'progress.json'),
    evidence: { root: work, paths: ['.'], exclude: ['*.private'] },
  }
  const input = join(root, 'spec.json')
  await writeFile(input, JSON.stringify(spec))
  return { root, work, directory, input }
}

async function until(check: () => boolean | Promise<boolean>, timeout = 6000) {
  const end = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > end) throw new Error('condition did not arrive')
    await new Promise((done) => setTimeout(done, 30))
  }
}

afterEach(async () => {
  for (const controller of controllers.splice(0)) {
    if (controller.exitCode === null && controller.signalCode === null) {
      controller.kill('SIGKILL')
      await once(controller, 'exit')
    }
  }
  for (const root of roots.splice(0)) {
    // Always stop our fake workers, including when an assertion fails.
    const directory = join(root, 'attempt')
    spawnSync('python3', [runner, 'stop', directory, '--json'])
    try {
      await until(() => cli('status', directory).phase === 'finished')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

it('finishes, cleans and exports evidence after its launching controller is killed', async () => {
  const f = await fixture(
    'import time,json;from pathlib import Path;' +
      'Path("progress.json").write_text(json.dumps({"phase":"upload"}));' +
      'time.sleep(1);Path("payload.txt").write_text("sample payload");' +
      'Path("token.private").write_text("sample secret")'
  )
  const code =
    'import runpy,sys,time;' +
    'm=runpy.run_path(sys.argv[1]);' +
    'm["start_attempt"](sys.argv[2],sys.argv[3]);' +
    'print("attached",flush=True);time.sleep(30)'
  const controller = spawn('python3', ['-u', '-c', code, runner, f.directory, f.input])
  controllers.push(controller)
  let output = ''
  controller.stdout.on('data', (data) => {
    output += data.toString()
  })
  await until(() => output.includes('attached'))
  await until(() => cli('status', f.directory).progress?.phase === 'upload')
  const before = cli('status', f.directory)
  controller.kill('SIGKILL')
  await once(controller, 'exit')

  // A repeated start of the same identity attaches to the existing worker.
  expect(cli('start', f.directory, f.input).token).toBe(before.token)
  const waiter = spawn('python3', [runner, 'wait', f.directory, '--timeout', '30', '--json'])
  controllers.push(waiter)
  waiter.kill('SIGKILL')
  await once(waiter, 'exit')
  await until(() => cli('status', f.directory).phase === 'finished')
  const result = cli('status', f.directory)
  expect(result.outcome).toBe('succeeded')
  expect(result.supervisorAlive).toBe(false)
  expect(result.cleanup.returncode).toBe(0)
  expect(cli('list', f.root).map((row: { token: string }) => row.token)).toContain(before.token)
  expect(await readFile(join(f.work, 'cleaned'), 'utf8')).toBe('yes')

  const destination = join(f.root, 'collected.tgz')
  expect(cli('collect', f.directory, destination).sha256).toBe(result.evidence.sha256)
  expect(cli('collect', f.directory, destination).sha256).toBe(result.evidence.sha256)
  const contents = spawnSync('tar', ['-tzf', destination], { encoding: 'utf8' })
  expect(contents.status).toBe(0)
  expect(contents.stdout).toContain('payload.txt')
  expect(contents.stdout).toContain('cleaned')
  expect(contents.stdout).not.toContain('token.private')
}, 15000)

it('enforces its absolute deadline and still cleans and exports after killing a stuck command', async () => {
  const f = await fixture(
    'import signal,time;from pathlib import Path;' +
      'signal.signal(signal.SIGTERM,signal.SIG_IGN);' +
      'Path("started").write_text("yes");time.sleep(30)',
    1
  )
  cli('start', f.directory, f.input)
  await until(() => cli('status', f.directory).phase === 'finished')
  const result = cli('status', f.directory)
  expect(result.outcome).toBe('timed-out')
  expect(result.command.timedOut).toBe(true)
  expect(result.cleanup.returncode).toBe(0)
  expect(result.evidence.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(await readFile(join(f.work, 'cleaned'), 'utf8')).toBe('yes')
  expect(() => process.kill(result.command.pid, 0)).toThrow()
})

it('retains failed outcomes and rejects an accidental new specification for the same attempt', async () => {
  const f = await fixture('raise RuntimeError("sample failure")')
  cli('start', f.directory, f.input)
  await until(() => cli('status', f.directory).phase === 'finished')
  const result = cli('status', f.directory)
  expect(result.outcome).toBe('failed')
  expect(result.command.returncode).not.toBe(0)
  expect(result.cleanup.returncode).toBe(0)
  expect(result.evidence.bytes).toBeGreaterThan(0)
  const spec = JSON.parse(await readFile(f.input, 'utf8'))
  spec.command = ['python3', '-c', 'print("different run")']
  await writeFile(f.input, JSON.stringify(spec))
  expect(() => cli('start', f.directory, f.input)).toThrow(/different specification/)
  expect(cli('status', f.directory).token).toBe(result.token)
})

it('reports a dead remote supervisor without starting a replacement', async () => {
  const f = await fixture('print("sample")')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(f.directory)
  await writeFile(join(f.directory, 'spec.json'), await readFile(f.input))
  await writeFile(
    join(f.directory, 'status.json'),
    JSON.stringify({
      schema: 1,
      token: 'sample-attempt',
      phase: 'starting',
      createdAt: Date.now() - 10000,
    })
  )
  const status = cli('start', f.directory, f.input)
  expect(status.availability).toBe('orphaned')
  expect(status.token).toBe('sample-attempt')
  expect(status.supervisorAlive).toBe(false)
  // This synthetic dead attempt never launched a worker needing cleanup.
  roots.splice(roots.indexOf(f.root), 1)
  await rm(f.root, { recursive: true, force: true })
})
