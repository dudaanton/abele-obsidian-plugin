import { describe, expect, it } from 'vitest'
import { evalJson, evalRaw, reloadApp } from './helpers/obsidianCli'
import { requested, targets } from './helpers/target'

targets('desktop')

/**
 * Checks the tier's own reload helper, not the plugin, so it runs only when asked for
 * (`ABELE_E2E_HARNESS=1`): when `helpers/obsidianCli.ts` or `helpers/reloadWitness.ts` changed.
 * The witness logic itself is covered without the app by `tests/harness/reloadWitness.test.ts`.
 */
describe.runIf(requested('ABELE_E2E_HARNESS'))('the reload helper', () => {
  it('observes an owned document transition after one controlled lost launch reply under the normal reload lock', async () => {
    const read = () =>
      evalJson<{ owner: string; generation: number; mobile: boolean }>(`({
    owner:app.vault.getName()+':'+require('@electron/remote').getCurrentWindow().id,
    generation:performance.timeOrigin,mobile:!!app.isMobile
  })`)
    const before = read()
    let requests = 0
    await reloadApp('location.reload()', (code, timeout) => {
      requests++
      evalRaw(code, timeout)
      // Discard only the launch reply, not the action. The normal helper still owns serialization.
      throw new Error('sample controlled launch reply loss')
    })
    const after = read()
    expect(requests).toBe(1)
    expect(after.owner).toBe(before.owner)
    expect(after.generation).not.toBe(before.generation)
    expect(after.mobile).toBe(before.mobile)
    console.info('controlled reload witness', JSON.stringify({ before, after, requests }))
  }, 90000)
})
