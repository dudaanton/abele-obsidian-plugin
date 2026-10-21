// What the requests model needs from around it, so it is tested without the key store, a script,
// the debugger or a device's storage.
import type { Outgoing } from './resolve'
export interface RequestRecording {
  sessionId: string
  name: string
  routeByDestination?: boolean
  stepHeader?: boolean
}

/** What a script is given around a send: before it the request, after it the answer too. */
export interface RequestScriptInput {
  environment: string
  vars: Record<string, string>
  request: Outgoing
  response?: { status: number; ms: number; headers: Record<string, string>; body: string }
}
/** What a script may hand back: a changed request before, values for the environment either way. */
export interface RequestScriptResult {
  request?: Partial<Outgoing>
  vars?: Record<string, string>
}

export interface RequestsPorts {
  keys: {
    /** Whether the key store has a key by this name, without reading it. */
    has(name: string): boolean
    /** Puts the keys' values in, asking for the address where it may; the values to blank. */
    prepare(
      out: Outgoing,
      interactive: boolean,
      signal?: AbortSignal
    ): Promise<{ out: Outgoing; secrets: string[] }>
  }
  scripts: {
    run(
      name: string,
      input: RequestScriptInput,
      interactive: boolean,
      signal?: AbortSignal
    ): Promise<RequestScriptResult | undefined>
  }
  /** The program being recorded now in this project, when one is. */
  recording(url?: string): RequestRecording | undefined | Promise<RequestRecording | undefined>
  prefs: { get(key: string): string | undefined; set(key: string, value: string): void }
  /** Waits between reads of a send under way; tests answer at once. */
  wait?: (ms: number) => Promise<void>
}

export interface SendOptions {
  /** A person pressed Send: questions may be asked of them. An agent's send asks nothing. */
  interactive: boolean
  signal?: AbortSignal
  /** For one send, rather than the switch the view keeps. */
  intoRecording?: boolean
}
