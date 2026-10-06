import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFindTool } from '@/ai/tools/FindTool'
import { ScopeResolver } from '@/ai/ScopeResolver'
import { GlobalStore } from '@/stores/GlobalStore'
import { buildFakeVault, type FakeFileSpec } from '../helpers/fakeVault'

const scopes: ScopeResolver[] = []
afterEach(() => {
  scopes.splice(0).forEach((scope) => scope.destroy())
  vi.restoreAllMocks()
})
function setup(specs: FakeFileSpec[]) {
  const app = buildFakeVault(specs)
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = app
  const scope = new ScopeResolver()
  scope.setFullVaultAccess(true)
  scopes.push(scope)
  return { app, scope, ctx: { scope, interactive: false } }
}
const query = { criteria: [{ type: 'content', operator: 'contains', value: 'needle' }] }
const many = () =>
  Array.from({ length: 2000 }, (_, i) => ({ path: `Sample-${i}.md`, content: 'needle' }))

describe('find cancellation and matching', () => {
  it('does no work for an already cancelled call', async () => {
    const { app, ctx } = setup(many())
    const stop = new AbortController()
    stop.abort()
    await expect(createFindTool().execute('find', query, stop.signal, ctx)).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(app.stats.read).toBe(0)
    expect(app.stats.getFiles).toBe(0)
  })

  it('stops immediately during an outstanding read batch and never schedules the rest', async () => {
    const { app, ctx } = setup(many())
    const stop = new AbortController()
    const pending: ((text: string) => void)[] = []
    let notifyRead: () => void
    const firstRead = new Promise<void>((resolve) => {
      notifyRead = resolve
    })
    const read = vi.spyOn(app.vault, 'cachedRead').mockImplementation(() => {
      notifyRead()
      return stop.signal.aborted
        ? Promise.resolve('needle')
        : new Promise((resolve) => pending.push(resolve))
    })
    const result = createFindTool().execute('find', query, stop.signal, ctx)
    const outcome = result.then(
      () => 'completed',
      (error: unknown) => error
    )
    await firstRead
    const started = read.mock.calls.length
    expect(started).toBeGreaterThan(0)
    expect(started).toBeLessThanOrEqual(64)
    stop.abort()
    try {
      const immediate = await Promise.race([
        outcome,
        new Promise((resolve) => setTimeout(() => resolve('still waiting'), 0)),
      ])
      expect(immediate).toMatchObject({ name: 'AbortError' })
    } finally {
      pending.forEach((resolve) => resolve('needle'))
      await outcome
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(read).toHaveBeenCalledTimes(started)
  })

  it.each([false, true])('yields to timers during %s content searches', async (content) => {
    const { app, ctx } = setup(many())
    const stop = new AbortController()
    let atStop = -1
    let timer: ReturnType<typeof setTimeout>
    const scheduleStop = () =>
      setTimeout(() => {
        atStop = content ? app.stats.read : app.stats.getAbstractFileByPath
        stop.abort()
      }, 0)
    if (content) {
      const read = app.vault.cachedRead.bind(app.vault)
      vi.spyOn(app.vault, 'cachedRead').mockImplementation((file) => {
        if (app.stats.read === 0) timer = scheduleStop()
        return read(file)
      })
    } else {
      timer = scheduleStop()
    }
    try {
      await expect(
        createFindTool().execute(
          'find',
          content
            ? query
            : {
                criteria: [{ type: 'property', operator: 'exists', property: 'type' }],
              },
          stop.signal,
          ctx
        )
      ).rejects.toMatchObject({ name: 'AbortError' })
      expect(atStop).toBeGreaterThan(0)
      expect(atStop).toBeLessThan(2000)
    } finally {
      clearTimeout(timer!)
    }
  })

  it('does not read rejected metadata candidates or match frontmatter as content', async () => {
    const { app, ctx } = setup([
      { path: 'Notes/A.md', frontmatter: { type: 'task', marker: 'needle' }, content: 'absent' },
      { path: 'Notes/B.md', frontmatter: { type: 'task' }, content: 'needle' },
      { path: 'Notes/C.md', frontmatter: { type: 'note' }, content: 'needle' },
      { path: 'Archive/D.md', frontmatter: { type: 'task' }, content: 'needle' },
    ])
    const result = await createFindTool().execute(
      'find',
      {
        criteria: [
          query.criteria[0],
          { type: 'property', operator: 'equals', property: 'type', value: 'task' },
          { type: 'path', operator: 'startsWith', value: 'Notes/' },
        ],
      },
      undefined,
      ctx
    )
    expect(result.content[0].text).toBe('1 files:\nNotes/B.md')
    expect(app.stats.read).toBe(2)
  })

  it('only reads the calling scope, including its delegation ceiling', async () => {
    const { app, scope, ctx } = setup([
      { path: 'Allowed.md', content: 'needle' },
      { path: 'Other.md', content: 'needle' },
    ])
    const ceiling = new ScopeResolver()
    scopes.push(ceiling)
    ceiling.addFile('Allowed.md')
    scope.setCeiling(ceiling)
    expect((await createFindTool().execute('find', query, undefined, ctx)).content[0].text).toBe(
      '1 files:\nAllowed.md'
    )
    expect(app.stats.read).toBe(1)
  })
})
