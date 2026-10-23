#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdir, copyFile, readdir, unlink } from 'node:fs/promises'
import { resolve, join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { fileExpectations, oversizedEvidence, pauseWriteMetrics } from './refusals.mjs'
import { AccessClient, V2EngineClient } from '@abele/sync-sdk/core'
import { decodeAccessToken, encodeAccessToken } from '@abele/sync-sdk/protocol'
import { generate, inventory, shapes, planVault } from './generate.mjs'
import { WireProxy } from './proxy.mjs'
import { validateBuildReceipt } from './build.mjs'
import {
  requireTime,
  phaseTimings,
  saveCheckpoint,
  activeRequestIds,
  recoveryTimings,
} from './progress.mjs'
import {
  compareInventory,
  budgets,
  markdown,
  pauseMetrics,
  expectedSet,
  comparePeer,
  noticeDetails,
  startupTiming,
  compareReports,
  attributePauseRequests,
} from './oracles.mjs'

const exec = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const evalProcess = resolve(here, '../e2e/helpers/obsidianEvalProcess.mjs')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const host = 'const h=app.plugins.plugins.abele?.tokenEngines;const u=h?.ui;'
let deadline = Infinity

async function wait(label, test, timeout = 120000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    requireTime(deadline)
    const result = await test()
    if (result) return result
    await sleep(100)
  }
  throw new Error(`Timed out: ${label}`)
}

export class RealVault {
  constructor(config, root) {
    this.config = config
    this.root = root
    this.name = basename(root)
  }
  async evaluate(body) {
    // Only file locations travel in CLI arguments. Never token text or arbitrary product errors.
    let stdout
    const nonce = randomUUID()
    const expression = `(async()=>{try{const value=await(async()=>{${body}})();return JSON.stringify({__abeleReply:${JSON.stringify(nonce)},hasValue:value!==undefined,value})}catch{return JSON.stringify({__abeleReply:${JSON.stringify(nonce)},hasValue:true,value:{scaleError:true}})}})()`
    try {
      ;({ stdout } = await exec(
        process.execPath,
        [
          evalProcess,
          this.config.cli,
          nonce,
          String(Date.now() + 12000),
          `vault=${this.name}`,
          'eval',
          `code=${expression}`,
        ],
        { timeout: 14000, maxBuffer: 2 * 1024 ** 2 }
      ))
    } catch {
      throw new Error('Vault CLI unavailable')
    }
    const line = stdout.slice(stdout.lastIndexOf('=> ') + 3).trim()
    let result
    try {
      const reply = JSON.parse(line)
      if (reply.__abeleReply !== nonce || !reply.hasValue) throw new Error('Invalid frame')
      result = reply.value
    } catch {
      throw new Error('Vault CLI returned no JSON result')
    }
    if (result?.scaleError) throw new Error('Vault action failed (private details suppressed)')
    return result
  }
  async ready() {
    return wait('plugin startup', () => this.evaluate(`${host}return !!u`).catch(() => false))
  }
  async snapshot() {
    return this.evaluate(
      `${host}return !u?null:{job:window.__scaleJob,engines:[...h.live.values()].map(e=>({state:e.engine.status.state,lastSyncAt:e.engine.status.lastSyncAt})),rows:u.rows.value.map(({id,status,paused})=>({id,status,paused})),activity:Object.values(u.activity.value).map(a=>({startup:a.startup?.stage,transfer:a.transfer?.stage,completed:a.transfer?.completed,total:a.transfer?.total}))}`
    )
  }
  async policy() {
    return this.evaluate(
      `${host}const v=app.vault;return {configDir:v.configDir,selective:u.registry.records()[0]?.selective,ignoreText:await v.adapter.exists('.abele-sync-ignore')?await v.adapter.read('.abele-sync-ignore'):null}`
    )
  }
  async refusals() {
    return this.evaluate(
      `${host}return Object.values(u.activity.value).flatMap(a=>[...(a.refused??[]).map(({path,reason})=>({path,reason,source:'status'})),...[...(a.events??[])].flatMap(e=>{const m=/^scan: held (.+): (.+) is synced under the same name but for case;/.exec(e.text);return m?[{path:m[1],reason:'Case collision: '+e.text,at:e.at,source:'log'}]:[]})])`
    )
  }
  async activityEvidence() {
    return this.evaluate(
      `${host}return Object.entries(u.activity.value).map(([id,a])=>({id,refused:a.refused??[],events:[...(a.events??[])]}))`
    )
  }
  async connect(tokenFile) {
    await this.evaluate(
      `${host}void u.connect(require('fs').readFileSync(${JSON.stringify(tokenFile)},'utf8')).catch(()=>{});return true`
    )
  }
  async sync() {
    await this.evaluate(
      `${host}const epoch=(window.__scaleJobEpoch||0)+1;window.__scaleJobEpoch=epoch;window.__scaleJob='pending';const update=state=>{if(window.__scaleJobEpoch===epoch)window.__scaleJob=state};void Promise.all(u.rows.value.map(r=>u.sync(r.id))).then(()=>update('done'),()=>update('failed'));return true`
    )
  }
  async invalidateJob() {
    await this.evaluate(
      'window.__scaleJobEpoch=(window.__scaleJobEpoch||0)+1;window.__scaleJob=null;return true'
    )
  }
  async paused(value) {
    return this.evaluate(
      `${host}window.__scaleCaptureCallers=${value};const at=Date.now();for(const r of u.rows.value)void u.pause(r.id,${value}).catch(()=>{});return at`
    )
  }
  async idle(timeout) {
    return wait(
      'vault idle',
      async () => {
        const state = await this.snapshot()
        if (state?.job === 'failed')
          throw new Error('Sync action failed (private details suppressed)')
        if (state?.rows.some((row) => row.status === 'error'))
          throw new Error('Vault entered an error state')
        return (
          state?.job !== 'pending' &&
          state?.rows.length &&
          state.rows.every((row) => row.status === 'idle') &&
          state.engines.length &&
          state.engines.every((engine) => engine.state === 'idle' && engine.lastSyncAt)
        )
      },
      timeout
    )
  }
}

