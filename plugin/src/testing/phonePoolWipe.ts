export interface PhoneWipeIdentity {
  vault: string
  appId: string
  confirm: string
  operation?: string
}
export interface PhoneWipeRow {
  database: string
  store: string
  key: IDBValidKey
  namespace: string
  value: unknown
}
/** Opaque namespace, never a filesystem path. Mobile additionally uses a container-relative id. */
export function validPoolAppId(appId: unknown, phone: boolean): appId is string {
  return (
    typeof appId === 'string' &&
    appId.length <= 128 &&
    (/^[A-Za-z0-9_-]+$/.test(appId) || (phone && /^documents\/[A-Za-z0-9_-]+$/.test(appId)))
  )
}
export function phonePoolWipePlan(
  expected: PhoneWipeIdentity,
  actual: { vault: string; appId: string; phone?: boolean },
  databases: string[],
  rows: PhoneWipeRow[],
  local: { namespace: string; key: string; value: unknown }[]
): { databases: string[]; rows: PhoneWipeRow[]; keys: string[]; paths: string[] } {
  if (
    !(
      expected.confirm === 'wipe-sync-phone-pool' ||
      (expected.confirm === 'wipe-sync-pool' && expected.operation === 'syncWipePool')
    ) ||
    !expected.vault ||
    !validPoolAppId(expected.appId, actual.phone === true) ||
    expected.vault !== actual.vault ||
    expected.appId !== actual.appId
  )
    throw new Error('Exact independently configured pool vault name and appId required')
  const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
  const allowed = new RegExp(
    '^(?:' +
      uuid +
      '|abele-sync-' +
      uuid +
      '|abele-sync-reviews-' +
      uuid +
      '|abele-scoped-(?:native-)?' +
      uuid +
      '|abele-local-edit-copies-' +
      uuid +
      '(?:-[a-f0-9]{64})?)$',
    'i'
  )
  const references = new Map<string, Set<string>>()
  const pluginKey = (key: string) =>
    /^(abele-sync-|abele-scoped-|abele-local-edit-copies-)/.test(key)
  const remember = (namespace: string, name: unknown) => {
    if (typeof name !== 'string' || !allowed.test(name))
      throw new Error('Malformed or non-plugin database reference')
    const owners = references.get(name) ?? new Set<string>()
    owners.add(namespace)
    references.set(name, owners)
  }
  const visit = (namespace: string, value: unknown, key = '', depth = 0): void => {
    if (depth > 64) throw new Error('Recovery reference nesting is invalid')
    if (['ledgerId', 'databaseName'].includes(key) && typeof value !== 'string')
      throw new Error('Malformed database reference')
    if (key === 'abele-sync-device-review-id-v1' && value != null && typeof value !== 'string')
      throw new Error('Malformed review database reference')
    if (value == null) return
    if (typeof value === 'string') {
      if (key === 'abele-sync-device-review-id-v1')
        remember(namespace, 'abele-sync-reviews-' + value)
      else if (key === 'ledgerId' || key === 'databaseName') remember(namespace, value)
      else if (key === 'stateId' && value) remember(namespace, 'abele-sync-' + value)
      else if (
        (key === 'value' || pluginKey(key)) &&
        (value.startsWith('{') || value.startsWith('['))
      ) {
        let parsed: unknown
        try {
          parsed = JSON.parse(value)
        } catch {
          throw new Error('Malformed recovery document')
        }
        visit(namespace, parsed, key, depth + 1)
      }
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (key === 'abele-sync-test-pool-ledgers-v1') remember(namespace, item)
        else visit(namespace, item, '', depth + 1)
      }
    } else if (typeof value === 'object') {
      for (const [name, item] of Object.entries(value)) visit(namespace, item, name, depth + 1)
    } else if (['ledgerId', 'databaseName', 'stateId'].includes(key)) {
      throw new Error('Malformed database reference')
    }
  }
  for (const row of rows) {
    const stores =
      row.database === 'abele-sync-host-v1'
        ? ['host', 'host-records', 'host-records-v3']
        : row.database === 'abele-sync-device-credentials-v1'
          ? ['credentials']
          : []
    if (!stores.includes(row.store) || !row.namespace)
      throw new Error('Unknown shared plugin store')
    if (Array.isArray(row.key)) {
      if (row.key[0] !== row.namespace) throw new Error('Cross-vault row key')
    } else if (typeof row.key === 'string') {
      let parts: unknown
      try {
        parts = JSON.parse(row.key)
      } catch {
        throw new Error('Malformed row key')
      }
      if (!Array.isArray(parts) || parts[0] !== row.namespace)
        throw new Error('Cross-vault row key')
    } else throw new Error('Unknown row key')
    // Credential ciphertext is not a journal or a database reference.
    if (row.database === 'abele-sync-host-v1') visit(row.namespace, row.value)
  }
  for (const entry of local) {
    if (!entry.namespace || !pluginKey(entry.key)) continue
    visit(entry.namespace, entry.value, entry.key)
  }
  const selected: string[] = []
  for (const [name, owners] of references) {
    if (!owners.has(actual.appId)) continue
    if (owners.size !== 1) throw new Error('Database is also referenced by a foreign vault')
    if (databases.includes(name)) selected.push(name)
  }
  return {
    databases: selected.sort(),
    rows: rows.filter((row) => row.namespace === actual.appId),
    keys: local
      .filter((entry) => entry.namespace === actual.appId && pluginKey(entry.key))
      .map((entry) => entry.key),
    paths: ['.abele-sync'],
  }
}

