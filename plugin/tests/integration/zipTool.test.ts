import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TFile, type App } from 'obsidian'
import { ChatSession } from '@/ai/ChatSession'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { CORE_TOOLS, DEFAULT_AI_SETTINGS, WRITE_TOOLS } from '@/ai/types'
import { createAgentTools, getToolRegistry } from '@/ai/tools'
import type { AgentTool } from '@/ai/client'
import { ChangeTracker } from '@/ai/rewind/ChangeTracker'
import { extractArchive } from '@/scripting/unzip'
import { subAgentRefusal } from '@/ai/SubAgentRunner'
import { createQueryDocsTool } from '@/ai/tools/QueryDocsTool'
import { boundRunToParent } from '@/ai/DelegateRun'
import { useVault } from '../helpers/testEnv'
import { deferred } from '../helpers/deferred'

let app: App
const sessions: ChatSession[] = []
beforeEach(() => {
  app = useVault([
    { path: 'Notes/sample.md', content: 'sample\r\n' },
    { path: 'Private/hidden.md', content: 'not selected' },
  ]) as unknown as App
  ;(app.vault.getAbstractFileByPath('Notes/sample.md') as TFile).stat.size =
    new TextEncoder().encode('sample\r\n').length
  AgentRegistry.destroy()
  AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS, agents: [], defaultAgentId: '' }
  vi.spyOn(AbeleConfig.getInstance(), 'saveSettings').mockResolvedValue()
})
afterEach(() => {
  sessions.forEach((s) => s.destroy())
  sessions.length = 0
  ChatService.getInstance().destroy()
  ChangeTracker.get()?.uninstall()
  vi.restoreAllMocks()
})
function session(
  mode: 'confirm-all' | 'allow-edit' | 'allow-all' = 'allow-edit',
  kind: 'chat' | 'run' = 'chat'
) {
  const agent = AgentRegistry.getInstance().create({
    name: 'Sample archiver',
    permissionMode: mode,
    scope: [{ type: 'file', path: 'Notes/sample.md' }],
    toolDiscovery: 'by-group',
  })
  const s = new ChatSession(ChatService.getInstance(), undefined, { agentId: agent.id, kind })
  sessions.push(s)
  return s
}
function tool(s: ChatSession) {
  return (s as unknown as { getTools(): AgentTool[] }).getTools().find((t) => t.name === 'zip')!
}
const request = (path = 'Exports/sample.zip') => ({ path, files: [{ path: 'Notes/sample.md' }] })
const read = (path: string) => app.vault.readBinary(app.vault.getAbstractFileByPath(path) as TFile)

it('exposes runtime tools and storage documentation through query_docs', async () => {
  for (const section of ['tools', 'vault']) {
    const result = await createQueryDocsTool().execute('docs', { section, topic: 'zip-archives' })
    expect(result.content[0].text).toContain('ZIP archives')
    expect(result.content[0].text).toContain('zip')
  }
})

it.each(['scope', 'event-revision', 'collision', 'parent', 'stop'] as const)(
  'revalidates %s during compression yields',
  async (fault) => {
    const s = session()
    const source = app.vault.getAbstractFileByPath('Notes/sample.md') as TFile
    const data = new Uint8Array(140000)
    source.stat.size = data.length
    const controller = new AbortController()
    const native = app.vault.createBinary.bind(app.vault)
    const create = vi.spyOn(app.vault, 'createBinary')
    const mutated = deferred<void>()
    vi.spyOn(app.vault, 'readBinary').mockImplementationOnce(async () => {
      setTimeout(() => {
        void (async () => {
          if (fault === 'scope') s.scopeResolver.clear()
          if (fault === 'event-revision')
            (app as unknown as { emit(scope: string, name: string, file: TFile): void }).emit(
              'vault',
              'modify',
              source
            )
          if (fault === 'collision') await native('Exports/sample.zip', new Uint8Array([9]).buffer)
          if (fault === 'parent') await app.vault.createFolder('Exports')
          if (fault === 'stop') controller.abort()
          mutated.resolve()
        })().catch(mutated.reject)
      }, 0)
      return data.buffer
    })
    await expect(tool(s).execute('sample', request(), controller.signal)).rejects.toThrow()
    await mutated.promise
    expect(create).not.toHaveBeenCalled()
    expect(s.scopeResolver.isInScope('Exports/sample.zip')).toBe(false)
  }
)

