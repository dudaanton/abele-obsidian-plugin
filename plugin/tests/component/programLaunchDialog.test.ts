import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import ProgramLaunchDialog from '@/debugger/ProgramLaunchDialog.vue'
import Modal from '@/components/obsidian/Modal.vue'
import Disclosure from '@/components/obsidian/Disclosure.vue'
import { Platform } from 'obsidian'

const modal = { props: ['size'], template: '<div><slot /><slot name="footer" /></div>' }
it('passes and remembers runtime configuration even when launch fails', async () => {
  const launch = vi.fn().mockRejectedValue(new Error('debugger_start_failed'))
  const rememberConfiguration = vi.fn()
  const configuration = {
    runtimeArguments: '--import=tsx',
    cwd: 'packages/sample',
    environment: 'MODE=sample',
  }
  const w = mount(ProgramLaunchDialog, {
    props: {
      program: 'packages/sample/src/main.ts',
      launch,
      configurationFor: () => configuration,
      rememberConfiguration,
    },
    global: { stubs: { Modal: modal } },
  })
  await w.findAll('button').at(-1)!.trigger('click')
  await flushPromises()
  expect(launch).toHaveBeenCalledWith('packages/sample/src/main.ts', [], undefined, {
    runtime_argv: ['--import=tsx'],
    cwd: 'packages/sample',
    env: { MODE: 'sample' },
  })
  expect(rememberConfiguration).toHaveBeenCalledWith('packages/sample/src/main.ts', configuration)
  w.unmount()
})
it('shows known exit status ahead of timeout wording', async () => {
  const w = fixture(
    vi.fn().mockRejectedValue(
      Object.assign(new Error('request_timeout'), {
        details: { exit_code: 1, stderr: 'module failed' },
      })
    )
  )
  await w.findAll('button').at(-1)!.trigger('click')
  await flushPromises()
  expect(w.get('[role="alert"]').text()).toContain('Exit code: 1')
  expect(w.get('[role="alert"]').text()).not.toContain('Reconnect')
  expect(w.get('[role="alert"]').text()).toContain('module failed')
  w.unmount()
})
it('does not start with malformed environment lines', async () => {
  const launch = vi.fn()
  const w = fixture(launch)
  await w.findAll('.abele-disclosure__control')[0].trigger('click')
  await w.get('textarea').setValue('MODE=sample\nmissing equals')
  await w.findAll('button').at(-1)!.trigger('click')
  expect(launch).not.toHaveBeenCalled()
  expect(w.get('[role="alert"]').text()).toContain('KEY=value')
  w.unmount()
})
it('passes environment values literally and limits the output preview', async () => {
  const launch = vi.fn().mockRejectedValue(
    Object.assign(new Error('debugger_start_failed'), {
      details: { exit_code: 2, stderr: 'sample failure\n' + 'detail\n'.repeat(50) },
    })
  )
  const w = fixture(launch)
  await w.findAll('.abele-disclosure__control')[0].trigger('click')
  await w.get('textarea').setValue('SAMPLE=a=b $HOME\nEMPTY=')
  await w.findAll('button').at(-1)!.trigger('click')
  await flushPromises()
  expect(launch).toHaveBeenCalledWith('dist/main.js', [], undefined, {
    env: { SAMPLE: 'a=b $HOME', EMPTY: '' },
  })
  expect(w.get('[role="alert"]').text()).toContain('sample failure')
  expect(w.get('[role="alert"]').text().length).toBeLessThan(200)
  w.unmount()
})
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
  await w.findAll('.abele-disclosure__control').at(-1)!.trigger('click')
  expect(w.findAll('.abele-disclosure__content').at(-1)!.text()).toContain(code)
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

it('retains structured startup reasons in Details when no output was captured', async () => {
  const error = Object.assign(new Error('debugger_start_failed'), {
    details: { reason: 'The sample entry is not a file.', path: 'dist/sample.js' },
  })
  const w = fixture(vi.fn().mockRejectedValue(error))
  await w.findAll('button').at(-1)!.trigger('click')
  await flushPromises()
  await w.findAll('.abele-disclosure__control').at(-1)!.trigger('click')
  expect(w.findAll('.abele-disclosure__content').at(-1)!.text()).toContain(
    'The sample entry is not a file.'
  )
  w.unmount()
})

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
  const details = w.findAllComponents(Disclosure).at(-1)!
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
