import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { evalLong } from './obsidianCli'
import { onPhone } from './target'
import { screenshot as phoneScreenshot, exposeToPhone } from './phone'
import { designCaptureExpression, type CaptureOptions } from '../../helpers/designCapture'
import { annotateDesign } from '../../helpers/designAnnotate'
import {
  lintDesign,
  type DesignSnapshot,
  type LintOptions,
  type Violation,
} from '../../helpers/designLint'

export interface DesignReport {
  snapshot: DesignSnapshot
  violations: Violation[]
  directory: string
  artifacts: string[]
}
// Large PNGs and snapshots travel over the existing reversed-port contract, never argv.
async function annotateOnPhone(
  snapshot: DesignSnapshot,
  violations: Violation[],
  png: string
): Promise<string> {
  const token = randomUUID()
  const payload = JSON.stringify({ snapshot, violations, png })
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/' + token) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close' }).end(payload)
  })
  let unexpose: (() => void) | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    unexpose = exposeToPhone(port)
    return await evalLong(
      `(async () => {
      const response = await requestUrl({url:${JSON.stringify(`http://127.0.0.1:${port}/${token}`)}, method:'GET'})
      const {snapshot, violations, png} = response.json
      const artifacts = []
      await (${annotateDesign.toString()})(snapshot, violations, png, (name, data) => artifacts.push({name, data}))
      return JSON.stringify(artifacts)
    })()`,
      120_000
    )
  } finally {
    unexpose?.()
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
/** Runs only in the selected vault's renderer. The caller owns the vault/window lease. */
export async function measureDesign(
  selector: string,
  outDir: string,
  capture: CaptureOptions = {},
  rules: LintOptions = {}
): Promise<DesignReport> {
  const directory = resolve(outDir)
  mkdirSync(directory, { recursive: true })
  const raw = onPhone()
    ? await evalLong(`JSON.stringify(${designCaptureExpression(selector, capture)})`, 30_000)
    : await evalLong(
        `(async () => {
    const selector = ${JSON.stringify(selector)}
    const document = globalThis.document.querySelector(selector) ? globalThis.document : app.setting?.containerEl?.ownerDocument ?? globalThis.document
    const win = document.defaultView.require('@electron/remote').getCurrentWindow()
    const image = await Promise.race([win.webContents.capturePage(), new Promise((_, reject) => setTimeout(() => reject(new Error('Design capture timed out')), 15000))])
    const snapshot = ${designCaptureExpression(selector, capture)}
    require('fs').writeFileSync(${JSON.stringify(join(directory, 'capture.png'))}, image.toPNG())
    return JSON.stringify(snapshot)
  })()`,
        30_000
      )
  if (raw.startsWith('Error:')) throw new Error(raw)
  const snapshot = JSON.parse(raw) as DesignSnapshot
  if (onPhone()) phoneScreenshot(join(directory, 'capture.png'))
  const violations = lintDesign(snapshot, rules)
  const reportFile = join(directory, 'report.json')
  if (existsSync(reportFile)) {
    // Only delete files that an earlier successful run explicitly owned. Never glob an output
    // directory or follow paths supplied by a modified manifest outside that directory.
    let previous: Partial<DesignReport> = {}
    try {
      previous = JSON.parse(readFileSync(reportFile, 'utf8'))
    } catch {
      /* Not an owned manifest. */
    }
    if (previous.directory === directory && Array.isArray(previous.artifacts))
      for (const name of previous.artifacts)
        if (/^violation-\d+-[a-z-]+-3x\.png$/.test(name) && existsSync(join(directory, name)))
          unlinkSync(join(directory, name))
  }
  const artifacts = [
    'capture.png',
    'annotated.png',
    ...violations.map((v, i) => `violation-${String(i + 1).padStart(3, '0')}-${v.rule}-3x.png`),
  ]
  const report = { snapshot, violations, directory, artifacts }
  writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
  const rendered = onPhone()
    ? await annotateOnPhone(
        snapshot,
        violations,
        'data:image/png;base64,' + readFileSync(join(directory, 'capture.png')).toString('base64')
      )
    : await evalLong(
        `(async () => {
    const fs = require('fs'), path = require('path')
    const report = JSON.parse(fs.readFileSync(${JSON.stringify(join(directory, 'report.json'))}, 'utf8'))
    const png = 'data:image/png;base64,' + fs.readFileSync(${JSON.stringify(join(directory, 'capture.png'))}).toString('base64')
    await (${annotateDesign.toString()})(report.snapshot, report.violations, png, (name, data) => {
      fs.writeFileSync(path.join(report.directory, name), Buffer.from(data.split(',')[1], 'base64'))
    })
    return 'rendered'
  })()`,
        120_000
      )
  if (onPhone()) {
    for (const artifact of JSON.parse(rendered) as Array<{ name: string; data: string }>) {
      if (!artifacts.includes(artifact.name)) throw new Error('Unknown design annotation artifact')
      writeFileSync(
        join(directory, artifact.name),
        Buffer.from(artifact.data.split(',')[1], 'base64')
      )
    }
  } else if (rendered !== 'rendered') throw new Error(rendered)
  return report
}
