/* eslint-disable @typescript-eslint/no-require-imports -- Loaded directly by the desktop host as a CommonJS plugin. */
const { Plugin, Notice } = require('obsidian')
const fs = require('fs')
const path = require('path')
/* eslint-enable @typescript-eslint/no-require-imports -- The host-only CommonJS imports end here. */

// Installed first in a disposable vault. Evidence survives renderer/process termination.
module.exports = class extends Plugin {
  async onload() {
    const config = JSON.parse(
      fs.readFileSync(
        path.join(this.app.vault.adapter.getBasePath(), '.scale-observer.json'),
        'utf8'
      )
    )
    let entryLedger, profilerAcknowledgedAt
    if (config.entryLedger && config.continuousCpu && config.entryLedgerEnabled !== false) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Qualification-only entry hooks.
      const { createEntryLedger, installEntryLedger, wrapProductExport } = require(config.entryLedger)
      /* eslint-disable @typescript-eslint/no-require-imports -- Host callback registration prototypes and shared editor APIs. */
      const { Events, Component, Workspace, Plugin: ProductPlugin, ItemView, FileView, View, MarkdownRenderChild,
        EditorSuggest, PluginSettingTab } = require('obsidian')
      const codeMirror = { ...require('@codemirror/state'), ...require('@codemirror/view') }
      /* eslint-enable @typescript-eslint/no-require-imports -- Host imports end here. */
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Native watcher/event completion callbacks.
      const { EventEmitter } = require('node:events')
      fs.mkdirSync(config.profileDirectory, { recursive: true })
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Host owns asynchronous ledger persistence.
      const ledgerRemote = require('@electron/remote')
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Batched evidence leaves the renderer through IPC.
      const ledgerIpc = require('electron').ipcRenderer
      const ledgerFile = path.join(config.profileDirectory, `entry-${config.device}-${Date.now()}.jsonl`)
      const ledgerChannel = ledgerRemote.require(config.diagnostics).openEvidencePort(
        ledgerRemote.getCurrentWebContents().id, JSON.stringify({ evidence: ledgerFile }))
      entryLedger = createEntryLedger({
        write: text => ledgerIpc.send(ledgerChannel, text),
        device: config.device, pluginAbsent: !this.app.plugins?.plugins?.abele,
        requireProductBridge: true,
      })
      // Native async hooks can abort the renderer when inspector breakpoints
      // run during host index startup. CPU profiles cover these continuations;
      // the remaining callback ledger must not claim complete coverage.
      entryLedger.markPartial('Native async callbacks require CPU attribution')
      const restore = installEntryLedger({ ledger: entryLedger, target: globalThis, Events,
        Component, Workspace, Plugin: ProductPlugin, ItemView, FileView, View, MarkdownRenderChild,
        EditorSuggest, PluginSettingTab, codeMirror, EventEmitter })
      globalThis.__scaleWrapProductExport = value => wrapProductExport(value, entryLedger)
      globalThis.__scaleEntryLedgerRequired = true
      const mark = performance.mark.bind(performance)
      let evaluation
      Object.defineProperty(performance, 'mark', { configurable: true, value(name) {
        if (name === 'abele:eval-start') evaluation = entryLedger.begin('plugin evaluation')
        try { return mark.apply(null, arguments) } finally {
          if (name === 'abele:eval-end' && evaluation !== undefined) {
            entryLedger.end(evaluation); evaluation = undefined
          }
        }
      } })
      globalThis.__scaleFlushEntryLedger = async () => {
        await entryLedger.flush()
        await ledgerIpc.invoke(ledgerChannel)
      }
      globalThis.__scalePrepareTeardown = () => entryLedger.teardown()
      // Keep the ledger through the observer's own unload: the product may be
      // unloaded later in the host's component order.
      window.addEventListener('unload', () => {
        entryLedger.teardown()
        // Navigation also emits unload. The host watch owns profiling until
        // webContents destruction, and must cover the next renderer generation.
        restore()
      }, { once: true })
      this.register(() => entryLedger.flush())
    }
    if (config.failureDiagnostic) {
      Error.stackTraceLimit = 100
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Disposable diagnostic helper.
      const diagnostic = require(config.failureDiagnostic)
      const emit = value => fs.appendFileSync(config.failureEvents,
        JSON.stringify({ at: Date.now(), device: config.device, ...value }) + '\n')
      if (diagnostic.shouldWrapFingerprints(config))
        globalThis.__scaleWrapFingerprints = Class => diagnostic.wrapFingerprints(Class, emit)
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Host profile location is evidence only.
      const remote = require('@electron/remote')
      const location = {
        userData: remote.app.getPath('userData'),
        storagePath: remote.getCurrentWebContents().session.getStoragePath?.(),
        root: this.app.vault.adapter.getBasePath(), pid: process.pid,
      }
      emit({ event: 'failure-capture-ready', ...location })
      const capture = diagnostic.captureFailures({ target: window, console, emit,
        armed: () => fs.existsSync(config.failureArmed),
        getState: () => {
          const host = this.app.plugins?.plugins?.abele?.tokenEngines
          return { rows: host?.ui?.rows.value, activity: host?.ui?.activity.value,
            engines: [...(host?.live.values() ?? [])].map(value => ({ status: value.engine.status,
              fatal: value.fatalFailure })) }
        },
        writeFatal: value => fs.writeFileSync(config.failureMarker, JSON.stringify({ device: config.device, ...location, ...value })),
        freeze: () => process.kill(process.pid, 'SIGSTOP'),
      })
      const timer = setInterval(() => capture.poll(), 25)
      globalThis.__scalePollFailureCapture = () => capture.poll()
      this.register(() => { clearInterval(timer); capture.close(); delete globalThis.__scaleWrapFingerprints; delete globalThis.__scalePollFailureCapture })
    }
    if (config.mode === 'control' || config.mode === 'profile-only' || config.mode === 'diagnostic') {
      const receipt = { observerStartedAt: Date.now() }
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Control errors retain startup diagnostics only.
      const { captureControlError } = config.controlError ? require(config.controlError) : {
        captureControlError: (_receipt, state) => {
          if (state.rows.some(row => row.status === 'error'))
            throw new Error('Control error diagnostic unavailable')
          return false
        },
      }
      const save = () => fs.writeFileSync(config.controlReceipt, JSON.stringify(receipt))
      save()
      const diagnostic = config.mode === 'diagnostic'
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- The host loads diagnostic CommonJS modules.
        ? require(config.diagnosticModule).startDiagnostic({
            output: config.diagnosticReceipt,
            root: this.app.vault.adapter.getBasePath(),
            contentPrefix: config.contentPrefix,
            adapter: this.app.vault.adapter,
            vault: this.app.vault,
            getActivity: () => Object.values(
              this.app.plugins?.plugins?.abele?.tokenEngines?.ui?.activity?.value ?? {}
            ),
          })
        : null
      const metadataCache = config.metadataCache
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Disposable observer helper.
        ? require(config.metadataCache).createMetadataCacheCapture(this.app, receipt, save)
        : { poll() {}, finish() {}, close() {} }
      const screenshot = config.waitScreenshot
        ? async () => {
            // eslint-disable-next-line @typescript-eslint/no-require-imports -- Host-only screenshot bridge.
            const remote = require('@electron/remote')
            const image = await remote.getCurrentWebContents().capturePage()
            fs.writeFileSync(config.waitScreenshot, image.toPNG())
            return true
          }
        : undefined
      const indexWait = config.indexWaitCapture
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- Disposable observer helper.
        ? require(config.indexWaitCapture).createIndexWaitCapture(receipt, save, screenshot)
        : { poll() {}, finish() {} }
      let profile
      if (config.mode === 'profile-only') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- Host-only profiler bridge.
          const remote = require('@electron/remote')
          // eslint-disable-next-line @typescript-eslint/no-require-imports -- Disposable observer helper.
          const { startProfileOnly } = require(config.profileOnly)
          profile = startProfileOnly(remote.getCurrentWebContents().debugger)
          profile.catch((error) => {
            receipt.profileUnavailable = true
            receipt.profileUnavailableReason = String(error?.message ?? error).slice(0, 300)
            save()
          })
        } catch (error) {
          receipt.profileUnavailable = true
          receipt.profileUnavailableReason = String(error?.message ?? error).slice(0, 300)
          save()
        }
      }
      try {
        const marks = new PerformanceObserver((list) => {
          for (const entry of list.getEntries())
            if (entry.name === 'abele:onload-start' && receipt.pluginLoadAt === undefined) {
              receipt.pluginLoadAt = Math.round(performance.timeOrigin + entry.startTime)
              save()
            }
        })
        marks.observe({ type: 'mark', buffered: true })
        this.register(() => marks.disconnect())
      } catch {
        receipt.pluginLoadUnavailable = true
        save()
      }
      let sawActive = false
      const timer = setInterval(() => {
        metadataCache.poll()
        const host = this.app.plugins?.plugins?.abele?.tokenEngines
        const ui = host?.ui
        if (!ui) return
        const rows = ui.rows.value
        indexWait.poll(Object.values(ui.activity?.value ?? {}))
        const engines = [...host.live.values()].map((runtime) => runtime.engine.status)
        if (captureControlError(receipt, { rows, engines,
          activity: Object.entries(ui.activity?.value ?? {}).map(([id, value]) => ({ id, ...value })) },
          save, () => globalThis.__scalePollFailureCapture?.())) {
          sawActive = true
          return
        }
        if (
          rows.some((row) => row.status !== 'idle') ||
          engines.some((engine) => engine.state !== 'idle')
        )
          sawActive = true
        if (
          sawActive &&
          receipt.firstIdleAt === undefined &&
          rows.length &&
          engines.length &&
          rows.every((row) => row.status === 'idle') &&
          engines.every((engine) => engine.state === 'idle' && engine.lastSyncAt)
        ) {
          receipt.firstIdleAt = Date.now()
          save()
          diagnostic?.stop()
          metadataCache.finish(receipt.firstIdleAt)
          indexWait.finish(receipt.firstIdleAt)
          save()
          if (profile)
            void profile
              .then((capture) => capture.stop())
              .then((result) => {
                fs.writeFileSync(config.profileReceipt, JSON.stringify(result))
                receipt.profileComplete = true
                save()
              })
              .catch((error) => {
                receipt.profileUnavailable = true
                receipt.profileUnavailableReason = String(error?.message ?? error).slice(0, 300)
                save()
              })
        }
      }, 100)
      this.register(() => clearInterval(timer))
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Host-owned asynchronous evidence survives renderer reloads.
    const evidenceRemote = require('@electron/remote')
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Ordered, nonblocking evidence delivery.
    const { ipcRenderer: evidenceIpc } = require('electron')
    const evidenceChannel = evidenceRemote
      .require(config.diagnostics)
      .openEvidencePort(evidenceRemote.getCurrentWebContents().id, JSON.stringify(config))
    const emit = (data) =>
      evidenceIpc.send(
        evidenceChannel,
        JSON.stringify({ at: Date.now(), device: config.device, ...data }) + '\n'
      )
    globalThis.__scaleFlushEvidence = () => evidenceIpc.invoke(evidenceChannel)
    globalThis.__scaleEmitEvidence = emit
    // The qualified bundle supplies closures over its actual hash classes.
    // Schedule them normally, never through debugger call-frame evaluation.
    if (config.strictRestartMeasurement) {
      // Strict restart windows contain no harness hash setup, including a
      // callback retained from an earlier observer load in this realm.
      delete globalThis.__scaleWarmHashConstructors
    } else if (config.receiptCapture) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Installed qualification-only scheduling helper.
      const { scheduleHashWarmup } = require(config.receiptCapture)
      globalThis.__scaleWarmHashConstructors = work => scheduleHashWarmup(work, emit)
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Desktop-only bridge; sampling lives outside the renderer.
      const remote = require('@electron/remote')
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Heartbeats carry no file content.
      const { ipcRenderer } = require('electron')
      const diagnostic = remote.require(config.diagnostics)
      const channel = await diagnostic.watch(
        remote.getCurrentWebContents().id,
        JSON.stringify(config)
      )
      if (config.continuousCpu && !diagnostic.profileReady(channel))
        throw new Error('Continuous profiler did not acknowledge startup')
      profilerAcknowledgedAt = Date.now()
      globalThis.__scaleStopProfiles = () => diagnostic.unwatch(channel)
      globalThis.__scaleReindexCoverage = {
        begin: (id) => diagnostic.beginReindexCoverage(channel, id),
        end: () => diagnostic.endReindexCoverage(channel),
      }
      const pendingFile = config.evidence + '.' + config.device + '.reindex.json'
      if (fs.existsSync(pendingFile)) {
        const pending = JSON.parse(fs.readFileSync(pendingFile, 'utf8'))
        await diagnostic.beginReindexCoverage(channel, pending.id)
      }
      ipcRenderer.send(channel)
      const heartbeat = setInterval(() => ipcRenderer.send(channel), 25)
      this.register(() => {
        clearInterval(heartbeat)
        if (!config.continuousCpu) void diagnostic.unwatch(channel)
      })
    } catch {
      emit({ event: 'cpu-profile-unavailable' })
      if (config.continuousCpu) throw new Error('Continuous profiling required before product load')
    }
    if (config.receiptCapture && config.fingerprintObserver) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Read-only disposable diagnostics.
      const receiptCapture = require(config.receiptCapture)
      globalThis.__scaleCaptureBoundary = async id => {
        const receipt = await receiptCapture.captureBoundary({ id, device: config.device,
          app: this.app, emit })
        const file = path.join(config.profileDirectory, `${config.device}-${id.replace(/[^a-zA-Z0-9-]/g, '-')}-receipts.json`)
        fs.mkdirSync(config.profileDirectory, { recursive: true })
        fs.writeFileSync(file, JSON.stringify(receipt))
        await globalThis.__scaleFlushEvidence()
        return { id, at: receipt.at, completedAt: receipt.completedAt, complete: receipt.complete, file }
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Argument-to-digest linkage only.
      const fingerprints = require(config.fingerprintObserver)
      globalThis.__scaleWrapFingerprints = Class => fingerprints.wrapFingerprints(Class, row => {
        if (row.event === 'fingerprint-error') {
          const { error: _error, ...safe } = row
          emit({ ...safe, category: 'fingerprint failed' })
        } else emit(row)
      })
      this.register(() => {
        delete globalThis.__scaleCaptureBoundary
        delete globalThis.__scaleWrapFingerprints
      })
    }
    emit({ event: 'renderer-start', pid: globalThis.process?.pid ?? null })
    if (config.targeted) {
      const lifecycle = kind => emit({event:'targeted-lifecycle',kind,
        visible:evidenceRemote.getCurrentWindow().isVisible(),
        minimized:evidenceRemote.getCurrentWindow().isMinimized(),
        documentVisibility:document.visibilityState})
      this.registerDomEvent(window,'beforeunload',()=>lifecycle('beforeunload'))
      this.registerDomEvent(window,'unload',()=>lifecycle('unload'))
      this.registerDomEvent(document,'visibilitychange',()=>lifecycle('visibilitychange'))
      const quitting = () => lifecycle('before-quit')
      evidenceRemote.app.on('before-quit',quitting)
      this.register(()=>evidenceRemote.app.removeListener('before-quit',quitting))
      lifecycle('observer-load')
      const trigger = path.join(this.app.vault.adapter.getBasePath(),'.scale-sync-during-index')
      if (fs.existsSync(trigger)) {
        const timer = setInterval(()=>{
          const ui = this.app.plugins?.plugins?.abele?.tokenEngines?.ui
          if (!ui?.rows.value.length) return
          const indexWaiting = Object.values(ui.activity.value).some(a=>a.indexWaiting===true)
          const cacheClean = this.app.metadataCache.isCacheClean()
          if (!indexWaiting && cacheClean) return
          clearInterval(timer)
          fs.unlinkSync(trigger)
          emit({event:'targeted-sync-now',indexWaiting,cacheClean})
          for (const row of ui.rows.value) void ui.sync(row.id).catch(()=>{})
        },25)
        this.register(()=>clearInterval(timer))
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Disposable observer module.
    const reindexObserver = require(config.reindexObserver)
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Observe native ports before product load.
    const nativeCrypto = require('node:crypto')
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Reuse stack provenance for hash observations.
    const { classifyOrigin: classifyHash, stateChunks, visibleStatus, observeSyncTrace } = require(
      config.diagnostics
    )
    globalThis.__scaleObserveIncrementalHash = (hash) =>
      reindexObserver.observeIncrementalHash(hash, emit)
    this.register(() => {
      delete globalThis.__scaleObserveIncrementalHash
    })
    this.register(
      reindexObserver.observeHashes(nativeCrypto, globalThis.crypto?.subtle, emit, classifyHash)
    )
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- The host loader needs the fixture's absolute module path.
    const { observeWrites, observeReads } = require(config.writeObserver)
    const undoWrites = observeWrites(this.app.vault.adapter, emit, fs.promises ? [fs.promises] : [])
    const undoReads =
      config.observeContentReads === false
        ? undefined
        : observeReads?.(
            this.app.vault.adapter,
            emit,
            fs.promises ? [fs.promises] : [],
            config.contentPrefix
          )
    this.register(() => {
      undoReads?.()
      undoWrites()
    })
    const cycleTraces = new WeakSet()
    let previous = ''
    const seenActivity = new Set()
    const stateTimer = setInterval(() => {
      const host = this.app.plugins?.plugins?.abele?.tokenEngines
      const ui = host?.ui
      if (!ui) return
      for (const runtime of host.live.values()) {
        if (!runtime.trace || cycleTraces.has(runtime.trace)) continue
        cycleTraces.add(runtime.trace)
        this.register(observeSyncTrace(runtime.trace, emit))
      }
      const state = {
        event: config.device === '0' ? 'primary-state' : 'device-state',
        snapshot: {
          visibleStatus: visibleStatus(document),
          rows: ui.rows.value.map(({ status, paused }) => ({ status, paused })),
          engines: [...host.live.values()].map((e) => ({
            state: e.engine.status.state,
            pending: e.engine.status.pending,
            cursor: e.engine.status.cursor,
            headSeq: e.engine.status.headSeq,
            lastSyncAt: e.engine.status.lastSyncAt,
          })),
        },
        activity: Object.entries(ui.activity.value).map(([id, a]) => ({
          id,
          classification: a.classification ?? null,
          waiting: a.waiting ?? null,
          waitingFiles: a.waitingFiles ?? null,
          notSynced: a.notSynced ?? null,
          notSyncedError: a.notSyncedError ?? null,
          refused: a.refused ?? [],
          events: [...(a.events ?? [])].filter((e) => {
            const key = `${id}:${e.at}:${e.text}`
            if (seenActivity.has(key)) return false
            seenActivity.add(key)
            return true
          }),
        })),
      }
      const next = JSON.stringify(state)
      if (next !== previous) {
        for (const chunk of stateChunks(state)) emit(chunk)
        previous = next
      }
    }, 1000)
    this.register(() => clearInterval(stateTimer))
    try {
      const marks = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (/^abele:(?:eval|onload|layout)-(?:start|end)$/.test(entry.name))
            emit({ event: 'plugin-load-mark', name: entry.name,
              at: Math.round(performance.timeOrigin + entry.startTime) })
          if (entry.name === 'abele:onload-start')
            emit({
              event: 'plugin-load',
              at: Math.round(performance.timeOrigin + entry.startTime),
              source: entry.name,
            })
        }
      })
      marks.observe({ type: 'mark', buffered: true })
      this.register(() => marks.disconnect())
    } catch {
      emit({ event: 'plugin-load-unavailable' })
    }
    // Observe the existing transport log only in the pause window. No request is changed.
    const debug = console.debug
    const tracedDebug = function (...args) {
      if (window.__scaleCaptureCallers && typeof args[0] === 'string') {
        const match = /^\[abele-sync\] ([A-Z]+) (http:\/\/127\.0\.0\.1:\d+\/\S+)$/.exec(args[0])
        if (match)
          emit({
            event: 'request-caller',
            method: match[1],
            route: new URL(match[2]).pathname,
            stack: new Error().stack,
          })
      }
      return debug.apply(this, args)
    }
    console.debug = tracedDebug
    this.register(() => {
      if (console.debug === tracedDebug) console.debug = debug
    })
    let noticeOrigins
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Absolute disposable fixture module.
      const diagnostic = require(config.diagnostics)
      noticeOrigins = diagnostic.observeNotices({
        Notice,
        Node: globalThis.Node,
        Element: globalThis.Element,
      })
      this.register(() => noticeOrigins.close())
    } catch {
      emit({ event: 'notice-origin-unavailable' })
    }
    const seen = new WeakSet()
    const observe = () => {
      for (const node of document.querySelectorAll('.notice')) {
        if (seen.has(node)) continue
        if (!node.textContent) continue
        seen.add(node)
        // Evidence stays in the disposable run directory, never in tracked fixtures.
        emit({
          event: 'notice',
          text: node.textContent ?? '',
          ...(noticeOrigins?.origin(node) ?? { source: 'unknown', method: null, stack: null }),
        })
      }
    }
    const observer = new MutationObserver(observe)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    observe()
    this.register(() => observer.disconnect())
    try {
      const recordTasks = entries => {
        for (const entry of entries)
          emit({
            event: 'long-task',
            startedAt: Math.round(performance.timeOrigin + entry.startTime),
            durationMs: entry.duration,
            attribution: Array.from(entry.attribution ?? [], (a) => ({
              name: a.name,
              containerType: a.containerType,
              containerSrc: a.containerSrc,
            })),
          })
        entryLedger?.flush()
      }
      const performanceObserver = new PerformanceObserver(list => recordTasks(list.getEntries()))
      performanceObserver.observe({ type: 'longtask', buffered: true })
      if (config.continuousCpu) window.addEventListener('unload', () => {
        recordTasks(performanceObserver.takeRecords())
        performanceObserver.disconnect()
      }, { once: true })
      else this.register(() => performanceObserver.disconnect())
    } catch {
      emit({ event: 'long-task-unavailable' })
    }
    reindexObserver.observeRebuild(this.app, config, emit, (dispose) => this.register(dispose))
    if (config.continuousCpu) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Disposable startup gate.
      const { enableAfterProfile } = require(config.profileGate)
      await enableAfterProfile(Promise.resolve(), () => this.app.plugins.enablePlugin('abele'))
      // Published by the actual renderer only after the host's product load.
      // The driver reads this file directly, so a stuck CLI cannot fake success.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- Installed qualification-only startup proof.
      const { startupReceipt } = require(config.liveStartup)
      const proof = startupReceipt({ at: Date.now(), profilerAcknowledgedAt,
        marks: performance.getEntriesByType('mark').filter(mark =>
          ['abele:onload-start', 'abele:onload-end'].includes(mark.name)).map(mark => ({
          name: mark.name, epoch: Math.round(performance.timeOrigin + mark.startTime) })),
        ledger: entryLedger?.startupSnapshot() })
      fs.writeFileSync(config.startupReceipt, JSON.stringify(proof))
    }
  }
}
