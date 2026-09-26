import type { AgentTool } from '../client'

/**
 * A tool whose description is worked out when it is first read, from whatever the settings and
 * the vault hold then — the secrets `fetch` can use, the agents `delegate` can reach, the skills
 * `skill` can load — and kept for the life of the tool, as it was when made at construction.
 *
 * Not at construction: the tools are also made while the settings are still being loaded, to
 * learn what each says of itself, and there are no settings, nor an app, to read yet. Setting
 * the description (a person's override) replaces it.
 */
export function describedLazily(
  tool: Omit<AgentTool, 'description'>,
  describe: () => string
): AgentTool {
  let description: string | undefined
  return Object.defineProperty(tool, 'description', {
    get: () => (description ??= describe()),
    set: (text: string) => {
      description = text
    },
    enumerable: true,
    configurable: true,
  }) as AgentTool
}
