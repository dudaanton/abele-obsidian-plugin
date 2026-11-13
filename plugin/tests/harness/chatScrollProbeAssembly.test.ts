import { expect, it, vi } from 'vitest'
import { nativeInputProbe } from '../e2e/helpers/nativeInput'
import { script, endScript, followScript, handoffScript } from '../e2e/helpers/chatScrollMatrix'
import { wideScript } from '../e2e/helpers/chatScrollWide'

vi.mock('../e2e/helpers/shots', () => ({ shotDir: () => '/sample-shots' }))

it.each([false, true])('assembles gesture-scoped chat probes with touch=%s', (phone) => {
  for (const source of [
    script('short', 'running-tool', phone),
    endScript('long', 'text', phone),
    followScript(phone),
    handoffScript(phone),
    ...(!phone ? [wideScript()] : []),
  ]) {
    const wrapped = nativeInputProbe(source)
    // Probe variants splice async phases and cleanup code into the full scenario.
    // Validate the final renderer program, including the injected awaited teardown.
    expect(() => new Function(`return ${wrapped}`)).not.toThrow()
  }
})
