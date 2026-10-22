import { expect, it, vi } from 'vitest'
import {
  codexProjectNetwork,
  isCodexNetworkRefusal,
  isCodexNetworkMessage,
} from '@/node/codexNetwork'
import type { Project } from '@abele/node-client'

const project = (enabled = false): Project => ({
  project_id: 'sample-project',
  root_path: '/sample/project',
  repository_path: null,
  git_common_dir: null,
  created_at: '2025-01-01T00:00:00.000Z',
  trust: 'trusted',
  use_repository_claude_permissions: false,
  codex_network_enabled: enabled,
})
function fixture() {
  return {
    channel: { channel: { welcome: { methods: ['project.codex_permissions'] } } },
    getProject: vi.fn(async () => project()),
    setProjectCodexPermissions: vi.fn(async (_id: string, enabled: boolean) => project(enabled)),
  }
}
it('reads the persisted choice and keeps projects and connections separate', async () => {
  const client = fixture()
  client.getProject.mockResolvedValueOnce(project(true))
  const network = codexProjectNetwork(client, 'sample-project')
  await network.load()
  expect(network.enabled.value).toBe(true)
  expect(codexProjectNetwork(client, 'sample-project')).toBe(network)
  expect(codexProjectNetwork(client, 'other-project').enabled.value).toBe(false)
  expect(codexProjectNetwork(fixture(), 'sample-project').enabled.value).toBe(false)
  await network.set(false)
  expect(client.setProjectCodexPermissions).toHaveBeenCalledWith('sample-project', false)
  expect(network.enabled.value).toBe(false)
})
it('does not replace a confirmed toggle with an older project read', async () => {
  const client = fixture()
  let resolve!: (value: Project) => void
  client.getProject.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r
      })
  )
  const network = codexProjectNetwork(client, 'sample-project')
  const loading = network.load()
  await network.set(true)
  resolve(project(false))
  await loading
  expect(network.enabled.value).toBe(true)
})
it('remembers negotiated support after transport disconnect', () => {
  const client = fixture()
  const network = codexProjectNetwork(client, 'sample-project')
  expect(network.supported).toBe(true)
  client.channel.channel.welcome.methods = []
  expect(network.supported).toBe(true)
})
it('recognizes the node network refusal without interpreting arbitrary command failures', () => {
  expect(
    isCodexNetworkRefusal(
      'Network is disabled: package installs require the project network switch.'
    )
  ).toBe(true)
  expect(isCodexNetworkRefusal('npm failed: missing package')).toBe(false)
  expect(
    isCodexNetworkMessage({
      id: 'sample',
      role: 'user',
      content: 'Network is disabled: explain this message',
    })
  ).toBe(false)
})
