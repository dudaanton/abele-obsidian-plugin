/** Empty names leave the transport's existing identity untouched. */
export function clientHeaders(clientName?: string): Record<string, string> {
  const name = clientName?.trim()
  return name ? { 'User-Agent': name } : {}
}

export const CLIENT_NAME_DESCRIPTION =
  'User-Agent sent to this connection. Empty keeps the default. Mobile streaming may ignore it.'
