export function formatFrameName(raw: string): { name: string; receiver: string } {
  const async = raw.startsWith('async ') ? 'async ' : ''
  const value = raw.slice(async.length).trim()
  // js-debug can include an abbreviated object preview in the receiver ("Timeout {").
  // Split at the method boundary before cleaning that preview, never truncate the function.
  const method = /^(.*)\.([^.]*)$/.exec(value)
  const receiver = method ? method[1].replace(/[{}]/g, '').trim() : ''
  const name = (method ? method[2] : value).replace(/[{}]/g, '').trim()
  return {
    name: async + (!name || name === '<anonymous>' ? '(anonymous)' : name),
    receiver: receiver === 'global' || receiver === 'globalThis' ? '' : receiver,
  }
}

export function asyncBoundary(name: string): string | undefined {
  const match = /^(.*?)\s*\(async\)$/.exec(name)
  return match ? match[1] || 'async' : undefined
}
