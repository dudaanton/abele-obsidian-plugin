import { describe, it, expect } from 'vitest'
import { NodeScopeLedger, NodeScopeEntrySchema, type NodeScopeChat } from '@/ai/nodeScope'

const entry = NodeScopeEntrySchema.parse({
  kind: 'target',
  node_id: 'sample-node',
  project_id: 'sample-project',
  target: { kind: 'worktree', worktree_id: 'sample-tree' },
  access: 'edit',
})
const target = {
  node_id: 'sample-node',
  project_id: 'sample-project',
  target: entry.kind === 'target' ? entry.target : undefined!,
}
const chat = (id = 'sample-chat'): NodeScopeChat => ({
  nodeScopeIdentity: id,
  overrides: { value: { nodeScope: [entry] } },
  conversationVersion: { value: 0 },
})

it('requires a live local folder approval for inherited scope', () => {
  const ledger = new NodeScopeLedger()
  const folder = chat('folder:sample')
  const session = chat()
  session.overrides.value.nodeScope = []
  Object.assign(session, { inheritedNodeScopes: [{ identity: 'folder:sample', entries: [entry] }] })
  expect(() => ledger.guard(session, target, 'pin:1', 'read')).toThrow()
  ledger.approve(folder, { 'sample-node': 'pin:1' })
  expect(() => ledger.guard(session, target, 'pin:2', 'read')).toThrow()
  const check = ledger.guard(session, target, 'pin:1', 'edit')
  ledger.revoke(folder)
  expect(check).toThrow()
  expect(() => ledger.guard(session, target, 'pin:1', 'read')).toThrow()
})

it('can confirm inherited access for just one chat without copying its folder configuration', () => {
  const ledger = new NodeScopeLedger()
  const session = chat()
  session.overrides.value.nodeScope = []
  const sources = [{ identity: 'folder:sample', entries: [entry] }]
  Object.assign(session, { inheritedNodeScopes: sources })
  ledger.approve(session, { 'sample-node': 'pin:1' }, [entry])
  const check = ledger.guard(session, target, 'pin:1', 'edit')
  expect(session.overrides.value.nodeScope).toEqual([])
  const sibling = { ...session, nodeScopeIdentity: 'sibling-chat' }
  expect(() => ledger.guard(sibling, target, 'pin:1', 'read')).toThrow()
  sources.splice(0)
  expect(check).toThrow()
  expect(() => ledger.guard(session, target, 'pin:1', 'read')).toThrow()
})

it('keeps ancestor reads and own edits additive and fences moving between equal folder scopes', () => {
  const ledger = new NodeScopeLedger()
  const folder = chat('folder:sample')
  folder.overrides.value.nodeScope = [{ ...entry, access: 'read' }]
  const session = chat()
  const sources = [
    { identity: folder.nodeScopeIdentity!, entries: folder.overrides.value.nodeScope },
  ]
  Object.assign(session, { inheritedNodeScopes: sources })
  ledger.approve(folder, { 'sample-node': 'pin:1' })
  expect(() => ledger.guard(session, target, 'pin:1', 'read')).not.toThrow()
  expect(() => ledger.guard(session, target, 'pin:1', 'edit')).toThrow()
  ledger.approve(session, { 'sample-node': 'pin:1' }, [entry])
  const check = ledger.guard(session, target, 'pin:1', 'edit')
  sources.splice(0)
  expect(check).toThrow()
  expect(() => ledger.guard(session, target, 'pin:1', 'edit')).not.toThrow()
  const anotherDevice = new NodeScopeLedger()
  expect(() => anotherDevice.guard(session, target, 'pin:1', 'read')).toThrow()
})

