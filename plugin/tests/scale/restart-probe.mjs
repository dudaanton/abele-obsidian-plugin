#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AccessClient, V2EngineClient } from '@abele/sync-sdk/core'
import { decodeAccessToken, encodeAccessToken } from '@abele/sync-sdk/protocol'
import { generate, inventory, shapes } from './generate.mjs'
import { openServer, verifyServerLimits, verifyUploadPresence } from './local-server.mjs'
import { RealVault, manifest, setupVault } from './run.mjs'
import { WireProxy } from './proxy.mjs'
import { controlTiming } from './restart.mjs'
import { validateBuildReceipt } from './build.mjs'
import { restartModes } from './restart-probe-plan.mjs'
import { waitForJsonExport } from './evidence-export.mjs'

const delay = (ms) => new Promise((done) => setTimeout(done, ms))
async function until(label, test, timeout = 180000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const value = await test()
    if (value) return value
    await delay(250)
  }
  throw new Error(`Timed out: ${label}`)
}
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
async function content(token, file) {
  const headers = { Authorization: `Bearer ${token.key}` }
  if (token.v === 2) headers['abele-scope-item'] = token.items[0].id
  const response = await globalThis.fetch(
    `${token.address}/v2/files/${encodeURIComponent(file.file_id)}/content?${new URLSearchParams({ version_id: file.version_id })}`,
    { headers, signal: AbortSignal.timeout(120000) }
  )
  if (!response.ok) throw new Error(`Server byte read failed: ${response.status}`)
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of response.body) {
    hash.update(chunk)
    size += chunk.length
  }
  return { path: file.path, sha: hash.digest('hex'), size }
}

