import { expect, it } from 'vitest'
import { evalJson, evalRaw, reloadApp } from './helpers/obsidianCli'
import { targets } from './helpers/target'

targets('desktop')

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
