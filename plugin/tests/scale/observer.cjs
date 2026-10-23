/* eslint-disable @typescript-eslint/no-require-imports -- Loaded directly by the desktop host as a CommonJS plugin. */
const { Plugin } = require('obsidian')
const fs = require('fs')
const path = require('path')
/* eslint-enable @typescript-eslint/no-require-imports -- The host-only CommonJS imports end here. */

// Installed first in a disposable vault. Evidence survives renderer/process termination.
module.exports = class extends Plugin {
  onload() {
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
    emit({ event: 'renderer-start' })
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
    const seen = new WeakSet()
    const observe = () => {
      for (const node of document.querySelectorAll('.notice')) {
        if (seen.has(node)) continue
        if (!node.textContent) continue
        seen.add(node)
        // Evidence stays in the disposable run directory, never in tracked fixtures.
        emit({ event: 'notice', text: node.textContent ?? '' })
      }
    }
    const observer = new MutationObserver(observe)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    observe()
    this.register(() => observer.disconnect())
    try {
      const performanceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          emit({ event: 'long-task', durationMs: entry.duration })
      })
      performanceObserver.observe({ type: 'longtask', buffered: true })
      this.register(() => performanceObserver.disconnect())
    } catch {
      emit({ event: 'long-task-unavailable' })
    }
  }
}
