import { expect, it } from 'vitest'
import { OPEN_LOCAL_NODE_FORM } from '../e2e/helpers/nodeSettingsForm'
import { MESSAGE_ACTIONS_SETUP } from '../e2e/helpers/messageActions'

it('resolves the node form after a boolean polling result', async () => {
  const modal = {}
  const root = {
    ownerDocument: { querySelector: () => ({ closest: () => modal }) },
    querySelectorAll: () => [
      {
        querySelector: (selector: string) =>
          selector === '.setting-item-name'
            ? { textContent: 'Add the node on this computer' }
            : { click() {} },
      },
    ],
  }
  const result = await new Function(
    'settingsRoot',
    'until',
    `return (async () => { ${OPEN_LOCAL_NODE_FORM}; return nodeForm })()`
  )(root, async (fn: () => unknown) => !!fn())
  expect(result).toBe(modal)
})

it('cleans its owned message fixture when rendering fails', async () => {
  const files = new Map()
  const service = {
    activeTabId: { value: 'previous' },
    createTab: () => 'fixture',
    getSession: () => ({ load: async () => {} }),
    openChatFile: async () => {},
    getSessionByFile: () => ({ id: 'fixture' }),
    revealSidebar: async () => {},
    deleteChat: async () => {
      files.clear()
    },
    switchTab() {},
  }
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => files.get(path),
      create: async (path: string) => {
        const file = { path }
        files.set(path, file)
        return file
      },
      delete: async (file: { path: string }) => {
        files.delete(file.path)
      },
    },
    commands: { executeCommandById() {} },
  }
  const window = {
    __abeleTest: {
      ChatService: { getInstance: () => service },
      AbeleConfig: { getInstance: () => ({ ai: {} }) },
      AgentRegistry: { getInstance: () => ({ defaultAgent: () => undefined }) },
    },
  }
  await expect(
    new Function(
      'app',
      'window',
      'document',
      'until',
      'wait',
      `return (async () => { ${MESSAGE_ACTIONS_SETUP} })()`
    )(
      app,
      window,
      { querySelector: () => null },
      async () => false,
      async () => {}
    )
  ).rejects.toThrow('Sample message did not render')
  expect(files.size).toBe(0)
})