export async function runProbe(config) {
  const report = { candidate: config.build, phase: 'preflight', phases: [], restarts: [] }
  const checkpoint = async (phase) => {
    report.phase = phase
    report.phases.push({ phase, at: Date.now() })
    await writeFile(join(config.output, 'checkpoint.json'), JSON.stringify(report, null, 2))
    console.log(`[restart-probe] ${phase}`)
  }
  await mkdir(config.output, { recursive: true })
  const lease = JSON.parse(await readFile(config.leaseFile, 'utf8'))
  if (!lease.exclusive || lease.pid === process.pid)
    throw new Error('Exclusive supervisor required')
  process.kill(lease.pid, 0)
  if (process.platform !== 'darwin' || config.vaults.length !== 1)
    throw new Error('One disposable desktop vault required')
  const artifact = JSON.parse(await readFile(join(config.buildDir, 'build-manifest.json'), 'utf8'))
  const receipt = JSON.parse(await readFile(config.buildReceipt, 'utf8'))
  validateBuildReceipt(receipt, artifact, config.build, config.sdkTarball)
  for (const name of ['main.js', 'main.css', 'manifest.json'])
    if (digest(await readFile(join(config.buildDir, name))) !== artifact.files[name])
      throw new Error('Selected build has modified assets')
  const root = config.vaults[0]
  const device = new RealVault(config, root)
  let server, proxy, app
  const stop = async () => {
    if (!app) return
    await device
      .evaluate(`setTimeout(()=>require('@electron/remote').app.quit(),100);return true`)
      .catch(() => {})
    await until('app exit', () => app.exitCode !== null || app.signalCode !== null, 15000).catch(
      () => app.kill('SIGKILL')
    )
    app = null
  }
  const start = () => {
    const at = Date.now()
    app = spawn(config.app, [], { stdio: 'ignore' })
    app.on('error', () => {})
    return at
  }
  try {
    await checkpoint('server')
    server = await openServer({
      ...config,
      serverSdkVersion: receipt.sdk.version,
      serverEvidenceDirectory: join(config.output, 'state/server-final'),
    })
    report.server = server.receipt
    const owner = AccessClient.fromToken(server.token, { fetch: globalThis.fetch })
    const limits = (await owner.connection()).limits
    verifyServerLimits(limits, config.expectedServerLimits)
    report.head = await verifyUploadPresence(server.address, owner.token.key)
    await checkpoint('fixture generation')
    const prefix = `Scale-${randomUUID()}`
    const client = new V2EngineClient(server.token, { fetch: globalThis.fetch })
    const created = await client.commitRaw([{ op: 'mkdir', path: prefix }], randomUUID())
    const directory = created.body.results.find((row) => row.file_id)
    if (!directory) throw new Error('Scope creation failed')
    const issued = await owner.issue({
      scope: { kind: 'folder', id: directory.file_id },
      label: 'Synthetic restart probe',
    })
    const token = decodeAccessToken(issued.token)
    if ((await readdir(root)).length) throw new Error('Disposable vault must be empty')
    const expected = await generate(join(root, prefix), { ...shapes.scale, seed: 42 })
    report.fixture = {
      files: expected.length,
      bytes: expected.reduce((sum, file) => sum + file.size, 0),
      seed: 42,
    }
    await setupVault({ ...config, contentPrefix: prefix }, root, '0')
    proxy = new WireProxy(server.address, '0')
    const address = await proxy.start()
    const tokenFile = join(config.output, 'connection.private')
    await writeFile(tokenFile, encodeAccessToken({ ...token, address }), { mode: 0o600 })
    const observerFile = join(root, '.scale-observer.json')
    const baseObserver = JSON.parse(await readFile(observerFile, 'utf8'))
    const initialReceipt = join(config.output, 'initial-receipt.json')
    await writeFile(
      observerFile,
      JSON.stringify({ ...baseObserver, mode: 'control', controlReceipt: initialReceipt })
    )
    await checkpoint('initial upload')
    start()
    await until('vault window', () => device.evaluate('return true').catch(() => false))
    await device.evaluate('await app.plugins.setEnable(true);return true')
    await device.ready()
    await device.connect(tokenFile)
    await device.idle(config.timeoutMs)
    report.initialUpload = {
      settledAt: Date.now(),
      serverFiles: (await manifest(token)).filter((file) => file.kind !== 'directory').length,
      activity: await device.activityEvidence(),
    }
    await checkpoint('initial upload settled')
    await stop()
    for (const [index, mode] of restartModes(config.controlRestarts).entries()) {
      const number = index + 1
      const controlReceipt = join(config.output, `restart-${number}.json`)
      const profileReceipt = join(config.output, `restart-${number}.cpuprofile.json`)
      await writeFile(
        observerFile,
        JSON.stringify({
          ...baseObserver,
          mode,
          controlReceipt,
          profileReceipt,
          waitScreenshot:
            number === 1 ? join(config.output, 'waiting-for-obsidian.png') : undefined,
        })
      )
      await checkpoint(`restart ${number} ${mode}`)
      const launchedAt = start()
      const timing = await until(
        `restart ${number} idle`,
        async () => {
          const row = await readFile(controlReceipt, 'utf8')
            .then(JSON.parse)
            .catch(() => null)
          if (row?.fatal) throw new Error(`Fatal sync state in restart ${number}`)
          const value = controlTiming(launchedAt, proxy.events, row)
          return Number.isFinite(value.pluginLoadToFirstRequestMs) &&
            value.firstIdleAt >= value.firstRequestAt &&
            (mode !== 'profile-only' || row.profileComplete)
            ? { ...value, receipt: row }
            : false
        },
        180000
      )
      if (mode === 'profile-only') await waitForJsonExport(profileReceipt)
      const activity = await device.activityEvidence()
      report.restarts.push({
        number,
        mode,
        timing,
        activity,
        wire: proxy.events.filter((event) => event.at >= launchedAt),
      })
      await checkpoint(`restart ${number} settled`)
      await stop()
    }
    await checkpoint('byte verification')
    const allowed = new Set(expected.map((file) => `${prefix}/${file.path}`))
    for (const file of expected) {
      const parts = `${prefix}/${file.path}`.split('/')
      while (parts.length > 1) {
        parts.pop()
        allowed.add(parts.join('/'))
      }
    }
    const primary = await inventory(root, (path) => !allowed.has(path))
    const primaryMap = new Map(primary.map((file) => [file.path, file]))
    const generatedMap = new Map(expected.map((file) => [`${prefix}/${file.path}`, file]))
    const mismatches = []
    for (const file of primary) {
      const generated = generatedMap.get(file.path)
      if (!generated || generated.sha !== file.sha || generated.size !== file.size)
        mismatches.push({ path: file.path, side: 'primary' })
    }
    for (const file of (await manifest(token)).filter((row) => row.kind !== 'directory')) {
      const serverFile = await content(token, file)
      const local = primaryMap.get(serverFile.path)
      if (!local || local.sha !== serverFile.sha || local.size !== serverFile.size)
        mismatches.push({ path: file.path, side: 'server' })
    }
    report.verification = {
      primaryFiles: primary.length,
      serverFiles: (await manifest(token)).filter((row) => row.kind !== 'directory').length,
      mismatches,
    }
    if (mismatches.length) throw new Error('Byte verification mismatch')
    await unlink(tokenFile)
    await checkpoint('complete')
    return report
  } catch (error) {
    report.failure = error.message
    await checkpoint('failed')
    throw error
  } finally {
    await stop().catch(() => {})
    await proxy?.close().catch(() => {})
    await server?.close().catch(() => {})
    await writeFile(join(config.output, 'report.json'), JSON.stringify(report, null, 2))
  }
}

if (process.argv[1]?.endsWith('/restart-probe.mjs'))
  await runProbe(JSON.parse(await readFile(process.argv[2], 'utf8')))
