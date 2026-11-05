import { afterEach, expect, it, vi } from 'vitest'
import { boundedNativeOperations, NATIVE_READ_DEADLINE_MS } from '@/sync/nativeReadDeadline'
import { deferred } from '../helpers/deferred'
import { initializeLocale } from '../helpers/i18n'
import { t } from '@/i18n'

const { notice } = vi.hoisted(() => ({ notice: vi.fn(function () {}) }))
vi.mock('obsidian', async (original) => ({ ...(await original<object>()), Notice: notice }))

afterEach(() => {
  initializeLocale('en')
  vi.useRealTimers()
  notice.mockClear()
})

it('notifies once per blocked vault, including across plugin reloads, without releasing mutations', async () => {
  vi.useFakeTimers()
  const pending = deferred<void>()
  const port = boundedNativeOperations(
    { write: () => pending.promise, stat: async () => 3 },
    'sample-notice-vault'
  )
  const first = port.write()
  const second = port.write()
  let settled = false
  void first.then(() => {
    settled = true
  })
  await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
  expect(notice).toHaveBeenCalledExactlyOnceWith(
    'Saving to this vault is stuck because a file operation has not finished. Fully quit and restart Obsidian. Reloading the plugin will not fix this.',
    0
  )
  expect(settled).toBe(false)
  for (let n = 0; n < 3; n++) {
    await expect(port.stat()).rejects.toMatchObject({
      message:
        'A file operation has not finished. Fully quit and restart Obsidian before trying again.',
      cause: { uncertain: true },
    })
  }
  vi.resetModules()
  const next = await import('@/sync/nativeReadDeadline')
  const fresh = next.boundedNativeOperations({ stat: async () => 3 }, 'sample-notice-vault')
  await expect(fresh.stat()).rejects.toThrow('Fully quit and restart Obsidian')
  expect(notice).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
  pending.resolve()
  await Promise.all([first, second])
  expect(await fresh.stat()).toBe(3)
})

it.each(['en', 'ru', 'lv', 'es', 'de'])(
  'localizes the stuck-write notice and follow-on error in %s',
  async (language) => {
    initializeLocale('en')
    const englishNotice = t('sync.nativeMutationStuckNotice')
    const englishError = t('sync.nativeMutationRestart')
    initializeLocale(language)
    vi.useFakeTimers()
    const pending = deferred<void>()
    const port = boundedNativeOperations(
      { write: () => pending.promise, stat: async () => 3 },
      'sample-localized-vault-' + language
    )
    const writing = port.write()
    await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
    const noticeText = t('sync.nativeMutationStuckNotice')
    const errorText = t('sync.nativeMutationRestart')
    expect(noticeText).toContain('Obsidian')
    expect(errorText).toContain('Obsidian')
    expect(noticeText).not.toBe('sync.nativeMutationStuckNotice')
    expect(errorText).not.toBe('sync.nativeMutationRestart')
    if (language !== 'en') {
      expect(noticeText).not.toBe(englishNotice)
      expect(errorText).not.toBe(englishError)
    }
    expect(notice).toHaveBeenCalledExactlyOnceWith(noticeText, 0)
    await expect(port.stat()).rejects.toThrow(errorText)
    pending.resolve()
    await writing
  }
)

it('does not notify or add polling for healthy mutations or lost reads', async () => {
  vi.useFakeTimers()
  const port = boundedNativeOperations(
    { write: async () => {}, stat: () => new Promise(() => {}) },
    'sample-healthy-vault'
  )
  await port.write()
  expect(vi.getTimerCount()).toBe(0)
  const failed = expect(port.stat()).rejects.toThrow('Sync will retry')
  expect(vi.getTimerCount()).toBe(1)
  await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
  await failed
  expect(notice).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('keeps the fence and mutation ownership if displaying the notice fails', async () => {
  vi.useFakeTimers()
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  notice.mockImplementationOnce(function () {
    throw new Error('sample notice failure')
  })
  const pending = deferred<void>()
  const port = boundedNativeOperations(
    { write: () => pending.promise, stat: async () => 3 },
    'sample-notice-failure'
  )
  const writing = port.write()
  try {
    await vi.advanceTimersByTimeAsync(NATIVE_READ_DEADLINE_MS)
    await expect(port.stat()).rejects.toThrow('Fully quit and restart Obsidian')
    expect(log).toHaveBeenCalledOnce()
    expect(notice).toHaveBeenCalledOnce()
  } finally {
    pending.resolve()
    await writing
    log.mockRestore()
  }
  expect(await port.stat()).toBe(3)
})
