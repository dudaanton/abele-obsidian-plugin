import { beforeEach, expect, it, vi } from 'vitest'
import { recoverNodeError } from '@/node/errorRecovery'

const fake = vi.hoisted(() => ({
  confirm: vi.fn(),
  trust: vi.fn(),
  project: vi.fn(),
  connect: vi.fn(),
  methods: [] as string[],
  settings: vi.fn(),
  external: vi.fn(),
  pair: vi.fn(),
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      connection: () => ({
        connect: fake.connect,
        client: {
          getProject: fake.project,
          channel: { channel: { welcome: { methods: fake.methods } } },
        },
      }),
    }),
  },
}))
vi.mock('@/components/obsidian/dialogs', () => ({ confirmDialog: fake.confirm }))
vi.mock('@/node/NodePathMutations', () => ({
  NodePathMutations: class {
    trust = fake.trust
  },
}))
vi.mock('@/components/settings/settingsTab', () => ({ openAbeleSettings: fake.settings }))
vi.mock('@/helpers/openExternal', () => ({ openExternal: fake.external }))
vi.mock('@/node/NodePathController', () => ({ openNodePathPairing: fake.pair }))
vi.mock('@/stores/GlobalStore', () => ({ GlobalStore: { getInstance: () => ({ app: {} }) } }))
const target = {
  nodeId: 'sample-node',
  registrationId: 'sample-node',
  projectId: 'sample-project',
  kind: 'workspace' as const,
  id: 'sample-folder',
}
beforeEach(() => {
  vi.clearAllMocks()
  fake.methods.splice(0)
  fake.project.mockResolvedValue({ trust: 'untrusted', root_path: '/sample/project' })
  fake.confirm.mockResolvedValue(false)
})
it('does not grant trust on an old node or after a cancelled confirmation', async () => {
  await expect(recoverNodeError('trust', 'sample-node', target)).rejects.toThrow()
  expect(fake.project).not.toHaveBeenCalled()
  fake.methods.push('project.trust')
  await recoverNodeError('trust', 'sample-node', target)
  expect(fake.confirm).toHaveBeenCalledOnce()
  expect(fake.trust).not.toHaveBeenCalled()
})
it('performs only the confirmed trust mutation, and skips already trusted folders', async () => {
  fake.methods.push('project.trust')
  fake.confirm.mockResolvedValue(true)
  await recoverNodeError('trust', 'sample-node', target)
  expect(fake.trust).toHaveBeenCalledExactlyOnceWith('sample-project')
  fake.project.mockResolvedValue({ trust: 'trusted' })
  await recoverNodeError('trust', 'sample-node', target)
  expect(fake.trust).toHaveBeenCalledTimes(1)
  expect(fake.confirm).toHaveBeenCalledTimes(1)
})
it('connects and opens the existing pairing, settings, and installation routes', async () => {
  await recoverNodeError('reconnect', 'sample-node')
  await recoverNodeError('pair', 'sample-node')
  await recoverNodeError('settings', 'sample-node')
  await recoverNodeError('update', 'sample-node')
  await recoverNodeError('install', 'sample-node')
  expect(fake.connect).toHaveBeenCalledOnce()
  expect(fake.pair).toHaveBeenCalledOnce()
  expect(fake.settings).toHaveBeenCalledWith({}, 'nodes')
  expect(fake.external).toHaveBeenCalledTimes(2)
})
