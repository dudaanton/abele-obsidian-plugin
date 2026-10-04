import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { shotDir } from './helpers/shots'
import { targets } from './helpers/target'
import { securityDialogScript, type DialogReport } from '../helpers/securityDialogProbe'

targets('desktop', 'phone')
const shots = shotDir('abele-security-dialogs')
const available = isObsidianRunning() && hasTestApi()

describe.skipIf(!available)('security dialogs on a real screen', () => {
  it.each([
    [
      'key-destinations',
      ['Allow key and address'],
      ['Allow on this device', 'Allow unencrypted HTTP'],
    ],
    ['key-destinations-new', ['Allow key and address'], []],
    ['saved-key-request', ['Cancel', 'Allow address and send'], []],
  ])(
    '%s keeps its actions visible while the body scrolls',
    async (name, actions, rowActions) => {
      const raw = await evalLong(
        securityDialogScript(String(name), shots + '/' + name + '.png'),
        60_000
      )
      if (raw.startsWith('Error:')) throw new Error(raw)
      const result = JSON.parse(raw) as DialogReport
      expect(result.shell).toBe(true)
      expect(result.bodyActions).toEqual(rowActions)
      expect(result.actions).toEqual(actions)
      if (name === 'key-destinations')
        expect(result.rows).toEqual([
          {
            name: 'Sample secure provider',
            description: 'https://api.sample.example',
            actions: ['Allow on this device'],
          },
          {
            name: 'Sample home provider',
            description:
              'http://192.168.8.20:1234 — Unencrypted: anyone on the network path can read the key.',
            actions: ['Allow unencrypted HTTP'],
          },
        ])
      else expect(result.rows).toEqual([])
      expect(result.outside).toEqual([])
      expect(result.scrolled).toBe(true)
      expect(result.footerMoved).toBeLessThanOrEqual(1)
      expect(result.restored).toBe(true)
      expect(result.shot).not.toMatch(/^no picture:/)
      console.info(JSON.stringify(result))
    },
    90_000
  )
})
