import { afterEach, beforeEach, expect, it } from 'vitest'
import { showFormModal } from '@/scripting/formModal'
import { closeComponentDialogs } from '@/modal/componentDialog'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))
afterEach(closeComponentDialogs)
const field = () => document.querySelector<HTMLInputElement>('.abele-script-form__input')
const submit = () => document.querySelector<HTMLFormElement>('.abele-script-form')!.requestSubmit()

it('mounts fresh fields for queued forms with the same name and settles each answer once', async () => {
  const answers: unknown[] = []
  const first = showFormModal([
    { name: 'value', label: 'First', type: 'text', default: 'one' },
  ]).then((answer) => answers.push(answer))
  const second = showFormModal([
    { name: 'value', label: 'Second', type: 'text', default: 'two' },
  ]).then((answer) => answers.push(answer))
  await expect.poll(() => field()?.value).toBe('one')
  expect(document.querySelectorAll('.abele-script-form')).toHaveLength(1)
  field()!.value = 'first answer'
  field()!.dispatchEvent(new Event('input', { bubbles: true }))
  submit()
  await first
  await expect.poll(() => field()?.value).toBe('two')
  expect(document.querySelectorAll('.abele-script-form')).toHaveLength(1)
  submit()
  await second
  expect(answers).toEqual([{ value: 'first answer' }, { value: 'two' }])
  expect(document.querySelector('[data-abele-dialog-host]')).toBeNull()
})

it('closes an active form on abort without closing its successor', async () => {
  const controller = new AbortController()
  const first = showFormModal(
    [{ name: 'value', type: 'text', default: 'first' }],
    undefined,
    controller.signal
  )
  const rejected = expect(first).rejects.toThrow('Script stopped')
  const second = showFormModal([{ name: 'value', type: 'text', default: 'second' }])
  await expect.poll(() => field()?.value).toBe('first')
  controller.abort()
  await rejected
  await expect.poll(() => field()?.value).toBe('second')
  submit()
  await expect(second).resolves.toEqual({ value: 'second' })
})

it('settles every queued request on unload and never mounts a late form', async () => {
  const first = showFormModal([{ name: 'one', type: 'text' }])
  const second = showFormModal([{ name: 'two', type: 'text' }])
  closeComponentDialogs()
  await expect(first).resolves.toBeNull()
  await expect(second).resolves.toBeNull()
  // All imports are microtasks; letting them finish must not revive either dialog.
  await new Promise<void>((resolve) => queueMicrotask(resolve))
  expect(document.querySelector('[data-abele-dialog-host]')).toBeNull()
  expect(document.querySelector('.abele-script-form')).toBeNull()
})
