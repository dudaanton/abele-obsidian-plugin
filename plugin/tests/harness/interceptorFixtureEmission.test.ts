import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { parseScriptHeader } from '@/scripting/ScriptParser'

it('uses the replacement script service and emits real source and SSE line breaks', async () => {
  const source = readFileSync('tests/e2e/interceptorScriptReplyOnly.e2e.test.ts', 'utf8')
  const template = source.match(/const probe = (String.raw`[\s\S]*?`)\n\nconst available/)![1]
  const files = new Map<string, { path: string; children?: unknown[]; source?: string }>()
  let enabled = false
  let indexed = false
  const current = {
    // A scan already in flight can queue the new-file scan behind it.
    discover: async () => {
      setTimeout(() => {
        indexed = true
      }, 20)
    },
    get: (path: string) =>
      indexed && files.has(path) ? { source: files.get(path)!.source } : null,
  }
  const stale = { discover: async () => {}, get: () => null }
  const review = vi.fn(async (_path: string, code: string) => {
    expect(parseScriptHeader(code)).toMatchObject({ name: 'Sample side reviewer', interceptor: 30 })
    expect(code.split('\n')).toHaveLength(4)
    const response = await win.fetch('http://sample-script-reply.invalid/v1', {})
    const stream = await response.text()
    expect(stream).toContain('\n\ndata: [DONE]\n\n')
    expect(stream).not.toContain('\\n')
    throw new Error('Fixture review reached')
  })
  const win = {
    fetch: vi.fn(),
    __abeleTest: {
      ChatService: { getInstance: () => ({ activeTabId: { value: '' } }) },
      ScriptService: { getInstance: () => (enabled ? current : stale) },
    },
  }
  const app = {
    workspace: { rightSplit: { collapsed: false } },
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path),
      createFolder: async (path: string) => files.set(path, { path, children: [] }),
      create: async (path: string, code: string) => {
        const file = { path, source: code }
        files.set(path, file)
        return file
      },
      delete: async (file: { path: string }) => files.delete(file.path),
    },
  }
  const helpers = `
    const saveScriptFixture = async () => ({});
    const enableScriptFixture = async () => enable();
    const approveScriptFixture = review;
    const restoreScriptFixture = async () => {};
  `
  const emitted = new Function('SCRIPT_FIXTURE', `return ${template}`)(helpers)
  const result = JSON.parse(
    await new Function('window', 'app', 'enable', 'review', `return ${emitted}`)(
      win,
      app,
      () => {
        enabled = true
      },
      review
    )
  )
  expect(result.error).toBe('Fixture review reached')
  expect(review).toHaveBeenCalledOnce()
  expect(files.size).toBe(0)
})
