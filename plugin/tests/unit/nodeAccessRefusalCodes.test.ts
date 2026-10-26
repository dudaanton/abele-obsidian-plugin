/**
 * A node tool that cannot reach a place says so twice: in words for the agent, and as a coded
 * refusal the chat shows under the call with the one thing that lets it through.
 */
import { describe, it, expect } from 'vitest'
import { NodeAccessRefusalError, type NodeAccessRefusal } from '@/ai/tools/node/accessRefusal'
import { project, setup, setupGit, workspace } from '../helpers/nodeAgentFixture'

async function refusal(work: Promise<unknown>): Promise<NodeAccessRefusal> {
  const failure = await work.then(
    () => undefined,
    (e: unknown) => e
  )
  expect(failure).toBeInstanceOf(NodeAccessRefusalError)
  const error = failure as NodeAccessRefusalError
  expect(error.message.length).toBeGreaterThan(20)
  expect(error.toolDetails).toEqual({ nodeAccessRefusal: error.refusal })
  return error.refusal
}
const none = { node: undefined, project: undefined, workspace: undefined, target_kind: undefined }

describe('a node call refused for want of access', () => {
  it('names no place when the chat has no node access at all', async () => {
    const { call, session } = setup()
    session.overrides.value = {}
    expect(await refusal(call('node_read', { ...none, path: 'sample.txt' }))).toEqual({
      kind: 'no-access',
      node_id: '',
    })
  })

  it('names the node, folder and place it wanted when the node is not in the chat’s access', async () => {
    const { call } = setup()
    expect(
      await refusal(call('node_read', { node: 'other-node', path: 'sample.txt' }))
    ).toMatchObject({
      kind: 'no-access',
      node_id: 'other-node',
      project_id: project.project_id,
      target: { kind: 'workspace', workspace_id: workspace.workspace_id },
    })
  })

  it('names the folder it wanted when the folder is outside the chat’s access', async () => {
    const { call } = setupGit()
    expect(
      await refusal(call('node_read', { project: 'other-project', path: 'sample.txt' }))
    ).toMatchObject({ kind: 'no-access', node_id: 'sample-node', project_id: 'other-project' })
    expect(await refusal(call('list_node_worktrees', { project: 'other-project' }))).toMatchObject({
      kind: 'no-access',
      node_id: 'sample-node',
      project_id: 'other-project',
    })
  })

  it('uses shared chat access without a local device approval', async () => {
    const { call, session, ledger } = setup()
    ledger.revoke(session)
    const result = await call('node_read', { path: 'sample.txt' })
    expect(result.content[0].text).toContain('old')
  })

  it('says the node is not connected when it is offline', async () => {
    const { call, client } = setup()
    client.connected = false
    expect(await refusal(call('node_read', { path: 'sample.txt' }))).toMatchObject({
      kind: 'offline',
      node_id: 'sample-node',
    })
  })

  it('wants edit where the chat may only read, and says so as no access there', async () => {
    const { call, session, ledger } = setup()
    session.overrides.value = {
      nodeScope: [
        { kind: 'project', node_id: 'sample-node', project_id: project.project_id, access: 'read' },
      ],
    }
    ledger.approve(session, { 'sample-node': 'sample-pin:0' })
    expect(
      await refusal(
        call('node_write', { path: 'sample.txt', expected_content_id: null, text: 'new' })
      )
    ).toMatchObject({ kind: 'no-access', node_id: 'sample-node', project_id: project.project_id })
  })

  it('says which worktrees there are when the one it named is not in the folder', async () => {
    const { call } = setupGit()
    expect(
      await refusal(call('node_read', { workspace: 'unknown-tree', path: 'sample.txt' }))
    ).toMatchObject({
      kind: 'no-worktree',
      node_id: 'sample-node',
      project_id: project.project_id,
      wanted: 'unknown-tree',
      known: ['sample-branch', 'other-branch'],
    })
  })
})
