/** Paired production-bundle startup measurements with no diagram or plugin view open. */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { build, loadConfigFromFile, type Plugin } from 'vite'
import { evalAsync } from './helpers/githubLive'
import { hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('diagram startup cost', () => {
  it('records paired onload, module evaluation and collected heap samples', async () => {
    const scratch = mkdtempSync(join(shotDir('diagram-startup'), 'build-'))
    try {
      const variants: Record<string, string> = {}
      for (const name of ['with-pele', 'without-pele']) {
        const loaded = await loadConfigFromFile(
          { command: 'build', mode: 'production' },
          resolve('vite.config.mts')
        )
        if (!loaded) throw new Error('Missing production build config')
        const plugins = (loaded.config.plugins?.flat().filter(Boolean) ?? []) as Plugin[]
        const baseline: Plugin = {
          name: 'diagram-measurement-baseline',
          enforce: 'pre',
          resolveId: (source) => (source === 'pele/lazy' ? '\0diagram-measurement-baseline' : null),
          load: (id) =>
            id === '\0diagram-measurement-baseline'
              ? 'export function renderAsync(){throw Error("Unexpected diagram during startup measurement")}; export function load(){throw Error("Unexpected parser during startup measurement")}; export function parse(){throw Error("Unexpected parser during startup measurement")}'
              : null,
        }
        const outDir = join(scratch, name)
        await build({
          ...loaded.config,
          configFile: false,
          mode: 'production',
          logLevel: 'warn',
          plugins: [
            ...(name === 'without-pele' ? [baseline] : []),
            ...plugins.filter((plugin) => plugin.name !== 'abele-build-evidence'),
          ],
          build: { ...loaded.config.build, outDir },
        })
        variants[name] = join(outDir, 'main.js')
      }
      const result = evalAsync<{
        samples: {
          variant: string
          modulesMs: number
          onloadMs: number
          enableMs: number
          heapBytes: number
        }[]
        bytes: Record<string, number>
      }>(
        `(async () => {
        const fs = require('fs'), path = require('path')
        const id = 'abele', ws = app.workspace
        const installed = path.join(app.vault.adapter.getBasePath(), app.plugins.manifests[id].dir, 'main.js')
        const original = fs.readFileSync(installed), layout = ws.getLayout()
        const variants = ${JSON.stringify(variants)}
        const samples = [], bytes = {}
        const cdp = require('@electron/remote').getCurrentWebContents().debugger
        const attached = cdp.isAttached()
        if (!attached) cdp.attach('1.3')
        const wait = ms => new Promise(r => setTimeout(r, ms))
        const settle = () => new Promise(resolve => {
          const start = performance.now()
          let previous = start, lastBusy = start
          const tick = () => {
            const now = performance.now()
            if (now - previous > 50) lastBusy = now
            previous = now
            if (now - lastBusy >= 500 || now - start >= 10000) resolve()
            else setTimeout(tick, 20)
          }
          tick()
        })
        const mark = name => performance.getEntriesByName('abele:' + name).at(-1)?.startTime
        try {
          const side = (id,type) => ({id,type:'split',direction:'horizontal',width:300,children:[{id:id+'-tabs',type:'tabs',children:[{id:id+'-leaf',type:'leaf',state:{type,state:{}}}]}]})
          await ws.changeLayout({main:{id:'sample-main',type:'split',direction:'vertical',children:[{id:'sample-tabs',type:'tabs',children:[{id:'sample-empty',type:'leaf',state:{type:'empty',state:{}}}]}]},left:side('sample-left','file-explorer'),right:side('sample-right','outline'),active:'sample-empty'})
          for (let round = 0; round < 5; round++) {
            for (const variant of (round % 2 ? ['without-pele','with-pele'] : ['with-pele','without-pele'])) {
              await app.plugins.disablePlugin(id)
              await wait(300)
              const bundle = fs.readFileSync(variants[variant])
              bytes[variant] = bundle.length
              fs.writeFileSync(installed, bundle)
              await cdp.sendCommand('HeapProfiler.collectGarbage')
              const before = await cdp.sendCommand('Runtime.getHeapUsage')
              const start = performance.now()
              await app.plugins.enablePlugin(id)
              const enableMs = performance.now() - start
              if (!app.plugins.plugins[id] || mark('onload-end') < start) throw Error('Plugin did not finish loading')
              await settle()
              await cdp.sendCommand('HeapProfiler.collectGarbage')
              const heap = await cdp.sendCommand('Runtime.getHeapUsage')
              samples.push({variant, round, modulesMs:mark('eval-end')-mark('eval-start'),preOnloadMs:mark('onload-start')-mark('eval-start'),readCompileMs:mark('eval-start')-start,onloadMs:mark('onload-end')-mark('onload-start'),enableMs,heapBytes:heap.usedSize,heapBeforeBytes:before.usedSize,heapDeltaBytes:heap.usedSize-before.usedSize})
            }
          }
          return {samples,bytes}
        } finally {
          await app.plugins.disablePlugin(id)
          fs.writeFileSync(installed, original)
          await app.plugins.enablePlugin(id)
          await ws.changeLayout(layout)
          if (!attached && cdp.isAttached()) cdp.detach()
        }
      })()`,
        180_000
      )
      writeFileSync(
        join(shotDir('diagram-startup'), 'measurements.json'),
        JSON.stringify(result, null, 2)
      )
      console.info('DIAGRAM_STARTUP ' + JSON.stringify(result))
      expect(result.samples).toHaveLength(10)
      for (const sample of result.samples) {
        expect(Number.isFinite(sample.onloadMs)).toBe(true)
        expect(Number.isFinite(sample.modulesMs)).toBe(true)
        expect(sample.heapBytes).toBeGreaterThan(0)
      }
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }, 900_000)
})
