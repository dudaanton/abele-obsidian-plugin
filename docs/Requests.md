# Saved requests

A project's saved HTTP requests, kept as files in the project on a node and sent from the node.
Offered where the node advertises `http_v1` (AbeleNode's `docs/http.md` has the node's side).
The client stands on its own: the debugger is not needed, and a recording is only one place a
request may optionally go.

## Where it lives

- **The Requests view** (`abele-requests`), opened by **Open requests** into the left sidebar. A
  project row (every project of every connected node that keeps requests), the environment row,
  then each collection as a folder of request rows: method as a code, name, last status faint and
  red for 4xx/5xx or a failed send. Row menu: Send, Duplicate, Rename, Copy as curl, Delete.
  While a program of the project is recorded, a quiet red line names it at the top.
- **A request's tab** (`abele-request`, state: node registration, project, request id). Method,
  address and Send; the resolved address under them; Params, Headers, Body, Scripts, Checks as
  folds; the answer beside (wide) or under (narrow, phone) with Body, Headers, Checks, History.
- **The environment dialog** from the environment row's menu: plain values written into the
  project's file, values kept in memory only, and *Say the step* (`X-Abele-Step`).

`src/requests/` holds it: `wire.ts` (the `http.v1` methods over the generic node request),
`resolve.ts` (variables, the query, checks, curl; pure), `RequestsModel.ts` (one project's state
and moves, no Obsidian), `secrets.ts` (memory-only values and their origins), `RequestsService.ts`
(contexts, the key store, scripts, the recording), `views.ts` and `actions.ts` (Obsidian). The
components are the designer's in `src/components/debugger/http/`.

## Sending

1. The environment's `{{name}}` values are put in; a value kept in memory only for its origin.
2. The script named before runs (`@request` scripts only) with keys still as
   `${abele_key:name}`; it may change the request or set values.
3. Keys go in last through the key store's `prepareSecretRequest`. A person's send asks to allow
   an address for a key the first time (`approveScriptKeyRequest`); an agent's send refuses.
4. The node sends (`http.v1.send`) and is followed with `http.v1.send.status` until the answer is
   in. The channel gives any one request five seconds, so the send itself never waits. Losing
   the node on the way is an unknown outcome; nothing is ever sent again by itself.
5. The script named after runs with the answer; checks are read; history is read again.

Every key value and every memory-only value is given to the node as a value to blank: the node
replaces it with `••••` in what it keeps and what it answers.

## Values kept in memory

A value marked secret in an environment is never written. One typed in the dialog is bound to the
environment's own `base` origin; one a script takes from an answer, to the origin of that answer;
one with no origin is bound where a person first sends it. A request to another origin does not
get it, and says so instead of sending. An agent's send never takes an unbound one. They are
forgotten when the plugin unloads.

## Into a recording

When `DebuggerService` has a binding for the same node and project whose trace says it is
recording, the tab shows a switch beside Send. On, the send carries the debugger session id: the
node puts every step taken while the request is out under it, by time, and writes the request as
an `http` step at the time it went. The answer's *N steps in code* opens that run on the
request's step.

## Import

`src/requests/importers/` reads a `.http` file (several requests, `@name = value` file variables),
a curl line, a HAR file, an OpenAPI 3 or Swagger 2 description (JSON or YAML), a Bruno `.bru`
request, and Postman (v2.x), Insomnia (v4) and Bruno collection exports; what one cannot carry is
skipped with its reason; `importInto` makes each a request under a name not yet taken and adds the values the
source names to the environment in use where it lacks them. A credential written out (an
`Authorization` or cookie header, `-u`, a Bruno bearer token) is never imported: it is left out and
named. Offered as the command *Import requests from the clipboard*, after which the view unfolds the
collection and brings the new rows into sight, and the agent tool `http_import`, whose answer
lists what was skipped and why; an import screen needs the designer first.

## Not here yet

Client certificates (the owner said not now), sending from the device rather than the node, and
editing scripts and checks from the tab (they are lines in the request's file).
