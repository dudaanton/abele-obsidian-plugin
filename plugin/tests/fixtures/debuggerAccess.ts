export const accessDescription = {
  capabilities: { capabilities: { 'debugger.access.v1': { status: 'supported' } } },
}
export const accessRequest = {
  request_id: 'sample-request',
  conversation_id: 'sample-chat',
  folder: '/sample/project',
  program: 'sample-server.js',
  access: 'read',
  expires_at: '2099-01-01T00:00:00.000Z',
}
export const accessGrant = {
  grant_id: 'sample-grant',
  installation_id: 'sample-installation',
  run_id: 'sample-run',
  task_id: 'sample-task',
  conversation_id: 'sample-chat',
  workspace_id: null,
  target_id: 'sample-target',
  debug_session_id: 'sample-debug',
  incarnation: 'sample-incarnation',
  expires_at: '2099-01-01T00:00:00.000Z',
  actions: ['read'],
  mode: 'ask',
  revoked: false,
  owner_authority: { installation_id: 'sample-owner', profile: 'local-token-v1' },
  controller_authority: { installation_id: 'sample-installation', profile: 'local-token-v1' },
}
