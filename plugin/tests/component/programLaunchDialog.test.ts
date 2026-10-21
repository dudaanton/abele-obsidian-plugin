import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import ProgramLaunchDialog from '@/debugger/ProgramLaunchDialog.vue'
import Modal from '@/components/obsidian/Modal.vue'
import Disclosure from '@/components/obsidian/Disclosure.vue'
import { Platform } from 'obsidian'

const modal = { props: ['size'], template: '<div><slot /><slot name="footer" /></div>' }
it.each([
  [
    'request_timeout',
    'The launch result is unknown. Reconnect and check the debug sessions before trying again.',
  ],
  [
    'debugger_program_not_found',
    'The program was not found. Check its path relative to the folder.',
  ],
])('explains a launch refused with %s', async (code, message) => {
  const w = fixture(vi.fn().mockRejectedValue(new Error(code)))
  await w.findAll('button').at(-1)!.trigger('click')
  await flushPromises()
  expect(w.get('[role="alert"]').text()).toContain(message)
  await w.get('.abele-disclosure__control').trigger('click')
  expect(w.get('.abele-disclosure__content').text()).toContain(code)
  w.unmount()
})
it('offers supported stop-at-start default off and sends the explicit choice', async () => {
  const launch = vi.fn(async () => {})
  const w = mount(ProgramLaunchDialog, {
    props: { program: 'dist/main.js', launch, stopOnEntrySupported: true },
    global: { stubs: { Modal: modal } },
  })
  expect(w.get('[role="checkbox"]').attributes('aria-checked')).toBe('false')
  await w.findAll('button').at(-1)!.trigger('click')
  await flushPromises()
  expect(launch).toHaveBeenCalledWith('dist/main.js', [], false)
  await w.get('[role="checkbox"]').trigger('click')
  await w.findAll('button').at(-1)!.trigger('click')
  await flushPromises()
  expect(launch).toHaveBeenLastCalledWith('dist/main.js', [], true)
  w.unmount()
})
it('restores arguments for the selected entry and remembers the successful launch', async () => {
  const rememberArguments = vi.fn()
  const w = mount(ProgramLaunchDialog, {
    props: {
      program: 'dist/main.js',
      launch: vi.fn(async () => {}),
      argumentsFor: () => 'sample --count 3',
      rememberArguments,
    },
    global: { stubs: { Modal: modal } },
  })
  expect(w.findAll('input')[1].element.value).toBe('sample --count 3')
  expect(w.find('[role="checkbox"]').exists()).toBe(false)
  await w.findAll('button').at(-1)!.trigger('click')
  await flushPromises()
  expect(rememberArguments).toHaveBeenCalledWith('dist/main.js', 'sample --count 3')
  w.unmount()
})
function fixture(launch = vi.fn().mockResolvedValue(undefined)) {
  return mount(ProgramLaunchDialog, {
    props: { program: 'dist/main.js', launch },
    global: { stubs: { Modal: modal } },
  })
}

it('sizes the desktop dialog to content and keeps the phone sheet tall', () => {
  const mobile = Platform.isMobile
  try {
    Platform.isMobile = false
    const desktop = fixture()
    expect(desktop.findComponent(Modal).props('size')).toBe('default')
    desktop.unmount()
    Platform.isMobile = true
    const phone = fixture()
    expect(phone.findComponent(Modal).props('size')).toBe('tall')
    phone.unmount()
  } finally {
    Platform.isMobile = mobile
  }
})

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
  expect(w.get('[role="alert"]').text()).toContain(
    'The program exited before the debugger could attach.'
  )
  expect(w.text()).not.toContain('debugger_startup_handoff_lost')
  const details = w.findComponent(Disclosure)
  expect(details.props('modelValue')).toBe(false)
  details.vm.$emit('update:modelValue', true)
  await flushPromises()
  expect(w.text()).toContain('debugger_startup_handoff_lost')
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
