#!/usr/bin/env node
/** Opt-in local disposable native gate; only a pool lease, no app-wide/window-list changes. */
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  rmSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifySyncFixture } from './verify-sync-inputs.mjs'
import { requireRoutableOwnedPool } from './agent-stand-window.mjs'
const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '..')
if (!process.env.ABELE_AGENT_STAND_STAGE) {
  console.log('Agent stand disabled: explicit ABELE_AGENT_STAND_STAGE required')
  process.exit(0)
}
if (process.env.ABELE_AGENT_STAND_STAGE !== 'disposable')
  throw new Error('Only disposable agent stand stage is allowed')
verifySyncFixture(process.env.ABELE_AGENT_STAND_FIXTURE, process.env.ABELE_AGENT_STAND_COMMIT)
const lease = join(homedir(), '.local/state/abele/e2e-vault.sh'),
  take = spawnSync(lease, ['try', 'sync-agent-stand'], { encoding: 'utf8' })
if (take.status !== 0) throw new Error('No free pool vault; shared app left untouched')
const vault = take.stdout.trim()
if (!/^[A-Za-z0-9_-]+$/.test(vault)) throw new Error('Invalid pool lease result')
const scratch = join(plugin, '../.scratch/agent-stand-run')
mkdirSync(scratch, { recursive: true })
console.log('Agent stand owned pool:', vault)
const backup = mkdtempSync(join(scratch, 'build-')),
  target = join(homedir(), 'obsidian', vault, '.obsidian/plugins/abele'),
  files = ['main.js', 'styles.css', 'manifest.json']
writeFileSync(join(backup, 'vault-name'), vault)
let installed = false,
  failed = false,
  cliResponsive = true
const cli = process.env.OBSIDIAN_CLI ?? join(homedir(), '.local/bin/obsidian')
const evaluateOwnedBoolean = (expression) => {
  if (spawnSync('pgrep', ['-x', 'Obsidian'], { encoding: 'utf8' }).status !== 0) return false
  const id = randomUUID(),
    code = `(async()=>JSON.stringify({__abeleReply:${JSON.stringify(id)},hasValue:true,value:await (${expression})}))()`
  const r = spawnSync(
    process.execPath,
    [
      join(plugin, 'tests/e2e/helpers/obsidianEvalProcess.mjs'),
      cli,
      id,
      String(Date.now() + 10000),
      'vault=' + vault,
      'eval',
      'code=' + code,
    ],
    { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', detached: true }
  )
  if (r.pid)
    try {
      process.kill(-r.pid, 'SIGKILL')
    } catch {
      /* owned proxy/CLI already reaped */
    }
  const traceFailure = () =>
    writeFileSync(
      join(scratch, 'cli-probe-failure.json'),
      JSON.stringify(
        {
          vault,
          command: { executable: cli, args: ['vault=' + vault, 'eval', 'code=' + code] },
          status: r.status,
          signal: r.signal,
          error: r.error?.message ?? null,
          stdout: r.stdout,
          stderr: r.stderr,
        },
        null,
        2
      ) + '\n'
    )
  if (r.status !== 0) {
    traceFailure()
    return false
  }
  for (const line of r.stdout.split('\n')) {
    if (!line.startsWith('=> ')) continue
    try {
      const reply = JSON.parse(line.slice(3))
      if (reply.__abeleReply === id && reply.value === true) return true
    } catch {
      /* unrelated/nonreply diagnostic */
    }
  }
  traceFailure()
  return false
}
const probe = () => evaluateOwnedBoolean('app.vault.getName()===' + JSON.stringify(vault))
const reload = () => {
  const r = spawnSync(cli, ['vault=' + vault, 'plugin:reload', 'id=abele'], {
    encoding: 'utf8',
    timeout: 45000,
    killSignal: 'SIGKILL',
  })
  if (r.status !== 0) {
    cliResponsive = false
    throw new Error(
      'Pool CLI/plugin reload failed; stop and report to manager, no app recovery permitted'
    )
  }
}
try {
  requireRoutableOwnedPool({ probe })
  for (const f of files) {
    if (existsSync(join(target, f))) copyFileSync(join(target, f), join(backup, f))
    else writeFileSync(join(backup, f + '.absent'), '')
  }
  const build = spawnSync('npm', ['run', 'build:test'], { cwd: plugin, stdio: 'inherit' })
  if (build.status !== 0) throw new Error('Development build failed')
  installed = true
  for (const f of files)
    copyFileSync(
      f === 'manifest.json'
        ? join(plugin, '..', f)
        : join(plugin, 'build', f === 'styles.css' ? 'main.css' : f),
      join(target, f)
    )
  reload()
  const args = [
    'vitest',
    'run',
    '--config',
    'vitest.e2e.config.ts',
    'tests/e2e/agentStand.e2e.test.ts',
    ...process.argv.slice(2),
  ]
  const result = spawnSync('npx', args, {
    cwd: plugin,
    stdio: 'inherit',
    env: { ...process.env, OBSIDIAN_TEST_VAULT: vault },
  })
  process.exitCode = result.status ?? 1
} catch (e) {
  failed = true
  process.exitCode = 1
  console.error(e.message)
} finally {
  try {
    if (installed) {
      for (const f of files) {
        if (existsSync(join(backup, f + '.absent'))) rmSync(join(target, f), { force: true })
        else {
          copyFileSync(join(backup, f), join(target, f))
          if (!readFileSync(join(target, f)).equals(readFileSync(join(backup, f))))
            throw new Error('Original pool build bytes differ')
        }
      }
      if (cliResponsive) reload()
      else throw new Error('Original build bytes restored; runtime reload awaits manager')
    }
    rmSync(backup, { recursive: true, force: true })
  } catch {
    failed = true
    process.exitCode = 1
    console.error('Original pool plugin restoration failed; preserved build backup for recovery')
  }
  spawnSync(lease, ['drop', vault], { stdio: 'ignore' })
  if (failed) console.error('Agent stand run did not pass')
}
