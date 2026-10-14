import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { DebuggerService } from '@/debugger/DebuggerService'
import { ProgramPicker, defaultProgram, openFilesOf, startProgram } from '@/debugger/startProgram'
import { NODE_FILE_VIEW } from '@/node/nodePathNavigation'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { PathTarget } from '@/node/NodePathModel'

const target: PathTarget = {
  nodeId: 'node-a',
  registrationId: 'reg-a',
  projectId: 'project-a',
  kind: 'workspace',
  id: 'workspace-a',
  incarnation: 'inc-a',
}

function fileLeaf(path: string, t: PathTarget = target) {
  let state: Record<string, unknown> = { kind: 'file', target: t, path }
  return {
    getViewState: () => ({ type: NODE_FILE_VIEW, state }),
    setViewState: vi.fn(async (v: { state: Record<string, unknown> }) => {
      state = v.state
    }),
  }
}

function fakeWorkspace(leaves: ReturnType<typeof fileLeaf>[] = []) {
  const opened: unknown[] = []
  const tab = { setViewState: vi.fn(async (s: unknown) => void opened.push(s)) }
  const workspace = {
    getMostRecentLeaf: () => leaves[1] ?? leaves[0] ?? null,
    getLeavesOfType: (type: string) => (type === NODE_FILE_VIEW ? [...leaves] : []),
    getLeaf: () => tab,
    revealLeaf: vi.fn(async () => {}),
    leftSplit: { collapse: vi.fn() },
  }
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = { workspace }
  return { workspace, opened }
}

function fakePresenter() {
  const calls: [string, any][] = []
  const request = vi.fn(async (method: string, params: any) => {
    calls.push([method, params])
    switch (method) {
      case 'debugger.v1.start':
        // The node answers with the session the program's code runs in.
        return {
          debug_session_id: 'child-1',
          sources: [
            { source_id: 's1', path: 'src/page.js' },
            { source_id: 's2', path: 'src/service.js' },
          ],
        }
      case 'debugger.v1.sessions':
        return [
          { debug_session_id: 'root-1', incarnation: 'i-root', target: { target_id: 't-1' } },
          {
            debug_session_id: 'child-1',
            incarnation: 'i-child',
            target: { target_id: 't-1:child:1' },
          },
        ]
      case 'debugger.v1.status':
        return {
          snapshot: { incarnation: params.debug_session_id === 'child-1' ? 'i-child' : 'x' },
        }
    }
    throw new Error(`unexpected ${method}`)
  })
  const presenter = {
    connection: { client: { request }, connect: async () => {}, state: ref('connected') },
    reference: { sessionId: 'chat-a', registrationId: 'reg-a', nodeId: 'node-a' },
  } as unknown as NodeChatPresenter
  return { presenter, calls }
}

afterEach(() => DebuggerService.instance.destroy())

