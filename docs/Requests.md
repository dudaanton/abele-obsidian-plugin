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

Open the **Scripts** fold in a request's tab and click **Before it goes** or **After it comes
back**. The quick-switcher picker lists scripts with `// @request` in their header and their
descriptions. Type a name and choose **New script** to create, open and assign one in the
configured scripts folder. Click an assigned script to open it; its row actions change the
assignment or remove it without deleting the script. A missing or ineligible script is red.

Assignments are stored in the request's `.http` file. To set them by hand, add these comments
above the method line, using each script's declared `// @name`:

```http
# @name Create sample
# @before Sign sample
# @after Read sample token
POST {{base}}/samples
```

Remove the corresponding comment to clear an assignment. The script itself must carry
`// @request`; choosing or creating it does not run it. The divider between request and response
spans the taller side; drag anywhere in its gap to resize, or double-click to reset its
device-local width. An empty response says **No body**.

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

Values returned by a request script are ordinary environment values unless their names are
explicitly marked secret in the environment. Declare tokens secret before running the script.

A value marked secret in an environment is never written. One typed in the dialog is bound to the
environment's own `base` origin; one a script takes from an answer, to the origin of that answer;
one with no origin is bound where a person first sends it. A request to another origin does not
get it, and says so instead of sending. An agent's send never takes an unbound one. They are
forgotten when the plugin unloads.

## Into a recording

Each request tab has a device-local answer timeout, from 30 to 300 seconds, defaulting to
300 seconds so a breakpoint inspection can finish before the answer arrives. The node's maximum
is five minutes; after a timeout the outcome remains unknown and the request is never replayed.
While the same project's debugger is paused, the tab names the paused location and opens the
debugger in one press. On a phone a completed send scrolls its answer into view; JSON values wrap.

When `DebuggerService` has a binding for the same node and project whose trace says it is
recording, the tab shows a switch beside Send. On, the send carries the debugger session id: the
node groups recorded code steps under the request by time. On nodes that capture program HTTP,
a run association is returned only when incoming traffic confirms the destination belongs to
that session. The answer's *N steps in code* opens that run on the confirmed request step.
When a confirmed request has no code steps, *Open recorded request* still opens it. A send with
no run association remains in request history.

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
editing checks from the tab (they are lines in the request's file).
