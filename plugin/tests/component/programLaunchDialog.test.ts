import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import ProgramLaunchDialog from '@/debugger/ProgramLaunchDialog.vue'

const modal = { template: '<div><slot /><slot name="footer" /></div>' }
function fixture(launch = vi.fn().mockResolvedValue(undefined)) {
  return mount(ProgramLaunchDialog, {
    props: { program: 'dist/main.js', launch },
    global: { stubs: { Modal: modal } },
  })
}

it('keeps arguments separate from the entry and launches them as argv', async () => {
  const launch = vi.fn().mockResolvedValue(undefined)
  const w = fixture(launch)
  await w.findAll('input')[1].setValue('order --label "sample item"')
  await w.findAll('button').at(-1)!.trigger('click')
  await flushPromises()
  expect(launch).toHaveBeenCalledWith('dist/main.js', ['order', '--label', 'sample item'])
  expect(w.emitted('close')).toHaveLength(1)
  w.unmount()
})

it('keeps launch failures and program stderr visible without closing the form', async () => {
  const error = Object.assign(new Error('debugger_startup_handoff_lost'), {
    details: { stderr: 'Error: Cannot find module sample-module', stdout: 'starting sample' },
  })
  const launch = vi.fn().mockRejectedValue(error)
  const w = fixture(launch)
  await w.findAll('button').at(-1)!.trigger('click')
  await flushPromises()
  expect(w.get('[role="alert"]').text()).toContain('Cannot find module sample-module')
  expect(w.get('[role="alert"]').text()).toContain('starting sample')
  expect(w.emitted('close')).toBeUndefined()
  expect(w.findAll('input')[0].element.value).toBe('dist/main.js')
  w.unmount()
})

it('requires complete argument syntax before starting', async () => {
  const launch = vi.fn()
  const w = fixture(launch)
  await w.findAll('input')[1].setValue('"unfinished')
  await w.findAll('button').at(-1)!.trigger('click')
  expect(launch).not.toHaveBeenCalled()
  expect(w.get('[role="alert"]').text()).toContain('quote')
  w.unmount()
})
