import { expect, it, vi } from 'vitest'
import { TraceRpc } from '@/debugger/trace/wire'

it('finishes a read at its initial snapshot instead of chasing a growing recording', async () => {
  const rpc = new TraceRpc(vi.fn())
  const step = (id: number) => ({ id: String(id) })
  const page = vi
    .spyOn(rpc, 'run')
    .mockResolvedValueOnce({
      run: { steps: 2 },
      steps: [step(1)],
      next: 1,
    } as never)
    .mockResolvedValueOnce({
      run: { steps: 3 },
      steps: [step(2), step(3)],
      next: 3,
    } as never)
    .mockRejectedValue(new Error('read chased the live tail'))
  expect((await rpc.wholeRun('sample-project', 'sample-run')).steps).toEqual([step(1), step(2)])
  expect(page).toHaveBeenCalledTimes(2)
})
