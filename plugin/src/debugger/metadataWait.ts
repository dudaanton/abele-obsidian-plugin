import { DebuggerControlMethodSchemas, DebuggerWaitResultSchema } from '@abele/node-protocol'

type WaitParams = Parameters<import('@abele/node-client').NodeClient['debugger']['wait']>[0]
/** Stop details are additive metadata; snapshots retain the released schema. */
export async function waitForDebuggerMetadata(
  client: { request: (method: string, params: unknown) => Promise<unknown> },
  params: WaitParams
) {
  const request = DebuggerControlMethodSchemas['debugger.v1.wait'].parse({
    ...params,
    kinds: [...new Set([...params.kinds, 'stop_details'])],
  })
  const raw = await client.request('debugger.v1.wait', request)
  // The old SDK event union cannot decode stop_details. This observer uses its snapshot,
  // never the event payload as a substitute for current state.
  return DebuggerWaitResultSchema.omit({ event: true }).strip().parse(raw)
}
