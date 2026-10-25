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
    const emit = (data) =>
      fs.appendFileSync(
        config.evidence,
        JSON.stringify({ at: Date.now(), device: config.device, ...data }) + '\n'
      )
    emit({ event: 'renderer-start', pid: globalThis.process?.pid ?? null })
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Disposable observer module.
    const reindexObserver = require(config.reindexObserver)
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Observe native ports before product load.
    const nativeCrypto = require('node:crypto')
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- Reuse stack provenance for hash observations.
    const { classifyOrigin: classifyHash, stateChunks } = require(config.diagnostics)
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
    let previous = ''
    const seenActivity = new Set()
    const stateTimer = setInterval(() => {
      if (config.device !== '0') return
      const host = this.app.plugins?.plugins?.abele?.tokenEngines
      const ui = host?.ui
      if (!ui) return
      const state = {
        event: 'primary-state',
        snapshot: {
          rows: ui.rows.value.map(({ status, paused }) => ({ status, paused })),
          engines: [...host.live.values()].map((e) => ({
            state: e.engine.status.state,
            pending: e.engine.status.pending,
            lastSyncAt: e.engine.status.lastSyncAt,
          })),
        },
        activity: Object.entries(ui.activity.value).map(([id, a]) => ({
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
      const performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
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
      })
      performanceObserver.observe({ type: 'longtask', buffered: true })
      this.register(() => performanceObserver.disconnect())
    } catch {
      emit({ event: 'long-task-unavailable' })
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
        void diagnostic.unwatch(channel)
      })
    } catch {
      emit({ event: 'cpu-profile-unavailable' })
    }
    reindexObserver.observeRebuild(this.app, config, emit, (dispose) => this.register(dispose))
  }
}
