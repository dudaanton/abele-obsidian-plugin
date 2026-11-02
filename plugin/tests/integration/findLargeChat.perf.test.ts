import { expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFindTool } from '@/ai/tools/FindTool'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'
import { buildFakeVault } from '../helpers/fakeVault'
import * as chatLog from '@/ai/ChatLog'
import * as chatReader from '@/ai/tools/findChatText'
import { chatForAgent, isChatLog } from '@/ai/chatText'
import { Criterion } from '@/entities/Criterion'

// Optional measurement of the original reader on exactly the same invented fixture;
// production files and existing tests are never swapped or checked out.
const baseline = process.env.FIND_ORIGINAL_BASELINE === '1'

it('keeps repeated 100 MiB chat searches cooperative and metadata searches read-free', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'abele-search-'))
  const meta = JSON.stringify({
    v: 2,
    k: 'meta',
    type: 'abele-chat',
    title: 'Invented conversation',
  })
  const tool = JSON.stringify({
    k: 'int',
    role: 'toolResult',
    content: 'private-needle '.repeat(4096),
  })
  const lines = [
    meta,
    JSON.stringify({ k: 'msg', id: 'u', role: 'user', content: 'public-needle', timestamp: 1 }),
  ]
  while (lines.length < 1800) lines.push(tool)
  const chat = lines.join('\n') + '\n'
  const disk = join(dir, 'Sample.abchat')
  await writeFile(disk, chat)
  const app = buildFakeVault([
    ...Array.from({ length: 3000 }, (_, i) => ({
      path: `Notes/${i}.md`,
      content: 'public-needle',
      frontmatter: { type: 'sample' },
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      path: `Chats/${i}.abchat`,
      raw: meta + '\n',
      mtime: 1,
    })),
  ])
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = app
  const scope = new ScopeResolver()
  scope.setFullVaultAccess(true)
  const original = app.vault.cachedRead.bind(app.vault)
  let chatReads = 0
  let readMs = 0
  vi.spyOn(app.vault, 'cachedRead').mockImplementation(async (file) => {
    if (!file.path.endsWith('.abchat')) return original(file)
    chatReads++
    const start = performance.now()
    const raw = await readFile(disk, 'utf8')
    readMs += performance.now() - start
    return raw
  })
  let parseMs = 0
  let matchMs = 0
  const parse = chatLog.parseChat
  vi.spyOn(chatLog, 'parseChat').mockImplementation((value, only) => {
    const start = performance.now()
    try {
      return parse(value, baseline ? false : only)
    } finally {
      parseMs += performance.now() - start
    }
  })
  if (baseline)
    vi.spyOn(chatReader, 'findChatText').mockImplementation(async (vault, file) => {
      const value = await vault.cachedRead(file)
      return isChatLog(file.path, value) ? chatForAgent(value, file.path) : value
    })
  const match = Criterion.prototype.checkContentCriterion
  vi.spyOn(Criterion.prototype, 'checkContentCriterion').mockImplementation(function (value) {
    const start = performance.now()
    try {
      return match.call(this, value)
    } finally {
      matchMs += performance.now() - start
    }
  })
  try {
    const find = createFindTool()
    const reports = []
    for (const [label, criteria] of [
      ['text-cold', [{ type: 'content', operator: 'contains', value: 'public-needle' }]],
      ['text-repeat', [{ type: 'content', operator: 'contains', value: 'private-needle' }]],
      ['properties', [{ type: 'property', operator: 'equals', property: 'type', value: 'sample' }]],
    ] as const) {
      const beforeReads = chatReads
      const beforeReadMs = readMs
      const beforeParse = parseMs
      const beforeMatch = matchMs
      let maxTimerGapMs = 0
      let ticks = 0
      let last = performance.now()
      const timer = setInterval(() => {
        const now = performance.now()
        maxTimerGapMs = Math.max(maxTimerGapMs, now - last)
        last = now
        ticks++
      }, 5)
      const start = performance.now()
      const result = await find.execute('find', { criteria, limit: 2 }, undefined, {
        scope,
        interactive: false,
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      clearInterval(timer)
      reports.push({
        label,
        fileMiB: +(Buffer.byteLength(chat) / 1024 ** 2).toFixed(1),
        wallMs: +(performance.now() - start).toFixed(1),
        chatReads: chatReads - beforeReads,
        summedReadLatencyMs: +(readMs - beforeReadMs).toFixed(1),
        parseMs: +(parseMs - beforeParse).toFixed(1),
        matchMs: +(matchMs - beforeMatch).toFixed(1),
        maxTimerGapMs: +maxTimerGapMs.toFixed(1),
        ticks,
      })
      if (label === 'text-cold')
        expect(result.content[0].text.split('\n')[0]).toBe('2 of 3003 files:')
      if (label === 'text-repeat') expect(result.content[0].text).toBe('No files found.')
      if (label === 'properties') expect(chatReads).toBe(beforeReads)
    }
    console.info('large chat search', JSON.stringify(reports))
    expect(chatReads).toBe(3)
  } finally {
    scope.destroy()
    vi.restoreAllMocks()
    await rm(dir, { recursive: true, force: true })
  }
}, 120_000)
