export interface LaunchConfiguration {
  runtimeArguments: string
  cwd: string
  environment: string
}

export interface LaunchOptions {
  runtime_argv?: string[]
  cwd?: string
  env?: Record<string, string>
}

/** Literal KEY=value lines; values are never expanded or passed through a shell. */
export function parseLaunchEnvironment(text: string): Record<string, string> {
  const entries = text.split(/\r?\n/).filter((line) => line.trim())
  return Object.fromEntries(
    entries.map((line) => {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
      if (!match || line.includes('\0')) throw new Error('invalid_environment')
      return [match[1], match[2]]
    })
  )
}