async function raw(token, route, init = {}) {
  const headers = { Authorization: `Bearer ${token.key}`, ...init.headers }
  if (token.v === 2) headers['abele-scope-item'] = token.items[0].id
  const response = await globalThis.fetch(`${token.address}/v2/${route}`, {
    ...init,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(120000),
  })
  if (!response.ok) throw new Error(`Server API failed: HTTP ${response.status}`)
  return response
}

async function manifest(token) {
  const result = []
  let next = null
  do {
    const page = await (
      await raw(token, 'manifest' + (next ? '?' + new URLSearchParams({ next }) : ''))
    ).json()
    result.push(...page.items)
    next = page.next
  } while (next)
  return result
}

async function setupVault(config, root, device) {
  await mkdir(join(root, '.obsidian/plugins/abele'), { recursive: true })
  for (const name of ['main.js', 'manifest.json', 'styles.css']) {
    const from = join(config.buildDir, name === 'styles.css' ? 'main.css' : name)
    await copyFile(from, join(root, '.obsidian/plugins/abele', name))
  }
  const observer = join(root, '.obsidian/plugins/scale-observer')
  await mkdir(observer, { recursive: true })
  await copyFile(join(here, 'observer.cjs'), join(observer, 'main.js'))
  await copyFile(join(here, 'writes.cjs'), join(observer, 'writes.cjs'))
  await writeFile(
    join(observer, 'manifest.json'),
    JSON.stringify({
      id: 'scale-observer',
      name: 'Scale observer',
      version: '1.0.0',
      minAppVersion: '1.0.0',
      description: 'Disposable scale evidence',
      author: '',
      isDesktopOnly: true,
    })
  )
  await writeFile(
    join(root, '.obsidian/community-plugins.json'),
    JSON.stringify(['scale-observer', 'abele'])
  )
  await writeFile(join(root, '.obsidian/core-plugins.json'), '[]')
  await writeFile(join(root, '.obsidian/app.json'), JSON.stringify({ promptDelete: false }))
  if (config.pluginSettings)
    await writeFile(
      join(root, '.obsidian/plugins/abele/data.json'),
      JSON.stringify(config.pluginSettings)
    )
  await writeFile(
    join(root, '.scale-observer.json'),
    JSON.stringify({
      evidence: join(config.output, 'renderer.jsonl'),
      device,
      writeObserver: join(observer, 'writes.cjs'),
    })
  )
}

