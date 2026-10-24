import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const levels = ['info', 'low', 'moderate', 'high', 'critical']

/** Evaluate npm's v2 report; indirect vulnerability entries are covered by their source advisories. */
export function evaluateAudit(report, exceptions, today = new Date().toISOString().slice(0, 10)) {
  if (
    report?.error ||
    report?.auditReportVersion !== 2 ||
    !report.vulnerabilities ||
    typeof report.vulnerabilities !== 'object' ||
    Array.isArray(report.vulnerabilities)
  ) {
    throw new Error('Invalid npm audit report')
  }
  if (!Array.isArray(exceptions)) throw new Error('Invalid audit exceptions')
  const errors = []
  const allowed = new Map()
  for (const entry of exceptions) {
    if (
      !/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/.test(entry.advisory) ||
      !entry.reason?.trim() ||
      !Array.isArray(entry.paths) ||
      !entry.paths.length ||
      !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires) ||
      !Number.isFinite(Date.parse(entry.expires)) ||
      new Date(entry.expires).toISOString().slice(0, 10) !== entry.expires
    ) {
      throw new Error('Invalid audit exception')
    }
    if (entry.expires < today)
      errors.push(`Exception expired: ${entry.advisory} (${entry.expires})`)
    for (const path of entry.paths) {
      if (typeof path !== 'string' || !path.startsWith('node_modules/')) {
        throw new Error('Invalid exception package path')
      }
      const key = `${entry.advisory} ${path}`
      if (allowed.has(key)) throw new Error(`Duplicate exception: ${key}`)
      allowed.set(key, false)
    }
  }
  for (const [name, vulnerability] of Object.entries(report.vulnerabilities)) {
    if (
      !Array.isArray(vulnerability.via) ||
      !Array.isArray(vulnerability.nodes) ||
      !vulnerability.via.length ||
      !vulnerability.nodes.length
    ) {
      throw new Error(`Invalid vulnerability: ${name}`)
    }
    for (const advisory of vulnerability.via) {
      if (typeof advisory === 'string') {
        if (!report.vulnerabilities[advisory]) throw new Error(`Missing source: ${advisory}`)
        continue
      }
      if (!levels.includes(advisory?.severity)) throw new Error(`Invalid severity: ${name}`)
      if (levels.indexOf(advisory.severity) < levels.indexOf('moderate')) continue
      const id = advisory.url?.match(/^https:\/\/github\.com\/advisories\/(GHSA-[a-z0-9-]+)$/)?.[1]
      for (const path of vulnerability.nodes) {
        const key = `${id ?? advisory.url ?? name} ${path}`
        if (allowed.has(key)) allowed.set(key, true)
        else errors.push(`Unexcepted advisory: ${key} (${advisory.severity})`)
      }
    }
  }
  for (const [key, used] of allowed) {
    if (!used) errors.push(`Exception unused: ${key}`)
  }
  return errors
}

function main() {
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['audit', '--omit=dev', '--json'],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }
  )
  if (result.error || ![0, 1].includes(result.status)) {
    throw new Error(`npm audit failed: ${result.error?.message ?? result.stderr ?? result.signal}`)
  }
  const exceptions = JSON.parse(
    readFileSync(new URL('./audit-exceptions.json', import.meta.url), 'utf8')
  )
  const errors = evaluateAudit(JSON.parse(result.stdout), exceptions)
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exitCode = 1
  } else console.log('Shipped dependency audit passed with recorded exceptions.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
