import { nanoid } from 'nanoid'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { AiSecret } from '@/ai/types'
import { secrets } from './SecretStore'
import { secretCatalog } from './catalog'
import { httpOrigin } from './DestinationPolicy'
import {
  acceptDestinations,
  destinationAccepted,
  forgetDestination,
  initializeDestinations,
} from './destinations'
import {
  allowedHttpOrigins,
  allowHttpOrigin,
  canAllowHttp,
  checkKeyTransport,
  forgetHttpOrigin,
} from './keyTransport'

export interface KeyRecipientConsent {
  address: string
  keyId?: string
  newKey?: { name: string; value: string }
}

/** Metadata only: values never leave the protected store to populate the picker. */
export function recipientKeys() {
  const store = secrets()
  return secretCatalog(AbeleConfig.getInstance(), {
    status: store.status.value,
    contents: store.contents(),
    has: (id) => !!store.get(id),
  }).filter((row) => row.set && !row.id.startsWith('abele-store-key'))
}

export function recipientOrigin(address: string): string {
  const origin = httpOrigin(address)
  if (!origin) throw new Error('Enter an HTTP(S) address without URL credentials')
  if (!canAllowHttp(origin)) checkKeyTransport(origin)
  return origin
}

// Serialise only this form's transactions; other settings editors remain independent.
let saving: Promise<void> = Promise.resolve()
export function allowKeyRecipient(
  request: KeyRecipientConsent,
  signal?: AbortSignal
): Promise<void> {
  const work = saving.then(() => persistConsent(request, signal))
  saving = work.catch(() => {})
  return work
}

async function persistConsent(request: KeyRecipientConsent, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const origin = recipientOrigin(request.address)
  const config = AbeleConfig.getInstance()
  const store = secrets()
  if (!!request.keyId === !!request.newKey) throw new Error('Choose one key')
  const selected = request.keyId ? recipientKeys().find((row) => row.id === request.keyId) : null
  if (request.keyId && !selected) throw new Error('Choose a saved key available on this device')
  const previous = selected ? config.ai.secrets.find((s) => s.keyId === selected.id) : undefined
  const name = request.newKey?.name.trim() || previous?.name || selected?.name || ''
  if (!name || (request.newKey && !request.newKey.value))
    throw new Error('Enter a key name and value')
  if (!previous && config.ai.secrets.some((s) => s.name === name))
    throw new Error('A saved key already has that name')
  let keyId = selected?.id ?? ''
  if (!keyId) {
    do {
      keyId = `abele-secret-${nanoid(16)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '0')}`
    } while (store.get(keyId) || recipientKeys().some((row) => row.id === keyId))
  }
  if (keyId.startsWith('abele-store-key')) throw new Error('The store key cannot be sent')
  // Seed the installation before introducing this recipient, never after it.
  initializeDestinations(config)
  const destination = { keyId, name, origin }
  const wasAccepted = destinationAccepted(destination)
  const hadHttp = allowedHttpOrigins().includes(origin)
  const hadOrigin = previous?.allowedOrigins?.includes(origin) ?? false
  const entry: AiSecret = previous
    ? { ...previous, allowedOrigins: [...new Set([...(previous.allowedOrigins ?? []), origin])] }
    : { id: nanoid(), name, keyId, allowedOrigins: [origin] }
  let created = false
  let introduced = false
  let accepting = false
  let allowingHttp = false
  try {
    if (request.newKey) {
      created = true
      store.set(keyId, request.newKey.value)
      await store.flush()
      signal?.throwIfAborted()
    }
    // An independent editor may have changed the catalog while protected storage was saving.
    if (!previous && config.ai.secrets.some((s) => s.name === name))
      throw new Error('A saved key already has that name')
    if (previous && !config.ai.secrets.includes(previous))
      throw new Error('The selected key changed; choose it again')
    config.ai = {
      ...config.ai,
      secrets: previous
        ? config.ai.secrets.map((s) => (s === previous ? entry : s))
        : [...config.ai.secrets, entry],
    }
    introduced = true
    await config.saveSettings()
    signal?.throwIfAborted()
    accepting = true
    acceptDestinations([destination])
    if (canAllowHttp(origin) && !hadHttp) {
      allowingHttp = true
      allowHttpOrigin(origin)
    }
  } catch {
    // Revoke only grants this transaction introduced. No await separates the two local writes.
    // One failing storage rollback must not prevent the other revocation or catalog cleanup.
    try {
      if (allowingHttp && !hadHttp) forgetHttpOrigin(origin)
    } catch {
      /* Continue independent cleanup; the operation still fails visibly. */
    }
    try {
      if (accepting && !wasAccepted) forgetDestination(destination)
    } catch {
      /* Removing configured metadata below also prevents sending this pair. */
    }
    if (introduced) {
      config.ai = {
        ...config.ai,
        secrets: config.ai.secrets.flatMap((s) => {
          const sameExisting =
            previous &&
            s.keyId === keyId &&
            (previous.id ? s.id === previous.id : s.name === previous.name)
          if (s !== entry && !sameExisting) return [s]
          if (!previous) return []
          return [
            {
              ...s,
              allowedOrigins: hadOrigin
                ? s.allowedOrigins
                : (s.allowedOrigins ?? []).filter((o) => o !== origin),
            },
          ]
        }),
      }
    }
    // A key adopted or replaced by another editor is no longer ours to remove.
    if (
      created &&
      store.get(keyId) === request.newKey!.value &&
      !recipientKeys().some((row) => row.id === keyId && !row.unused)
    ) {
      try {
        store.remove(keyId)
        await store.flush()
      } catch {
        /* Still roll back settings if protected storage cannot finish cleanup. */
      }
    }
    if (introduced) await config.saveSettings().catch(() => {})
    // Persistence/keychain errors can carry submitted values; never display or log them.
    throw new Error(
      'Could not save key permission. No new permission was confirmed; review the key and try again.'
    )
  }
}
