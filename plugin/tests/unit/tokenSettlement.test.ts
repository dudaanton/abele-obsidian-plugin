import { afterEach, expect, it, vi } from 'vitest'
import { tokenUi } from '@/sync/tokenUi'
import { isFullySynced, onStatusChange } from '@/sync/tokenSettlement'
import { tokenSettingsFixture } from '../helpers/tokenSettingsFixture'

afterEach(() => {
  tokenUi.value = null
})
it('waits for every token connection while treating paused and unreachable connections as settled', () => {
  const fixture = tokenSettingsFixture()
  fixture.bind()
  const other = fixture.registry.add()
  const scope = { kind: 'folder' as const, id: 'sample-other-root', path: '/' }
  fixture.registry.attach(
    other,
    { v: 1, address: 'https://other.example', key: 'b'.repeat(43), scope },
    {
      protocol: 2,
      token_id: 'sample-other-token',
      space_id: 'sample-other-space',
      scope,
      status: 'active',
    },
    {
      get: (key) => fixture.keys.get(key) ?? null,
      set: (key, value) => {
        fixture.keys.set(key, value)
      },
    }
  )
  fixture.registry.setStatus(fixture.id, 'syncing')
  fixture.registry.setStatus(other, 'joining')
  fixture.ui.refresh()
  const change = vi.fn()
  const stop = onStatusChange(change)
  expect(isFullySynced()).toBe(false)
  fixture.registry.setStatus(fixture.id, 'idle')
  fixture.ui.refresh()
  expect(isFullySynced()).toBe(false)
  expect(change).not.toHaveBeenCalled()
  fixture.registry.setStatus(other, 'offline')
  fixture.ui.refresh()
  expect(isFullySynced()).toBe(true)
  expect(change).toHaveBeenCalledOnce()
  stop()
  fixture.registry.setStatus(fixture.id, 'paused')
  fixture.ui.refresh()
  expect(isFullySynced()).toBe(true)
  expect(change).toHaveBeenCalledOnce()
})