describe('running a program under the debugger', () => {
  it('offers the JavaScript files open from the chat’s folder, the active one first', () => {
    const { workspace } = fakeWorkspace([
      fileLeaf('src/service.js'),
      fileLeaf('src/page.js'),
      fileLeaf('README.md'),
      fileLeaf('src/other.js', { ...target, id: 'workspace-b' }),
    ])
    expect(openFilesOf(workspace as never, target)).toEqual(['src/page.js', 'src/service.js'])
  })

  it('takes TypeScript open beside the build as sources, and runs only JavaScript', () => {
    const { workspace } = fakeWorkspace([
      fileLeaf('dist/total.js'),
      fileLeaf('src/total.ts'),
      fileLeaf('src/view.tsx'),
    ])
    const open = openFilesOf(workspace as never, target)
    expect(open).toEqual(['src/total.ts', 'dist/total.js', 'src/view.tsx'])
    expect(defaultProgram(open)).toBe('dist/total.js')
    expect(defaultProgram(['src/total.ts'])).toBe('')
  })

  it('offers a typed path to run on top of the open files, once', () => {
    const offered = [
      { id: 'src/page.js', icon: 'file-code', kind: 'Open in a tab', title: 'src/page.js' },
    ]
    const picker = new ProgramPicker({} as never, offered, 'program', () => {})
    expect(picker.getSuggestions('').map((i) => i.title)).toEqual(['src/page.js'])
    expect(picker.getSuggestions('src/main.js').map((i) => [i.icon, i.title])).toEqual([
      ['play', 'src/main.js'],
    ])
    expect(picker.getSuggestions('src/page.js').map((i) => i.title)).toEqual(['src/page.js'])
  })

  it('leaves Restart in the panel the same program again, with the same files', async () => {
    fakeWorkspace()
    const { presenter, calls } = fakePresenter()
    await startProgram(presenter, 'src/page.js', ['src/service.js'], target, async () => {})
    const binding = DebuggerService.instance.binding(presenter)
    expect(binding.rerun).toBeTypeOf('function')
    await binding.rerun!()
    const starts = calls.filter(([m]) => m === 'debugger.v1.start').map(([, p]) => p)
    expect(starts).toHaveLength(2)
    expect(starts[1]).toEqual(
      expect.objectContaining({ program: 'src/page.js', sources: ['src/service.js'] })
    )
  })

  it('starts it, shows the session its code runs in and opens its file with the margin', async () => {
    const { opened } = fakeWorkspace()
    const { presenter, calls } = fakePresenter()
    const show = vi.fn(async () => {})
    const id = await startProgram(
      presenter,
      'src/page.js',
      ['src/page.js', 'src/service.js'],
      target,
      show
    )
    expect(id).toBe('child-1')
    expect(calls[0]).toEqual([
      'debugger.v1.start',
      expect.objectContaining({
        conversation_id: 'chat-a',
        program: 'src/page.js',
        argv: [],
        sources: ['src/service.js'],
      }),
    ])
    expect(show).toHaveBeenCalledWith('child-1')
    expect(calls.map(([m]) => m)).not.toContain('debugger.v1.sessions')
    expect(opened).toEqual([
      {
        type: NODE_FILE_VIEW,
        active: true,
        state: {
          kind: 'file',
          target,
          path: 'src/page.js',
          debug: {
            conversationId: 'chat-a',
            sourceId: 's1',
            debugSessionId: 'child-1',
            incarnation: 'i-child',
          },
        },
      },
    ])
    const sources = DebuggerService.instance.sources.get(JSON.stringify(['reg-a', 'chat-a']))
    expect([...(sources?.entries() ?? [])]).toEqual([
      [
        's1',
        { path: 'src/page.js', debugSessionId: 'child-1', incarnation: 'i-child', folder: target },
      ],
      [
        's2',
        {
          path: 'src/service.js',
          debugSessionId: 'child-1',
          incarnation: 'i-child',
          folder: target,
        },
      ],
    ])
  })
})

describe('files already open when the program starts', () => {
  it('take its margin too, mapped to the sources the node took', async () => {
    const service = fileLeaf('src/service.js')
    const other = fileLeaf('src/service.js', { ...target, id: 'workspace-b' })
    fakeWorkspace([service, other])
    const { presenter } = fakePresenter()
    await startProgram(presenter, 'src/page.js', ['src/service.js'], target, async () => {})
    expect(service.setViewState).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NODE_FILE_VIEW,
        state: expect.objectContaining({
          path: 'src/service.js',
          debug: {
            conversationId: 'chat-a',
            sourceId: 's2',
            debugSessionId: 'child-1',
            incarnation: 'i-child',
          },
        }),
      })
    )
    expect(other.setViewState).not.toHaveBeenCalled()
  })
})

describe('the files a program took', () => {
  it('keep their margin in the folder they came from, whichever way a tab comes to show them', async () => {
    const { debuggerSnapshot } = await import('../fixtures/debugger')
    const { ref } = await import('vue')
    const service = DebuggerService.instance
    const presenter = {
      connection: { state: ref('connected'), client: { request: vi.fn() } },
      reference: { sessionId: 'chat-a', registrationId: 'reg-a', nodeId: 'node-a' },
    } as unknown as NodeChatPresenter
    const binding = service.binding(presenter)
    binding.controller.observe({ observation: 'current', snapshot: debuggerSnapshot() })
    service.registerSource(
      'reg-a',
      'chat-a',
      's2',
      'src/total.ts',
      'sample-debug',
      'sample-incarnation',
      target
    )
    expect(service.debugFor(target, 'src/total.ts')).toEqual({
      conversationId: 'chat-a',
      sourceId: 's2',
      debugSessionId: 'sample-debug',
      incarnation: 'sample-incarnation',
    })
    expect(service.debugFor({ ...target, id: 'workspace-b' }, 'src/total.ts')).toBeUndefined()
    expect(service.debugFor(target, 'src/other.ts')).toBeUndefined()
    // A tab that shows it and moves on leaves the program's mapping in place.
    const shown = service.registerSource(
      'reg-a',
      'chat-a',
      's2',
      'src/total.ts',
      'sample-debug',
      'sample-incarnation'
    )
    shown()
    expect(service.debugFor(target, 'src/total.ts')?.sourceId).toBe('s2')
  })
})
