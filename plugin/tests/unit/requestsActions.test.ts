import { beforeEach, expect, it, vi } from 'vitest'
import { RequestsModel } from '@/requests/RequestsModel'
import { fakeNode, ports } from '../helpers/requestsFakeNode'

const host = vi.hoisted(() => ({ model: undefined as unknown, output: '' }))
const prompt = vi.hoisted(() => vi.fn())
const setViewState = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/requests/RequestsService', () => ({
  RequestsService: {
    instance: () => ({
      model: () => host.model,
      openRequest: { value: undefined },
    }),
  },
}))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: {
    getInstance: () => ({
      app: {
        workspace: {
          getLeavesOfType: () => [],
          getLeaf: () => ({ setViewState }),
          revealLeaf: async () => {},
        },
      },
    }),
  },
}))
vi.mock('@/components/obsidian/dialogs', () => ({ promptDialog: prompt, confirmDialog: vi.fn() }))
vi.mock('@/modal/componentDialog', () => ({ openComponentDialog: vi.fn() }))
vi.mock('@/debugger/DebuggerService', () => ({
  DebuggerService: {
    instance: {
      active: {
        value: {
          registrationId: 'node-1',
          controller: {
            snapshot: { target: { project_id: 'project-1' } },
            session: {
              get output() {
                return host.output
              },
            },
          },
        },
      },
    },
  },
}))
import { newRequest } from '@/requests/actions'

const context = { registrationId: 'node-1', projectId: 'project-1' }
beforeEach(() => {
  prompt.mockReset()
  host.output = ''
})

it('offers the running server and creates a usable first request', async () => {
  const node = fakeNode()
  node.envs.clear()
  const model = new RequestsModel(node.rpc, 'project-1', ports())
  host.model = model
  host.output = 'Listening on http://localhost:4567/'
  prompt.mockResolvedValueOnce('Read sample').mockResolvedValueOnce('http://localhost:4567')
  await newRequest(context)
  expect(prompt.mock.calls[1]?.[0]).toMatchObject({ value: 'http://localhost:4567' })
  const request = node.files.get('Samples/Read sample.http')!
  expect(model.blocked(request)).toBeUndefined()
  expect(model.state.env?.vars).toEqual([{ key: 'base', value: 'http://localhost:4567' }])
})

it('leaves no unusable request when the server address is cancelled', async () => {
  const node = fakeNode()
  node.envs.clear()
  host.model = new RequestsModel(node.rpc, 'project-1', ports())
  prompt.mockResolvedValueOnce('Read sample').mockResolvedValueOnce(null)
  await newRequest(context)
  expect(node.files.has('Samples/Read sample.http')).toBe(false)
  expect(node.envs.size).toBe(0)
})

it('offers a missing base in an existing environment without losing its other variables', async () => {
  const node = fakeNode()
  node.envs.clear()
  node.envs.set('local', { name: 'local', vars: [{ key: 'region', value: 'sample' }] })
  const model = new RequestsModel(node.rpc, 'project-1', ports())
  host.model = model
  prompt.mockResolvedValueOnce('Read sample').mockResolvedValueOnce('http://localhost:4567')
  await newRequest(context)
  expect(prompt).toHaveBeenCalledTimes(2)
  expect(model.state.env?.vars).toEqual([
    { key: 'region', value: 'sample' },
    { key: 'base', value: 'http://localhost:4567' },
  ])
  expect(model.blocked(node.files.get('Samples/Read sample.http')!)).toBeUndefined()
})
