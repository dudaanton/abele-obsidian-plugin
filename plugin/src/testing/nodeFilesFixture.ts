import { ref } from 'vue'
import { MemoryClientStore, NodeClient, type DiffMode } from '@abele/node-client'
import { NodeFilesModel } from '@/node/NodeFilesModel'
const path = 'sample-folder/long-file-name-with-several-parts.ts'
const text = 'export const sample = "retained file content"\n'.repeat(60)
const patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,2 +1,2 @@\n export const sample = true\n-old value\n+new value\ndiff --git a/other.txt b/other.txt\n--- a/other.txt\n+++ b/other.txt\n@@ -1 +1 @@\n-before\n+after\n`
/** Invented browser contract only: layout checks never start an agent or daemon. */
export async function nodeFilesFixture(view: 'files' | 'diffs' | 'review' | 'history' = 'files') {
  const store = new MemoryClientStore()
  await store.transaction((s) => {
    s.node_id = 'sample-node'
    s.installation_id = 'sample-installation'
  })
  const client = new NodeClient(
    { url: 'ws://127.0.0.1:7777/channel', profile: 'local-token-v1', token: '0'.repeat(64) },
    store
  )
  client.listFiles = async () => ({
    entries: [
      { name: 'sample-folder', path: 'sample-folder', kind: 'directory', size: 0 },
      { name: '.sample-config', path: '.sample-config', kind: 'file', size: 15 },
      { name: 'ignored-file.txt', path: 'ignored-file.txt', kind: 'file', size: 20 },
      { name: 'outside-link', path: 'outside-link', kind: 'symlink', size: 10 },
    ],
    next: null,
  })
  client.readFile = async (p, name) => ({
    workspace_id: p,
    path: name,
    content_id: 'sample-content',
    size: text.length,
    binary: false,
    large: false,
    too_large: false,
  })
  client.readContent = async (_w, _id, offset = 0) => ({
    offset,
    total: text.length,
    base64: btoa(text.slice(offset)),
  })
  client.captureDiff = async (w, mode: DiffMode = 'head') => ({
    diff_id: 'sample-immutable-snapshot',
    workspace_id: w,
    mode,
    head_commit: 'a'.repeat(40),
    base_commit: 'b'.repeat(40),
    merge_base: mode === 'base' ? 'b'.repeat(40) : null,
    commit: null,
    content_id: 'sample-patch',
    size: patch.length,
    created_at: '2026-01-01T00:00:00Z',
  })
  client.readDiff = async (_w, _id, offset = 0) => ({
    offset,
    total: patch.length,
    base64: btoa(patch.slice(offset)),
  })
  client.gitLog = async () => [
    { commit: 'a'.repeat(40), subject: 'Update sample file' },
    { commit: 'b'.repeat(40), subject: 'Initial sample' },
  ]
  const model = new NodeFilesModel(client, 'sample-node', 'sample-workspace', 'sample-session')
  if (view !== 'files' && view !== 'history') await model.loadDiff('head')
  if (view === 'review')
    await model.addComment(
      model.selectLines(model.files.value[0], { side: 'R', start: 2, end: 2 }),
      'Please explain why this changed. Keep the retained context when the workspace moves on.'
    )
  if (view === 'history') await model.loadLog()
  return {
    model,
    connection: { state: ref('connected' as const) },
    initialTab: view === 'review' ? ('diffs' as const) : view,
    initialPath: view === 'files' ? path : undefined,
    initialSelection:
      view === 'review'
        ? model.selectLines(model.files.value[0], { side: 'R', start: 2, end: 2 })
        : undefined,
  }
}