describe('device-local node scope', () => {
  it('inherits only the parent’s approved entries and installation bindings', () => {
    const ledger = new NodeScopeLedger()
    const parent = chat('parent')
    const child = chat('child')
    ledger.inherit(child, parent.nodeScopeIdentity!)
    expect(ledger.approvedNode(child, 'sample-node', 'pin:1')).toBe(false)
    ledger.approve(parent, { 'sample-node': 'pin:1' })
    ledger.inherit(child, parent.nodeScopeIdentity!)
    expect(() => ledger.guard(child, target, 'pin:1', 'edit')).not.toThrow()
    expect(ledger.approvedNode(child, 'sample-node', 'pin:2')).toBe(false)
    child.overrides.value.nodeScope = [{ ...entry, access: 'read' }]
    ledger.inherit(child, parent.nodeScopeIdentity!)
    expect(ledger.approvedNode(child, 'sample-node', 'pin:1')).toBe(false)
  })
  it('does not trust loaded configuration, full vault access, or another chat', () => {
    const ledger = new NodeScopeLedger()
    const session = chat()
    expect(() => ledger.guard(session, target, 'pin:1', 'read')).toThrow(/approval/)
    ledger.approve(session, { 'sample-node': 'pin:1' })
    expect(() => ledger.guard(session, target, 'pin:1', 'edit')).not.toThrow()
    expect(() => ledger.guard(chat('copied-chat'), target, 'pin:1', 'read')).toThrow()
    session.overrides.value = { fullVaultAccess: true }
    expect(() => ledger.guard(session, target, 'pin:1', 'read')).toThrow()
  })
  it('fences retained reads after scope, principal, conversation or branch changes', () => {
    const ledger = new NodeScopeLedger()
    const session = chat()
    ledger.approve(session, { 'sample-node': 'pin:1' })
    const check = ledger.guard(session, target, 'pin:1', 'read')
    session.overrides.value.nodeScope = []
    expect(check).toThrow()
    session.overrides.value.nodeScope = [entry]
    ledger.revoke(session)
    expect(check).toThrow()
    ledger.approve(session, { 'sample-node': 'pin:1' })
    expect(check).toThrow()
    ledger.approve(session, { 'sample-node': 'pin:2' })
    expect(() => ledger.guard(session, target, 'pin:1', 'read')).toThrow()
    const current = ledger.guard(session, target, 'pin:2', 'read')
    session.conversationVersion.value++
    expect(current).toThrow()
  })
  it('whole-node includes future registered projects but target scope never widens on switching', () => {
    const ledger = new NodeScopeLedger()
    const session = chat()
    ledger.approve(session, { 'sample-node': 'pin:1' })
    expect(() =>
      ledger.guard(
        session,
        { ...target, target: { kind: 'worktree', worktree_id: 'other-tree' } },
        'pin:1',
        'read'
      )
    ).toThrow()
    session.overrides.value.nodeScope = [{ kind: 'node', node_id: 'sample-node', access: 'read' }]
    ledger.approve(session, { 'sample-node': 'pin:1' })
    expect(() =>
      ledger.guard(session, { ...target, project_id: 'future-project' }, 'pin:1', 'read')
    ).not.toThrow()
    expect(() => ledger.guard(session, target, 'pin:1', 'edit')).toThrow()
  })
  it('durably revokes a node on registration replacement, even if the same principal returns later', () => {
    let local: unknown
    const storage = {
      read: () => local,
      write: (value: unknown) => {
        local = value
      },
    }
    const ledger = new NodeScopeLedger(storage),
      session = chat()
    ledger.approve(session, { 'sample-node': 'pin:0' })
    const check = ledger.guardNode(session, 'sample-node', 'pin:0')
    ledger.revokeNode('sample-node')
    expect(check).toThrow()
    expect(() => new NodeScopeLedger(storage).guardNode(session, 'sample-node', 'pin:0')).toThrow()
  })
  it('travels as configuration, while approval stays in a separate local store', () => {
    let local: unknown
    const storage = {
      read: () => local,
      write: (value: unknown) => {
        local = value
      },
    }
    const session = chat()
    new NodeScopeLedger(storage).approve(session, { 'sample-node': 'pin:1' })
    expect(() => new NodeScopeLedger(storage).guard(session, target, 'pin:1', 'read')).not.toThrow()
    expect(() => new NodeScopeLedger().guard(session, target, 'pin:1', 'read')).toThrow()
    expect(() => NodeScopeEntrySchema.parse({ ...entry, approved: true })).toThrow()
  })
})
