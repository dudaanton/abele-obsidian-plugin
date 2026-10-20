import type { AgentChoice, NodeProvider } from './providers'

export function preferredAgentChoices(
  choices: AgentChoice[],
  providers: NodeProvider[],
  last?: string | null
): AgentChoice[] {
  const id = (c: AgentChoice) => (c.agent ? `${c.provider}:${c.agent}` : c.provider)
  const preferred =
    choices.find((c) => id(c) === last && !c.unavailable) ??
    choices.find(
      (c) =>
        !c.unavailable &&
        c.provider !== 'fake' &&
        providers.some((p) => p.provider === c.provider && !!p.configuration?.model)
    ) ??
    choices.find((c) => !c.unavailable && c.provider !== 'fake')
  return preferred ? [preferred, ...choices.filter((c) => c !== preferred)] : choices
}

const key = (node: string) => `abele.node.last-agent:${node}`
export function lastNodeAgent(
  node: string,
  storage: { loadLocalStorage(key: string): unknown }
): string | null {
  try {
    const value = storage.loadLocalStorage(key(node))
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}
export function rememberNodeAgent(
  node: string,
  choice: AgentChoice,
  storage: { saveLocalStorage(key: string, value: string): void }
): void {
  try {
    storage.saveLocalStorage(
      key(node),
      choice.agent ? `${choice.provider}:${choice.agent}` : choice.provider
    )
  } catch (error) {
    console.debug('[Abele node] agent preference unavailable', error)
  }
}
