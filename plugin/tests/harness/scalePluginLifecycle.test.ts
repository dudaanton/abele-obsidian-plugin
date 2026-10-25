// @vitest-environment node
import { expect, it } from 'vitest'
import { createContext, runInContext } from 'node:vm'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { RealVault } from '../scale/run.mjs'

it('replies to the launch before plugin loading completes, then waits for completion', async () => {
  let complete: () => void = () => {}
  const pending = new Promise<void>((resolve) => {
    complete = resolve
  })
  let launched: () => void = () => {}
  const launchReply = new Promise<void>((resolve) => {
    launched = resolve
  })
  const context = createContext({
    window: {},
    Date,
    app: { plugins: { enablePlugin: () => pending } },
  })
  const vault = new RealVault({}, '/sample-vault')
  vault.evaluate = async (body) => {
    const value = await runInContext(`(async()=>{${body}})()`, context)
    if (value?.state === 'pending') launched()
    return value
  }
  let settled = false
  const operation = vault.pluginEnabled(true, 2000).then((value) => {
    settled = true
    return value
  })
  try {
    await Promise.race([
      launchReply,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Launch reply blocked')), 500)),
    ])
    expect(settled).toBe(false)
    complete()
    expect(await operation).toMatchObject({ state: 'done' })
  } finally {
    complete()
    await operation.catch(() => {})
  }
})

it('reports a rejected plugin action without exposing its private error text', async () => {
  const context = createContext({
    window: {},
    Date,
    app: {
      plugins: {
        disablePlugin: async () => {
          throw new Error('sample secret')
        },
      },
    },
  })
  const vault = new RealVault({}, '/sample-vault')
  vault.evaluate = (body) => runInContext(`(async()=>{${body}})()`, context)
  await expect(vault.pluginEnabled(false, 2000)).rejects.toThrow('Plugin disable action failed')
  expect(JSON.stringify(context.window)).not.toContain('sample secret')
})

it('retains CLI exit metadata without retaining process output', async () => {
  const root = await mkdtemp(join(process.cwd(), '.scale-cli-failure-'))
  try {
    const cli = join(root, 'sample-cli.cjs')
    await writeFile(
      cli,
      `#!${process.execPath}\nprocess.stderr.write('sample secret');process.exit(7)`,
      {
        mode: 0o755,
      }
    )
    const vault = new RealVault({ cli }, '/sample-vault')
    const error = await vault.evaluate('return true').catch((failure) => failure)
    expect(error.message).toBe('Vault CLI unavailable')
    expect(error.scaleCliFailure).toMatchObject({
      code: 7,
      killed: false,
      stderrBytes: 13,
      stdoutBytes: 0,
    })
    expect(error.scaleCliFailure.elapsedMs).toBeGreaterThanOrEqual(0)
    expect(JSON.stringify(error)).not.toContain('sample secret')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
