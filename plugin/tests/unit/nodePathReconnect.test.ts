import { expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { NodePathService } from '@/node/NodePathService'

const fixture = vi.hoisted(() => ({ state: undefined as any, calls: [] as string[] }))
vi.mock('@/stores/GlobalStore', () => ({
  GlobalStore: { getInstance: () => ({ app: { loadLocalStorage() {}, saveLocalStorage() {} } }) },
}))
vi.mock('@/node/NodeService', () => ({
  NodeService: {
    getInstance: () => ({
      nodes: ref([{ id: 'sample-registration', expectedNodeId: 'sample-node' }]),
      connection: () => ({ state: fixture.state, client: {}, connect: async () => {} }),
    }),
  },
}))
vi.mock('@/node/NodePathModel', () => ({
  NodePathModel: class {
    online = ref(false)
    folders = ref([])
    targets = ref([])
    inspections = ref({})
    selected = ref('sample-folder')
    receivedAt = ref(0)
    current = ref({ id: 'sample-folder' })
    panelMode = ref('files')
    restoreSnapshot() {}
    async start() {}
    async refresh() {
      fixture.calls.push('catalogue')
    }
    async select(id: string) {
      fixture.calls.push(`watch:${id}`)
    }
    // Mirrors NodePathModel.reconnected: re-list, then reselect with a fresh watch.
    async reconnected() {
      await this.refresh()
      await this.select(this.current.value.id)
    }
    async refreshCurrent() {
      fixture.calls.push('old-watch')
    }
    connectionRecovered() {}
    report(error: unknown) {
      throw error
    }
    destroy() {}
  },
}))

it('re-reads the catalogue and acquires a new folder watch after reconnection', async () => {
  fixture.state = ref('offline')
  fixture.calls = []
  const service = NodePathService.getInstance()
  try {
    await service.ready('sample-registration')
    fixture.state.value = 'connected'
    await nextTick()
    await Promise.resolve()
    expect(fixture.calls).toEqual(['catalogue', 'watch:sample-folder'])
  } finally {
    NodePathService.destroyCurrent()
  }
})
