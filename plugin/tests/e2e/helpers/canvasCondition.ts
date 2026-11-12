import { WAIT_PRELUDE } from './wait'

/** Poll in the page: a readiness retry must not launch another native driver process. */
export const canvasCondition = (body: string, timeoutMs = 10_000): string => `
  ${WAIT_PRELUDE}
  const ready = await until(async () => { ${body} }, ${timeoutMs}, 50)
  if (!ready) throw new Error('Canvas condition did not become ready')
  return ready
`
