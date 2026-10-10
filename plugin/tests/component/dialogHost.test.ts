import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, onMounted, onUnmounted } from 'vue'
import { openComponentDialog, closeComponentDialogs } from '@/modal/componentDialog'
import { useVault } from '../helpers/testEnv'

beforeEach(() => useVault([]))

const dialog = defineComponent({
  props: { text: String },
  emits: ['close'],
  setup:
    (props, { emit }) =>
    () =>
      h('button', { onClick: () => emit('close') }, props.text),
})
afterEach(() => {
  closeComponentDialogs()
  document.body.replaceChildren()
})

it('mounts only on demand and cleans up an isolated instance once', async () => {
  const closed = vi.fn()
  const load = vi.fn(async () => dialog)
  const first = openComponentDialog(load, { text: 'First' }, { onClosed: closed })
  const second = openComponentDialog(load, { text: 'Second' })
  await Promise.all([first.ready, second.ready])
  expect(load).toHaveBeenCalledTimes(2)
  expect([...document.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
    'First',
    'Second',
  ])
  document.querySelector('button')!.click()
  expect([...document.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
    'Second',
  ])
  first.close()
  expect(closed).toHaveBeenCalledOnce()
  second.close()
  expect(document.querySelector('[data-abele-dialog-host]')).toBeNull()
})

// BUG: a delayed component load must not resurrect a dialog cancelled during loading/unload.
it('does not mount a late import after the host was closed', async () => {
  let release!: (value: typeof dialog) => void
  const load = new Promise<typeof dialog>((resolve) => {
    release = resolve
  })
  const closed = vi.fn()
  const handle = openComponentDialog(() => load, {}, { onClosed: closed })
  closeComponentDialogs()
  release(dialog)
  await handle.ready
  expect(document.querySelector('button')).toBeNull()
  expect(document.querySelector('[data-abele-dialog-host]')).toBeNull()
  expect(closed).toHaveBeenCalledOnce()
})

it('keeps the old single-window behavior for repeated utility commands', async () => {
  const load = vi.fn(async () => dialog)
  const first = openComponentDialog(load, { text: 'Same' }, { key: 'sample' })
  const second = openComponentDialog(load, { text: 'Same' }, { key: 'sample' })
  expect(first).toBe(second)
  await first.ready
  expect(load).toHaveBeenCalledOnce()
  expect(document.querySelectorAll('button')).toHaveLength(1)
  first.close()
  const next = openComponentDialog(load, { text: 'Fresh' }, { key: 'sample' })
  await next.ready
  expect(next).not.toBe(first)
  expect(document.querySelector('button')?.textContent).toBe('Fresh')
})

it('cleans up a component that dismisses itself while mounting', async () => {
  const disposed = vi.fn()
  const selfClosing = defineComponent({
    emits: ['close'],
    setup: (_props, { emit }) => {
      onMounted(() => emit('close'))
      onUnmounted(disposed)
      return () => h('div', 'Sample')
    },
  })
  const handle = openComponentDialog(async () => selfClosing)
  await handle.ready
  expect(disposed).toHaveBeenCalledOnce()
  expect(document.querySelector('[data-abele-dialog-host]')).toBeNull()
})

it('releases a failed import and permits reopening', async () => {
  const closed = vi.fn()
  const failed = openComponentDialog(
    async () => {
      throw Error('Sample load failed')
    },
    {},
    { key: 'failed', onClosed: closed }
  )
  await expect(failed.ready).rejects.toThrow('Sample load failed')
  expect(closed).toHaveBeenCalledOnce()
  const next = openComponentDialog(async () => dialog, { text: 'Retry' }, { key: 'failed' })
  await next.ready
  expect(document.querySelector('button')?.textContent).toBe('Retry')
})
