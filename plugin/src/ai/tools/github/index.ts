/**
 * The GitHub tools: read-only access to GitHub for an agent, and to the GitHub tabs the person
 * has open. Offered only while the GitHub integration is on.
 */
import type { AgentTool } from '../../client'
import { createGithubPrFilesTool, createGithubReadTool } from './ItemTools'
import { createGithubCommitsTool, createGithubFileTool } from './CodeTools'
import { createGithubSearchTool } from './SearchTool'
import { createGithubOpenTool, createGithubViewsTool } from './ViewTools'

export function createGithubTools(): AgentTool[] {
  return [
    createGithubViewsTool(),
    createGithubReadTool(),
    createGithubPrFilesTool(),
    createGithubFileTool(),
    createGithubCommitsTool(),
    createGithubSearchTool(),
    createGithubOpenTool(),
  ]
}
