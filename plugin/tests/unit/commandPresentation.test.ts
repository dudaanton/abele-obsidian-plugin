import { expect, it } from 'vitest'
import { commandFolder, commandLine } from '@/node/commandPresentation'

it('shows the named target and relative folder while retaining argument boundaries', () => {
  expect(
    commandFolder(
      '/workspace/sample-project/src/tools',
      '/workspace/sample-project',
      'sample-project'
    )
  ).toBe('sample-project/src/tools')
  expect(commandFolder('src/tools', '/workspace/sample-project', 'work/sample')).toBe(
    'work/sample/src/tools'
  )
  expect(commandLine(['printf', 'sample\n\u202eline'])).toBe(
    "printf $'sample\\U0000000a\\U0000202eline'"
  )
})
