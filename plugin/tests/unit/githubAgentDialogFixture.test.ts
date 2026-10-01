import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Modal } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { openDialog } from '@/testing/openDialog'
import { useVault } from '../helpers/testEnv'

afterEach(() => vi.restoreAllMocks())
describe('temporary GitHub agent layout fixture', () => {
  it('cannot persist sample settings and restores the real save method when closed', async () => {
    useVault([])
    const config = AbeleConfig.getInstance()
    const original = config.github
    const save = vi.spyOn(config, 'saveSettings').mockResolvedValue(undefined)
    const opened: Modal[] = []
    const open = Modal.prototype.open
    vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
      opened.push(this)
      open.call(this)
    })
    openDialog('github-agent-access')
    await flushPromises()
    await config.saveSettings()
    const called = save.mock.calls.length
    opened[0].close()
    await flushPromises()
    expect(called).toBe(0)
    expect(config.github).toBe(original)
    expect(config.saveSettings).toBe(save)
    expect(
      AgentRegistry.getInstance()
        .list()
        .some((a) => a.name === 'Sample connection permissions')
    ).toBe(false)
  })
})
