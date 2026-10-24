// What the requests of a project draw: saved requests in collections, the environment they are
// sent in, and what came back. Plain data, so the views can be built and tested without a node;
// the node reads the files of `.abele/requests/` and sends, the plugin only fills these shapes.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

/** One line of the params, the headers or an environment: a name and what it stands for. */
export interface HttpPair {
  key: string
  value: string
  /** Kept in the request but not sent. */
  off?: boolean
  /** The value comes from the plugin's keys by name, `${abele_key:name}`: never shown. */
  secret?: boolean
  /** Why it cannot be sent as it is: a key that is not in the keys, a variable with no value. */
  missing?: string
}

/** A check of the answer, `status == 201`; passed once it was sent. */
export interface HttpCheck {
  text: string
  passed?: boolean
}

export interface HttpResponse {
  status: number
  /** The status in words, `Created`. */
  reason: string
  ms: number
  bytes: number
  headers: HttpPair[]
  body: string
  /** Steps the record points took in the code while it was out, when a run was recorded. */
  steps?: number
  checks?: HttpCheck[]
  /** The body was longer than what is kept, and was cut. */
  cut?: boolean
}

/** What one sending came to. */
export type HttpOutcome =
  | { kind: 'sending' }
  | { kind: 'answered'; response: HttpResponse }
  /** It never reached the server: refused, no such host. */
  | { kind: 'failed'; reason: string }
  /** No answer in time: it may have gone through, and it is not sent again by itself. */
  | { kind: 'unknown'; after: string; reason?: string }

export interface HttpRequest {
  id: string
  name: string
  method: HttpMethod
  /** As written, with `{{variables}}` of the environment in it. */
  url: string
  params: HttpPair[]
  headers: HttpPair[]
  body?: { format: 'json' | 'text' | 'form'; text: string }
  /** Scripts of the plugin run before it goes and after it comes back, by name. */
  scripts: { before?: string; after?: string }
  checks: HttpCheck[]
  /** The last time it was sent: its status, or that it did not get through. */
  last?: { status?: number; failed?: boolean }
  /** Read from a file of the project, not saved here: where in it, so an edit goes back there. */
  origin?: { file: string; line: number }
}

/**
 * A value an earlier answer gives this request, `{{createOrder.response.body.id}}`: what it came
 * to, or that the request it comes from was not sent yet.
 */
export interface HttpCapture {
  /** As written in the request. */
  expression: string
  /** The short name it reads as, `id`. */
  name: string
  /** The request it comes from, by its name, and its id to send it first. */
  from: { id: string; name: string }
  value?: string
  /** When that answer came, `05:12`, and its status. */
  at?: string
  status?: number
}

/** A folder of `.abele/requests/`, or a file of requests the project already has. */
export interface HttpCollection {
  name: string
  requests: HttpRequest[]
  /**
   * A `.http` file or a Bruno collection of the project, read where it is each time: not saved
   * here. Its folder, and what could not be read in it.
   */
  file?: {
    kind: 'http' | 'bruno'
    path: string
    folder?: string
    problem?: { line: number; text: string }
  }
}

export interface HttpEnvironment {
  name: string
  vars: HttpPair[]
}

/** One sending of a request, kept in its history beside the request's file. */
export interface HttpSend {
  id: string
  /** When, said as it should read: `05:12`, `Yesterday 18:40`. */
  at: string
  environment: string
  status?: number
  /** It never reached the server. */
  failed?: boolean
  ms?: number
  bytes?: number
  /** The answer's body, to show again and to compare. */
  body?: string
  /** Sent into a recording: it is a step of that run. */
  intoRun?: boolean
}

/** An environment as its dialog edits it: plain values, secrets by name, the step header. */
export interface HttpEnvironmentEdit {
  name: string
  vars: { key: string; value?: string; secret?: boolean; off?: boolean }[]
  stepHeader?: boolean
}
