/** Adapt synchronous fake command answers to the eval proxy's nonce-framed protocol.
 * Tests still inspect the original command and allowance; no executable is started.
 */
export function evalSource(wrapped: string): string {
  const source = /window\.eval\(("(?:[^"\\]|\\.)*")\)/su.exec(wrapped)
  return source ? (JSON.parse(source[1]) as string) : wrapped
}

export function evalOutput(wrapped: string, raw: string): string {
  const id = /__abeleReply:\s*"([a-f\d]+)"/u.exec(wrapped)?.[1]
  if (!id) return raw
  return (
    '=> ' +
    JSON.stringify({
      __abeleReply: id,
      hasValue: true,
      value: raw.replace(/^=>\s*/u, ''),
    })
  )
}

export function framedSpawn(exec: (...args: any[]) => string) {
  return (_node: string, command: string[], options: unknown) => {
    const [, cli, , , ...args] = command
    const wrapped = args.find((arg) => arg.startsWith('code='))?.slice(5) ?? ''
    const logical = args.map((arg) =>
      arg.startsWith('code=') ? 'code=' + evalSource(wrapped) : arg
    )
    const raw = exec(cli, logical, options)
    return { status: 0, pid: 0, stdout: evalOutput(wrapped, raw), stderr: '', signal: null }
  }
}
