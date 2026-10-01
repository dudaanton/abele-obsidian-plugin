/**
 * The GitHub tools: read-only access to GitHub for an agent, and to the GitHub tabs the person
 * has open. Offered only while the GitHub integration is on.
 */
import type { AgentTool } from '../../client'
import { createGithubPrFilesTool, createGithubReadTool } from './ItemTools'
import { createGithubCommitsTool, createGithubFileTool } from './CodeTools'
import { createGithubSearchTool } from './SearchTool'
import { createGithubGrepTool } from './GrepTool'
import { createGithubOpenTool, createGithubViewsTool } from './ViewTools'

import { githubSettings } from '@/github/GithubService'
import { toolOperation, type GithubToolAccess } from './operation'
import type { GithubToolOperation } from './shared'
import { GithubError } from '@/github/client'
import { primaryAccess } from '@/github/primaryAccess'

const factories = [
  createGithubViewsTool,
  createGithubReadTool,
  createGithubPrFilesTool,
  createGithubFileTool,
  createGithubCommitsTool,
  createGithubSearchTool,
  createGithubGrepTool,
  createGithubOpenTool,
]

export function createGithubTools(access?: GithubToolAccess): AgentTool[] {
  return factories.map((factory): AgentTool => {
    const tool = factory()
    return {
      ...tool,
      parameters: {
        ...tool.parameters,
        properties: {
          ...(tool.parameters.properties as Record<string, unknown>),
          connection: {
            type: 'string',
            description:
              'Connection name or unique ID. Explicit choice never silently changes accounts; use github_views for available connections.',
          },
        },
      },
      execute: async (id, params, signal) => {
        // Unmigrated test/compatibility callers have only the old single-server context.
        // Runtime settings load always migrates an existing credential into a connection.
        if (!(githubSettings().connections ?? []).length && !params.connection)
          return tool.execute(id, params, signal)
        const operation: GithubToolOperation = await toolOperation(
          tool.name,
          params,
          access ?? { agent: () => null },
          signal
        )
        try {
          const result = await factory(operation).execute(id, params, signal)
          operation.assertAccess()
          return result
        } catch (error) {
          operation.assertAccess()
          if (
            operation.explicit ||
            !operation.target ||
            !(error instanceof GithubError) ||
            !['not-found', 'forbidden', 'sso'].includes(error.kind)
          )
            throw error
          // Do not switch identity for a secondary section that failed after a readable item.
          let primaryDenied = false
          try {
            await primaryAccess(operation.client, operation.target)
          } catch (probeError) {
            if (
              probeError instanceof GithubError &&
              ['not-found', 'forbidden', 'sso'].includes(probeError.kind)
            )
              primaryDenied = true
            else throw probeError
          }
          if (!primaryDenied) throw error
          for (const candidate of operation.candidates.filter(
            (c) => c !== operation.connectionId
          )) {
            const next = await toolOperation(
              tool.name,
              { ...params, connection: candidate },
              access ?? { agent: () => null },
              signal
            )
            try {
              await primaryAccess(next.client, next.target!)
            } catch (probeError) {
              if (
                probeError instanceof GithubError &&
                ['not-found', 'forbidden', 'sso'].includes(probeError.kind)
              )
                continue
              throw probeError
            }
            const result = await factory(next).execute(id, params, signal)
            next.assertAccess()
            return {
              ...result,
              content: [
                {
                  type: 'text',
                  text: `Read using GitHub connection ${candidate}; the first connection could not access the item.`,
                },
                ...result.content,
              ],
            }
          }
          throw error
        }
      },
    }
  })
}
