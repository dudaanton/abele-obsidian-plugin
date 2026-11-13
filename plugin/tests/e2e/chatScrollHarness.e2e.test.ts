/** A short preflight for the matrix's native input, fake tool/provider and composer driver. */
import { describe, expect, it } from 'vitest'
import { evalLong, hasTestApi, isObsidianRunning } from './helpers/obsidianCli'
import { nativeInputProbe, withNativeInput } from './helpers/nativeInput'
import { withEmulatedPhone } from './helpers/emulatedPhone'
import { inputProbe, script, type Report } from './helpers/chatScrollMatrix'
import { targets } from './helpers/target'

targets('desktop')
describe.runIf(isObsidianRunning() && hasTestApi())(
  'scroll matrix input and fixture preflight',
  () => {
    it.each([false, true])(
      'completes the fixture with touch=%s',
      async (phone) => {
        const probe = async () => {
          const input = await withNativeInput(
            async () => JSON.parse(await evalLong(inputProbe(phone), 15_000)) as { moved: number }
          )
          console.info('scroll-native-control', JSON.stringify({ phone, ...input }))
          expect(input.moved).toBeGreaterThan(50)
          const result = JSON.parse(
            await evalLong(nativeInputProbe(script('short', 'running-tool', phone)), 120_000)
          ) as Report
          console.info('scroll-matrix-preflight', JSON.stringify({ phone, ...result }))
          expect(result.error).toBeUndefined()
          expect(result.rows).toHaveLength(13)
          for (const row of result.rows) expect(row.samples, row.move).toBeGreaterThan(0)
        }
        if (phone) await withEmulatedPhone(probe)
        else await probe()
      },
      240_000
    )
  }
)
