/**
 * The parts of an item that are not the item itself.
 *
 * A pull request is one request for itself and several for what hangs off it — comments,
 * reviews, files, commits. Only the first decides whether there is anything to show. Each of
 * the others is read on its own: REST first, GraphQL when REST refuses it, and if both refuse,
 * the tab still shows everything else and says in that section's place what was refused.
 */
import { GithubError, type GithubClient } from './client'
import { refusalText } from './refusal'

/** REST refused this one endpoint rather than the token or the network — worth asking GraphQL. */
const endpointRefused = (e: unknown): e is GithubError =>
  e instanceof GithubError && (e.kind === 'forbidden' || e.kind === 'not-found')

const messageOf = (e: unknown): string =>
  e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e)

function graphqlNote(e: unknown): string {
  if (e instanceof GithubError) {
    return e.githubSaid
      ? `Asked through GraphQL as well, and refused there too: "${e.githubSaid}"`
      : `Asked through GraphQL as well: ${e.reason}`
  }
  return `Asked through GraphQL as well: ${messageOf(e)}`
}

/**
 * `rest`, and `graphql` when REST refuses the endpoint. GraphQL always wants a token, so without
 * one it is not asked. When both fail, the REST refusal is what is thrown — it names the
 * permission and carries GitHub's words — with GraphQL's answer added to it.
 */
export async function withFallback<T>(
  client: GithubClient,
  rest: () => Promise<T>,
  graphql?: () => Promise<T>
): Promise<T> {
  try {
    return await rest()
  } catch (e) {
    if (!graphql || !client.hasToken || !endpointRefused(e)) throw e
    try {
      const value = await graphql()
      console.debug('[Abele] GitHub REST refused a request; read it through GraphQL instead', e)
      return value
    } catch (g) {
      console.debug('[Abele] GitHub GraphQL refused it too', g)
      throw new GithubError(e.kind, e.message, e.status, { ...e.refusal, graphql: graphqlNote(g) })
    }
  }
}

export interface Settled<T> {
  value: T
  /** Set when neither REST nor GraphQL gave the section. */
  error?: unknown
}

/** A section that never throws: its value, or `empty` and why. */
export async function secondary<T>(
  client: GithubClient,
  empty: T,
  rest: () => Promise<T>,
  graphql?: () => Promise<T>
): Promise<Settled<T>> {
  try {
    return { value: await withFallback(client, rest, graphql) }
  } catch (error) {
    console.debug('[Abele] A section of a GitHub item could not be read', error)
    return { value: empty, error }
  }
}

/**
 * What to say about a refused section, knowing the item itself was read.
 *
 * `proven` is the permission that read proves the token holds — the pull request itself takes
 * Pull requests (read). When a refused request names that same permission among the ones it
 * accepts, or answers "not found" about an item just read, "add the permission" would send the
 * person to grant what the token already has. The server refused this one request; say that.
 */
export function problemText(error: unknown, proven?: string): string {
  if (!(error instanceof GithubError)) return messageOf(error)
  const r = error.refusal
  const namesProven = !!proven && !!r.needed?.includes(`${proven} (read)`)
  if ((r.kind === 'forbidden' && namesProven) || (r.kind === 'not-found' && proven)) {
    return refusalText({
      ...r,
      fix: `The same token read the item itself${
        namesProven
          ? `, which takes ${proven} (read) — one of the permissions this request accepts`
          : ''
      }. So this is not a permission missing from the token: the server refuses this one request. The rest of the item is shown; open it on GitHub for this part.`,
    })
  }
  return error.message
}

/** Several sections' problems as one notice; nothing when all of them were read. */
export function problems(errors: unknown[], proven?: string): string | undefined {
  const texts = errors.filter((e) => e !== undefined).map((e) => problemText(e, proven))
  return texts.length ? texts.join('\n\n') : undefined
}
