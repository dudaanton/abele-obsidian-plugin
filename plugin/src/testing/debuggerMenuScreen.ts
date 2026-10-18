import { Menu } from 'obsidian'
import { ref } from 'vue'
import { NodeService, type NodeConnection } from '@/node/NodeService'
import type { NodePathModel, PathTarget } from '@/node/NodePathModel'
import {
  showNodePathFileMenu,
  showNodePathNodeMenu,
  showNodePathPlaceMenu,
} from '@/node/NodePathController'

const menus = new Set<Menu>()
export function closeDebuggerMenuFixture() {
  for (const menu of menus) menu.hide()
  menus.clear()
}

/** Synthetic read-only negotiation through the real context-menu entry points. */
export async function openDebuggerMenuFixture(
  kind: 'file' | 'node' | 'place',
  state: 'ready' | 'refused' | 'offline' | 'reconnected' | 'old' | 'disabled' | 'missing'
) {
  closeDebuggerMenuFixture()
  const target: PathTarget = {
    registrationId: 'sample-debug-menu',
    nodeId: 'sample-node',
    projectId: 'sample-project',
    kind: 'worktree',
    id: 'sample-worktree',
  }
  const connection = {
    state: ref(state === 'offline' ? 'offline' : 'connected'),
    client: {
      describe: async () => {
        await new Promise((resolve) => window.setTimeout(resolve, 150))
        if (state === 'reconnected') {
          connection.state.value = 'offline'
          connection.state.value = 'connected'
        }
        return {
          capabilities: {
            capabilities:
              state === 'disabled'
                ? {}
                : {
                    debugger_v1: { status: 'supported', evidence: 'sample' },
                  },
          },
        }
      },
      getProject: async () => ({ use_repository_claude_permissions: false }),
      request: async (method: string) => {
        if (method === 'debugger.v1.sessions') {
          if (state === 'refused') throw new Error('Permission refused')
          if (state === 'old') throw new Error('unsupported_method')
          return []
        }
        if (method === 'debugger.v1.profiles')
          return state === 'missing' ? [] : [{ id: 'js-ts-native' }]
        return { project_id: target.projectId, external_read: false }
      },
    },
  }
  const model = {
    registrationId: target.registrationId,
    current: ref(target),
    selected: ref(target.id),
    currentFolder: ref({ id: target.projectId, git: false }),
    folders: ref([{ id: target.projectId, path: '/sample/project', git: false, copies: [] }]),
    target: () => target,
    capabilities: ref([]),
    port: {},
  } as unknown as NodePathModel
  const service = NodeService.getInstance()
  const originalConnection = service.connection
  const originalAdd = Menu.prototype.addItem
  const originalShow = Menu.prototype.showAtPosition
  const rows = new WeakMap<Menu, { title: string; disabled: boolean }[]>()
  let finish!: (rows: { title: string; disabled: boolean }[]) => void
  const snapshot = new Promise<{ title: string; disabled: boolean }[]>((resolve) => {
    finish = resolve
  })
  service.connection = (id) =>
    id === target.registrationId
      ? (connection as unknown as NodeConnection)
      : originalConnection.call(service, id)
  Menu.prototype.addItem = function (build) {
    return originalAdd.call(this, (item) => {
      const row = { title: '', disabled: false }
      const list = rows.get(this) ?? []
      list.push(row)
      rows.set(this, list)
      const title = item.setTitle,
        disabled = item.setDisabled
      item.setTitle = function (value) {
        row.title = String(value)
        return title.call(this, value)
      }
      item.setDisabled = function (value = true) {
        row.disabled = value
        return disabled.call(this, value)
      }
      build(item)
    })
  }
  Menu.prototype.showAtPosition = function (...args) {
    // Capture at the native serialization boundary, never read mutable rows after display.
    const frozen = structuredClone(rows.get(this) ?? [])
    menus.add(this)
    const result = originalShow.apply(this, args)
    finish(frozen)
    return result
  }
  let timer: number | undefined
  try {
    const event = new MouseEvent('contextmenu', { clientX: 20, clientY: 100 })
    if (kind === 'file') showNodePathFileMenu(event, { target, path: 'sample.js' })
    else if (kind === 'node') showNodePathNodeMenu(model, event)
    else showNodePathPlaceMenu(model, event, () => {})
    const result = await Promise.race([
      snapshot,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error('Debugger menu did not settle')), 5000)
      }),
    ])
    return result
  } finally {
    window.clearTimeout(timer)
    service.connection = originalConnection
    Menu.prototype.addItem = originalAdd
    Menu.prototype.showAtPosition = originalShow
  }
}
