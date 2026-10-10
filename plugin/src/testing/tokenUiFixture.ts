import { TokenUi } from '@/sync/tokenUi'
import { TokenConnectionRegistry } from '@/sync/tokenConnectionRegistry'
import { encodeAccessToken } from '@/sync/v2/contract'

/** Anonymous, isolated UI data. No host files, credentials or real requests are used. */
export function tokenUiFixture(empty = false): TokenUi {
  const values = new Map<string, unknown>(),
    keys = new Map<string, string>()
  const registry = TokenConnectionRegistry.open({
    loadLocalStorage: (key) => structuredClone(values.get(key) ?? null),
    saveLocalStorage: (key, value) => {
      values.set(key, structuredClone(value))
    },
  })
  const token = {
    v: 1 as const,
    address: 'https://sync.example',
    key: 'a'.repeat(43),
    scope: { kind: 'folder' as const, id: 'root', path: '/' },
  }
  const secrets = {
    get: (id: string) => keys.get(id) ?? null,
    set: (id: string, key: string) => {
      keys.set(id, key)
    },
    remove: (id: string) => {
      keys.delete(id)
    },
  }
  const transport: typeof fetch = async (input, init) => {
    const route = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    return new Response(
      JSON.stringify(
        init?.method === 'POST'
          ? {
              token: encodeAccessToken(token),
              info: {
                id: 'new-access',
                label: 'Sample second device',
                scope: token.scope,
                issued_by_token_id: 'token-a',
                created_at: '2025-01-01T12:00:00Z',
                revoked_at: null,
              },
            }
          : route.endsWith('/manifest')
            ? {
                items: [
                  {
                    file_id: 'folder-a',
                    path: 'Shared/Sample project with a deliberately long folder name',
                    kind: 'directory',
                    version_id: 'v-a',
                    mtime: 100,
                  },
                  {
                    file_id: 'group-a',
                    path: 'Groups/Sample research group with a long name.md',
                    kind: 'note',
                    version_id: 'v-a',
                    mtime: 100,
                    sha: 'a'.repeat(64),
                    size: 20,
                  },
                ],
                cursor: 1,
                next: null,
              }
            : route.endsWith('/tokens')
              ? {
                  items: [
                    {
                      id: 'issued-a',
                      label: 'Sample collaborator’s device with a long description',
                      scope: token.scope,
                      issued_by_token_id: 'token-a',
                      created_at: '2025-01-01T10:00:00Z',
                      revoked_at: null,
                    },
                  ],
                }
              : { revoked: true }
      )
    )
  }
  const ui = new TokenUi(registry, secrets, transport)
  if (empty) return ui
  for (const [index, address] of [
    'https://sync.example',
    'https://unavailable.example',
    'https://collaboration.example',
  ].entries()) {
    const id = registry.add(),
      scope =
        index === 2
          ? {
              kind: 'group' as const,
              id: 'group-a',
              path: 'Groups/Sample research group with a deliberately long name.md',
            }
          : token.scope
    registry.attach(
      id,
      { ...token, address, scope },
      {
        protocol: 2,
        space_id: 'sample-space',
        token_id: 'token-' + index,
        scope,
        status: 'active',
      },
      secrets
    )
    if (index === 1) registry.setStatus(id, 'offline')
    ui.bind(id, {
      sync: async () => {},
      pause: async () => {},
      disconnect: async () => {},
      apply: async () => {},
      resolve: async () => null,
      opened: async () => [],
    })
  }
  ui.refresh()
  const first = ui.rows.value[0],
    source = {
      id: first.id,
      address: first.address,
      spaceId: first.spaceId,
      tokenId: first.tokenId,
      scope: first.scope,
    }
  ui.candidates.value = [
    {
      id: 'candidate-a',
      source,
      fileId: 'script-a',
      versionId: 'version-a',
      path: 'Scripts/Sample automation with a long filename.js',
      previousPath: null,
      operation: 'modify',
      directory: false,
      receivedAt: Date.parse('2025-01-01T12:00:00Z'),
      mtime: Date.parse('2025-01-01T11:00:00Z'),
      sha: 'a'.repeat(64),
      bytes: Array.from(
        new TextEncoder().encode(
          '// Sample reviewed code\nexport const sample = "This exact version is waiting for approval";'
        )
      ),
      status: 'pending',
    },
  ]
  const group = ui.rows.value[2]
  ui.questions.value = [
    {
      id: 'question-a',
      fileId: 'local-image-a',
      path: 'Private/Sample diagram with a deliberately long filename.png',
      noteIds: ['local-note-a'],
      source: {
        id: group.id,
        address: group.address,
        spaceId: group.spaceId,
        tokenId: group.tokenId,
        scope: group.scope,
      },
    },
  ]
  ui.publish(first.id, {
    lastSync: Date.parse('2025-01-01T12:00:00Z'),
    completed: 820,
    total: 2500,
    refused: [
      {
        path: 'Shared/sample-large-video.mp4',
        reason: 'The server is full. This file is kept locally and is still waiting.',
      },
    ],
    conflicts: ['Shared/Sample note (Conflicted copy sample-device).md'],
  })
  ui.publish(ui.rows.value[1].id, {
    error: 'The server is not reachable. Other connections keep working.',
  })
  return ui
}

export const sampleIssuedToken = encodeAccessToken({
  v: 1,
  address: 'https://sync.example',
  key: 'a'.repeat(43),
  scope: { kind: 'folder', id: 'root', path: '/' },
})
