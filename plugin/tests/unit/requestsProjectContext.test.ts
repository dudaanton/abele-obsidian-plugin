import { expect, it, vi } from 'vitest'
const saved = vi.hoisted(() => new Map<string, unknown>())
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({
      app: {
        loadLocalStorage: (key: string) => saved.get(key),
        saveLocalStorage: (key: string, value: unknown) => saved.set(key, value),
      },
    }),
  },
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      nodes: { value: [{ id: 'node-1' }] },
    }),
  },
}))
vi.mock('@/debugger/DebuggerService', () => ({
  DebuggerService: {
    instance: {
      active: {
        value: {
          registrationId: 'node-1',
          controller: {
            snapshot: { target: { project_id: 'debug-project' } },
          },
        },
      },
    },
  },
}))
import { distinctProjects, projectOfTab, serverAddress } from '@/requests/projectContext'
import { RequestsService } from '@/requests/RequestsService'

it('selects the open project before the remembered one, with debugger as fallback', () => {
  RequestsService.destroy()
  const service = RequestsService.instance()
  vi.spyOn(service, 'contexts').mockResolvedValue([])
  service.choose({ registrationId: 'node-1', projectId: 'old-project' })
  service.chooseOpenProject({ target: { registrationId: 'node-1', projectId: 'open-project' } })
  expect(service.context.value?.projectId).toBe('open-project')
  service.chooseOpenProject({ file: 'sample.md' })
  expect(service.context.value?.projectId).toBe('debug-project')
  RequestsService.destroy()
})

it('uses the open node file project or request project', () => {
  const target = { registrationId: 'node-1', projectId: 'project-1' }
  expect(projectOfTab({ target, path: 'sample.js' })).toEqual(target)
  expect(projectOfTab({ ...target, id: 'Samples/Read.http' })).toEqual(target)
  expect(projectOfTab({ file: 'sample.md' })).toBeUndefined()
})

it('removes repeated projects and distinguishes projects with identical display names', () => {
  const first = { registrationId: 'node-1', projectId: 'project-1', label: 'sample', node: 'Node' }
  const second = { ...first, projectId: 'project-2' }
  const choices = distinctProjects([first, first, second])
  expect(choices).toHaveLength(2)
  expect(choices[0]!.label).not.toEqual(choices[1]!.label)
})

it('offers the last local server address printed by the program', () => {
  expect(serverAddress('Listening http://localhost:4567/ready')).toBe('http://localhost:4567')
  expect(serverAddress('Listening on a port')).toBeUndefined()
  expect(serverAddress('http://localhost:99999/')).toBeUndefined()
})

it('keeps the exact worktree of a current node repository file', () => {
  expect(
    projectOfTab({
      sourceTarget: {
        provider: 'node',
        source: {
          provider: 'node',
          installation: 'sample-installation',
          node: 'node-1',
          project: 'project-1',
          workspace: 'sample-copy',
        },
        location: { kind: 'file', ref: 'Working tree', path: 'sample.http' },
      },
    })
  ).toEqual({ registrationId: 'node-1', projectId: 'project-1', worktreeId: 'sample-copy' })
})