it('two concurrent chats keep independent cancellation and successful output grants', async () => {
  const first = session()
  const second = session()
  const gate = deferred<ArrayBuffer>()
  vi.spyOn(app.vault, 'readBinary').mockReturnValueOnce(gate.promise)
  const stop = new AbortController()
  const failed = tool(first).execute('first', request('first.zip'), stop.signal)
  await vi.waitFor(() => expect(app.vault.readBinary).toHaveBeenCalled())
  const saved = await tool(second).execute('second', request('second.zip'))
  stop.abort()
  gate.resolve(new TextEncoder().encode('sample\r\n').buffer)
  await expect(failed).rejects.toThrow()
  expect(saved.details).toMatchObject({ path: 'second.zip' })
  expect(first.scopeResolver.isInScope('second.zip')).toBe(false)
  expect(second.scopeResolver.isInScope('second.zip')).toBe(true)
  expect(app.vault.getAbstractFileByPath('first.zip')).toBeNull()
})

it('Stop after creating a parent reports remaining folders and saves no ZIP', async () => {
  const s = session()
  const stop = new AbortController()
  const native = app.vault.createFolder.bind(app.vault)
  vi.spyOn(app.vault, 'createFolder').mockImplementationOnce(async (path) => {
    const folder = await native(path)
    stop.abort()
    return folder
  })
  await expect(tool(s).execute('sample', request(), stop.signal)).rejects.toThrow(
    /folders may remain/
  )
  expect(app.vault.getAbstractFileByPath('Exports')).not.toBeNull()
  expect(app.vault.getAbstractFileByPath('Exports/sample.zip')).toBeNull()
})

it('does not grant a rebound conversation after a known native save', async () => {
  const s = session()
  const native = app.vault.createBinary.bind(app.vault)
  vi.spyOn(app.vault, 'createBinary').mockImplementationOnce(async (...args) => {
    const saved = await native(...args)
    s.conversationVersion.value++
    return saved
  })
  const result = await tool(s).execute('sample', request('sample.zip'))
  expect(result.details).toMatchObject({
    path: 'sample.zip',
    warning: expect.stringContaining('no scope grant'),
  })
  expect(s.scopeResolver.isInScope('sample.zip')).toBe(false)
  expect(s.touched.value).toEqual([])
})

