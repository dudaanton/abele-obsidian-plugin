import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { DebuggerService } from '@/debugger/DebuggerService'
import {
  ProgramPicker,
  carriedPoints,
  defaultProgram,
  openFilesOf,
  startProgram,
} from '@/debugger/startProgram'
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

it('discovers retained sessions after an uncertain launch without replaying start', async () => {
  fakeWorkspace()
  const { presenter } = fakePresenter()
  vi.mocked(presenter.connection.client.request).mockRejectedValueOnce(new Error('request_timeout'))
  const discover = vi.spyOn(DebuggerService.instance, 'discover').mockResolvedValue(undefined)
  try {
    await expect(
      startProgram(presenter, 'src/page.js', [], target, async () => {})
    ).rejects.toThrow('request_timeout')
    expect(discover).toHaveBeenCalledWith(presenter)
    expect(presenter.connection.client.request).toHaveBeenCalledTimes(1)
  } finally {
    discover.mockRestore()
  }
})

it('keeps a confirmed launch visible when reading its source metadata fails', async () => {
  fakeWorkspace()
  const { presenter } = fakePresenter()
  const request = vi.mocked(presenter.connection.client.request).getMockImplementation()!
  vi.spyOn(presenter.connection.client, 'request').mockImplementation(async (method, params) => {
    if (method === 'debugger.v1.status') throw new Error('request_timeout')
    return request(method, params)
  })
  const show = vi.fn(async () => {})
  await expect(startProgram(presenter, 'src/page.js', [], target, show)).resolves.toBe('child-1')
  expect(show).toHaveBeenCalledWith('child-1')
})

it.each([true, false])('sends stop-at-start only to supporting nodes: %s', async (supported) => {
  fakeWorkspace()
  const { presenter, calls } = fakePresenter()
  Object.assign(presenter.connection.client, {
    describe: async () => ({
      capabilities: {
        capabilities: { debugger_v1: { status: 'supported', launch_stop_on_entry: supported } },
      },
    }),
  })
  await startProgram(presenter, 'src/page.js', [], target, async () => {}, [], [], {
    stopOnEntry: false,
  })
  const params = calls.find(([method]) => method === 'debugger.v1.start')![1]
  if (supported) expect(params.stop_on_entry).toBe(false)
  else expect(params).not.toHaveProperty('stop_on_entry')
})

it('carries the log message and disabled state on restart', () => {
  const binding = {
    controller: {
      knownBreakpoints: () => [
        {
          file: 'src/sample.js',
          requestedLine: 8,
          condition: 'n < 4',
          log_message: 'sample {n}',
          enabled: false,
        },
      ],
    },
  }
  expect(carriedPoints(binding as never)).toEqual([
    {
      path: 'src/sample.js',
      line: 8,
      condition: 'n < 4',
      log_message: 'sample {n}',
      enabled: false,
    },
  ])
})

