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
