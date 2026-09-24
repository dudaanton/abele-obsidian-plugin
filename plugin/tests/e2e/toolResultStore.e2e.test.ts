/**
 * Long tool answers in the running app: the live chat's own tools shorten an answer too big to
 * send, keep it whole, and `read_result` reads the rest back — the wiring in the bundle, with
 * Obsidian's real metadata cache behind the listings.
 *
 * No model is asked: the tools are taken from the active session exactly as a turn gets them
 * and called directly, so this runs without a key. Nothing is written to the vault.
 *
 * Requires Obsidian running with the development build — see docs/Testing.md.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { isObsidianRunning, hasTestApi, evalRaw } from './helpers/obsidianCli'

interface Report {
  error?: string
  offered: string[]
  files: number
  firstLine: string
  stored: boolean
  sentChars: number
  storedChars: number
  key: string
  note: string
  target: string
  hit: string
  page: string
  wholeLines: number
  pagedLines: number
  workspaceHead: string[]
}

const script = `(async () => {
  const t = window.__abeleTest
  const service = t.ChatService.getInstance()
  service.ensureInitialized()
  const session = service.activeSession.value
  if (!session) return JSON.stringify({ error: 'no active chat session' })
  const scope = session.scopeResolver
  const wasFull = scope.fullVaultAccess.value
  scope.fullVaultAccess.value = true
  try {
    const tools = session.getTools()
    const tool = (name) => tools.find((x) => x.name === name)
    const report = { offered: tools.map((x) => x.name).filter((n) => ['find', 'read_result', 'workspace'].includes(n)) }
    const any = [{ type: 'path', operator: 'endsWith', value: '.md' }]
    const flat = await tool('find').execute('e2e-flat', { criteria: any, limit: 100000 })
    report.files = Number(/^(\\d+)/.exec(flat.content[0].text)[1])
    const big = await tool('find').execute('e2e-big', { criteria: any, include_frontmatter: true, limit: 100000 })
    const sent = big.content[0].text
    report.firstLine = sent.split('\\n')[0]
    report.stored = !!big.stored
    report.sentChars = sent.length
    report.storedChars = big.stored ? big.stored.text.length : 0
    report.key = big.stored ? big.stored.key : ''
    report.note = sent.slice(sent.lastIndexOf('\\n[') + 1)
    // A file from the far end of the listing, which the short form does not reach.
    const names = big.stored.text.split('\\n').filter((l) => l.startsWith('  '))
    const last = names[names.length - 1].trim().split(' | ')[0]
    report.target = last
    const read = tool('read_result')
    report.hit = (await read.execute('e2e-hit', { key: report.key, grep: last })).content[0].text
    report.wholeLines = big.stored.text.split('\\n').length
    let start = 1
    let got = 0
    for (let i = 0; i < 500; i++) {
      const page = (await read.execute('e2e-page', { key: report.key, start_line: start })).content[0].text
      if (i === 0) report.page = page.split('\\n')[0]
      const m = /lines ([\\d,]+)–([\\d,]+) of ([\\d,]+)/.exec(page.split('\\n')[0])
      const [from, to, total] = m.slice(1).map((x) => Number(x.replace(/,/g, '')))
      got += to - from + 1
      if (to >= total) break
      start = to + 1
    }
    report.pagedLines = got
    const ws = await tool('workspace').execute('e2e-ws', {})
    report.workspaceHead = ws.content[0].text.split('\\n').slice(0, 3)
    return JSON.stringify(report)
  } finally {
    scope.fullVaultAccess.value = wasFull
  }
})()`

const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('long tool answers in the running app', () => {
  let report: Report

  beforeAll(() => {
    report = JSON.parse(evalRaw(script, 120_000)) as Report
    expect(report.error).toBeUndefined()
  })

  it('offers read_result beside the tools that can answer at length', () => {
    expect(report.offered.sort()).toEqual(['find', 'read_result', 'workspace'])
  })

  it('sends the start of a long answer and keeps all of it', () => {
    expect(report.files).toBeGreaterThan(50)
    expect(report.stored).toBe(true)
    expect(report.sentChars).toBeLessThan(report.storedChars / 2)
    expect(report.note).toContain(`key ${report.key}`)
    expect(report.note).toContain('is not in this message')
  })

  it('finds what the short form did not reach, by key', () => {
    expect(report.hit).toContain('lines match')
    expect(report.hit).toContain(report.target)
  })

  it('pages through every line of it', () => {
    expect(report.page).toMatch(/lines 1–/)
    expect(report.pagedLines).toBe(report.wholeLines)
  })

  it('lists the workspace grouped by folder', () => {
    expect(report.workspaceHead[0]).toMatch(/accessible files/)
    expect(report.workspaceHead[1]).toMatch(/\/ \(\d+\)$/)
    expect(report.workspaceHead[2]).toMatch(/^ {2}\S/)
  })
})
