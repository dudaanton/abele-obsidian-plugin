import { describe, it, expect, vi } from 'vitest'
import { NodeLspDocument, acquireLspDocument } from '@/node/NodeLspDocument'
import { provideLsp, lspNavigation } from '@/node/lspContext'
const problem = (source: string) => ({
  source,
  message: 'Sample problem',
  range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } },
})
function fixture(capabilities = ['lsp_v1']) {
  let event: (value: any) => void = () => {}
  const lsp = {
    status: vi.fn(async (): Promise<any[]> => []),
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
  it('recovers Retry after failed status, hover, and an edit with another admission failure', async () => {
    const f = fixture()
    f.lsp.status.mockRejectedValue(new Error('Sample status unavailable'))
    f.lsp.hover.mockResolvedValue({ text: 'sample hover' })
    await f.doc.open('initial sample')
    expect(f.doc.supported).toBe(true)
    const hover = await f.doc.hover({ line: 0, character: 2 })
    await f.doc.open('edited sample')
    f.lsp.status.mockResolvedValue([])
    // The Retry action refreshes availability before reopening the current text.
    await f.doc.refreshStatus()
    await f.doc.open('edited sample')
    try {
      expect(f.doc.error).toBe('')
      expect(hover).toBe('')
      expect(f.lsp.hover).not.toHaveBeenCalled()
      expect(f.lsp.open).toHaveBeenCalledOnce()
      expect(f.client.describe).toHaveBeenCalledTimes(3)
      expect(f.client.subscribe).toHaveBeenCalledOnce()
      expect(await f.doc.hover({ line: 0, character: 2 })).toBe('sample hover')
    } finally {
      await f.doc.close()
    }
  })
  it('queries each visible text atomically and restores the surviving view on release', async () => {
    const f = fixture()
    const root = { workspace_id: 'sample-workspace' }
    const reader = acquireLspDocument(f.client as any, root, 'shared.ts', () => 'reader text')
    const editor = acquireLspDocument(f.client as any, root, 'shared.ts', () => 'unsaved draft')
    let remote = ''
    f.lsp.open.mockImplementation(async (_root, _path, text) => {
      remote = text
      return { servers: ['typescript'] }
    })
    f.lsp.hover.mockImplementation(async () => {
      const before = remote
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(remote).toBe(before)
      return { text: remote }
    })
    const definitionTexts: string[] = []
    f.lsp.definition.mockImplementation(async () => {
      definitionTexts.push(remote)
      expect(remote).toBe('reader text')
      return []
    })
    await reader.document.open('reader text')
    await editor.document.open('unsaved draft')
    const position = { line: 0, character: 2 }
    expect(
      await Promise.all([
        reader.document.hover(position, 'reader text'),
        editor.document.hover(position, 'unsaved draft'),
        reader.document.query('definition', position, 'reader text'),
      ])
    ).toEqual(['reader text', 'unsaved draft', []])
    expect(definitionTexts).toEqual(['reader text'])
    await editor.document.open('new draft')
    await editor.release()
    expect(remote).toBe('reader text')
    expect(f.lsp.close).not.toHaveBeenCalled()
    await reader.release()
    expect(f.lsp.close).toHaveBeenCalledOnce()
  })
  it('keeps capability support and retry available after initial status fails', async () => {
    const f = fixture()
    f.lsp.status.mockRejectedValueOnce(new Error('Sample status failure'))
    await f.doc.open('sample')
    expect(f.doc.supported).toBe(true)
    expect(f.doc.error).toBe('Sample status failure')
    await f.doc.open('sample')
    expect(f.doc.error).toBe('')
    expect(f.lsp.open).toHaveBeenCalledOnce()
    await f.doc.close()
  })
  it('does not insert a delayed analysis notice after diagnostics have already arrived', async () => {
    const f = fixture()
    let finish!: () => void
    f.lsp.open.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return { servers: ['typescript'] }
    })
    const opening = f.doc.open('sample')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    f.push({
      workspace_id: 'sample-workspace',
      path: 'sample.ts',
      diagnostics: [problem('typescript')],
    })
    await new Promise((resolve) => setTimeout(resolve, 350))
    try {
      expect(f.doc.loading).toBe(false)
    } finally {
      finish()
      await opening
      await f.doc.close()
    }
  })
  it('publishes initial server availability before exposing diagnostics to the view', async () => {
    const f = fixture()
    let finish!: (status: any[]) => void
    f.lsp.status.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const opening = f.doc.open('sample')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    try {
      expect(f.doc.supported).toBe(true)
      expect(f.client.onEvent).not.toHaveBeenCalled()
    } finally {
      finish([
        { language: 'typescript', found: true },
        { language: 'eslint', found: false },
      ])
      await opening
      await f.doc.close()
    }
    expect(f.doc.status).toContainEqual({ language: 'eslint', found: false })
  })
  it('retains diagnostics until the next analysis answers', async () => {
    const f = fixture()
    await f.doc.open('before')
    f.doc.diagnostics = [problem('eslint')]
    f.lsp.open.mockImplementation(async () => {
      expect(f.doc.diagnostics).toEqual([problem('eslint')])
      return { servers: ['typescript'] }
    })
    await f.doc.open('after')
    expect(f.doc.error).toBe('')
    await f.doc.close()
  })
  it('keeps fast analysis invisible and diagnostics present during an update', async () => {
    const f = fixture()
    const loading: boolean[] = []
    f.doc.listeners.add(() => loading.push(f.doc.loading))
    await f.doc.open('sample')
    expect(loading).not.toContain(true)
    f.doc.diagnostics = [problem('typescript')]
    let finish!: () => void
    f.lsp.open.mockImplementation(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve
      })
      return { servers: ['typescript'] }
    })
    const update = f.doc.open('changed')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    try {
      expect(f.doc.diagnostics).toEqual([problem('typescript')])
      await vi.waitFor(() => expect(f.doc.loading).toBe(true))
    } finally {
      finish()
      await update
      await f.doc.close()
    }
  })
  it('shares a buffer and closes only when its last view releases it', async () => {
    const f = fixture()
    const a = acquireLspDocument(f.client as any, { workspace_id: 'sample-workspace' }, 'shared.ts')
    const b = acquireLspDocument(f.client as any, { workspace_id: 'sample-workspace' }, 'shared.ts')
    expect(a.document).toBe(b.document)
    await Promise.all([a.document.open('same'), b.document.open('same')])
    expect(f.lsp.open).toHaveBeenCalledOnce()
    await a.release()
    await a.release()
    expect(f.lsp.close).not.toHaveBeenCalled()
    await b.release()
    expect(f.lsp.close).toHaveBeenCalledOnce()
  })
  it('waits for the previous final close before reacquiring the same buffer', async () => {
    const f = fixture()
    const a = acquireLspDocument(f.client as any, { workspace_id: 'sample-workspace' }, 'shared.ts')
    await a.document.open('first')
    let finish!: () => void
    f.lsp.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        })
    )
    const closing = a.release()
    const b = acquireLspDocument(f.client as any, { workspace_id: 'sample-workspace' }, 'shared.ts')
    const opening = b.document.open('second')
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(f.lsp.open).toHaveBeenCalledOnce()
    finish()
    await Promise.all([closing, opening])
    expect(f.lsp.open).toHaveBeenCalledTimes(2)
    f.lsp.close.mockResolvedValue(undefined)
    await b.release()
  })
  it('isolates clients, root kinds and paths and keeps diagnostics when another file opens', async () => {
    const f = fixture()
    const a = acquireLspDocument(f.client as any, { workspace_id: 'sample-workspace' }, 'a.ts')
    const b = acquireLspDocument(f.client as any, { workspace_id: 'sample-workspace' }, 'b.ts')
    const c = acquireLspDocument(f.client as any, { worktree_id: 'sample-workspace' }, 'a.ts')
    const d = acquireLspDocument(
      fixture().client as any,
      { workspace_id: 'sample-workspace' },
      'a.ts'
    )
    expect(new Set([a.document, b.document, c.document, d.document]).size).toBe(4)
    await a.document.open('a')
    a.document.diagnostics = [problem('typescript')]
    await b.document.open('b')
    expect(a.document.diagnostics).toEqual([problem('typescript')])
    await b.release()
    expect(a.document.diagnostics).toHaveLength(1)
    await Promise.all([a.release(), c.release(), d.release()])
  })
  it('shares a pending hover when diagnostic pushes restart the tooltip', async () => {
    const f = fixture()
    await f.doc.open('const sample = 1')
    const finishes: ((value: { text: string }) => void)[] = []
    f.lsp.hover.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishes.push(resolve)
        })
    )
    const first = f.doc.hover({ line: 0, character: 7 })
    await vi.waitFor(() => expect(f.lsp.hover).toHaveBeenCalledOnce())
    const restarted = f.doc.hover({ line: 0, character: 7 })
    await new Promise((resolve) => setTimeout(resolve, 30))
    try {
      expect(f.lsp.hover).toHaveBeenCalledOnce()
    } finally {
      for (const finish of finishes) finish({ text: 'const sample: number\nSample documentation.' })
      await Promise.all([first, restarted])
      await f.doc.close()
    }
  })
  it.each([
    { language: 'typescript', found: false },
    { language: 'typescript', found: true, reason: 'untrusted_folder' },
  ])('closes an unavailable document without a remote buffer to release: %j', async (status) => {
    const f = fixture()
    f.lsp.status.mockResolvedValue([status])
    await f.doc.open('const sample = 1')
    await f.doc.close()
    expect(f.lsp.open).not.toHaveBeenCalled()
    expect(f.lsp.close).not.toHaveBeenCalled()
  })
  it('does not open a missing backend because an unrelated language is installed, and retries after installation', async () => {
    const f = fixture()
    f.lsp.status.mockResolvedValue([
      { language: 'typescript', found: false },
      { language: 'eslint', found: false },
      { language: 'python', found: true },
    ])
    await f.doc.open('const sample = 1')
    try {
      expect(f.lsp.open).not.toHaveBeenCalled()
      expect(await f.doc.query('definition', { line: 0, character: 7 })).toEqual([])
      expect(await f.doc.hover({ line: 0, character: 7 })).toBe('')
      expect(f.lsp.definition).not.toHaveBeenCalled()
      expect(f.lsp.hover).not.toHaveBeenCalled()
      f.lsp.status.mockResolvedValue([
        { language: 'typescript', found: true },
        { language: 'eslint', found: false },
      ])
      await f.doc.refreshStatus()
      await f.doc.open('const sample = 2')
      expect(f.lsp.open).toHaveBeenCalledOnce()
    } finally {
      await f.doc.close()
    }
  })
  it('uses text navigation without opening language servers in an untrusted folder, then resumes after trust', async () => {
    const f = fixture()
    f.lsp.status.mockResolvedValue([
      { language: 'typescript', found: true, reason: 'untrusted_folder' },
    ])
    await f.doc.open('const sample = 1')
    const root = document.createElement('div')
    const code = root.appendChild(document.createElement('div'))
    const fallback = { pathOf: () => 'sample.ts', goToDefinition: vi.fn(), findReferences: vi.fn() }
    const remove = provideLsp(root, { document: f.doc, navigate: vi.fn() })
    try {
      expect(f.doc.supported).toBe(true)
      expect(f.lsp.open).not.toHaveBeenCalled()
      await lspNavigation(code, fallback)!.goToDefinition('sample', 'sample.ts', {
        line: 0,
        character: 7,
      })
      expect(fallback.goToDefinition).toHaveBeenCalledOnce()
      expect(await f.doc.hover({ line: 0, character: 7 })).toBe('')
      expect(f.lsp.definition).not.toHaveBeenCalled()
      expect(f.lsp.hover).not.toHaveBeenCalled()
      expect(f.lsp.open).not.toHaveBeenCalled()
      f.lsp.status.mockResolvedValue([])
      await f.doc.refreshStatus()
      await f.doc.open('const sample = 2')
      expect(f.lsp.open).toHaveBeenCalledOnce()
    } finally {
      remove()
      await f.doc.close()
    }
  })
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
