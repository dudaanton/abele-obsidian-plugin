import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { SuggestModal } from 'obsidian'
import { GlobalStore } from '@/stores/GlobalStore'
import { DebuggerService } from '@/debugger/DebuggerService'
import {
  NOTHING_WAITS,
  askAndAttachProgram,
  attachToProgram,
  programSuggestions,
  type WaitingProgram,
} from '@/debugger/attachProgram'
import { NodeSuggestModal } from '@/components/nodeWork/NodeSuggestModal'
import { NODE_FILE_VIEW } from '@/node/nodePathNavigation'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { PathTarget } from '@/node/NodePathModel'

vi.mock('@/modal/confirm', () => ({ confirmAction: vi.fn(async () => false) }))
import { confirmAction } from '@/modal/confirm'

const target: PathTarget = {
  nodeId: 'node-a',
  registrationId: 'reg-a',
  projectId: 'project-a',
  kind: 'workspace',
  id: 'workspace-a',
}

const inFolder: WaitingProgram = {
  pid: 4101,
  port: 9229,
  command: 'node --inspect src/server.js',
  cwd: '/work/sample-app',
  script: '/work/sample-app/src/server.js',
  project: { project_id: 'project-a', path: '/work/sample-app' },
  in_chat_folder: true,
}
const elsewhere: WaitingProgram = {
  pid: 4202,
  port: 9230,
  command: 'node --inspect-brk tool.js',
  cwd: '/work/other-tool',
  script: '/work/other-tool/tool.js',
  project: null,
  in_chat_folder: false,
}

function fileLeaf(path: string) {
  let state: Record<string, unknown> = { kind: 'file', target, path }
  return {
    getViewState: () => ({ type: NODE_FILE_VIEW, state }),
    setViewState: vi.fn(async (v: { state: Record<string, unknown> }) => {
      state = v.state
    }),
  }
}

function fakeWorkspace(leaves: ReturnType<typeof fileLeaf>[] = []) {
  const opened: any[] = []
  const tab = { setViewState: vi.fn(async (s: unknown) => void opened.push(s)) }
  const workspace = {
    getMostRecentLeaf: () => leaves[0] ?? null,
    getLeavesOfType: (type: string) => (type === NODE_FILE_VIEW ? [...leaves] : []),
    getLeaf: () => tab,
    revealLeaf: vi.fn(async () => {}),
    leftSplit: { collapse: vi.fn() },
  }
  ;(GlobalStore.getInstance() as unknown as { _app: unknown })._app = { workspace }
  return { workspace, opened }
}

function fakePresenter(programs: WaitingProgram[] = []) {
  const calls: [string, any][] = []
  const request = vi.fn(async (method: string, params: any) => {
    calls.push([method, params])
    switch (method) {
      case 'chat.binding':
      case 'session.binding':
        break
      case 'debugger.v1.programs':
        return { programs }
      case 'debugger.v1.attachProgram':
        return {
          debug_session_id: 'child-9',
          sources: params.outside_folder
            ? []
            : [
                { source_id: 's1', path: 'src/server.js' },
                { source_id: 's2', path: 'src/routes.js' },
              ],
        }
      case 'debugger.v1.status':
        return { snapshot: { incarnation: 'i-9' } }
    }
    throw new Error(`unexpected ${method}`)
  })
  const presenter = {
    connection: { client: { request }, connect: async () => {}, state: ref('connected') },
    reference: { sessionId: 'chat-a', registrationId: 'reg-a', nodeId: 'node-a' },
  } as unknown as NodeChatPresenter
  return { presenter, calls }
}

vi.mock('@/node/expectedTarget', () => ({
  readChatBinding: vi.fn(async () => ({
    project_id: 'project-a',
    target: { kind: 'workspace', workspace_id: 'workspace-a' },
  })),
}))

afterEach(() => {
  DebuggerService.instance.destroy()
  vi.mocked(confirmAction).mockClear()
  vi.restoreAllMocks()
})

