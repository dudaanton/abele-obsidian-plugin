import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { evalLong } from './obsidianCli'
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
/** Runs only in the selected vault's renderer. The caller owns the vault/window lease. */
export async function measureDesign(
  selector: string,
  outDir: string,
  capture: CaptureOptions = {},
  rules: LintOptions = {}
): Promise<DesignReport> {
  const directory = resolve(outDir)
  mkdirSync(directory, { recursive: true })
  const raw = await evalLong(
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
  const rendered = await evalLong(
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
  if (rendered !== 'rendered') throw new Error(rendered)
  return report
}
