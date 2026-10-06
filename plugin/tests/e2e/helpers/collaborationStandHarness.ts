import { spawnAgentStandServer } from './agentStandHarness'
/** Same verified deployment assembly as the stand, including its persisted group maintenance. */
export const spawnCollaborationStandServer = (root: string, commit: string, work: string) =>
  spawnAgentStandServer(root, commit, work)
