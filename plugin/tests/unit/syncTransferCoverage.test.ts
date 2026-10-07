import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/services/AbeleConfig'
import { defaultSyncSettings } from '@/sync/settings'
import { emptyConnection } from '@/sync/connection'
import { collectEntries, applyEntries, buildPayload } from '@/transfer/entries'
import {
  connectionEntry,
  withSibling,
  readTransferred,
  CONNECTION_TOKEN,
} from '@/transfer/connection'

it('carries every declared shared sync setting through its transfer section', () => {
  const file = ts.createSourceFile(
    'settings.ts',
    readFileSync('src/sync/settings.ts', 'utf8'),
    ts.ScriptTarget.Latest
  )
  const shape = file.statements.find(
    (node) => ts.isInterfaceDeclaration(node) && node.name.text === 'SyncSettings'
  ) as ts.InterfaceDeclaration
  const names = shape.members
    .filter(ts.isPropertySignature)
    .map((member) => member.name.getText(file))
  const defaults = defaultSyncSettings()
  expect(Object.keys(defaults).sort()).toEqual(names.sort())
  const source = {
    ...DEFAULT_SETTINGS,
    sync: {
      keySignature: { property: 'sample-private', value: 'yes' },
      sharing: [
        { issuer: 'https://sync.example', vaultId: 'sample-vault', grants: ['sample-group'] },
      ],
    },
  }
  const entry = collectEntries(source).find((item) => item.section === 'sync')!
  expect(Object.keys((entry.data as { sync: object }).sync).sort()).toEqual(names.sort())
  expect(applyEntries([entry], { ...DEFAULT_SETTINGS, sync: defaults }).sync).toEqual(source.sync)
})

it('carries all selective choices except the receiver-local size cap, using only a sibling token', () => {
  const own = emptyConnection()
  Object.assign(own, {
    serverUrl: 'https://sync.example',
    vaultId: 'sample-vault',
    vaultName: 'Sample',
    deviceId: 'sender',
    deviceTokenId: 'abele-sync-device-sender',
    paused: true,
  })
  own.selective.images = false
  own.selective.excludedFolders = ['Sample skipped']
  own.selective.maxFileBytes = 1234
  const entry = connectionEntry(own)!
  const { entry: sent, secrets } = withSibling(entry, {
    serverUrl: own.serverUrl,
    vaultId: own.vaultId,
    vaultName: own.vaultName,
    deviceId: 'receiver',
    deviceName: 'Sample receiver',
    token: 'invented-sibling-token',
  })
  const received = readTransferred(sent, secrets)
  expect(Object.keys(received.selective).sort()).toEqual(
    Object.keys(own.selective)
      .filter((key) => key !== 'maxFileBytes')
      .sort()
  )
  expect(received.selective).toEqual(
    Object.fromEntries(Object.entries(own.selective).filter(([key]) => key !== 'maxFileBytes'))
  )
  expect(received.connection?.deviceId).toBe('receiver')
  expect(received.token).toBe('invented-sibling-token')
  expect(sent.secretIds).toEqual([CONNECTION_TOKEN])
  expect(JSON.stringify(sent)).not.toContain(own.deviceTokenId)
  expect(JSON.stringify(sent)).not.toContain('paused')
  const payload = buildPayload([sent], (id) => secrets[id] ?? '')
  expect(payload.secrets).toEqual(secrets)
})