describe('attaching the debugger to a running program', () => {
  it('lists each program by its command, where it runs, its process and its port', () => {
    expect(programSuggestions([inFolder, elsewhere])).toEqual([
      {
        id: '4101:9229',
        icon: 'plug',
        kind: "Runs from this chat's folder",
        title: 'node --inspect src/server.js',
        note: "This chat's folder · pid 4101 · port 9229",
      },
      {
        id: '4202:9230',
        icon: 'folder-output',
        kind: "Runs outside this chat's folder: attaching asks first",
        title: 'node --inspect-brk tool.js',
        note: '/work/other-tool · pid 4202 · port 9230',
      },
    ])
    expect(
      programSuggestions([{ ...elsewhere, project: { project_id: 'p', path: '/work/kit' } }])[0]!
        .note
    ).toBe('Project kit · pid 4202 · port 9230')
  })

  it('says how to start a program that waits for a debugger when none does', async () => {
    fakeWorkspace()
    const { presenter } = fakePresenter([])
    const opened = vi.spyOn(SuggestModal.prototype, 'open')
    await askAndAttachProgram(presenter, async () => {})
    const picker = opened.mock.contexts.at(-1) as NodeSuggestModal
    expect(picker).toBeInstanceOf(NodeSuggestModal)
    expect(picker.getSuggestions('')).toEqual([])
    expect(picker.emptyStateText).toBe(NOTHING_WAITS)
    expect(NOTHING_WAITS).toContain('node --inspect app.js')
  })

  it('attaches with the files open from the folder and opens the program’s own file', async () => {
    const routes = fileLeaf('src/routes.js')
    fakeWorkspace([routes])
    const { presenter, calls } = fakePresenter([inFolder])
    const show = vi.fn(async () => {})
    await attachToProgram(presenter, inFolder, show)
    const attach = calls.find(([m]) => m === 'debugger.v1.attachProgram')![1]
    expect(attach).toMatchObject({
      conversation_id: 'chat-a',
      pid: 4101,
      port: 9229,
      sources: ['src/routes.js'],
      outside_folder: false,
    })
    expect(show).toHaveBeenCalledWith('child-9')
    // Nothing to restart: the node did not start it.
    expect(DebuggerService.instance.binding(presenter).rerun).toBeUndefined()
    // The one file tab of the folder shows the program's own file, with its margin.
    expect(routes.getViewState().state).toMatchObject({
      path: 'src/server.js',
      debug: { sourceId: 's1', debugSessionId: 'child-9', incarnation: 'i-9' },
    })
  })

  it('asks before attaching to a program outside the chat’s folder, and not otherwise', async () => {
    fakeWorkspace()
    const { presenter, calls } = fakePresenter([inFolder, elsewhere])
    const opened = vi.spyOn(SuggestModal.prototype, 'open')
    await askAndAttachProgram(presenter, async () => {})
    const picker = opened.mock.contexts.at(-1) as NodeSuggestModal
    const [mine, other] = picker.getSuggestions('')
    const attaches = () => calls.filter(([m]) => m === 'debugger.v1.attachProgram')

    vi.mocked(confirmAction).mockResolvedValueOnce(false)
    picker.onChooseSuggestion(other!)
    await vi.waitFor(() => expect(confirmAction).toHaveBeenCalledTimes(1))
    expect(vi.mocked(confirmAction).mock.calls[0]![1]).toMatchObject({ confirmText: 'Attach' })
    await new Promise((r) => setTimeout(r, 0))
    expect(attaches()).toHaveLength(0)

    vi.mocked(confirmAction).mockResolvedValueOnce(true)
    picker.onChooseSuggestion(other!)
    await vi.waitFor(() => expect(attaches()).toHaveLength(1))
    expect(attaches()[0]![1]).toMatchObject({ pid: 4202, outside_folder: true })

    picker.onChooseSuggestion(mine!)
    await vi.waitFor(() => expect(attaches()).toHaveLength(2))
    expect(confirmAction).toHaveBeenCalledTimes(2)
    expect(attaches()[1]![1]).toMatchObject({ pid: 4101, outside_folder: false })
  })
})
