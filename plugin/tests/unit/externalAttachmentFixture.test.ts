import { expect, it, vi } from 'vitest'
import { defaultSelective } from '@/sync/connection'
import { allowFixtureAttachment } from '../e2e/helpers/externalAttachmentFixture'

it('opts a 200 MiB attachment into the phone policy without changing other selectors', async () => {
  const selective = defaultSelective(true)
  const svc = {
    registry: { records: () => [{ id: 'phone', selective }] },
    updateConnection: vi.fn(),
  }
  await allowFixtureAttachment(svc as never, 'phone', 200 * 1024 * 1024)
  expect(svc.updateConnection).toHaveBeenCalledWith('phone', {
    selective: { ...selective, maxFileBytes: 200 * 1024 * 1024 },
  })
  expect(selective.maxFileBytes).toBe(50 * 1024 * 1024)
})
it('does not change the phone policy for a small attachment', async () => {
  const svc = {
    registry: { records: () => [{ id: 'phone', selective: defaultSelective(true) }] },
    updateConnection: vi.fn(),
  }
  await allowFixtureAttachment(svc as never, 'phone', 26)
  expect(svc.updateConnection).not.toHaveBeenCalled()
})
