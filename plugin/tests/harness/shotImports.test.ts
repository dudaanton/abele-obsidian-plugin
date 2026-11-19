import { afterEach, expect, it, vi } from 'vitest'

const { mkdirSync } = vi.hoisted(() => ({
  mkdirSync: vi.fn(() => {
    throw new Error('Screenshot directory creation is forbidden during harness imports')
  }),
}))
vi.mock('node:fs', async (importOriginal) => {
  const mock = { ...(await importOriginal<typeof import('node:fs')>()), mkdirSync }
  return { ...mock, default: mock }
})

afterEach(() => vi.unstubAllEnvs())

it.each([undefined, 'sample-shots'])(
  'imports harness helpers without creating directories (screenshot root: %s)',
  async (root) => {
    vi.resetModules()
    vi.stubEnv('ABELE_E2E_SHOTS', root)
    vi.stubEnv('DESIGN_LINT_OUT_DIR', undefined)
    const matrix = await import('../e2e/helpers/chatScrollMatrix')
    await import('../e2e/helpers/designCatalogueContracts')
    expect(matrix.script('long', 'text', true)).toContain(`${root ?? '/tmp'}/abele-phone`)
    expect(mkdirSync).not.toHaveBeenCalled()
    // Ensure the import guard intercepts the filesystem used by screenshot helpers.
    const { shotDir } = await import('../e2e/helpers/shots')
    expect(() => shotDir('sample-capture')).toThrow('Screenshot directory creation is forbidden')
  }
)
