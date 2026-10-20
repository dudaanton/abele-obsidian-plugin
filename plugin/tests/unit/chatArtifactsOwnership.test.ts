import { expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Modal } from 'obsidian'
import { openDialog } from '@/testing/openDialog'
import { useVault } from '../helpers/testEnv'
import { AbeleConfig } from '@/services/AbeleConfig'
import { DEFAULT_AI_SETTINGS } from '@/ai/types'

it.each(['chat-artifacts-empty', 'chat-artifacts', 'chat-artifacts-long'])(
  'marks %s so async fixture consumers close its owned modal',
  async (name) => {
    const app = useVault([])
    AbeleConfig.getInstance().ai = { ...DEFAULT_AI_SETTINGS }
    const opened: Modal[] = []
    const open = Modal.prototype.open
    const spy = vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
      opened.push(this)
      open.call(this)
    })
    try {
      await openDialog(name)
      await flushPromises()
      expect(opened[0]?.modalEl.getAttribute('data-abele-fixture')).toBe(name)
    } finally {
      opened[0]?.close()
      await flushPromises()
      spy.mockRestore()
    }
    expect(app.vault.getFiles()).toHaveLength(0)
  }
)
