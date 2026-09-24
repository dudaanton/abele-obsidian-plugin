/**
 * A GitHub tab mounted from canned API answers, for the component tests: the client answers each
 * path from a table, and the tab is pointed at a URL the way the view points it.
 */
import { vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian'
import GithubItem from '@/components/github/GithubItem.vue'
import { GithubClient } from '@/github/client'
import { endpoints, parseGithubUrl } from '@/github/urls'
import type { GithubViewModel } from '@/github/model'
import { emptyScreen } from '@/github/screen'

export type Reply = {
  status?: number
  json?: unknown
  text?: string
  headers?: Record<string, string>
}
export type Route = Reply | ((req: RequestUrlParam) => Reply)

export function clientWith(routes: Record<string, Route>) {
  const request = vi.fn(async (req: RequestUrlParam): Promise<RequestUrlResponse> => {
    const path = req.url.replace('https://api.github.com', '').replace(/[?&]per_page=.*$/, '')
    const key = Object.keys(routes)
      .sort((a, b) => b.length - a.length)
      .find((k) => path === k || path.startsWith(k + '?'))
    const route: Route = key ? routes[key] : { status: 404, json: { message: 'Not Found' } }
    const r = typeof route === 'function' ? route(req) : route
    return {
      status: r.status ?? 200,
      headers: r.headers ?? {},
      json: r.json,
      text: r.text ?? JSON.stringify(r.json ?? null),
      arrayBuffer: new ArrayBuffer(0),
    } as RequestUrlResponse
  })
  return { client: new GithubClient(endpoints(''), 'tkn', request), request }
}

export function openTab(
  url: string,
  routes: Record<string, Route>,
  enabled = true,
  attachTo: Element = document.body
) {
  const { client } = clientWith(routes)
  const model: GithubViewModel = reactive({
    url: '',
    target: null,
    nonce: 0,
    screen: emptyScreen(),
  })
  const onTitle = vi.fn()
  const onOpen = vi.fn()
  const wrapper = mount(GithubItem, {
    props: { model, enabled, clientFor: () => client, onTitle, onOpen },
    attachTo,
  })
  model.url = url
  model.target = parseGithubUrl(url, ['github.com'])
  model.nonce++
  return { wrapper, onTitle, onOpen, model }
}

export const ISSUE = {
  title: 'Crash on start',
  number: 5,
  html_url: 'https://github.com/o/r/issues/5',
  user: { login: 'bob' },
  created_at: '2026-01-01T10:00:00Z',
  state: 'open',
  labels: [{ name: 'bug', color: 'd73a4a' }],
  body: 'It **crashes**.',
}

export const PULL = {
  title: 'Fix the crash',
  number: 7,
  html_url: 'https://github.com/o/r/pull/7',
  user: { login: 'ann' },
  created_at: '2026-01-02T10:00:00Z',
  state: 'open',
  draft: false,
  labels: [],
  body: 'Fixes #5',
  base: { ref: 'main' },
  head: { label: 'ann:fix' },
  additions: 2,
  deletions: 1,
  changed_files: 6,
  commits: 1,
}

export const file = (name: string, patch = '@@ -1,2 +1,3 @@\n a\n-b\n+c\n+d') => ({
  filename: name,
  status: 'modified',
  additions: 2,
  deletions: 1,
  patch,
})
