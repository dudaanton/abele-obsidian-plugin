import assert from 'node:assert/strict'
import { test } from 'node:test'
import { planOfflineChanges, updateExpectedOfflineChanges } from './qualification-offline.mjs'

test('plans six stopped-app change kinds within a scoped fixture', () => {
  const scope = 'Sample-scope'
  const files = [
    ...Array.from({ length: 12 }, (_, i) => ({ path: `${scope}/Notes/Section 0/层 0/Nested 0/Sample ${i}.md`, size: 1, sha: String(i) })),
    ...Array.from({ length: 32 }, (_, i) => ({ path: `${scope}/Notes/Section 1/层 1/Nested 1/Sample ${i}.md`, size: 1, sha: 'move'+i })),
  ]
  const plan = planOfflineChanges(scope, files)
  assert.equal(plan.moves.length, 32)
  assert.equal(new Set([plan.sized, plan.sameSize, plan.deleted]).size, 3)
  assert.ok(plan.moves.every(x => x.from.startsWith(scope+'/') && x.to.startsWith(scope+'/')))
  assert.ok(plan.folderFile.startsWith(plan.addedFolder+'/'))
  const changed = [
    { path: plan.sized, size: 2, sha: 'sized' },
    { path: plan.sameSize, size: 1, sha: 'same' },
    { path: plan.added, size: 2, sha: 'added' },
    { path: plan.folderFile, size: 2, sha: 'folder' },
    ...plan.moves.map((x, i) => ({ path: x.to, size: 1, sha: 'move'+i })),
  ]
  const updated = updateExpectedOfflineChanges(files, plan, changed)
  assert.equal(updated.length, files.length+1)
  assert.ok(!updated.some(x => x.path === plan.deleted || x.path === plan.moves[0].from))
  assert.equal(updated.find(x => x.path === plan.sized)?.sha, 'sized')
  assert.equal(updated.filter(x => x.path.startsWith(plan.renameTo+'/')).length, 32)
})
