/**
 * A result too big to send is kept whole and read back by key — and nothing of it is lost:
 * whatever the agent was not sent can be read, every line of it, through `read_result`.
 */
import { describe, it, expect } from 'vitest'
import {
  ResultStore,
  STORE_OVER,
  PAGE_TOKENS,
  PIECE_CHARS,
  createReadResultTool,
  pieces,
  resultKey,
  withResultStore,
} from '@/ai/resultStore'
import { estimateTokens } from '@/ai/tokens'
import type { AgentTool, AgentToolResult, Message, ToolResultMessage } from '@/ai/client'

const result = (text: string): AgentToolResult => ({ content: [{ type: 'text', text }] })
const textOf = (r: AgentToolResult) => r.content.map((c) => c.text).join('')

/** A listing of `n` rows, each different, so a lost or doubled line shows. */
const listing = (n: number) =>
  Array.from({ length: n }, (_, i) => `Folder/Sub/Note number ${i + 1}.md | due:2026-01-01`).join(
    '\n'
  )

/** Pages through a stored result by following the tool's own "read on" hints. */
async function readAll(tool: AgentTool, key: string): Promise<string[]> {
  const lines: string[] = []
  let start = 1
  for (let guard = 0; guard < 1000; guard++) {
    const page = textOf(await tool.execute('x', { key, start_line: start }))
    const [head, ...rest] = page.split('\n')
    const m = /lines ([\d,]+)–([\d,]+) of ([\d,]+)/.exec(head)!
    const [from, to, total] = m.slice(1).map((x) => Number(x.replace(/,/g, '')))
    expect(from).toBe(start)
    lines.push(...rest.slice(0, to - from + 1))
    if (to >= total) return lines
    expect(rest[to - from + 1]).toContain(`start_line: ${to + 1}`)
    start = to + 1
  }
  throw new Error('never ended')
}

describe('a result small enough to send', () => {
  it('is sent as it is and not stored', () => {
    const store = new ResultStore({ messages: () => [] })
    const r = result(listing(20))
    store.keep('find', 'c1', r)
    expect(textOf(r)).toBe(listing(20))
    expect(r.stored).toBeUndefined()
  })
})

describe('a result too big to send', () => {
  const big = listing(3000)

  it('is sent as its start and a key, within budget', () => {
    expect(estimateTokens(big)).toBeGreaterThan(STORE_OVER)
    const store = new ResultStore({ messages: () => [] })
    const r = result(big)
    store.keep('read_tasks', 'c1', r)
    const sent = textOf(r)
    expect(r.stored).toEqual({ key: resultKey('c1'), text: big })
    expect(estimateTokens(sent)).toBeLessThan(STORE_OVER)
    expect(sent.startsWith(big.split('\n').slice(0, 10).join('\n'))).toBe(true)
    expect(sent).toContain(resultKey('c1'))
    expect(sent).toMatch(/lines 1–[\d,]+ of 3,000/)
    expect(sent).toContain('is not in this message')
  })

  it('can be read back whole, line for line, by following the hints', async () => {
    const store = new ResultStore({ messages: () => [] })
    const r = result(big)
    store.keep('read_tasks', 'c1', r)
    const lines = await readAll(createReadResultTool(store), r.stored!.key)
    expect(lines.join('\n')).toBe(big)
  })

  it('keeps every page within budget', async () => {
    const store = new ResultStore({ messages: () => [] })
    const r = result(big)
    store.keep('read_tasks', 'c1', r)
    const page = textOf(
      await createReadResultTool(store).execute('x', { key: r.stored!.key, start_line: 10 })
    )
    expect(estimateTokens(page)).toBeLessThanOrEqual(PAGE_TOKENS + 60)
  })

  it('answers a search with the matching lines and their numbers', async () => {
    const store = new ResultStore({ messages: () => [] })
    const r = result(big)
    store.keep('read_tasks', 'c1', r)
    const tool = createReadResultTool(store)
    const hits = textOf(await tool.execute('x', { key: r.stored!.key, grep: 'number 2999.md' }))
    expect(hits).toContain('1 of 3,000 lines match')
    expect(hits).toContain('2999\tFolder/Sub/Note number 2999.md | due:2026-01-01')
    const regex = textOf(
      await tool.execute('x', { key: r.stored!.key, grep: '/number 1\\d\\.md/' })
    )
    expect(regex).toContain('10 of 3,000 lines match')
  })

  it('reads a window it is asked for', async () => {
    const store = new ResultStore({ messages: () => [] })
    const r = result(big)
    store.keep('read_tasks', 'c1', r)
    const page = textOf(
      await createReadResultTool(store).execute('x', {
        key: r.stored!.key,
        start_line: 5,
        end_line: 6,
      })
    )
    expect(page.split('\n').slice(1, 3)).toEqual(big.split('\n').slice(4, 6))
    expect(page).toContain('Lines 7–3,000 follow')
  })

  it('cuts one enormous line into pieces that still add up to it', async () => {
    const line = 'x'.repeat(PIECE_CHARS * 20 + 7) + 'END'
    const text = `head\n${line}\ntail`
    const store = new ResultStore({ messages: () => [] })
    const r = result(text)
    store.keep('eval_js', 'c1', r)
    expect(r.stored).toBeDefined()
    expect(textOf(r)).toContain('count as several lines')
    const all = pieces(text)
    const joined = all.reduce(
      (acc, p, i) => (i === 0 ? p.text : acc + (p.continued ? '' : '\n') + p.text),
      ''
    )
    expect(joined).toBe(text)
    const lines = await readAll(createReadResultTool(store), r.stored!.key)
    expect(lines).toEqual(all.map((p) => p.text))
  })
})

