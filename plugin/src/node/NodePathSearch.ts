import type { NodeClient } from '@abele/node-client'
import type { CodeResults, ResultFile } from '@/repository/model'
import { compileQuery, searchText, type CodeQuery } from '@/github/search/textSearch'
import type { Scope } from '@/github/search/tabCode'
import { t } from '@/i18n'
import type { PathTarget } from './NodePathModel'
import { nodeCodeLink } from './codeLinks'

/** A continuation stays bound to the original target, query and working-tree observation. */
export async function searchNodePathCode(
  client: Pick<NodeClient, 'repository' | 'nodePath'>,
  target: PathTarget,
  scope: Scope,
  query: CodeQuery,
  glob: string,
  signal?: AbortSignal
): Promise<CodeResults> {
  signal?.throwIfAborted()
  const bound = { ...target }
  const re = compileQuery(query)
  const revision =
    bound.kind === 'worktree'
      ? (await client.repository.observe({ worktree_id: bound.id })).revision
      : undefined
  const request = {
    query: query.wholeWord ? re.source : query.text,
    mode:
      scope === 'names'
        ? ('filename' as const)
        : query.regex || query.wholeWord
          ? ('regex' as const)
          : ('literal' as const),
    case_sensitive: query.caseSensitive ?? false,
    ...(glob.trim() && scope !== 'names' ? { path_glob: glob.trim() } : {}),
    limit: 100,
  }
  const read = async (
    cursor?: string,
    previous: CodeResults = { files: [], total: 0, capped: false },
    visited = new Set<string>()
  ): Promise<CodeResults> => {
    signal?.throwIfAborted()
    const page = revision
      ? await client.repository.search({
          ...request,
          worktree_id: bound.id,
          revision,
          scope: 'repository',
          cursor,
        })
      : await client.nodePath.search({ ...request, workspace_id: bound.id, cursor })
    signal?.throwIfAborted()
    const files = new Map<string, ResultFile>(
      previous.files.map((file) => [file.path, { ...file, lines: [...file.lines] }])
    )
    for (const row of page.entries) {
      let file = files.get(row.path)
      if (!file)
        files.set(
          row.path,
          (file = { path: row.path, url: nodeCodeLink(bound, row.path), lines: [] })
        )
      if (scope !== 'names') {
        const hit = searchText(row.text, re, 1)[0]
        file.lines.push({
          label: String(row.line),
          text: hit?.text ?? row.text,
          column: hit?.column ?? 0,
          length: hit?.length ?? 0,
          url: nodeCodeLink(bound, row.path, { start: row.line, end: row.line }),
        })
      }
    }
    const repeated = !!page.cursor && visited.has(page.cursor)
    const result: CodeResults = {
      files: [...files.values()],
      total: previous.total + page.entries.length,
      capped: !!previous.note || page.incomplete || !!page.cursor,
      ...(page.incomplete || page.omissions.length || repeated
        ? { note: t('repository.searchOmitted') }
        : previous.note
          ? { note: previous.note }
          : {}),
    }
    if (page.cursor && !repeated) {
      const cursor = page.cursor
      const nextVisited = new Set(visited).add(cursor)
      result.next = () => read(cursor, result, nextVisited)
    }
    return result
  }
  return read()
}
