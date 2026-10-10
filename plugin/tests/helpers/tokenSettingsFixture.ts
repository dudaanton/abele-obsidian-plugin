import { vi } from 'vitest'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { TokenUi, tokenUi, type TokenUiRuntime } from '@/sync/tokenUi'
import { useVault } from './testEnv'

export function tokenSettingsFixture(app = useVault([])) {
  const registry = TokenConnectionRegistry.open(app),
    keys = new Map<string, string>()
  const secrets = {
    get: (id: string) => keys.get(id) ?? null,
    set: (id: string, key: string) => {
      keys.set(id, key)
    },
    remove: (id: string) => {
      keys.delete(id)
    },
  }
  const id = registry.add()
  registry.setAddress(id, 'https://old.example.com')
  const ui = new TokenUi(registry, secrets, vi.fn() as never)
  tokenUi.value = ui
  const bind = () => {
    const scope = { kind: 'folder' as const, id: 'sample-root', path: '/' }
    registry.attach(
      id,
      { v: 1, address: 'https://old.example.com', key: 'a'.repeat(43), scope },
      { protocol: 2, token_id: 'sample-token', space_id: 'sample-space', scope, status: 'active' },
      secrets
    )
    ui.refresh()
    const runtime: TokenUiRuntime = {
      sync: vi.fn(async () => {}),
      pause: vi.fn(async () => {}),
      disconnect: vi.fn(async () => {}),
      opened: async () => [],
      resolve: async () => null,
      apply: vi.fn(async () => {}),
    }
    ui.bind(id, runtime)
    return runtime
  }
  return {
    app,
    registry,
    ui,
    id,
    keys,
    bind,
    path: (field: string) => 'sync.connections.' + id + '.' + field,
  }
}