export interface PhoneWipePorts {
  identity(): { vault: string; appId: string; phone: boolean }
  stop(): Promise<void>
  snapshot(): Promise<{
    databases: string[]
    rows: PhoneWipeRow[]
    local: { namespace: string; key: string; value: unknown }[]
  }>
  erase(plan: ReturnType<typeof phonePoolWipePlan>): Promise<void>
  reload(): Promise<void>
  verify(): Promise<void>
}
export function executePhonePoolWipe(expected: PhoneWipeIdentity, ports: PhoneWipePorts) {
  if (!ports.identity().phone) return Promise.reject(new Error('Real phone pool required'))
  if (expected.confirm !== 'wipe-sync-phone-pool')
    return Promise.reject(
      new Error('Exact independently configured pool vault confirmation required')
    )
  return executeWipe(expected, ports, true)
}
/** Test-only desktop/phone operation. No ordinary reset can authorize it. */
export function executePoolWipe(expected: PhoneWipeIdentity, ports: PhoneWipePorts) {
  if (expected.operation !== 'syncWipePool' || expected.confirm !== 'wipe-sync-pool')
    return Promise.reject(new Error('Explicit syncWipePool operation and confirmation required'))
  return executeWipe(expected, ports, false)
}
async function executeWipe(expected: PhoneWipeIdentity, ports: PhoneWipePorts, phoneOnly: boolean) {
  expected = { ...expected }
  const check = () => {
    const actual = ports.identity()
    if (phoneOnly && !actual.phone) throw new Error('Real phone pool required')
    phonePoolWipePlan(expected, actual, [], [], [])
    return actual
  }
  const stage = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    console.debug('[e2e sync wipe] stage', name, 'start')
    try {
      const result = await work()
      console.debug('[e2e sync wipe] stage', name, 'complete')
      return result
    } catch (cause) {
      throw new Error('Pool wipe ' + name + ': ' + String((cause as Error)?.message ?? cause), {
        cause,
      })
    }
  }
  check()
  await stage('stop', () => ports.stop())
  const snapshot = await stage('snapshot', () => ports.snapshot())
  const plan = phonePoolWipePlan(
    expected,
    check(),
    snapshot.databases,
    snapshot.rows,
    snapshot.local
  )
  await stage('erase', () => ports.erase(plan))
  check()
  await stage('reload', () => ports.reload())
  check()
  await stage('verify', () => ports.verify())
  return { databases: plan.databases, rows: plan.rows.length, keys: plan.keys, paths: plan.paths }
}
