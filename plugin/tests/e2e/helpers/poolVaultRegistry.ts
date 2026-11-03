/** Read-only discovery: no bridge methods/getters or current-vault identity fallback. */
export function poolVaultRegistry(host: object) {
  const fields = Object.getOwnPropertyDescriptors(host)
  const candidates = Object.keys(fields)
    .filter((key) => /vault|registry/i.test(key))
    .sort()
  const unavailable = {
    available: false as const,
    candidates,
    reason:
      'No readable host vaultRegistry data map; current appId is not independent registry evidence.',
  }
  const field = fields.vaultRegistry
  if (!field || !('value' in field) || !field.value || typeof field.value !== 'object')
    return unavailable
  const rows: { name: string; id: string }[] = []
  for (const [id, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(field.value))) {
    if (
      !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
      !('value' in descriptor) ||
      !descriptor.value ||
      typeof descriptor.value !== 'object'
    )
      return unavailable
    const name = Object.getOwnPropertyDescriptor(descriptor.value, 'name')
    if (!name || !('value' in name) || typeof name.value !== 'string' || !name.value)
      return unavailable
    rows.push({ name: name.value, id })
  }
  if (!rows.length || new Set(rows.map((row) => row.name)).size !== rows.length) return unavailable
  return { available: true as const, source: 'host.vaultRegistry', vaults: rows }
}
