import { expect, it, vi } from 'vitest'
import { ObsidianFileSystem } from '@/sync/ObsidianFileSystem'
import { useVault } from '../helpers/testEnv'

it('lets the host render before a metadata-only operation pass starts', async () => {
  const app = useVault([])
  const fs = new ObsidianFileSystem(app as never)
  const previous = Object.getOwnPropertyDescriptor(window, 'scheduler')
  let painted = false
  const timer = setTimeout(() => {
    painted = true
  }, 0)
  Object.defineProperty(window, 'scheduler', {
    configurable: true,
    value: {
      yield: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 0))),
    },
  })
  try {
    const pass = fs as unknown as {
      [key: symbol]: <T>(work: () => Promise<T>) => Promise<T>
    }
    await pass[Symbol.for('abele.sync.operation-pass-v1')](async () => {
      expect(painted).toBe(true)
    })
  } finally {
    clearTimeout(timer)
    if (previous) Object.defineProperty(window, 'scheduler', previous)
    else Reflect.deleteProperty(window, 'scheduler')
  }
})

it('yields while collecting a scoped host index without reading outside it', async () => {
  const paths = Array.from({ length: 5000 }, (_, i) => `Scope/Part ${i % 16}/Sample ${i}.md`)
  const app = useVault([...paths.map((path) => ({ path })), { path: 'Outside/sample.md' }])
  const fs = new ObsidianFileSystem(app as never)
  let painted = false
  const timer = setTimeout(() => {
    painted = true
  }, 0)
  try {
    const files = await (
      fs as unknown as { indexedFiles(scope: string): Promise<{ path: string }[]> }
    ).indexedFiles('Scope')
    expect(painted).toBe(true)
    expect(files.map((file) => file.path).sort()).toEqual(paths.sort())
  } finally {
    clearTimeout(timer)
  }
})

it('stops scoped index collection at the first aborted scheduler yield', async () => {
  const app = useVault(Array.from({ length: 5000 }, (_, i) => ({ path: `Scope/Sample ${i}.md` })))
  const fs = new ObsidianFileSystem(app as never)
  const controller = new AbortController()
  const scoped = fs as unknown as { [key: symbol]: (signal: AbortSignal) => void }
  scoped[Symbol.for('abele.sync.index-wait-signal-v1')](controller.signal)
  const previous = Object.getOwnPropertyDescriptor(window, 'scheduler')
  const pause = vi.fn(async () => {
    controller.abort(new Error('sample pause'))
  })
  Object.defineProperty(window, 'scheduler', { configurable: true, value: { yield: pause } })
  try {
    await expect(
      (fs as unknown as { indexedFiles(scope: string): Promise<unknown> }).indexedFiles('Scope')
    ).rejects.toThrow('sample pause')
    expect(pause).toHaveBeenCalledTimes(1)
  } finally {
    if (previous) Object.defineProperty(window, 'scheduler', previous)
    else Reflect.deleteProperty(window, 'scheduler')
  }
})
