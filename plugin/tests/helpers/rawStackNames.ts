/** Diagnostic caller names without invoking the runner's synchronous source-map formatter. */
export function rawStackNames(): string {
  const error = new Error()
  const format = Error.prepareStackTrace
  try {
    Error.prepareStackTrace = (_, frames) => frames
    const stack: unknown = error.stack
    return Array.isArray(stack)
      ? (stack as NodeJS.CallSite[]).map((frame) => frame.getFunctionName() ?? '').join(' ')
      : String(stack ?? '')
  } finally {
    Error.prepareStackTrace = format
  }
}
