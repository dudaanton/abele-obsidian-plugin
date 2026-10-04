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

const CONSENT_ERRORS = {
  address: 'Enter an HTTP(S) address without URL credentials.',
  publicHttp: 'Public HTTP cannot receive keys. Use HTTPS.',
  key: 'Choose a saved key available on this device.',
  name: 'Enter a name and value for the new key.',
  collision:
    'A key already has that name. Choose another name; existing keys are never overwritten.',
  changed: 'The selected key changed. Choose it again.',
  unreadable:
    'Could not save key permission. Settings cannot be read; restore the settings file and reload before saving permissions.',
  persistence:
    'Could not save key permission. No new permission was confirmed; check storage and retry.',
}
class ConsentError extends Error {
  constructor(code: keyof typeof CONSENT_ERRORS) {
    super(CONSENT_ERRORS[code])
  }
}
/** Only controlled validation messages may reach the dialog; native storage errors can contain keys. */
export function keyConsentError(error: unknown): string {
  return error instanceof ConsentError ? error.message : CONSENT_ERRORS.persistence
}

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
  if (!origin) throw new ConsentError('address')
  if (!canAllowHttp(origin)) {
    try {
      checkKeyTransport(origin)
    } catch {
      throw new ConsentError('publicHttp')
    }
  }
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

export interface NamedKeyBinding {
  name: string
  keyId: string
}

/** A named request is one decision, not independent grants resolved again between saves. */
export function allowNamedKeyRecipients(
  bindings: NamedKeyBinding[],
  address: string,
  signal?: AbortSignal,
  validateRequest?: () => void,
  onCommitted?: () => void
): Promise<void> {
  const captured = bindings.map(({ name, keyId }) => ({ name, keyId }))
  const work = saving.then(async () => {
    const config = AbeleConfig.getInstance()
    const origin = recipientOrigin(address)
    const validate = () => {
      signal?.throwIfAborted()
      requireReadableSettings(config)
      checkKeyTransport(origin)
      for (const binding of captured) {
        const current = config.ai.secrets.find((key) => key.name === binding.name)
        if (
          !current ||
          current.keyId !== binding.keyId ||
          binding.keyId.startsWith('abele-store-key')
        )
          throw new ConsentError('changed')
        if (!secrets().get(binding.keyId)) throw new ConsentError('key')
      }
      validateRequest?.()
    }
    validate()
    initializeDestinations(config)
    validate()
    const records = captured.map((binding) => {
      const previous = config.ai.secrets.find(
        (key) => key.name === binding.name && key.keyId === binding.keyId
      )!
      const added = !(previous.allowedOrigins ?? []).includes(origin)
      const next = added
        ? { ...previous, allowedOrigins: [...(previous.allowedOrigins ?? []), origin] }
        : previous
      const destination = { ...binding, origin }
      return {
        binding,
        previous,
        next,
        added,
        destination,
        wasAccepted: destinationAccepted(destination),
        id: previous.id,
      }
    })
    const changes = new Map(records.map((record) => [record.previous, record.next]))
    const owned: (typeof records)[number]['destination'][] = []
    config.ai = { ...config.ai, secrets: config.ai.secrets.map((key) => changes.get(key) ?? key) }
    try {
      await config.saveSettings()
      validate()
      for (const record of records) {
        validate()
        if (!destinationAccepted(record.destination)) {
          owned.push(record.destination)
          acceptDestinations([record.destination])
        }
      }
      validate()
      onCommitted?.()
    } catch (error) {
      // Local grants made independently during our save belong to that other action.
      const independent = new Set(
        records
          .filter(
            (record) =>
              !record.wasAccepted &&
              !owned.some((grant) => grant.keyId === record.binding.keyId) &&
              destinationAccepted(record.destination)
          )
          .map((record) => record.binding.keyId)
      )
      for (const grant of owned.reverse()) {
        try {
          forgetDestination(grant)
        } catch {
          /* Continue independent metadata cleanup. */
        }
      }
      config.ai = {
        ...config.ai,
        secrets: config.ai.secrets.map((key) => {
          const record = records.find(
            (record) =>
              key === record.next ||
              (record.id
                ? key.id === record.id
                : key.name === record.binding.name && key.keyId === record.binding.keyId)
          )
          if (!record?.added || independent.has(record.binding.keyId)) return key
          // A replacement explicitly granted by another editor is not ours to revoke.
          if (
            key.keyId !== record.binding.keyId &&
            destinationAccepted({ keyId: key.keyId, name: key.name, origin })
          )
            return key
          return {
            ...key,
            allowedOrigins: (key.allowedOrigins ?? []).filter((entry) => entry !== origin),
          }
        }),
      }
      await config.saveSettings().catch(() => {})
      throw error instanceof ConsentError ? error : new ConsentError('persistence')
    }
  })
  saving = work.catch(() => {})
  return work
}

