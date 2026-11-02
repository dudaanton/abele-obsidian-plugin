import { expect, it } from 'vitest'
import { describeAttachment } from '@/debugger/trace/attachment'

const base = { name: 'sample.js', pid: 123, folder: '/sample/project', files: [] }
it('does not turn missing evidence into a negative conclusion', () => {
  const text = describeAttachment(base, 'src/sample.ts')
  expect(text).toContain('Attached here: sample.js (pid 123)')
  expect(text).toContain('unknown')
  expect(text).not.toMatch(/not loaded|none maps|source maps: no/)
})
it.each([true, false, undefined])(
  'reports observed missing mappings with map presence %s',
  (source_maps) => {
    const text = describeAttachment(
      {
        ...base,
        loaded_scripts: 12,
        source_maps,
        files: [{ path: 'src/sample.ts', loaded: false, mapped: false }],
      },
      'src/sample.ts'
    )
    expect(text).toContain('has not loaded src/sample.ts yet')
    expect(text).toContain('loads 12 scripts, none maps to src/sample.ts')
    expect(text).toContain(
      `source maps: ${source_maps === undefined ? 'unknown' : source_maps ? 'yes' : 'no'}`
    )
  }
)