describe('running a program under the debugger', () => {
  it('opens the mapped entry source rather than the ignored build file', async () => {
    const { opened } = fakeWorkspace()
    const { presenter } = fakePresenter()
    await startProgram(
      presenter,
      'dist/service.js',
      ['src/service.js'],
      target,
      async () => {},
      [],
      [],
      { source: 'src/service.js' }
    )
    expect(opened).toEqual([
      expect.objectContaining({
        state: expect.objectContaining({ path: 'src/service.js' }),
      }),
    ])
  })
  it('passes arguments to the node and retains them on Restart', async () => {
    fakeWorkspace()
    const { presenter, calls } = fakePresenter()
    await startProgram(
      presenter,
      'dist/entry.js',
      [],
      target,
      async () => {},
      [],
      ['order', '--count', '2']
    )
    const binding = DebuggerService.instance.binding(presenter)
    vi.spyOn(binding.controller, 'current', 'get').mockReturnValue(true)
    binding.controller.session.status = 'exited'
    await binding.rerun!()
    const starts = calls.filter(([method]) => method === 'debugger.v1.start')
    expect(starts.map(([, p]) => p.argv)).toEqual([
      ['order', '--count', '2'],
      ['order', '--count', '2'],
    ])
  })
  it('includes a later-admitted file without points in the restarted program', async () => {
    fakeWorkspace()
    const { presenter, calls } = fakePresenter()
    const service = DebuggerService.instance
    await startProgram(presenter, 'src/page.js', [], target, async () => {})
    const binding = service.binding(presenter)
    binding.controller.snapshot = { debug_session_id: 'child-1', incarnation: 'i-child' } as never
    vi.spyOn(binding.controller, 'current', 'get').mockReturnValue(true)
    binding.controller.session.status = 'exited'
    service.registerSource(
      'reg-a',
      'chat-a',
      'sample-later',
      'src/later.js',
      'child-1',
      'i-child',
      target
    )
    await binding.rerun!()
    expect(calls.filter(([method]) => method === 'debugger.v1.start')[1][1].sources).toContain(
      'src/later.js'
    )
  })
  it('admits the source before offering debugger controls so late admission cannot replace a selected line', async () => {
    const { opened } = fakeWorkspace()
    const { presenter } = fakePresenter()
    await startProgram(presenter, 'src/page.js', [], target, async () => {
      expect(opened).toHaveLength(1)
    })
    expect(opened).toHaveLength(1)
  })
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
    // The UI host normally opens the session; this test's show callback is inert.
    vi.spyOn(binding.controller, 'current', 'get').mockReturnValue(true)
    binding.controller.session.status = 'exited'
    await binding.rerun!()
    const starts = calls.filter(([m]) => m === 'debugger.v1.start').map(([, p]) => p)
    expect(starts).toHaveLength(2)
    expect(starts[1]).toEqual(
      expect.objectContaining({ program: 'src/page.js', sources: ['src/service.js'] })
    )
  })

  it('does not launch a second program when the first stop is unconfirmed', async () => {
    fakeWorkspace()
    const { presenter, calls } = fakePresenter()
    await startProgram(presenter, 'src/page.js', [], target, async () => {})
    const binding = DebuggerService.instance.binding(presenter)
    vi.spyOn(binding.controller, 'current', 'get').mockReturnValue(true)
    binding.controller.session.status = 'running'
    vi.spyOn(binding.controller, 'command').mockResolvedValue(undefined)
    await expect(binding.rerun!()).rejects.toThrow('previous program has not stopped')
    expect(calls.filter(([m]) => m === 'debugger.v1.start')).toHaveLength(1)
  })

  it('refreshes a lost observation before stopping and restarting', async () => {
    fakeWorkspace()
    const { presenter, calls } = fakePresenter()
    await startProgram(presenter, 'src/page.js', [], target, async () => {})
    const binding = DebuggerService.instance.binding(presenter)
    binding.controller.snapshot = { debug_session_id: 'old-session' } as never
    let current = false
    vi.spyOn(binding.controller, 'current', 'get').mockImplementation(() => current)
    binding.controller.session.status = 'lost'
    const order: string[] = []
    vi.spyOn(presenter.connection, 'connect').mockImplementation(async () => {
      order.push('connect')
    })
    vi.spyOn(binding, 'open').mockImplementation(async () => {
      order.push('refresh')
      current = true
      binding.controller.session.status = 'running'
    })
    vi.spyOn(binding.controller, 'command').mockImplementation(async () => {
      order.push('stop')
      binding.controller.session.status = 'exited'
    })
    await binding.rerun!()
    expect(order).toEqual(['connect', 'refresh', 'stop'])
    expect(calls.filter(([m]) => m === 'debugger.v1.start')).toHaveLength(2)
  })

  it('stops the program still going on Restart and carries its breakpoints and record points to the new run', async () => {
    fakeWorkspace()
    const { presenter, calls } = fakePresenter()
    await startProgram(presenter, 'src/page.js', [], target, async () => {})
    const binding = DebuggerService.instance.binding(presenter)
    const order: string[] = []
    vi.spyOn(binding.controller, 'knownBreakpoints').mockReturnValue([
      {
        id: 'b-stop',
        sourceId: 'old-1',
        file: 'src/page.js',
        line: 9,
        requestedLine: 8,
        state: 'set',
        condition: 'n > 1',
        log_message: 'sample {n}',
        enabled: false,
      },
      {
        id: 'b-rec',
        enabled: false,
        sourceId: 'old-2',
        file: 'src/service.js',
        line: 4,
        requestedLine: 4,
        state: 'set',
      },
    ] as never)
    Object.defineProperty(binding.controller, 'session', { value: { status: 'paused' } })
    vi.spyOn(binding.controller, 'current', 'get').mockReturnValue(true)
    vi.spyOn(binding.controller, 'command').mockImplementation(async (a: string) => {
      order.push(a)
      binding.controller.session.status = 'exited'
      return undefined as never
    })
    const setBreakpoint = vi
      .spyOn(binding.controller, 'setBreakpoint')
      .mockImplementation(async () => undefined as never)
    const savePoint = vi.fn(async () => {})
    binding.trace = {
      points: [{ breakpoint_id: 'b-rec', take: ['sum'], note: 'the running total' }],
      savePoint,
      dispose: () => {},
    } as never
    await binding.rerun!()
    expect(order).toEqual(['stop'])
    const starts = calls.filter(([m]) => m === 'debugger.v1.start').map(([, p]) => p)
    // The file a point stands in is taken by the new run even when no tab shows it.
    expect(starts[1].sources).toEqual(['src/service.js'])
    expect(setBreakpoint).toHaveBeenCalledWith(expect.any(String), 's1', 8, 'n > 1', {
      log_message: 'sample {n}',
      enabled: false,
    })
    expect(savePoint).toHaveBeenCalledWith('s2', 4, {
      take: ['sum'],
      note: 'the running total',
      enabled: false,
    })
    // Record metadata must be installed before its breakpoint, by savePoint.
    expect(setBreakpoint).toHaveBeenCalledTimes(1)
  })

  it('carries the points only once the new run is held, so they name the state it stopped in', async () => {
    fakeWorkspace()
    const { presenter } = fakePresenter()
    const binding = DebuggerService.instance.binding(presenter)
    const setBreakpoint = vi
      .spyOn(binding.controller, 'setBreakpoint')
      .mockImplementation(async () => undefined as never)
    // The node answers the start before the program's first-line stop has reached the panel.
    binding.controller.session.status = 'starting'
    const started = startProgram(presenter, 'src/page.js', [], target, async () => {}, [
      { path: 'src/page.js', line: 3 },
    ])
    for (let i = 0; i < 20; i++) await Promise.resolve()
    await new Promise((r) => setTimeout(r, 20))
    expect(setBreakpoint).not.toHaveBeenCalled()
    binding.controller.session.status = 'paused'
    ++binding.revision.value
    await started
    expect(setBreakpoint).toHaveBeenCalledWith(expect.any(String), 's1', 3, undefined)
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
