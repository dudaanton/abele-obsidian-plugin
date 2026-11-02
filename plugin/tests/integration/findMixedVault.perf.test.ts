import { afterEach, expect, it, vi } from 'vitest'
import { createFindTool } from '@/ai/tools/FindTool'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'
import { buildFakeVault } from '../helpers/fakeVault'

// Invented data only. Most bytes in a real agentic chat are private tool records.
const meta = '{"v":2,"k":"meta","type":"abele-chat","title":"Sample conversation"}\n'
const internal = JSON.stringify({
  k: 'int',
  role: 'toolResult',
  content: 'private-needle '.repeat(600_000),
})
const chat =
  meta +
  JSON.stringify({ k: 'msg', id: 'u', role: 'user', content: 'public-needle', timestamp: 1 }) +
  '\n' +
  internal +
  '\n'
const scopes: ScopeResolver[] = []
afterEach(() => {
  scopes.splice(0).forEach((s) => s.destroy())
  vi.restoreAllMocks()
})

it('bounds mixed-vault search work without reading attachments or parsing private chat records', async () => {
  const app = buildFakeVault([
    ...Array.from({ length: 3000 }, (_, i) => ({
      path: `Notes/Sample-${String(i).padStart(4, '0')}.md`,
      content: 'public-needle',
    })),
    ...Array.from({ length: 4 }, (_, i) => ({ path: `Chats/Sample-${i}.abchat`, raw: chat })),
    { path: 'Chats/Renamed.md', raw: chat },
    ...['pdf', 'png', 'jpg', 'zip', 'xlsx', 'docx', 'mp4', 'woff2'].map((ext) => ({
      path: `Media/Sample.${ext}`,
      raw: 'binary public-needle\u0000'.repeat(100_000),
    })),
    { path: 'Notes/Plain.txt', raw: 'public-needle' },
  ])
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = app
  const scope = new ScopeResolver()
  scope.setFullVaultAccess(true)
  scopes.push(scope)
  const ctx = { scope, interactive: false }
  const phases = { scope: 0, read: 0, parse: 0, parsedPrivate: 0, binaryReads: 0 }
  const resolve = scope.getAccessiblePaths.bind(scope)
  vi.spyOn(scope, 'getAccessiblePaths').mockImplementation(() => {
    const start = performance.now()
    const paths = resolve()
    phases.scope += performance.now() - start
    return paths
  })
  const read = app.vault.cachedRead.bind(app.vault)
  vi.spyOn(app.vault, 'cachedRead').mockImplementation(async (file) => {
    const start = performance.now()
    if (file.path.startsWith('Media/')) phases.binaryReads++
    const value = await read(file)
    phases.read += performance.now() - start
    return value
  })
  const parse = JSON.parse
  vi.spyOn(JSON, 'parse').mockImplementation((value, reviver) => {
    const start = performance.now()
    if (value === internal) phases.parsedPrivate++
    try {
      return parse(value, reviver)
    } finally {
      phases.parse += performance.now() - start
    }
  })
  const tool = createFindTool()
  const run = async (word: string) => {
    const start = performance.now()
    const result = await tool.execute(
      'find',
      { criteria: [{ type: 'content', operator: 'contains', value: word }], limit: 2 },
      undefined,
      ctx
    )
    console.info(
      `mixed find ${word}: ${JSON.stringify({ totalMs: +(performance.now() - start).toFixed(1), ...phases, reads: app.stats.read })}`
    )
    return result.content[0].text
  }
  const publicResult = await run('public-needle')
  const privateResult = await run('private-needle')
  // Counts pin public conversation + notes + plain text, but never binary bytes.
  expect.soft(publicResult.split('\n')[0]).toBe('2 of 3006 files:')
  expect.soft(privateResult).toBe('No files found.')
  expect.soft(phases.binaryReads).toBe(0)
  expect(phases.parsedPrivate).toBe(0)
}, 60_000)
