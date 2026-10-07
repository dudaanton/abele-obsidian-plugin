import { expect, it } from 'vitest'
import { calendarKeyId } from '@/calendars/settings'
import { mcpKeyId } from '@/ai/mcp/settings'
import { keychainId } from '@/secrets/keychainId'
import { deviceKeyId } from '@/secrets/storeFile'
import { tokenServerId } from '@/secrets/deviceSecret'
import { CredentialGenerations } from '@/secrets/credentialGenerations'
import { newSecretId } from '@/sync/ids'
import { REVOKE_SECRET_PREFIX } from '@/sync/connection'
import { NodeRegistry } from '@/node/NodeRegistry'
import { scopedSecretSlot } from '@/sync/scoped/scopedSecretSlots'

// Inventory of minted keychain names: settings (calendar/MCP/GitHub/providers/images/saved
// keys), secret store, credential clocks, sync/revoke and scoped credentials/proofs, nodes.
// Imported/user-chosen references are not minted IDs and are validated by Obsidian itself.
it('all plugin-minted secret names satisfy the host rule, including derived proof names', () => {
  const ids = [
    'abele-firefly-token',
    'abele-github-token',
    'abele-github-notifications-token',
    'abele-openrouter',
  ]
  for (const stem of ['A'.repeat(21), '_'.repeat(21), '-'.repeat(21), 'a'.repeat(21)]) {
    ids.push(calendarKeyId(stem), mcpKeyId(stem), keychainId('abele-gh', stem))
  }
  for (const prefix of ['abele-provider', 'abele-img', 'abele-secret'])
    ids.push(`${prefix}-${'a'.repeat(16)}`)
  ids.push(deviceKeyId('a'.repeat(32)))
  for (const id of [newSecretId(), `${REVOKE_SECRET_PREFIX}sample00`])
    ids.push(id, tokenServerId(id))
  const uuid = '12345678-1234-4234-8234-123456789abc'
  const registry = new NodeRegistry({
    read: () => [],
    write: () => {},
    getSecret: (id) => {
      ids.push(id)
      return ''
    },
    setSecret: (id) => {
      ids.push(id)
    },
    removeSecret: () => {},
  })
  registry.add(
    { id: uuid, label: 'Sample node', url: 'http://127.0.0.1:7777', expectedNodeId: 'sample-node' },
    'invented-token'
  )
  registry.token(uuid)
  for (const kind of ['invitation', 'installation'])
    for (const suffix of ['', ':binding', ':accepted'])
      ids.push(scopedSecretSlot(`abele-scoped-${kind}-${uuid}${suffix}`))
  const clock = new CredentialGenerations({
    getSecret: (id) => {
      ids.push(id)
      return null
    },
    setSecret: (id) => {
      ids.push(id)
    },
  })
  for (const id of [...ids]) clock.get(id, 'invented-value')
  for (const id of ids) expect(id, id).toMatch(/^[a-z0-9-]{1,64}$/)
})
