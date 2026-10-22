import { expect, it, vi } from 'vitest'
import { SyncActionNotice } from '@/sync/actionNotice'

it('updates one visible notice for the whole explicit bulk action and closes it afterwards', () => {
  vi.useFakeTimers()
  const before = document.querySelectorAll('.notice').length
  try {
    const notice = new SyncActionNotice('Starting')
    for (let i = 0; i < 100; i++) notice.update(`Completed ${i}`)
    expect(document.querySelectorAll('.notice')).toHaveLength(before + 1)
    notice.finish('Finished')
    expect(document.querySelectorAll('.notice')).toHaveLength(before + 1)
    vi.advanceTimersByTime(5000)
    expect(document.querySelectorAll('.notice')).toHaveLength(before)
  } finally {
    vi.useRealTimers()
  }
})
