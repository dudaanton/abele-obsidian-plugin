#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdir, copyFile, readdir, unlink, stat } from 'node:fs/promises'
import { resolve, join, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  rendererEntries,
  readEvidenceJson,
  writeEvidenceJson,
  writeEvidenceChunks,
  enableRestartReadEvidence,
} from './evidence.mjs'
import {
  declaredInterruptions,
  reindexEvidence,
  javascriptHashEvidence,
  hashTracepoints,
  hashTracepointBoundary,
  digestCoverage,
  completedBlobShas,
  previouslyHashedShas,
  payloadUploadEvents,
  classifyReindexHashes,
} from './reindex.mjs'
import { openServer, verifyServerLimits, verifyUploadPresence } from './local-server.mjs'
import diagnostics from './diagnostics.cjs'
import {
  noticeSummary,
  profileSummary,
  sampleMemory,
  deadlinePlan,
  tracepointAdjustedTasks,
} from './diagnostics.mjs'
import { appendFile } from 'node:fs/promises'
import {
  fileExpectations,
  oversizedEvidence,
  pauseWriteMetrics,
  restartReadMetrics,
} from './refusals.mjs'
import { AccessClient, V2EngineClient } from '@abele/sync-sdk/core'
import { decodeAccessToken, encodeAccessToken } from '@abele/sync-sdk/protocol'
import { generate, inventory, shapes, planVault } from './generate.mjs'
import { WireProxy } from './proxy.mjs'
import { settleRestartDevices, controlTiming } from './restart.mjs'
import { triggerComparisonAtRestart } from './restart-trigger.mjs'
import { enablePluginWhenReady } from './startup-enable.mjs'
import { validateBuildReceipt } from './build.mjs'
import { applyCombinedChanges } from './combined.mjs'
import { planOfflineChanges, updateExpectedOfflineChanges } from './qualification-offline.mjs'
import { verifyDirectoryChanges } from './directory-oracle.mjs'
import { observeErrorRecovery } from './transient-error.mjs'
import {
  requireTime,
  phaseTimings,
  saveCheckpoint,
  saveFailureCheckpoint,
  activeRequestIds,
  recoveryTimings,
  requireHealthySnapshot,
  uploadRecoveryMetrics,
  fatalDeviceSnapshots,
} from './progress.mjs'
import {
  compareInventory,
  budgets,
  markdownChunks,
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
    const startedAt = Date.now()
    const device = String(this.config.vaults?.indexOf(this.root) ?? -1)
    const slow = setTimeout(() => {
      if (this.config.heapDiagnostics)
        void writeFile(
          join(this.config.output, 'profiles', `control-${device}.json`),
          JSON.stringify({
            id: nonce,
            kind: 'slow-cli',
            startedAt,
            requestedAt: Date.now(),
            device,
          })
        ).catch(() => {})
    }, 3000)
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
    } catch (error) {
      const failure = new Error('Vault CLI unavailable')
      failure.scaleCliFailure = {
        startedAt,
        endedAt: Date.now(),
        device,
        elapsedMs: Date.now() - startedAt,
        code: error.code,
        signal: error.signal,
        killed: error.killed === true,
        stdoutBytes: Buffer.byteLength(error.stdout ?? ''),
        stderrBytes: Buffer.byteLength(error.stderr ?? ''),
      }
      throw failure
    } finally {
      clearTimeout(slow)
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
  async reindex(operation) {
    return this.evaluate(`const fs=require('node:fs');
      const config=JSON.parse(fs.readFileSync(require('node:path').join(app.vault.adapter.getBasePath(),'.scale-observer.json'),'utf8'));
      return require(config.reindexObserver).clickRebuild(app,document,${JSON.stringify(operation)},config.evidence+'.'+config.device+'.reindex.json')`)
  }
  async ready() {
    return wait('plugin startup', () => this.evaluate(`${host}return !!u`).catch(() => false))
  }
  async pluginEnabled(enabled, timeout = this.config.timeoutMs) {
    const id = randomUUID()
    const action = enabled ? 'enable' : 'disable'
    await this
      .evaluate(`const job=window.__scalePluginChange={id:${JSON.stringify(id)},state:'pending',startedAt:Date.now()};
      void Promise.resolve().then(()=>app.plugins.${action}Plugin('abele')).then(
        result=>Object.assign(job,{state:result===false?'failed':'done',endedAt:Date.now()}),
        ()=>Object.assign(job,{state:'failed',endedAt:Date.now()}));
      return {...job}`)
    return wait(
      `plugin ${action}`,
      async () => {
        const job = await this.evaluate(
          `const job=window.__scalePluginChange;return job?.id===${JSON.stringify(id)}?job:null`
        )
        if (job?.state === 'failed') throw new Error(`Plugin ${action} action failed`)
        return job?.state === 'done' ? job : false
      },
      timeout
    )
  }
  async snapshot() {
    return this.evaluate(
      `${host}return !u?null:{visibleStatus:[...(globalThis.document?.querySelectorAll('.abele-sync-status, .abele-sync-window__line, .abele-sync-row__status')??[])].filter(el=>el.getClientRects().length>0).map(el=>({text:el.textContent?.trim()??'',label:el.getAttribute('aria-label')})),job:window.__scaleJob,engines:[...h.live.values()].map(e=>({state:e.engine.status.state,lastSyncAt:e.engine.status.lastSyncAt,lastError:e.engine.status.lastError})),rows:u.rows.value.map(({id,status,paused})=>({id,status,paused})),activity:Object.entries(u.activity.value).map(([id,a])=>({id,classification:a.classification??null,waiting:a.waiting??null,waitingFiles:a.waitingFiles??null,notSynced:a.notSynced??null,error:a.error,failure:a.failure?{code:a.failure.code,reason:a.failure.reason,message:a.failure.message,stage:a.failure.stage,kind:a.failure.kind,substep:a.failure.substep}:undefined,startup:a.startup?.stage,transfer:a.transfer?.stage,completed:a.transfer?.completed,total:a.transfer?.total}))}`
    )
  }
  async inFlight(proxy, label, timeout = this.config.timeoutMs) {
    let nextHealthCheck = 0
    return wait(
      label,
      async () => {
        if (Date.now() >= nextHealthCheck) {
          const snapshot = await this.snapshot()
          try {
            requireHealthySnapshot(snapshot)
          } catch (error) {
            if (this.onObservedError) {
              await this.onObservedError(snapshot, label)
              nextHealthCheck = Date.now() + 2000
              return proxy.active.size > 0
            }
            error.scaleFatalDevice = this.config.vaults?.indexOf(this.root)
            throw error
          }
          nextHealthCheck = Date.now() + 2000
        }
        return proxy.active.size > 0
      },
      timeout
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
      `${host}return Object.entries(u.activity.value).map(([id,a])=>({id,classification:a.classification??null,waiting:a.waiting??null,waitingFiles:a.waitingFiles??null,notSynced:a.notSynced??null,failure:a.failure??null,refused:a.refused??[],events:[...(a.events??[])]}))`
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
        requireHealthySnapshot(state, 'Vault entered an error state')
        if (state?.job === 'failed')
          throw new Error('Sync action failed (private details suppressed)')
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

export async function manifest(token) {
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

export async function setupVault(config, root, device) {
  await mkdir(join(root, '.obsidian/plugins/abele'), { recursive: true })
  for (const name of ['main.js', 'manifest.json', 'styles.css']) {
    const from = join(config.buildDir, name === 'styles.css' ? 'main.css' : name)
    await copyFile(from, join(root, '.obsidian/plugins/abele', name))
  }
  const observer = join(root, '.obsidian/plugins/scale-observer')
  await mkdir(observer, { recursive: true })
  await copyFile(join(here, 'observer.cjs'), join(observer, 'main.js'))
  await copyFile(join(here, 'writes.cjs'), join(observer, 'writes.cjs'))
  await copyFile(join(here, 'reindex.cjs'), join(observer, 'reindex.cjs'))
  await copyFile(join(here, 'diagnostics.cjs'), join(observer, 'diagnostics.cjs'))
  await copyFile(join(here, 'heap.cjs'), join(observer, 'heap.cjs'))
  await copyFile(join(here, 'evidence-writer.cjs'), join(observer, 'evidence-writer.cjs'))
  await copyFile(join(here, 'profile-only.cjs'), join(observer, 'profile-only.cjs'))
  await copyFile(join(here, 'metadata-cache.cjs'), join(observer, 'metadata-cache.cjs'))
  await copyFile(join(here, 'index-wait-capture.cjs'), join(observer, 'index-wait-capture.cjs'))
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
      contentPrefix: config.contentPrefix,
      observeContentReads: false,
      writeObserver: join(observer, 'writes.cjs'),
      reindexObserver: join(observer, 'reindex.cjs'),
      diagnostics: join(observer, 'diagnostics.cjs'),
      profileOnly: join(observer, 'profile-only.cjs'),
      metadataCache: join(observer, 'metadata-cache.cjs'),
      indexWaitCapture: join(observer, 'index-wait-capture.cjs'),
      profileDirectory: join(config.output, 'profiles'),
      continuousCpu: config.continuousCpu === true,
      heapDiagnostics: config.heapDiagnostics === true,
      preciseHashCoverage: config.preciseHashCoverage !== false,
      javascriptHashBoundary: hashTracepointBoundary(
        await readFile(join(config.buildDir, 'main.js'), 'utf8')
      ),
      javascriptHashTracepoints: hashTracepoints(
        await readFile(join(config.buildDir, 'main.js'), 'utf8')
      ),
    })
  )
}

export async function run(config) {
  const plannedDeadline = deadlinePlan(config.workerStartedAt ?? Date.now())
  deadline = config.deadlineAt ?? plannedDeadline.scenarioDeadlineAt
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
    plannedDeadline: { ...plannedDeadline, effectiveScenarioDeadlineAt: deadline },
    ...options,
    declaredInterruptions: declaredInterruptions(
      config.reindex === true || config.shape === 'scale'
    ),
    interruptions: [],
    reindexes: [],
    failures: [],
    phase: 'preflight',
    phases: [{ name: 'preflight', at: Date.now() }],
    restartContentReadRequired: true,
    contentReadObservationWindow: 'synced restart; write and hash observers cover every phase',
    caseRefusals: [],
    primaryActivity: [],
  }
  const phase = (name) => {
    report.phase = name
    report.phases.push({ name, at: Date.now() })
    console.debug('[scale]', name)
    checkpoint(true)
  }
  const rebuilds = []
  const proxies = []
  const tokenFiles = []
  let serverSession
  let memoryTimer
  let memoryPending = Promise.resolve()
  let appProcess
  let issued
  let owner
  let expected = []
  const devices = config.vaults.map((root) => new RealVault(config, root))
  let saving = Promise.resolve()
  let checkpointError = false
  const checkpoint = (boundary = false) => {
    const snapshot = structuredClone(report)
    const wire = structuredClone(proxies.map((p) => ({ events: p.events })))
    const at = Date.now()
    saving = saving
      .then(() => saveCheckpoint(config.output, snapshot, wire, at, boundary))
      .catch(() => {
        checkpointError = true
      })
  }
  let checkpointTimer
  const loadEvidence = async (path) => {
    try {
      return await readEvidenceJson(path)
    } catch (error) {
      report.failure ??= 'Harness evidence JSON could not be read'
      report.evidenceReadFailures = (report.evidenceReadFailures ?? 0) + 1
      throw error
    }
  }
  const captureSettledHeap = async (device, step) => {
    if (config.heapDiagnostics && !device.heapCaptured) {
      const id = randomUUID(),
        file = join(config.output, 'profiles', `control-${devices.indexOf(device)}.json`)
      await writeFile(file, JSON.stringify({ id, kind: 'snapshot', step, startedAt: Date.now() }))
      await wait(
        'settled heap snapshot',
        async () => {
          const receipt = await readFile(`${file}.done`, 'utf8')
            .then(JSON.parse)
            .catch(() => null)
          if (receipt?.id !== id) return false
          if (!receipt.complete) throw new Error('Settled heap snapshot failed')
          return true
        },
        180000
      )
      device.heapCaptured = true
    }
  }
  const fatalCapture = async (device, label) => {
    const output = join(config.output, 'state', label)
    await device.evaluate(`window.__scaleFatalCapture={done:false};void require(${JSON.stringify(join(here,'diag-capture.cjs'))}).capture(app,${JSON.stringify(output)},indexedDB).then(result=>{window.__scaleFatalCapture={done:true,result}},error=>{window.__scaleFatalCapture={done:true,error:{message:error.message,stack:error.stack}}});return true`)
    const value=await wait('fatal state export',async()=>{const state=await device.evaluate('return window.__scaleFatalCapture');return state?.done?state:false},60000)
    ;(report.diagnosticCaptures??=[]).push({label,...value});checkpoint(true)
  }
  let lastHealthCheck=0
  const recoverObservedError = async (device, step, first) => {
    const entry = {step, device:String(devices.indexOf(device)),
      reason:'Vault entered an error state', snapshot:first, strictFail:true}
    report.failures.push(entry)
    const observations = report.errorObservations ??= []
    const result = await observeErrorRecovery({
      first,
      snapshot: () => device.snapshot(),
      record: event => { observations.push({step,device:entry.device,...event}); checkpoint(true) },
      sleep,
      now:Date.now,
      timeoutMs:120000,
    })
    entry.recovered=result.recovered
    entry.recoveryMs=result.recoveryMs
    checkpoint(true)
    if (!result.recovered) {
      const error=new Error('Vault error did not recover within 120 seconds')
      error.scaleFatalSnapshot=first
      throw error
    }
    return result
  }
  for (const device of devices)
    device.onObservedError = (snapshot, step) => recoverObservedError(device, step, snapshot)
  const primaryHealthy = async () => {
    if(Date.now()-lastHealthCheck<2000)return
    lastHealthCheck=Date.now()
    const snapshot=await devices[0].snapshot()
    if(snapshot?.rows?.some(row=>row.status==='error'))
      await recoverObservedError(devices[0], 'primary health', snapshot)
  }
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
      const first = error.scaleFatalSnapshot ?? (await device.snapshot().catch(() => null))
      if (first?.rows?.some(row=>row.status==='error')) {
        await recoverObservedError(device, step, first)
        idle = true
        return true
      }
      report.failures.push({
        step,
        reason,
        device: String(devices.indexOf(device)),
        snapshot: first,
      })
      requireHealthySnapshot(report.failures.at(-1).snapshot)
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
      checkpoint(true)
    }
  }
  const stop = async (hard, { minimal = false } = {}) => {
    clearInterval(memoryTimer)
    await memoryPending
    if (!appProcess) return
    for (const device of minimal ? [] : devices) {
      const at = Date.now()
      const flushed = await device
        .evaluate(
          'if(globalThis.__scaleStopProfiles)await globalThis.__scaleStopProfiles();return globalThis.__scaleFlushEvidence ? await globalThis.__scaleFlushEvidence() : false'
        )
        .catch(() => false)
      ;(report.observerFlushes ??= []).push({
        device: String(devices.indexOf(device)),
        at,
        flushed,
      })
      if (!flushed) report.failure ??= 'Observer evidence flush failed'
    }
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
  const start = async ({ passive = false } = {}) => {
    const at = Date.now()
    appProcess = spawn(config.app, config.appArgs ?? [], { stdio: 'ignore' })
    appProcess.on('error', () => {})
    const rootPid = appProcess.pid
    let sampling = false
    const sample = () => {
      if (sampling) return
      sampling = true
      memoryPending = sampleMemory(rootPid)
        .then(async (value) => {
          if (!value) {
            report.memoryUnavailable = true
            return
          }
          const row = { at: Date.now(), phase: report.phase, rootPid, ...value }
          report.peakAppRssBytes = Math.max(report.peakAppRssBytes ?? 0, value.rssBytes)
          report.memorySamples = (report.memorySamples ?? 0) + 1
          await appendFile(join(config.output, 'memory.jsonl'), JSON.stringify(row) + '\n')
        })
        .catch(() => {
          report.memoryUnavailable = true
        })
        .finally(() => {
          sampling = false
        })
    }
    if (!passive) {
      sample()
      memoryTimer = setInterval(sample, 1000)
      for (const device of devices) {
        await wait('disposable vault window', () =>
          device.evaluate('return true').catch(() => false)
        )
        await enablePluginWhenReady(device, wait)
      }
      await devices[0].ready()
    }
    return at
  }
  await mkdir(config.output, { recursive: true })
  checkpoint(true)
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
    if (config.serverCommit && !report.buildReceipt?.sdk?.version)
      throw new Error('Selected build SDK provenance required for matching server')
    serverSession = await openServer({
      ...config,
      serverEvidenceDirectory: join(config.output, 'state/server-final'),
      ...(config.serverCommit ? { serverSdkVersion: report.buildReceipt.sdk.version } : {}),
    })
    config = { ...config, server: serverSession.address }
    report.serverReceipt = serverSession.receipt
    const encoded = serverSession.token
    owner = AccessClient.fromToken(encoded, { fetch: globalThis.fetch })
    if (new URL(owner.token.address).origin !== new URL(config.server).origin)
      throw new Error('Token endpoint does not match configured server')
    report.serverLimits = (await owner.connection()).limits
    if (config.serverMode === 'local' && config.serverCommit)
      report.serverReceipt.uploadHead = await verifyUploadPresence(config.server, owner.token.key)
    report.serverReceipt.advertisedLimits = report.serverLimits
    await writeFile(
      join(config.output, 'server-receipt.json'),
      JSON.stringify(report.serverReceipt, null, 2)
    )
    if (config.serverMode === 'local' || config.expectedServerLimits)
      verifyServerLimits(report.serverLimits, config.expectedServerLimits)
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
      await setupVault({ ...config, contentPrefix: prefix }, device.root, String(i))
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
          server: report.serverReceipt,
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
    const mark = (kind) => {
      report.interruptions.push({ kind, triggered: true, at: Date.now() })
      checkpoint(true)
    }
    const reindex = async (id, device, proxy, nextBreakpoint = null) => {
      const declared = report.declaredInterruptions.find((one) => one.id === id)
      if (!declared) return
      if (id === 'reindex-primary-upload') await triggered(proxy, 'reindex-upload', async () => {})
      else await wait('reindex active sync request', () => proxy.active.size > 0, config.timeoutMs)
      const allowed = new Set(expected.map((file) => file.path))
      for (const file of expected) {
        const parts = file.path.split('/')
        while (parts.length > 1) {
          parts.pop()
          allowed.add(parts.join('/'))
        }
      }
      const snapshotExcluded = (path) => !allowed.has(path)
      const before = await inventory(device.root, snapshotExcluded)
      const serverBefore = await manifest(token)
      await wait('reindex active sync at click', () => proxy.active.size > 0, config.timeoutMs)
      await device.reindex(declared)
      const readEntries = () =>
        rendererEntries(createReadStream(join(config.output, 'renderer.jsonl')), undefined, true)
      const pendingFile =
        join(config.output, 'renderer.jsonl') + '.' + declared.device + '.reindex.json'
      const receipt = async (file) => {
        try {
          const row = await readEvidenceJson(file)
          return row.id === id ? row : null
        } catch (error) {
          if (error.code === 'ENOENT') return null
          throw error
        }
      }
      const clicked = await wait(
        'reindex user button click',
        async () => (await receipt(pendingFile)) ?? (await receipt(pendingFile + '.complete.json')),
        config.timeoutMs
      )
      const operation = {
        ...declared,
        at: clicked.at,
        triggered: activeRequestIds(proxy.events, clicked.at - 1).size > 0,
        activeClockResolutionMs: 1,
      }
      proxy.release(nextBreakpoint)
      report.interruptions.push(operation)
      const saved = { operation, before, serverBefore }
      rebuilds.push(saved)
      report.reindexes.push(
        reindexEvidence(operation, await readEntries(), proxy.events, { before })
      )
      checkpoint(true)
      await wait(
        'reindex host cache completion',
        () => receipt(pendingFile + '.complete.json'),
        config.timeoutMs
      )
      await device.ready()
      const after = await inventory(device.root, snapshotExcluded)
      saved.after = after
      // Checkpoint raw evidence immediately; final settle and transfer attribution follow.
      report.reindexes[report.reindexes.findIndex((row) => row.id === id)] = reindexEvidence(
        operation,
        await readEntries(),
        proxy.events,
        { before, after }
      )
      checkpoint(true)
    }
    const endReindex = async (id, device) => {
      const saved = rebuilds.find((one) => one.operation.id === id)
      if (!saved) return
      await device.evaluate('await globalThis.__scaleReindexCoverage?.end?.();return true')
      saved.settledAt = Date.now()
      checkpoint(true)
    }
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
      async () => {
        await primaryHealthy()
        return p.events.find(
          (e) =>
            e.at >= resumedAt &&
            e.event === 'start' &&
            ['PUT', 'POST'].includes(e.method) &&
            (/^\/v2\/uploads\//.test(e.route) || (e.route === '/v2/commit' && e.contentCommit))
        )
      },
      config.timeoutMs
    )
    report.resumeUploadMs = upload.at - resumedAt
    // Hold genuine resumed payload before all blobs have reached the server.
    await reindex('reindex-primary-upload', a, p, 'batch')
    await wait(
      'commit acknowledgement interruption',
      async () => {await primaryHealthy();return p.events.find((e) => e.event === 'trigger' && e.kind === 'batch')},
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
    await a.inFlight(p, 'network interruption in flight')
    p.drop()
    mark('network drop')
    await sleep(2000)
    p.offline = false
    await a.sync()
    await a.inFlight(p, 'plugin interruption in flight')
    await a.invalidateJob()
    report.pluginDisable = await a.pluginEnabled(false)
    report.pluginEnable = await a.pluginEnabled(true)
    mark('plugin disable-enable')
    await a.ready()
    report.firstUploadSettled = await settle(a, 'first upload')
    await endReindex('reindex-primary-upload', a)
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
    if (config.reindex === true || config.shape === 'scale') {
      await triggered(q, 'pull', async () => {
        await b.paused(false)
        await b.sync()
      })
    } else {
      await b.paused(false)
      await b.sync()
    }
    await reindex('reindex-peer-download', b, q)
    report.peerPullSettled = await settle(b, 'second device pull')
    await endReindex('reindex-peer-download', b)
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
    await enableRestartReadEvidence(devices.map((device) => device.root))
    phase('synced restart')
    const restartAt = Date.now()
    report.restartAt = restartAt
    if (config.reindex === true || config.shape === 'scale')
      await triggerComparisonAtRestart(p, start, triggered)
    else await start()
    report.deviceRestartIdleAt = await settleRestartDevices(
      devices,
      settle,
      report.settleTimings ?? [],
      async () => {
        await reindex('reindex-restart-comparison', a, p)
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
      }
    )
    await endReindex('reindex-restart-comparison', a)
    report.restartIdleMs = report.deviceRestartIdleAt.every(Number.isFinite)
      ? Math.max(...report.deviceRestartIdleAt) - restartAt
      : undefined
    report.restartObservedMs = Date.now() - restartAt
    report.restartClassification = await Promise.all(
      devices.map(async (device, index) => {
        const snapshot = await device.snapshot()
        return {
          device: String(index),
          at: Date.now(),
          connections: snapshot?.activity
            ? diagnostics.classificationSnapshot(
                Object.fromEntries(snapshot.activity.map((row) => [row.id, row]))
              )
            : null,
        }
      })
    )
    report.strictRestartActivity = await Promise.all(devices.map((device) => device.activityEvidence()))
    phase('post-run heap diagnostics')
    for (const device of devices) await captureSettledHeap(device, 'post-run')
    await stop(false)
    if (config.shape === 'scale') {
      phase('stopped-app changes')
      const plan = planOfflineChanges(prefix, expected)
      const beforeRows = new Map((await manifest(token)).filter(file => file.kind !== 'directory').map(file => [file.path, file]))
      for (const path of [plan.sized, plan.sameSize, plan.deleted, ...plan.moves.map(move => move.from)])
        if (!beforeRows.has(path)) throw new Error('Offline source was not uploaded: '+path)
      for (const path of [plan.added, plan.folderFile, ...plan.moves.map(move => move.to)])
        if (beforeRows.has(path)) throw new Error('Offline target already exists on server: '+path)
      const sameSizeBefore = await stat(join(a.root, plan.sameSize))
      const changed = await applyCombinedChanges(a.root, plan)
      const sameSizeAfter = await stat(join(a.root, plan.sameSize))
      if (sameSizeAfter.size !== sameSizeBefore.size || sameSizeAfter.mtimeMs <= sameSizeBefore.mtimeMs)
        throw new Error('Offline same-size mtime edit precondition failed')
      expected = updateExpectedOfflineChanges(expected, plan, changed)
      await writeFile(join(config.output, 'expected-inventory.json'), JSON.stringify(expected))
      report.offlineCheck = {
        plan, changed, sameSizeMtimeBefore: sameSizeBefore.mtimeMs,
        sameSizeMtimeAfter: sameSizeAfter.mtimeMs, phaseSamples: [],
      }
      checkpoint(true)
      let polling = false
      let lastPoll = Promise.resolve()
      const poll = () => {
        if (polling) return
        polling = true
        lastPoll = a.evaluate(`${host}if(!u)return null;const s=[...h.live.values()][0]?.engine.status;
          const activity=Object.values(u.activity.value)[0];const row=u.rows.value[0];
          return {engineState:s?.state??null,reconciliationPhase:activity?.reconciliation?.phase??null,
          reconciliationReason:activity?.reconciliation?.reason??null,
          heldDeletes:s?.heldDeletes??activity?.heldDeletes??null,pending:activity?.pending??null,
          uiStatus:row?.status??null}`)
          .then(value => { if (value) report.offlineCheck.phaseSamples.push({ at: Date.now(), ...value }) })
          .catch(() => {})
          .finally(() => { polling = false })
      }
      const timer = setInterval(poll, 1000)
      poll()
      try {
        const restartedAt = Date.now()
        report.offlineCheck.restartedAt = restartedAt
        await start()
        await b.ready()
        for (let cycle = 0; cycle < 3; cycle++) {
          await a.sync()
          if (!await settle(a, `offline cycle ${cycle} primary`))
            throw new Error('Offline primary did not settle')
          await b.sync()
          if (!await settle(b, `offline cycle ${cycle} peer`))
            throw new Error('Offline peer did not settle')
        }
        await lastPoll
        poll()
        await lastPoll
        report.offlineCheck.bothIdleMs = Date.now() - restartedAt
      } finally {
        clearInterval(timer)
        await lastPoll
      }
      const latest = report.offlineCheck.phaseSamples.at(-1)
      report.offlineCheck.heldDeletesAtIdle = latest?.heldDeletes ?? null
      if (latest?.engineState !== 'idle' || latest?.heldDeletes !== 0 || latest?.reconciliationPhase === 'review')
        throw new Error('Offline deletion held for review')
      const afterRows = new Map((await manifest(token)).filter(file => file.kind !== 'directory').map(file => [file.path, file]))
      const notFound = async (root, path) => stat(join(root, path)).then(() => false, error => {
        if (error.code === 'ENOENT') return true
        throw error
      })
      report.offlineCheck.deletedAbsent = {
        server: !afterRows.has(plan.deleted),
        primary: await notFound(a.root, plan.deleted),
        peer: await notFound(b.root, plan.deleted),
      }
      if (!Object.values(report.offlineCheck.deletedAbsent).every(Boolean))
        throw new Error('Offline deletion missing or resurrected')
      for (const file of changed) {
        const row = afterRows.get(file.path)
        if (!row) throw new Error('Offline file missing on server: '+file.path)
        const response = await raw(token, `files/${encodeURIComponent(row.file_id)}/content?${new URLSearchParams({ version_id: row.version_id })}`)
        const serverBytes = Buffer.from(await response.arrayBuffer())
        const peerBytes = await readFile(join(b.root,file.path))
        if (serverBytes.length !== file.size || sha(serverBytes) !== file.sha ||
            peerBytes.length !== file.size || sha(peerBytes) !== file.sha)
          throw new Error('Offline changed bytes differ across server and peer: '+file.path)
      }
      const oldFilesAbsent = await Promise.all(plan.moves.map(async move =>
        !afterRows.has(move.from) && await notFound(b.root, move.from)))
      if (!oldFilesAbsent.every(Boolean)) throw new Error('Offline old moved path remains')
      const allowedChanges = new Set([plan.sized, plan.sameSize, plan.added, plan.deleted,
        plan.folderFile, ...plan.moves.flatMap(move => [move.from,move.to])])
      const unexpected = [...afterRows].filter(([path,row]) =>
        !allowedChanges.has(path) && beforeRows.get(path)?.version_id !== row.version_id)
      if (unexpected.length) throw new Error('Unrelated server file version changed after offline edit')
      report.offlineCheck.directoryState = verifyDirectoryChanges(
        join(config.localServerDirectory, 'abele.db'), {
          addedFolder: plan.addedFolder, renamedFolderFrom: plan.renameFrom,
          renamedFolderTo: plan.renameTo,
        })
      report.offlineCheck.changedBytesVerified = changed.length
      report.offlineCheck.unexpectedFileVersions = unexpected.length
      report.offlineCheck.peerContentRequests = q.events.filter(e =>
        e.at >= report.offlineCheck.restartedAt && e.event === 'start' &&
        /^\/v2\/files\//.test(e.route ?? '') && /\/content/.test(e.route ?? '')).length
      phase('stopped-app changes verified')
      await stop(false)
    }
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
    phase('control restart')
    for (const [index, device] of devices.entries()) {
      const file = join(device.root, '.scale-observer.json')
      const observerConfig = await loadEvidence(file)
      await writeEvidenceJson(file, {
        ...observerConfig,
        mode: 'control',
        controlReceipt: join(config.output, `control-restart-${index}.json`),
      })
    }
    const controlAt = await start({ passive: true })
    const controlRows = await Promise.all(
      devices.map(async (_, index) => {
        const receiptFile = join(config.output, `control-restart-${index}.json`)
        return wait(
          `control restart device ${index} idle`,
          async () => {
            const receipt = await readFile(receiptFile, 'utf8')
              .then(JSON.parse)
              .catch(() => null)
            if (receipt?.fatal) throw new Error('Fatal sync state in control restart')
            const timing = controlTiming(controlAt, proxies[index].events, receipt)
            return Number.isFinite(timing.pluginLoadToFirstRequestMs) &&
              timing.firstIdleAt >= timing.firstRequestAt
              ? { device: String(index), ...timing }
              : false
          },
          120000
        )
      })
    )
    const controlActivity = await Promise.all(devices.map((device) => device.activityEvidence()))
    report.controlRestart = {
      mode: 'observer load/idle marks and proxy requests only',
      forcedReindex: false,
      devices: controlRows,
      activity: controlActivity,
    }
    await stop(false, { minimal: true })
    phase('complete')
  } catch (error) {
    if (error.scaleFatalSnapshot && Number.isInteger(error.scaleFatalDevice))
      report.failures.push({
        device: String(error.scaleFatalDevice),
        step: report.phase,
        snapshot: error.scaleFatalSnapshot,
      })
    const fatalSnapshots=fatalDeviceSnapshots(await Promise.all(devices.map(device=>device.snapshot().catch(()=>null))),report.failures)
    for(const {device:index,snapshot} of fatalSnapshots) {
      ;(report.diagnosticFatals??=[]).push({at:Date.now(),device:index,state:snapshot})
      await fatalCapture(devices[index],'fatal-device-'+index).catch(captureError=>{report.diagnosticCaptureError={device:index,message:captureError.message}})
    }
    // Errors from SDK/CLI can include credentials; expose only our controlled diagnostics.
    report.cliFailure = error.scaleCliFailure
    report.failure =
      /^(Fatal sync state|Advertised server limit|Expected server limits|Local fixture|Unknown server mode|Server file limit|Run deadline reached|Timed out:|Disposable |Two separate|Isolated |Token endpoint|Case-sensitive|Selected build)/.test(
        error.message
      )
        ? error.message
        : 'Harness operation failed; private details suppressed'
    report.harnessFailureFrames = String(error.stack ?? '')
      .split('\n')
      .slice(1, 6)
    await saving
    await saveFailureCheckpoint(
      config.output,
      report,
      proxies.map((p) => ({ events: p.events })),
      'scenario'
    )
    report.lastSnapshots = await Promise.all(
      devices.map((device) => device.snapshot().catch(() => null))
    )
    report.fatalSnapshots = fatalDeviceSnapshots(report.lastSnapshots, report.failures)
  } finally {
    try {
      clearInterval(checkpointTimer)
      await saving
      report.checkpointFailure = checkpointError
      // Cleanup waits must remain available after the scenario deadline.
      deadline = Infinity
      await stop(true)
      report.ownDownloads = proxies.reduce((sum, proxy) => sum + proxy.ownDownloads(), 0)
      report.unresolvedDownloads = proxies.reduce(
        (sum, proxy) => sum + proxy.unresolvedDownloads(),
        0
      )
      report.wire = proxies.flatMap((proxy) => proxy.events)
      const resumeIndex = report.phases.findIndex((phase) => phase.name === 'resume upload')
      report.uploadRecovery = uploadRecoveryMetrics(report.wire, report.phases[resumeIndex]?.at, {
        untilAt: report.phases[resumeIndex + 1]?.at ?? Infinity,
      })
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
      const entries = await rendererEntries(
        createReadStream(join(config.output, 'renderer.jsonl')),
        report.restartAt
      ).catch(() => {
        report.failure ??= 'Renderer evidence could not be read'
        report.evidenceReadFailures = (report.evidenceReadFailures ?? 0) + 1
        return []
      })
      for (const saved of rebuilds) {
        const proxy = proxies[Number(saved.operation.device)]
        const end = entries.find(
          (row) => row.event === 'reindex-complete' && row.id === saved.operation.id
        )
        const during = proxy.events.filter(
          (row) =>
            row.at >= saved.operation.at && row.at <= (saved.settledAt ?? end?.at ?? Infinity)
        )
        const knownLocal = new Set(saved.before.map((file) => file.sha))
        const knownServer = new Set([
          ...saved.serverBefore.map((file) => file.sha),
          ...completedBlobShas(report.wire, saved.operation.at),
        ])
        const reads = during.filter(
          (row) => row.event === 'start' && /\/content$/.test(row.route ?? '')
        )
        const uploads = payloadUploadEvents(during)
        const unknown = reads.some((row) => !proxy.versions.has(row.version))
        const hashes = entries.filter(
          (row) =>
            row.device === saved.operation.device &&
            row.at >= saved.operation.at &&
            row.at <= (end?.at ?? Infinity) &&
            row.event === 'renderer-hash'
        )
        const coverage = entries.some(
          (row) =>
            row.device === saved.operation.device &&
            row.at >= saved.operation.at &&
            row.at <= (end?.at ?? Infinity) &&
            row.event === 'hash-observer-ready'
        )
        const previouslyHashed = previouslyHashedShas(
          entries,
          saved.operation.device,
          saved.operation.at
        )
        const fileHashes = new Set(
          [...expected, ...saved.before, ...saved.serverBefore].map((file) => file.sha)
        )
        const knownShas = new Set(
          [...fileHashes].filter(
            (sha) =>
              previouslyHashed.has(sha) ||
              knownServer.has(sha) ||
              (saved.operation.device === '1' && knownLocal.has(sha))
          )
        )
        const classifiedHashes = classifyReindexHashes(
          saved.operation,
          entries,
          saved.settledAt ?? end?.at ?? Infinity,
          knownShas
        )
        const hashUnknown = hashes.some(
          (row) => row.source === 'unknown' && fileHashes.has(row.sha)
        )
        const jsHashes = await javascriptHashEvidence(saved.operation, entries, loadEvidence)
        const digestProof = digestCoverage(
          saved.operation,
          entries,
          saved.settledAt ?? end?.at ?? Infinity
        )
        const redundantUploads = uploads.filter((row) => knownServer.has(row.route.split('/')[3]))
        const result = reindexEvidence(saved.operation, entries, proxy.events, {
          before: saved.before,
          after: saved.after,
          settled: report.verificationComplete === true,
          extraDeletes:
            during
              .flatMap((row) => row.operations ?? [])
              .filter((op) => /delete|remove|unlink|tombstone/.test(op.op)).length +
            entries.filter(
              (row) =>
                row.device === saved.operation.device &&
                row.at >= saved.operation.at &&
                row.at <= (saved.settledAt ?? end?.at ?? Infinity) &&
                row.event === 'vault-delete'
            ).length,
          extraUploads: new Set(redundantUploads.map((row) => row.route.split('/')[3])).size,
          extraDownloads: unknown
            ? undefined
            : reads.filter((row) => knownLocal.has(proxy.versions.get(row.version))).length,
          extraRendererHashes:
            coverage && !hashUnknown && digestProof.complete
              ? classifiedHashes.reindexHashes.length
              : undefined,
        })
        result.postReindexPayloadDigests = classifiedHashes.payloadDigests.length
        result.inReindexPayloadDigests = classifiedHashes.inReindexPayloadDigests.length
        result.otherPostReindexHashes = classifiedHashes.otherPostReindexHashes.length
        result.settledAt = saved.settledAt ?? null
        result.afterIndexUntilSettle = {
          requests: proxy.events.filter(
            (row) => row.at > (end?.at ?? Infinity) && row.at <= (saved.settledAt ?? Infinity)
          ),
          renderer: entries.filter(
            (row) =>
              row.device === saved.operation.device &&
              row.at > (end?.at ?? Infinity) &&
              row.at <= (saved.settledAt ?? Infinity) &&
              [
                'vault-delete',
                'renderer-hash',
                'write-start',
                'write-finish',
                'notice',
                'long-task',
              ].includes(row.event)
          ),
        }
        result.javascriptHashCoverage = jsHashes
        result.javascriptDigestCoverage = digestProof
        result.extraUploadRequests = redundantUploads
        result.extraUploadBytes = redundantUploads.reduce((sum, row) => sum + row.sent, 0)
        result.extraRendererHashEvidence = classifiedHashes.reindexHashes.map((row) => ({
          ...row,
          paths: [...expected, ...saved.before]
            .filter((file) => file.sha === row.sha)
            .map((file) => file.path),
        }))
        report.reindexes[report.reindexes.findIndex((row) => row.id === result.id)] = result
      }
      report.noticeCounts = noticeSummary(entries)
      report.notices = entries.length ? report.noticeCounts.abele : undefined
      report.hashTracepointSetup = entries.filter(
        (row) => row.event === 'javascript-hash-tracepoint-setup'
      )
      report.longTaskAttribution = await profileSummary(entries, entries, loadEvidence)
      report.tracepointAdjustedLongTasks = tracepointAdjustedTasks(
        report.longTaskAttribution,
        report.hashTracepointSetup
      )
      for (const rebuild of report.reindexes) {
        rebuild.longTasks = report.longTaskAttribution.filter(
          (row) =>
            row.device === rebuild.device &&
            (row.startedAt ?? row.at) >= rebuild.at &&
            (row.startedAt ?? row.at) <= (rebuild.completedAt ?? Infinity)
        )
      }
      report.memorySampling =
        'Maximum observed sum of owned app-tree RSS, sampled externally every second; not an instantaneous peak.'
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
        report.wire,
        report.interruptions,
        report.restartAt,
        report.controlRestart?.devices?.[0]?.launchAt,
        report.offlineCheck?.restartedAt
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
      report.restartReadEvidence = devices.map((_, i) =>
        restartReadMetrics(entries, String(i), report.restartAt, report.deviceRestartIdleAt?.[i])
      )
      report.restartContentReadBytes = report.restartReadEvidence.every((e) => e.complete)
        ? report.restartReadEvidence.reduce((n, e) => n + e.syncBytes, 0)
        : undefined
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
      if (serverSession)
        await serverSession.close().catch(() => {
          report.cleanupFailure = true
        })
      report.budgets = budgets(report)
      if (report.evidenceReadFailures)
        await saveFailureCheckpoint(
          config.output,
          report,
          proxies.map((p) => ({ events: p.events })),
          'analysis'
        )
      report.status =
        report.budgets.every((row) => row.status === 'PASS') &&
        !report.failure &&
        !report.cleanupFailure
          ? 'PASS'
          : 'FAIL'
      if (config.baselineReport)
        report.comparison = compareReports(await loadEvidence(config.baselineReport), report)
      await writeEvidenceJson(join(config.output, 'report.json'), report)
      await writeEvidenceChunks(join(config.output, 'report.md'), markdownChunks(report))
    } catch (error) {
      console.error('[scale] final analysis error', error?.stack ?? error)
      report.failure ??= 'Harness final evidence analysis failed; checkpoint retained'
      report.status = 'FAIL'
      await saveFailureCheckpoint(
        config.output,
        report,
        proxies.map((p) => ({ events: p.events })),
        'analysis'
      ).catch(() => {
        report.checkpointFailure = true
      })
      const failureSummary = {
        status: report.status,
        failure: report.failure,
        phase: report.phase,
        harnessFailures: report.harnessFailures,
        remainingPhaseEvidence: report.remainingPhaseEvidence,
        checkpointFailure: report.checkpointFailure,
      }
      await writeEvidenceJson(join(config.output, 'failure-report.json'), failureSummary)
      // Never leave a previously written PASS JSON beside a failed Markdown/analyzer exit.
      await writeEvidenceJson(join(config.output, 'report.json'), failureSummary)
    } finally {
      if (serverSession) await serverSession.close()
    }
  }
  return report
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'))
  const result = await run(config)
  console.log(result.status === 'PASS' ? 'Scale run PASS' : 'Scale run FAIL; see report.md')
  process.exitCode = result.status === 'PASS' ? 0 : 1
}