export async function run(config) {
  deadline = config.deadlineAt ?? Infinity
  // The external supervisor owns app-wide locks, resource reservation and crash cleanup.
  const lease = JSON.parse(await readFile(config.leaseFile, 'utf8'))
  if (!lease.exclusive || lease.pid === process.pid)
    throw new Error('Exclusive live supervisor required')
  process.kill(lease.pid, 0)
  if (process.platform !== 'darwin') throw new Error('Real desktop scale runs require macOS')
  const options = {
    ...shapes[config.shape ?? 'smoke'],
    ...config.parameters,
    seed: config.seed ?? 1,
  }
  const report = {
    build: config.build,
    ...options,
    interruptions: [],
    failures: [],
    phase: 'preflight',
    phases: [{ name: 'preflight', at: Date.now() }],
    caseRefusals: [],
    primaryActivity: [],
  }
  const phase = (name) => {
    report.phase = name
    report.phases.push({ name, at: Date.now() })
    console.debug('[scale]', name)
  }
  const proxies = []
  const tokenFiles = []
  let appProcess
  let issued
  let owner
  let expected = []
  const devices = config.vaults.map((root) => new RealVault(config, root))
  let saving = Promise.resolve()
  let checkpointError = false
  const checkpoint = () => {
    saving = saving
      .then(() => saveCheckpoint(config.output, report, proxies))
      .catch(() => {
        checkpointError = true
      })
  }
  let checkpointTimer
  const settle = async (device, step) => {
    const startedAt = Date.now()
    let idle = false
    try {
      await device.idle(config.timeoutMs)
      idle = true
      return true
    } catch (error) {
      if (error.message === 'Run deadline reached') throw error
      const reason = [
        'Vault entered an error state',
        'Sync action failed (private details suppressed)',
        'Timed out: vault idle',
      ].includes(error.message)
        ? error.message
        : 'Device state unavailable'
      report.failures.push({ step, reason, snapshot: await device.snapshot().catch(() => null) })
      await device.invalidateJob().catch(() => {})
      return false
    } finally {
      ;(report.settleTimings ??= []).push({
        step,
        device: String(devices.indexOf(device)),
        idle,
        startedAt,
        endedAt: Date.now(),
        durationMs: Date.now() - startedAt,
      })
      if (device === devices[0])
        report.caseRefusals.push(...(await device.refusals().catch(() => [])))
      if (device === devices[0])
        report.primaryActivity.push({
          phase: report.phase,
          at: Date.now(),
          activity: await device.activityEvidence().catch(() => null),
        })
    }
  }
  const stop = async (hard) => {
    if (!appProcess) return
    if (!hard)
      await devices[0]
        .evaluate(`setTimeout(()=>require('@electron/remote').app.quit(),100);return true`)
        .catch(() => {})
    if (hard) appProcess.kill('SIGKILL')
    await wait(
      'app exit',
      () => appProcess.exitCode !== null || appProcess.signalCode !== null,
      15000
    ).catch(() => appProcess.kill('SIGKILL'))
    appProcess = null
  }
  const start = async () => {
    const at = Date.now()
    appProcess = spawn(config.app, config.appArgs ?? [], { stdio: 'ignore' })
    appProcess.on('error', () => {})
    for (const device of devices) {
      await wait('disposable vault window', () => device.evaluate('return true').catch(() => false))
      await device.evaluate('await app.plugins.setEnable(true);return true')
    }
    await devices[0].ready()
    return at
  }
  await mkdir(config.output, { recursive: true })
  checkpointTimer = setInterval(checkpoint, config.checkpointMs ?? 30000)
  checkpointTimer.unref()
  try {
    const artifact = JSON.parse(
      await readFile(join(config.buildDir, 'build-manifest.json'), 'utf8')
    )
    if (config.sdkTarball && !config.buildReceipt)
      throw new Error('Selected build SDK tarball requires a build receipt')
    if (config.buildReceipt) {
      report.buildReceipt = JSON.parse(await readFile(config.buildReceipt, 'utf8'))
      validateBuildReceipt(report.buildReceipt, artifact, config.build, config.sdkTarball)
    }
    if (artifact.provenance?.git?.revision !== config.build)
      throw new Error('Selected build does not match artifact revision')
    for (const name of ['main.js', 'main.css', 'manifest.json']) {
      if (sha(await readFile(join(config.buildDir, name))) !== artifact.files[name])
        throw new Error('Selected build has modified assets')
    }
    if (devices.length !== 2 || devices[0].root === devices[1].root)
      throw new Error('Two separate disposable vaults required')
    const encoded = (await readFile(config.tokenFile, 'utf8')).trim()
    owner = AccessClient.fromToken(encoded, { fetch: globalThis.fetch })
    if (new URL(owner.token.address).origin !== new URL(config.server).origin)
      throw new Error('Token endpoint does not match configured server')
    report.serverLimits = (await owner.connection()).limits
    const declared = fileExpectations(planVault(options), report.serverLimits)
    report.filePlan = {
      limit: declared.limit,
      oversized: declared.oversized,
      interruptionTarget: declared.interruptionTarget,
    }
    const prefix = `Scale-${randomUUID()}`
    report.scope = prefix
    const client = new V2EngineClient(encoded, { fetch: globalThis.fetch })
    const created = await client.commitRaw([{ op: 'mkdir', path: prefix }], randomUUID())
    const directory = created.body.results.find((row) => row.file_id)
    if (!directory) throw new Error('Isolated server folder was not created')
    report.scopeId = directory.file_id
    issued = await owner.issue({
      scope: { kind: 'folder', id: directory.file_id },
      label: 'Synthetic scale run',
    })
    const token = decodeAccessToken(issued.token)
    phase('generate and install')
    for (const [i, device] of devices.entries()) {
      await mkdir(device.root, { recursive: true })
      if ((await readdir(device.root)).length) throw new Error('Disposable vault must be empty')
      if (i === 0) report.expected = await generate(join(device.root, prefix), options)
      await setupVault(config, device.root, String(i))
      const proxy = new WireProxy(config.server, String(i))
      proxies.push(proxy)
      const address = await proxy.start()
      const file = join(config.output, `connection-${i}.private`)
      await writeFile(file, encodeAccessToken({ ...token, address }), { mode: 0o600 })
      tokenFiles.push(file)
    }
    expected = report.expected.map((file) => ({ ...file, path: `${prefix}/${file.path}` }))
    const filePlan = fileExpectations(expected, report.serverLimits)
    report.oversizedFiles = filePlan.oversized
    report.interruptionTarget = filePlan.interruptionTarget
    await writeFile(
      join(config.output, 'run-receipt.json'),
      JSON.stringify(
        {
          build: report.build,
          sdk: report.buildReceipt?.sdk,
          ...options,
          serverLimits: report.serverLimits,
          oversizedFiles: report.oversizedFiles,
          interruptionTarget: report.interruptionTarget,
        },
        null,
        2
      )
    )
    await writeFile(join(config.output, 'expected-inventory.json'), JSON.stringify(expected))
    delete report.expected
    const a = devices[0],
      b = devices[1],
      p = proxies[0],
      q = proxies[1]
    p.breakpointSha = report.interruptionTarget.sha
    p.cutAfterBytes = ((options.seed % 4) + 1) * 16 * 1024
    const triggered = async (proxy, kind, action) => {
      const since = Date.now()
      proxy.breakpoint = kind
      await action()
      const event = await wait(
        `interruption ${kind}`,
        () => proxy.events.find((e) => e.at >= since && e.event === 'trigger' && e.kind === kind),
        config.timeoutMs
      )
      return event
    }
    const mark = (kind) => report.interruptions.push({ kind, triggered: true, at: Date.now() })
    const firstUploadAt = Date.now()
    phase('first upload')
    await start()
    await triggered(p, 'large-upload', () => a.connect(tokenFiles[0]))
    await stop(true)
    p.release()
    mark('kill mid-large-file')
    const resumedAt = Date.now()
    phase('resume upload')
    p.breakpoint = 'batch'
    await start()
    const upload = await wait(
      'resume upload',
      () =>
        p.events.find(
          (e) =>
            e.at >= resumedAt &&
            e.event === 'start' &&
            ['PUT', 'POST'].includes(e.method) &&
            (/^\/v2\/uploads\//.test(e.route) || (e.route === '/v2/commit' && e.contentCommit))
        ),
      config.timeoutMs
    )
    report.resumeUploadMs = upload.at - resumedAt
    await wait(
      'commit acknowledgement interruption',
      () => p.events.find((e) => e.event === 'trigger' && e.kind === 'batch'),
      config.timeoutMs
    )
    await stop(false)
    p.release()
    mark('quit mid-batch')
    phase('comparison interruption')
    await triggered(p, 'comparison', start)
    await stop(false)
    p.release()
    mark('quit during comparison')
    await start()
    phase('network and plugin interruption')
    await wait('network interruption in flight', () => p.active.size > 0, config.timeoutMs)
    p.drop()
    mark('network drop')
    await sleep(2000)
    p.offline = false
    await a.sync()
    await wait('plugin interruption in flight', () => p.active.size > 0, config.timeoutMs)
    await a.invalidateJob()
    await a.evaluate(`await app.plugins.disablePlugin('abele');return true`)
    await a.evaluate(`await app.plugins.enablePlugin('abele');return true`)
    mark('plugin disable-enable')
    await a.ready()
    report.firstUploadSettled = await settle(a, 'first upload')
    report.syncPolicy = await a.policy()
    const uploaded = (await manifest(token)).filter((file) => file.kind !== 'directory')
    report.uploadedFiles = uploaded.length
    report.uploadedBytes = uploaded.reduce((sum, file) => sum + file.size, 0)
    const firstUploadMs = Date.now() - firstUploadAt
    report.initialUploadMs = firstUploadMs
    report.filesPerSecond = report.uploadedFiles / (firstUploadMs / 1000)
    report.mibPerSecond = report.uploadedBytes / 1024 ** 2 / (firstUploadMs / 1000)
    phase('second device pull')
    const peerDownloadAt = Date.now()
    await b.ready()
    await triggered(q, 'pull', () => b.connect(tokenFiles[1]))
    const pauseAt = Date.now()
    report.pauseActionAt = await b.paused(true)
    report.pauseControllerAt = pauseAt
    const alreadyActive = activeRequestIds(q.events, report.pauseActionAt)
    report.pauseActionOffsetMs = report.pauseActionAt - pauseAt
    q.release()
    await sleep(2500)
    report.pauseWindowEndAt = Date.now()
    Object.assign(
      report,
      pauseMetrics(
        q.events,
        report.pauseActionAt,
        alreadyActive,
        new Set(q.active.keys()),
        Date.now()
      )
    )
    mark('pause mid-pull')
    await b.paused(false)
    await b.sync()
    await settle(b, 'second device pull')
    report.peerInitialDownloadMs = Date.now() - peerDownloadAt
    phase('edits and settle')
    const edits = [
      { device: a, path: `${prefix}/Notes/Device A.md`, text: '# Device A\n' },
      { device: b, path: `${prefix}/Notes/Device B.md`, text: '# Device B\n' },
      { device: a, path: expected[10].path, text: '# Existing note edited on A\n' },
      { device: b, path: expected[11].path, text: '# Existing note edited on B\n' },
    ]
    for (const edit of edits) {
      await edit.device.evaluate(
        `const path=${JSON.stringify(edit.path)},text=${JSON.stringify(edit.text)};const f=app.vault.getAbstractFileByPath(path);if(f)await app.vault.modify(f,text);else await app.vault.create(path,text);return true`
      )
      const next = { path: edit.path, size: Buffer.byteLength(edit.text), sha: sha(edit.text) }
      const prior = expected.findIndex((file) => file.path === edit.path)
      if (prior < 0) expected.push(next)
      else expected[prior] = next
    }
    for (let i = 0; i < 3; i++) {
      await a.sync()
      await b.sync()
      await settle(a, `edit cycle ${i} device A`)
      await settle(b, `edit cycle ${i} device B`)
    }
    await writeFile(join(config.output, 'expected-inventory.json'), JSON.stringify(expected))
    await stop(false)
    phase('synced restart')
    const restartAt = Date.now()
    report.restartAt = restartAt
    await start()
    await wait(
      'restart first server request',
      () =>
        proxies.every((proxy) =>
          proxy.events.some((e) => e.event === 'start' && e.at >= restartAt)
        ),
      60000
    ).catch(() => {})
    report.deviceRestartRequestMs = proxies.map((proxy) => {
      const first = proxy.events.find((e) => e.event === 'start' && e.at >= restartAt)
      return first ? first.at - restartAt : null
    })
    report.restartRequestMs = report.deviceRestartRequestMs.every((value) => value !== null)
      ? Math.max(...report.deviceRestartRequestMs)
      : undefined
    const settledA = await settle(a, 'restart device A')
    const idleA = settledA ? Date.now() : null
    const settledB = await settle(b, 'restart device B')
    report.deviceRestartIdleAt = [idleA, settledB ? Date.now() : null]
    report.restartIdleMs = settledA && settledB ? Date.now() - restartAt : undefined
    report.restartObservedMs = Date.now() - restartAt
    await stop(false)
    phase('byte verification')
    report.mismatches = []
    report.verifiedFiles = 0
    report.deviceFiles = []
    report.expectedFiles = expected.length
    const set = expectedSet(
      fileExpectations(expected, report.serverLimits).transfer,
      report.syncPolicy
    )
    report.excludedBySettings = set.excluded
    report.syncedExpectedFiles = set.synced.length
    for (const [i, device] of devices.entries()) {
      const actual = await inventory(
        device.root,
        (path) => path !== prefix && !path.startsWith(prefix + '/')
      )
      report.deviceFiles.push(actual.length)
      report.verifiedFiles += actual.length
      report.mismatches.push(
        ...(i === 0
          ? compareInventory(expected, actual)
          : comparePeer(set, actual, report.caseRefusals)
        ).map((row) => ({ device: String(i), ...row }))
      )
    }
    const serverFiles = []
    report.serverInventory = serverFiles
    for (const file of (await manifest(token)).filter((file) => file.kind !== 'directory')) {
      requireTime(deadline)
      const response = await raw(
        token,
        `files/${encodeURIComponent(file.file_id)}/content?${new URLSearchParams({ version_id: file.version_id })}`
      )
      const hash = createHash('sha256')
      let size = 0
      for await (const chunk of response.body) {
        hash.update(chunk)
        size += chunk.length
      }
      serverFiles.push({ path: file.path, size, sha: hash.digest('hex') })
      report.serverHashesCompleted = serverFiles.length
    }
    report.mismatches.push(
      ...comparePeer(set, serverFiles, report.caseRefusals).map((row) => ({
        device: 'server',
        ...row,
      }))
    )
    report.serverFiles = serverFiles.length
    report.verifiedFiles += serverFiles.length
    report.verificationComplete = true
    if (report.failures.length)
      report.failure = 'Device settle checks failed; byte evidence was still collected'
    phase('complete')
  } catch (error) {
    // Errors from SDK/CLI can include credentials; expose only our controlled diagnostics.
    report.failure =
      /^(Server file limit|Run deadline reached|Timed out:|Disposable |Two separate|Isolated |Token endpoint|Case-sensitive|Selected build)/.test(
        error.message
      )
        ? error.message
        : 'Harness operation failed; private details suppressed'
    report.lastSnapshots = await Promise.all(
      devices.map((device) => device.snapshot().catch(() => null))
    )
  } finally {
    clearInterval(checkpointTimer)
    await saving
    if (checkpointError) report.checkpointFailure = true
    // Cleanup waits must remain available after the scenario deadline.
    deadline = Infinity
    await stop(true)
    report.ownDownloads = proxies.reduce((sum, proxy) => sum + proxy.ownDownloads(), 0)
    report.unresolvedDownloads = proxies.reduce(
      (sum, proxy) => sum + proxy.unresolvedDownloads(),
      0
    )
    report.wire = proxies.flatMap((proxy) => proxy.events)
    report.phaseTimings = phaseTimings(report.phases)
    report.recoveryTimings = recoveryTimings(
      report.interruptions,
      report.wire,
      report.settleTimings ?? []
    )
    for (const proxy of proxies) await proxy.close()
    for (const file of tokenFiles) await unlink(file).catch(() => {})
    if (issued && owner)
      await owner.revoke(issued.info.id).catch(() => {
        report.cleanupFailure = true
      })
    const renderer = await readFile(join(config.output, 'renderer.jsonl'), 'utf8').catch(() => '')
    const entries = renderer.trim()
      ? renderer
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : []
    report.notices = entries.length ? entries.filter((e) => e.event === 'notice').length : undefined
    report.noticeDetails = noticeDetails(entries, report.phases)
    report.primaryStateObservations = entries.filter((e) => e.event === 'primary-state')
    const intact = []
    for (const file of report.oversizedFiles ?? []) {
      try {
        const hash = createHash('sha256')
        let size = 0
        for await (const chunk of createReadStream(join(devices[0].root, file.path))) {
          hash.update(chunk)
          size += chunk.length
        }
        intact.push({ path: file.path, size, sha: hash.digest('hex') })
      } catch {
        /* Missing or unreadable bytes fail the independent primary oracle. */
      }
    }
    report.oversizedEvidence = oversizedEvidence(
      report.oversizedFiles ?? [],
      intact,
      report.primaryStateObservations,
      report.wire
    )
    if (report.pauseActionAt && report.pauseWindowEndAt)
      Object.assign(
        report,
        pauseWriteMetrics(entries, '1', report.pauseActionAt, report.pauseWindowEndAt)
      )
    if (report.restartAt)
      report.startupTiming = proxies.map((proxy, i) => ({
        device: proxy.device,
        ...startupTiming(
          report.restartAt,
          proxy.events.find((e) => e.event === 'start' && e.at >= report.restartAt)?.at,
          entries.filter((e) => e.device === proxy.device),
          report.deviceRestartIdleAt?.[i]
        ),
      }))
    report.startupClock = 'plugin-load'
    const worst = (key) =>
      report.startupTiming?.length === devices.length &&
      report.startupTiming.every((row) => Number.isFinite(row[key]))
        ? Math.max(...report.startupTiming.map((row) => row[key]))
        : undefined
    report.restartPluginRequestMs = worst('pluginLoadToFirstRequestMs')
    report.restartPluginIdleMs = worst('pluginLoadToIdleMs')
    report.pauseCallerTraces = entries.filter((e) => e.event === 'request-caller')
    attributePauseRequests(report.pauseRequests ?? [], report.pauseCallerTraces)
    report.maxRendererTaskMs = entries.reduce(
      (maximum, entry) =>
        entry.event === 'long-task' ? Math.max(maximum, entry.durationMs) : maximum,
      0
    )
    report.budgets = budgets(report)
    report.status =
      report.budgets.every((row) => row.status === 'PASS') &&
      !report.failure &&
      !report.cleanupFailure
        ? 'PASS'
        : 'FAIL'
    if (config.baselineReport)
      report.comparison = compareReports(
        JSON.parse(await readFile(config.baselineReport, 'utf8')),
        report
      )
    await writeFile(join(config.output, 'report.json'), JSON.stringify(report, null, 2))
    await writeFile(join(config.output, 'report.md'), markdown(report))
  }
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
  const result = await run(config)
  console.log(result.status === 'PASS' ? 'Scale run PASS' : 'Scale run FAIL; see report.md')
  process.exitCode = result.status === 'PASS' ? 0 : 1
}