describe('what is never stored', () => {
  it('leaves alone a result that carries a file for the read guard', () => {
    const store = new ResultStore({ messages: () => [] })
    const r: AgentToolResult = { ...result(listing(3000)), seen: { path: 'A.md', hash: 'h' } }
    store.keep('read', 'c1', r)
    expect(r.stored).toBeUndefined()
    expect(textOf(r)).toBe(listing(3000))
  })

  it('never stores its own pages again', () => {
    const store = new ResultStore({ messages: () => [] })
    const r = result(listing(3000))
    store.keep('read_result', 'c1', r)
    expect(r.stored).toBeUndefined()
  })
})

describe('finding a stored result later', () => {
  it('finds it on a saved message, once the turn that made it is over', async () => {
    const first = new ResultStore({ messages: () => [] })
    const r = result(listing(3000))
    first.keep('read_tasks', 'call_abc', r)
    const message: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: 'call_abc',
      toolName: 'read_tasks',
      content: r.content,
      isError: false,
      timestamp: 0,
      stored: r.stored,
    }
    // As it comes back from the chat file.
    const reloaded = JSON.parse(JSON.stringify([message])) as Message[]
    const later = new ResultStore({ messages: () => reloaded })
    const lines = await readAll(createReadResultTool(later), resultKey('call_abc'))
    expect(lines.join('\n')).toBe(listing(3000))
  })

  it('says so when the key is unknown', async () => {
    const tool = createReadResultTool(new ResultStore({ messages: () => [] }))
    await expect(tool.execute('x', { key: 'rnope' })).rejects.toThrow('No stored result "rnope"')
  })

  it('forgets a live result when the turn is settled, since its message went with it', () => {
    const store = new ResultStore({ messages: () => [] })
    const r = result(listing(3000))
    store.keep('read_tasks', 'c1', r)
    store.settle()
    expect(store.lookup(r.stored!.key)).toBeNull()
  })
})

describe('an agent a script starts', () => {
  it('gets the store in front of its tools and read_result beside them', async () => {
    const big: AgentTool = {
      name: 'read_tasks',
      label: 'x',
      description: 'x',
      parameters: {},
      execute: async () => result(listing(3000)),
    }
    const tools = withResultStore([big], new ResultStore({ messages: () => [] }))
    expect(tools.map((t) => t.name)).toEqual(['read_tasks', 'read_result'])
    const r = await tools[0].execute('c9', {})
    const lines = await readAll(tools[1], r.stored!.key)
    expect(lines.join('\n')).toBe(listing(3000))
  })
})
