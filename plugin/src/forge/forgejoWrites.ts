import type { ForgejoClient } from './forgejoClient'
import { forgejoUrls } from './forgejoUrls'
import type { NewPull } from '@/node/NodePathModel'
import { ForgejoError } from './forgejoClient'

const creations = new Map<string, Promise<{ number: number; url?: string }>>()

/** Explicit human writes. The transport latches uncertain outcomes, never retries a POST. */
export function nativeWrites(client: ForgejoClient, repository: string) {
  forgejoUrls(client.deployment).repository(repository)
  const root = `/repos/${repository.split('/').map(encodeURIComponent).join('/')}`
  const number = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error('Invalid issue or pull request number.')
    return value
  }
  return {
    async comment(index: number, body: string): Promise<void> {
      if (!body.trim()) throw new Error('A comment cannot be empty.')
      await client.write('POST', `${root}/issues/${number(index)}/comments`, { body })
    },
    async reply(_index: number, _comment: number, _body: string): Promise<never> {
      throw new Error(
        'Threaded review replies are not available for this service API. Open the conversation in the browser.'
      )
    },
    async create(pull: NewPull & { head: string }): Promise<{ number: number; url?: string }> {
      client.session.assertCurrent()
      if (pull.draft) throw new Error('Draft creation is not available for this service API.')
      if (!pull.title.trim() || !pull.head || !pull.base)
        throw new Error('Title, head and base are required.')
      const key = JSON.stringify([
        client.deployment.kind,
        client.deployment.webBase,
        client.session.connectionId,
        repository,
        pull.head,
        pull.base,
      ])
      const known = creations.get(key)
      if (known !== undefined) {
        const made = await known
        const current = await client.get<{ state?: string }>(`${root}/pulls/${made.number}`)
        if (current.state !== 'closed') return made
        if (creations.get(key) === known) creations.delete(key)
        const newer = creations.get(key)
        if (newer !== undefined) return newer
      }
      if (creations.size >= 256)
        throw new Error(
          'Check the service before creating another pull request: retained submission outcomes are full.'
        )
      const pending = (async () => {
        const made = await client.write<{ number: number; html_url?: string }>(
          'POST',
          `${root}/pulls`,
          { title: pull.title.trim(), body: pull.body, head: pull.head, base: pull.base }
        )
        if (!made || !Number.isSafeInteger(made.number) || made.number < 1)
          throw new Error(
            'The service did not confirm the new pull request. Check the service before submitting again.'
          )
        // Construct locally: a write response cannot redirect navigation to another service.
        return {
          number: made.number,
          url: `${forgejoUrls(client.deployment).repository(repository)}/pulls/${made.number}`,
        }
      })()
      creations.set(key, pending)
      // Only an explicit API rejection proves that another submission is safe.
      void pending.catch((error) => {
        if (error instanceof ForgejoError && error.status >= 400 && error.status < 500)
          creations.delete(key)
      })
      return pending
    },
    async merge(index: number, head: string): Promise<void> {
      if (!/^[a-f0-9]{40,64}$/i.test(head))
        throw new Error('Refresh the pull request before merging: its exact head is required.')
      await client.write(
        'POST',
        `${root}/pulls/${number(index)}/merge`,
        {
          Do: 'merge',
          head_commit_id: head,
          delete_branch_after_merge: false,
          force_merge: false,
          merge_when_checks_succeed: false,
        },
        'none'
      )
    },
  }
}
