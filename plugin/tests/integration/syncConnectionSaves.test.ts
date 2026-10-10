// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { tokenHostFixture } from '../helpers/tokenHostFixture'
import { TOKEN_REGISTRY_KEY } from '@/sync/tokenConnectionRegistry'

function refusingFixture() {
  const fixture = tokenHostFixture(vi.fn())
  const save = fixture.app.saveLocalStorage.bind(fixture.app)
  fixture.app.saveLocalStorage = (key, value) => {
    if (key !== TOKEN_REGISTRY_KEY) save(key, value)
  }
  const runtime = { pause: vi.fn(), disconnect: vi.fn() }
  fixture.ui.bind(fixture.id, runtime as never)
  return { ...fixture, runtime }
}
it('refuses enrollment before changing the ledger or creating a live row', () => {
  const { registry } = refusingFixture()
  const before = registry.records()
  expect(() => registry.add()).toThrow(/recovery/)
  expect(registry.records()).toEqual(before)
})
it('refuses a pause before changing the running engine', async () => {
  const { ui, registry, id, runtime } = refusingFixture()
  await expect(ui.pause(id, true)).rejects.toThrow(/recovery/)
  expect(registry.records()[0].paused).toBe(false)
  expect(runtime.pause).not.toHaveBeenCalled()
})
it('refuses disconnect before stopping the engine or removing its credential', async () => {
  const { ui, registry, keys, id, runtime } = refusingFixture()
  const before = registry.records()
  await expect(ui.disconnect(id)).rejects.toThrow(/recovery/)
  expect(registry.records()).toEqual(before)
  expect(keys.size).toBe(1)
  expect(runtime.disconnect).not.toHaveBeenCalled()
})
