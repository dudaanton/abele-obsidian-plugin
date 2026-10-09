import { beforeEach, expect, it, vi } from 'vitest'
import { resolve } from 'node:path'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { evalLong } from '../e2e/helpers/obsidianCli'
import { measureDesign } from '../e2e/helpers/designLint'
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const mock = {
    ...actual,
    mkdirSync: vi.fn(),
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    writeFileSync: vi.fn(),
  }
  return { ...mock, default: mock }
})
vi.mock('../e2e/helpers/obsidianCli', () => ({ evalLong: vi.fn() }))
beforeEach(() => {
  vi.mocked(evalLong).mockReset()
  vi.mocked(evalLong)
    .mockResolvedValueOnce(
      JSON.stringify({
        selector: '#sample',
        viewport: { width: 800, height: 600 },
        mobile: false,
        scale: [0, 4],
        elements: [],
      })
    )
    .mockResolvedValueOnce('rendered')
})
it('lists current evidence and removes only previously manifested tool crops, not arbitrary files', async () => {
  vi.mocked(existsSync).mockReturnValue(true)
  vi.mocked(readFileSync).mockReturnValue(
    JSON.stringify({
      directory: resolve('sample-evidence'),
      artifacts: ['violation-001-line-alignment-3x.png', '../unrelated.png', 'unrelated.png'],
    })
  )
  const report = await measureDesign('#sample', 'sample-evidence')
  expect(report.artifacts).toEqual(['capture.png', 'annotated.png'])
  expect(unlinkSync).toHaveBeenCalledTimes(1)
  expect(unlinkSync).toHaveBeenCalledWith(
    resolve('sample-evidence/violation-001-line-alignment-3x.png')
  )
  expect(writeFileSync).toHaveBeenCalled()
})
