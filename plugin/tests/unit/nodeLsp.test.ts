import { describe, it, expect, vi } from 'vitest'
import { NodeLspDocument } from '@/node/NodeLspDocument'
import { provideLsp, lspNavigation } from '@/node/lspContext'
const problem = (source: string) => ({
  source,
  message: 'Sample problem',
  range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } },
})
function fixture(capabilities = ['lsp_v1']) {
  let event: (value: any) => void = () => {}
  const lsp = {
    status: vi.fn(async () => []),
    open: vi.fn(async (..._args: any[]) => ({ servers: ['typescript', 'eslint'] })),
    close: vi.fn(async () => {}),
    diagnostics: vi.fn(async (): Promise<any[]> => []),
    hover: vi.fn(),
    definition: vi.fn(),
    references: vi.fn(),
  }
  const stop = vi.fn()
  const client = {
    lsp,
    describe: vi.fn(async () => ({
      capabilities: {
        capabilities: Object.fromEntries(
          capabilities.map((name) => [name, { status: 'supported' }])
        ),
      },
    })),
    subscribe: vi.fn(async () => {}),
    onEvent: vi.fn((fn: typeof event) => {
      event = fn
      return stop
    }),
  }
  const doc = new NodeLspDocument(client as any, { workspace_id: 'sample-workspace' }, 'sample.ts')
  return {
    client,
    lsp,
    doc,
    stop,
    push: (data: unknown, type = 'lsp.diagnostics') => event({ type, data }),
  }
}
describe('node LSP document', () => {
  it('waits for a query buffer update before closing and never queries a departed view', async () => {
    const f = fixture()
    await f.doc.open('sample')
    let finish!: () => void
    f.lsp.open.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return { servers: ['typescript'] }
    })
    const query = f.doc.query('definition', { line: 0, character: 0 })
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    const closing = f.doc.close()
    expect(f.lsp.close).not.toHaveBeenCalled()
    finish()
    expect(await query).toEqual([])
    await closing
    expect(f.lsp.definition).not.toHaveBeenCalled()
    expect(f.lsp.close).toHaveBeenCalledOnce()
  })
  it('lets the node advance its shared version after another view or an agent refresh', async () => {
    const f = fixture()
    let sharedVersion = 50
    f.lsp.open.mockImplementation(async (_root, _path, _text, version) => {
      if (version !== undefined && version <= sharedVersion) throw new Error('stale_revision')
      sharedVersion = version ?? sharedVersion + 1
      return { servers: ['typescript'] }
    })
    await f.doc.open('const sample = 1')
    expect(f.doc.error).toBe('')
    sharedVersion += 3
    await f.doc.open('const sample = 2')
    expect(f.doc.error).toBe('')
    expect(sharedVersion).toBe(55)
    await f.doc.close()
  })
  it('resends the visible draft before a query after the node evicts its buffer', async () => {
    const f = fixture()
    let serverText = ''
    f.lsp.open.mockImplementation(async (_root, _path, text) => {
      serverText = text
      return { servers: ['typescript'] }
    })
    await f.doc.open('const sample = "draft"')
    serverText = 'const sample = "disk"'
    f.lsp.hover.mockImplementation(async () => ({ text: serverText }))
    expect(await f.doc.hover({ line: 0, character: 7 })).toContain('draft')
    serverText = 'disk'
    f.lsp.definition.mockImplementation(async () => {
      expect(serverText).toContain('draft')
      return []
    })
    await f.doc.query('definition', { line: 0, character: 7 })
    await f.doc.close()
  })
  it('shows a server failure for this folder and ignores failures in another folder', async () => {
    const f = fixture()
    await f.doc.open('sample')
    f.push({ workspace_id: 'another-workspace', message: 'Another server stopped' }, 'lsp.status')
    expect(f.doc.error).toBe('')
    f.push({ workspace_id: 'sample-workspace', message: 'Sample server stopped' }, 'lsp.status')
    expect(f.doc.error).toBe('Sample server stopped')
    await f.doc.close()
  })
  it('ignores navigation that answers after the document has closed', async () => {
    const f = fixture()
    await f.doc.open('sample')
    let answer!: (hits: any[]) => void
    f.lsp.definition.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve
        })
    )
    const query = f.doc.query('definition', { line: 0, character: 0 })
    await vi.waitFor(() => expect(answer).toBeTypeOf('function'))
    await f.doc.close()
    answer([
      {
        path: 'stale.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      },
    ])
    expect(await query).toEqual([])
  })
  it('uses precise positions and falls back when no server answers', async () => {
    const f = fixture()
    await f.doc.open('const sample = 1')
    const root = document.createElement('div')
    const code = root.appendChild(document.createElement('div'))
    const navigate = vi.fn()
    const remove = provideLsp(root, { document: f.doc, navigate })
    const fallback = { pathOf: () => 'sample.ts', goToDefinition: vi.fn(), findReferences: vi.fn() }
    const nav = lspNavigation(code, fallback)!
    const position = { line: 2, character: 7 }
    const hit = {
      path: 'definition.ts',
      range: { start: { line: 4, character: 1 }, end: { line: 4, character: 7 } },
    }
    f.lsp.definition.mockResolvedValue([hit])
    await nav.goToDefinition('sample', 'sample.ts', position)
    expect(f.lsp.definition).toHaveBeenCalledWith(
      { workspace_id: 'sample-workspace' },
      'sample.ts',
      position,
      expect.any(AbortSignal)
    )
    expect(navigate).toHaveBeenCalledWith([hit])
    expect(fallback.goToDefinition).not.toHaveBeenCalled()
    f.lsp.definition.mockResolvedValue([])
    await nav.goToDefinition('sample', 'sample.ts', position)
    expect(fallback.goToDefinition).toHaveBeenCalledWith('sample', 'sample.ts', position)
    f.lsp.references.mockResolvedValue([hit])
    nav.findReferences('sample', position)
    await vi.waitFor(() => expect(f.lsp.references).toHaveBeenCalled())
    expect(navigate).toHaveBeenCalledTimes(2)
    remove()
    expect(lspNavigation(code, fallback)).toBe(fallback)
    await f.doc.close()
  })
  it('retains a push received while open is still answering', async () => {
    const f = fixture()
    f.lsp.open.mockImplementation(async () => {
      f.push({
        workspace_id: 'sample-workspace',
        path: 'sample.ts',
        diagnostics: [problem('typescript')],
      })
      return { servers: ['typescript'] }
    })
    await f.doc.open('sample')
    expect(f.doc.diagnostics[0].source).toBe('typescript')
    await f.doc.close()
  })
  it('closes a late open and ignores late diagnostics after leaving', async () => {
    const f = fixture()
    let resolve!: () => void
    f.lsp.open.mockImplementation(async () => {
      await new Promise<void>((r) => {
        resolve = r
      })
      return { servers: ['typescript'] }
    })
    const opening = f.doc.open('sample')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    const closing = f.doc.close()
    resolve()
    await Promise.all([opening, closing])
    f.push({
      workspace_id: 'sample-workspace',
      path: 'sample.ts',
      diagnostics: [problem('typescript')],
    })
    expect(f.doc.diagnostics).toEqual([])
    expect(f.lsp.close).toHaveBeenCalledOnce()
  })
  it('does nothing without the capability', async () => {
    const f = fixture([])
    await f.doc.open('sample')
    expect(f.lsp.open).not.toHaveBeenCalled()
    expect(f.client.subscribe).not.toHaveBeenCalled()
  })
  it('opens versioned text and isolates merged pushes by root and path', async () => {
    const f = fixture()
    await f.doc.open('const sample: string = 1')
    expect(f.client.subscribe).toHaveBeenCalledWith('catalog')
    expect(f.lsp.open).toHaveBeenCalledWith(
      { workspace_id: 'sample-workspace' },
      'sample.ts',
      'const sample: string = 1',
      undefined,
      expect.any(AbortSignal)
    )
    f.push({ workspace_id: 'other', path: 'sample.ts', diagnostics: [problem('wrong')] })
    expect(f.doc.diagnostics).toEqual([])
    f.push({
      workspace_id: 'sample-workspace',
      path: 'sample.ts',
      diagnostics: [problem('typescript'), problem('eslint')],
    })
    expect(f.doc.diagnostics.map((d) => d.source)).toEqual(['typescript', 'eslint'])
    await f.doc.open('const sample = 2')
    expect(f.lsp.open.mock.calls[1][2]).toBe('const sample = 2')
    expect(f.lsp.open.mock.calls[1][3]).toBeUndefined()
    await f.doc.close()
    expect(f.stop).toHaveBeenCalled()
    expect(f.lsp.close).toHaveBeenCalledOnce()
  })
  it('keeps a push received during the initial cached pull', async () => {
    const f = fixture()
    let resolve!: (value: any[]) => void
    f.lsp.diagnostics.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    const opening = f.doc.open('sample')
    await vi.waitFor(() => expect(resolve).toBeTypeOf('function'))
    f.push({
      workspace_id: 'sample-workspace',
      path: 'sample.ts',
      diagnostics: [problem('eslint')],
    })
    resolve([])
    await opening
    expect(f.doc.diagnostics[0].source).toBe('eslint')
    await f.doc.close()
  })
})