it('registers a core Files write with explicit selection schema, including by-group discovery', () => {
  const tools = createAgentTools()
  const zip = tools.find((t) => t.name === 'zip')
  expect(zip).toBeDefined()
  expect(zip?.parameters.required).toEqual(['path', 'files'])
  expect(getToolRegistry(tools).find((t) => t.name === 'zip')?.category).toBe('Files')
  expect(CORE_TOOLS.has('zip')).toBe(true)
  expect(WRITE_TOOLS).toContain('zip')
  expect(tool(session())).toBeDefined()
})
it.each(['confirm-all', 'allow-edit', 'allow-all'] as const)(
  'uses ordinary %s creation admission, outside the source scope',
  async (mode) => {
    const s = session(mode)
    expect(s.needsApproval('zip', request())).toBe(mode === 'confirm-all')
    if (mode === 'confirm-all') {
      await expect(tool(s).execute('sample', request())).rejects.toThrow(/approval|permitted/)
      expect(app.vault.getAbstractFileByPath('Exports')).toBeNull()
    }
    const result = await tool(s).execute('sample', request(), undefined, {
      scope: s.scopeResolver,
      interactive: true,
      approved: mode === 'confirm-all',
    })
    expect(result.details).toMatchObject({ path: 'Exports/sample.zip', count: 1 })
    expect(result.seen).toBeUndefined()
    expect(result.details).not.toHaveProperty('diff')
    expect(s.scopeResolver.isInScope('Exports/sample.zip')).toBe(true)
  }
)
it('requires bound context rather than a privileged fallback', async () => {
  const zip = createAgentTools().find((t) => t.name === 'zip')!
  await expect(zip.execute('sample', request())).rejects.toThrow(/bound|context/)
})
it.each([false, true])(
  'mixed denied selections cause ZERO metadata reads, binary reads and writes (denied first %s)',
  async (deniedFirst) => {
    const s = session('confirm-all')
    const files = [{ path: 'Notes/sample.md' }, { path: 'Private/hidden.md' }]
    if (deniedFirst) files.reverse()
    const metadata = vi.spyOn(app.vault, 'getAbstractFileByPath')
    const bytes = vi.spyOn(app.vault, 'readBinary')
    const create = vi.spyOn(app.vault, 'createBinary')
    const folders = vi.spyOn(app.vault, 'createFolder')
    await expect(
      tool(s).execute('sample', { ...request(), files }, undefined, {
        scope: s.scopeResolver,
        interactive: true,
        approved: true,
      })
    ).rejects.toThrow('Selected files are not available in this scope')
    expect(metadata).not.toHaveBeenCalled()
    expect(bytes).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(folders).not.toHaveBeenCalled()
    expect(s.scopeResolver.isInScope('Private/hidden.md')).toBe(false)
  }
)
it('a listable ancestor does not grant a sibling source', async () => {
  const s = session()
  await app.vault.create('Notes/sibling.md', 'keep')
  expect(s.scopeResolver.isFolderInScope('Notes')).toBe(true)
  const bytes = vi.spyOn(app.vault, 'readBinary')
  await expect(
    tool(s).execute('sample', { ...request(), files: [{ path: 'Notes/sibling.md' }] })
  ).rejects.toThrow(/scope/)
  expect(bytes).not.toHaveBeenCalled()
})
it('roundtrips raw binary/BOM/CRLF/empty bytes and canonical mapping through unchanged unzip', async () => {
  const s = session()
  const bytes = new Uint8Array([239, 187, 191, 97, 13, 10, 255, 0])
  const raw = await app.vault.createBinary('Notes/raw.bin', bytes.buffer)
  raw.stat.size = bytes.byteLength
  await app.vault.createBinary('Notes/empty.bin', new ArrayBuffer(0))
  s.scopeResolver.addFile('Notes/raw.bin')
  s.scopeResolver.addFile('Notes/empty.bin')
  await tool(s).execute('sample', {
    path: 'sample.zip',
    files: [
      { path: 'Notes/sample.md' },
      { path: 'Notes/raw.bin', name: 'nested\\cafe\u0301.bin' },
      { path: 'Notes/raw.bin', name: 'copy.bin' },
      { path: 'Notes/empty.bin' },
    ],
  })
  const output = new Map<string, Uint8Array>()
  await extractArchive(new Uint8Array(await read('sample.zip')), 'Extracted', {
    write: async (p, b) => {
      output.set(p, b)
    },
  })
  expect(output.get('Extracted/nested/café.bin')).toEqual(bytes)
  expect(output.get('Extracted/copy.bin')).toEqual(bytes)
  expect(output.get('Extracted/Notes/sample.md')).toEqual(new TextEncoder().encode('sample\r\n'))
  expect(output.get('Extracted/Notes/empty.bin')).toEqual(new Uint8Array())
})
it.each([
  { path: '../sample.zip' },
  { path: 'sample.txt' },
  { path: 'sample#.zip' },
  { files: [] },
  { files: [{ path: 'Notes\\sample.md' }] },
  { files: [{ path: 'Notes/sample.md', name: '../escape' }] },
  {
    files: [
      { path: 'Notes/sample.md', name: 'a' },
      { path: 'Notes/sample.md', name: 'a/b' },
    ],
  },
  { overwrite: true },
  { files: [{ path: 'Notes/sample.md', other: true }] },
])('rejects invalid public requests before reads/mutations %j', async (patch) => {
  const s = session()
  const bytes = vi.spyOn(app.vault, 'readBinary')
  const create = vi.spyOn(app.vault, 'createBinary')
  await expect(tool(s).execute('sample', { ...request(), ...patch })).rejects.toThrow()
  expect(bytes).not.toHaveBeenCalled()
  expect(create).not.toHaveBeenCalled()
})
it.each([
  'scope',
  'revision',
  'rename',
  'replace',
  'owner',
  'conversation',
  'destroy',
  'permission',
  'stop',
] as const)(
  'rejects %s changes across a deferred read without final save/grant',
  async (change) => {
    const s = session()
    const gate = deferred<ArrayBuffer>()
    const controller = new AbortController()
    const source = app.vault.getAbstractFileByPath('Notes/sample.md') as TFile
    vi.spyOn(app.vault, 'readBinary').mockReturnValueOnce(gate.promise)
    const operation = tool(s).execute('sample', request(), controller.signal)
    await vi.waitFor(() => expect(app.vault.readBinary).toHaveBeenCalled())
    if (change === 'scope') s.scopeResolver.entries.value = []
    if (change === 'revision') source.stat.mtime++
    if (change === 'rename') await app.vault.rename(source, 'Private/moved.md')
    if (change === 'replace') {
      await app.vault.delete(source)
      await app.vault.create('Notes/sample.md', 'replacement')
    }
    if (change === 'owner') s.agentId.value = 'unbound'
    if (change === 'conversation') s.conversationVersion.value++
    if (change === 'destroy') s.destroy()
    if (change === 'permission') s.permissionMode.value = 'confirm-all'
    if (change === 'stop') controller.abort()
    gate.resolve(new Uint8Array([1]).buffer)
    await expect(operation).rejects.toThrow()
    expect(app.vault.getAbstractFileByPath('Exports')).toBeNull()
    expect(s.scopeResolver.isInScope('Exports/sample.zip')).toBe(false)
  }
)
it('snapshots caller arguments and does not rebind to a foreground chat', async () => {
  const owner = session()
  const visible = session()
  const gate = deferred<ArrayBuffer>()
  vi.spyOn(app.vault, 'readBinary').mockReturnValueOnce(gate.promise)
  const args = request('sample.zip')
  const operation = tool(owner).execute('sample', args)
  await vi.waitFor(() => expect(app.vault.readBinary).toHaveBeenCalled())
  args.path = 'other.zip'
  args.files[0].path = 'Private/hidden.md'
  ChatService.getInstance().activeTabId.value = visible.id
  gate.resolve(new TextEncoder().encode('sample\r\n').buffer)
  await operation
  expect(owner.scopeResolver.isInScope('sample.zip')).toBe(true)
  expect(visible.scopeResolver.isInScope('sample.zip')).toBe(false)
  expect(app.vault.getAbstractFileByPath('other.zip')).toBeNull()
})
it('checks sources after tracker preparation and does not read collision contents', async () => {
  const s = session()
  const tracker = ChangeTracker.install(app)
  const original = tracker.prepareCreate.bind(tracker)
  vi.spyOn(tracker, 'prepareCreate').mockImplementation((path, kind, validate) =>
    original(path, kind, () => {
      s.permissionMode.value = 'confirm-all'
      validate()
    })
  )
  await expect(tool(s).execute('sample', request('sample.zip'))).rejects.toThrow(
    /approval|permitted/
  )
  expect(app.vault.getAbstractFileByPath('sample.zip')).toBeNull()
  vi.restoreAllMocks()
  s.permissionMode.value = 'allow-edit'
  await app.vault.createBinary('sample.zip', new Uint8Array([9]).buffer)
  const bytes = vi.spyOn(app.vault, 'readBinary')
  await expect(tool(s).execute('sample', request('sample.zip'))).rejects.toThrow(/exists/)
  expect(bytes).not.toHaveBeenCalled()
})
it('reports saved creation honestly when stopped in flight, but grants nothing on native rejection', async () => {
  const s = session()
  const native = app.vault.createBinary.bind(app.vault)
  const controller = new AbortController()
  vi.spyOn(app.vault, 'createBinary').mockImplementationOnce(async (...args) => {
    controller.abort()
    return native(...args)
  })
  const result = await tool(s).execute('sample', request('sample.zip'), controller.signal)
  expect(result.details).toMatchObject({ path: 'sample.zip' })
  expect(s.scopeResolver.isInScope('sample.zip')).toBe(true)
  vi.spyOn(app.vault, 'createBinary').mockRejectedValueOnce(new Error('Sample disk failure'))
  await expect(tool(s).execute('second', request('failed.zip'))).rejects.toThrow(/issued|failure/)
  expect(s.scopeResolver.isInScope('failed.zip')).toBe(false)
})
it('applies unattended permission admission and delegated ceilings without source or parent grants', async () => {
  const parent = session()
  const run = session('allow-all', 'run')
  boundRunToParent(run, parent)
  run.scopeResolver.setFullVaultAccess(true)
  expect(subAgentRefusal('zip', request(), run.agent.value!, run.scopeResolver)).toBeNull()
  run.agent.value!.permissionMode = 'confirm-all'
  expect(subAgentRefusal('zip', request(), run.agent.value!, run.scopeResolver)).toMatch(/approval/)
  run.permissionMode.value = 'allow-edit'
  await tool(run).execute('sample', request('sample.zip'))
  expect(parent.scopeResolver.isInScope('sample.zip')).toBe(false)
  expect(run.scopeResolver.isInScope('sample.zip')).toBe(false) // ceiling remains
  await expect(
    tool(run).execute('denied', { path: 'denied.zip', files: [{ path: 'Private/hidden.md' }] })
  ).rejects.toThrow(/scope/)
})