export function removeKeyRecipient(
  keyId: string,
  address: string,
  signal?: AbortSignal
): Promise<void> {
  const work = saving.then(async () => {
    signal?.throwIfAborted()
    const config = AbeleConfig.getInstance()
    requireReadableSettings(config)
    const origin = httpOrigin(address)
    if (!origin || keyId.startsWith('abele-store-key')) throw new ConsentError('key')
    const owned = config.ai.secrets.filter(
      (s) => s.keyId === keyId && s.allowedOrigins?.includes(origin)
    )
    if (!owned.length) throw new ConsentError('key')
    const destination = { keyId, name: owned[0].name || 'Saved key', origin }
    const accepted = destinationAccepted(destination)
    const changed = new Map(
      owned.map((s) => [s, { ...s, allowedOrigins: s.allowedOrigins!.filter((o) => o !== origin) }])
    )
    config.ai = { ...config.ai, secrets: config.ai.secrets.map((s) => changed.get(s) ?? s) }
    try {
      await config.saveSettings()
      signal?.throwIfAborted()
      requireReadableSettings(config)
      forgetDestination(destination)
    } catch {
      config.ai = {
        ...config.ai,
        secrets: config.ai.secrets.map((s) => {
          const previous = [...changed].find(([, replacement]) => replacement === s)?.[0]
          return previous
            ? { ...s, allowedOrigins: [...new Set([...(s.allowedOrigins ?? []), origin])] }
            : s
        }),
      }
      if (accepted) {
        try {
          acceptDestinations([destination])
        } catch {
          /* Keep reporting failure. */
        }
      }
      await config.saveSettings().catch(() => {})
      throw new ConsentError('persistence')
    }
  })
  saving = work.catch(() => {})
  return work
}

function requireReadableSettings(config: AbeleConfig): void {
  if (config.settingsUnreadable) throw new ConsentError('unreadable')
}

async function persistConsent(request: KeyRecipientConsent, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const origin = recipientOrigin(request.address)
  const config = AbeleConfig.getInstance()
  requireReadableSettings(config)
  const store = secrets()
  if (!!request.keyId === !!request.newKey) throw new ConsentError('key')
  const selected = request.keyId ? recipientKeys().find((row) => row.id === request.keyId) : null
  if (request.keyId && !selected) throw new ConsentError('key')
  const previous = selected ? config.ai.secrets.find((s) => s.keyId === selected.id) : undefined
  const name = request.newKey?.name.trim() || previous?.name || selected?.name || ''
  if (!name || (request.newKey && !request.newKey.value)) throw new ConsentError('name')
  if (!previous && config.ai.secrets.some((s) => s.name === name))
    throw new ConsentError('collision')
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
      requireReadableSettings(config)
    }
    // An independent editor may have changed the catalog while protected storage was saving.
    if (!previous && config.ai.secrets.some((s) => s.name === name))
      throw new ConsentError('collision')
    if (previous && !config.ai.secrets.includes(previous)) throw new ConsentError('changed')
    config.ai = {
      ...config.ai,
      secrets: previous
        ? config.ai.secrets.map((s) => (s === previous ? entry : s))
        : [...config.ai.secrets, entry],
    }
    introduced = true
    await config.saveSettings()
    signal?.throwIfAborted()
    // A save can resolve without writing when the settings file becomes unreadable.
    requireReadableSettings(config)
    accepting = true
    acceptDestinations([destination])
    if (canAllowHttp(origin) && !hadHttp) {
      allowingHttp = true
      allowHttpOrigin(origin)
    }
  } catch (error) {
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
    throw error instanceof ConsentError ? error : new ConsentError('persistence')
  }
}
