import { afterEach, describe, expect, it, vi } from 'vitest'
import { GlobalStore } from '@/stores/GlobalStore'
import { DebuggerService } from '@/debugger/DebuggerService'
import { defaultProgram, openFilesOf, startProgram } from '@/debugger/startProgram'
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
  return {
    getViewState: () => ({ type: NODE_FILE_VIEW, state: { kind: 'file', target: t, path } }),
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
    connection: { client: { request }, connect: async () => {} },
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
      ['s1', { path: 'src/page.js', debugSessionId: 'child-1', incarnation: 'i-child' }],
      ['s2', { path: 'src/service.js', debugSessionId: 'child-1', incarnation: 'i-child' }],
    ])
  })
})
