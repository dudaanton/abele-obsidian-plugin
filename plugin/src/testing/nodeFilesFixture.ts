import { ref } from 'vue'
import { MemoryClientStore, NodeClient, type DiffMode } from '@abele/node-client'
import { NodeFilesModel } from '@/node/NodeFilesModel'
const path = 'sample-folder/long-file-name-with-several-parts.ts'
const text = 'export const sample = "retained file content"\n'.repeat(60)
const patch = `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1,2 +1,2 @@\n export const sample = true\n-old value\n+new value\ndiff --git a/other.txt b/other.txt\n--- a/other.txt\n+++ b/other.txt\n@@ -1 +1 @@\n-before\n+after\n`
/** Invented browser contract only: layout checks never start an agent or daemon. */
export async function nodeFilesFixture(
  view:
    | 'files'
    | 'diffs'
    | 'review'
    | 'history'
    | 'edit'
    | 'conflict'
    | 'unknown'
    | 'binary'
    | 'tooLarge'
    | 'shared' = 'files'
) {
  const fileView = [
    'files',
    'edit',
    'conflict',
    'unknown',
    'binary',
    'tooLarge',
    'shared',
  ].includes(view)
  const contentId = Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    (b) => b.toString(16).padStart(2, '0')
  ).join('')
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
    content_id: contentId,
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
  if (!fileView && view !== 'history') await model.loadDiff('head')
  if (fileView && view !== 'files') {
    await model.openFile(path)
    await model.beginEditing()
    await model.editText('export const sample = "local draft"\n')
    if (view === 'binary' || view === 'tooLarge') {
      const read = client.readFile
      client.readFile = async (...args) => ({
        ...(await read(...args)),
        binary: view === 'binary',
        too_large: view === 'tooLarge',
        content_id: view === 'tooLarge' ? null : 'b'.repeat(64),
        size: view === 'tooLarge' ? 20 * 1024 * 1024 : 64,
      })
      await model.openFile(path)
    }
    if (view === 'shared') {
      const other = new NodeFilesModel(client, model.nodeId, model.workspaceId, 'other-session')
      await other.openFile(path)
      await other.beginEditing()
      await other.editText('Draft from another view')
      await model.editText('export const sample = "visible local draft"\n').catch(() => {})
    }
    if (view === 'conflict' || view === 'unknown') {
      await model.saveFile()
      const pending = model.draft.value!.pending!
      await store.transaction((s) => {
        s.outbox = []
        s.results[pending.operationId] = {
          result: {
            operation_id: pending.operationId,
            workspace_id: model.workspaceId,
            path,
            state: view === 'conflict' ? 'conflict' : 'outcome_unknown',
            expected_content_id: contentId,
            content_id: 'b'.repeat(64),
            predecessor_content_id: contentId,
            recovery_path: view === 'unknown' ? 'sample-folder/.abele-fixture-predecessor' : null,
          },
        }
      })
      await model.checkSave()
    }
  }
  if (view === 'review')
    await model.addComment(
      model.selectLines(model.files.value[0], { side: 'R', start: 2, end: 2 }),
      'Please explain why this changed. Keep the retained context when the workspace moves on.'
    )
  if (view === 'history') await model.loadLog()
  return {
    model,
    connection: { state: ref('connected' as const) },
    initialTab: fileView
      ? ('files' as const)
      : view === 'review'
        ? ('diffs' as const)
        : (view as 'files' | 'diffs' | 'history'),
    initialPath: fileView ? path : undefined,
    initialSelection:
      view === 'review'
        ? model.selectLines(model.files.value[0], { side: 'R', start: 2, end: 2 })
        : undefined,
  }
}
