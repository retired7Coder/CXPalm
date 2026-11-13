# CXPalm protocol v1

Only methods advertised in the WSS hello capabilities are supported. Unknown
methods fail closed; caller-supplied RPC names, executable commands and local
filesystem paths are not forwarded.

## Authorization

`POST /api/v1/login` accepts `{username,password,remember,name?}` and returns a
revocable device bearer. Browser login at `/api/v1/browser/login` instead sets a
host-only Secure / HttpOnly / SameSite=Strict cookie under `/api/v1/`, with no
bearer in the response body. Remembered sessions expire after 30 days; temporary
sessions have a 24-hour server maximum. Browser temporary cookies are session-only.
Logout revokes a session. Local account rotation atomically revokes all sessions.
There is no public account setup, reset, link-exchange or QR login endpoint.

Exact Host/Origin and persisted IP policy protect public APIs. Login size,
deadline, concurrent password work and attempt rate are bounded. Passwords use
individually salted PBKDF2-HMAC-SHA256. Device expiry/revocation and IP policy
are checked throughout WebSocket delivery. Tokens never belong in query strings,
fragments or subprotocols. Responses are no-store and nosniff.

## WebSocket

`GET /api/v1/ws` carries text JSON `{id,method,...fields}` commands. Replies use
`{id,type:result|error,data|error}`. Reads include session browse/list/subscribe,
chat subscribe/history/item/catalog/read and operation lookup. Mutation methods:

- `sessions.create`, `sessions.rename`, `sessions.archive`, `sessions.unarchive`;
- `chat.send`, `chat.steer`, `chat.stop`, `chat.approve`;
- `chat.queue`, `chat.queue.cancel`;
- `chat.settings`, `chat.goal`, `chat.compact`, `chat.notifications`.

`chat.approve` accepts `decision: acceptForSession` only when the current owner
request explicitly offers session approval. MCP tool confirmations require
`_meta.persist` to offer `session`; the gateway sends `action: accept` with only
`_meta: {persist: session}`. Command/file approvals require `acceptForSession`
in `availableDecisions`. The owner stores the scoped approval; the gateway does
not cache approvals globally or expose permanent `always` grants. Both clients
confirm the scope before sending. Permission-profile requests remain turn-only.

IDs are durable device-scoped operation IDs. Save before transmission; query
`operation.get {requestId}` after timeout or disconnect instead of resending.
A matching duplicate returns its original receipt. Changed content under the
same ID fails. `confirmed` means the invoked operation returned, not that a model
task finished. `unknown` never replays. `operation.acknowledge` requires explicit
`text: inspected`; it dismisses a warning without making the original ID executable.

If lookup finds no operation, the gateway atomically reserves that ID with a
`not_sent` receipt. Clients may release only the matching pending lock, retaining
the draft and attachments. The reserved ID cannot execute even if a delayed
request arrives later. Existing `dispatched` or `unknown` receipts are never
converted to `not_sent`; no pending mutation is automatically replayed.

`rejected` is a terminal, definitely unexecuted archive precondition failure, not
a successful archive. Clients release only its matching lock and show a scoped
failure notice. Unknown transport failures remain protected. Legacy active-writer
receipts are projected as rejected only after matching the original archive
command fingerprint; persisted audit records and operation-ID fences stay intact.
The current official follower protocol has no archive forwarding API. A desktop
writer can retain ownership even while idle; archive there rather than stealing
its writer lease or repeatedly starting metadata processes.
Web and Android therefore hide archive/unarchive actions. Archived
history remains readable. The protocol methods and historical receipt inspection
remain available for compatibility; their presence is not a desktop-owner
archive-forwarding capability.

Chat identity is checked against official history and bound to its original
owner. No main thread is independently resumed. Native execution snapshots are
separate from phone projections, lazy history and versioned delta streams.
A stream gap requests another read-only subscription, never a mutation replay.

`chat.state` may include top-level `nativeSyncedAtMs`, the gateway timestamp of
the last validated original-owner snapshot or patch. It is omitted until such
an event arrives. Heartbeats, history reads and presentation overlays do not
advance it; a disconnected state may retain the last timestamp as stale evidence,
not permission to send. Older gateways omit the field, so clients must show an
unknown sync time rather than substitute `observedAtMs` or their current clock.

## Input and controls

`chat.steer.turn` requires `chat.steer.options.expectedTurn`, captured from the
client's displayed active turn. The gateway checks it before construction and
again immediately before original-owner dispatch. Missing/stale bindings return
a terminal, definitely-unexecuted `steer_turn_changed` rejection. Clients keep
the draft for manual inspection/retry. Older clients must update for guidance;
new clients refuse guidance when the gateway lacks this capability. Main chat
ownership and the native owner's own `expectedTurnId` arbitration remain intact.

History questions include optional `item` alongside `turn`, allowing each
guidance message in one task turn to be selected separately. Clients fall back
to turn-only navigation for older history indexes. User-message index refreshes
are coalesced across a pending history read.

`chat.suggest {thread,turn,readToken}` is available only for the chat selected on
that socket. Both clients require explicit opt-in because generation uses the
configured Codex provider/current model quota. The gateway requires a fresh,
idle original-owner snapshot, a completed latest reply, its exact content token,
no pending approval, active goal or queued message. Results are
`{thread,turn,readToken,text}`; empty text means no suggestion. No send follows
acceptance. Suggestions are not part of native snapshots or offline caches.

Generation starts a separate ephemeral identity with bounded recent user and
assistant text, never `thread/resume`, `thread/fork` or a turn on the main ID.
Execution features, plugins, MCP, project instructions and environment access
are disabled; read-only/never-approve policy is verified before its prediction
turn. Any interactive request aborts the helper. The current CLI still exposes
the harmless request-user-input schema; the gateway never answers it. Attempts
are coalesced per reply in a bounded memory cache, one generation runs at a time,
and new attempts are limited to one per 30 seconds. Failed attempts do not replay.
A separate socket lane preserves chat controls; selection/disconnection,
revocation and deadlines cancel generation. Late or mismatched source/owner
results are discarded. This independently generated text can differ from the
official desktop's predictions.

Messages are bounded to 100,000 UTF-8 bytes and at most 8 unique catalog Skill
IDs. Skill paths are resolved locally. `chat.send`, `chat.steer` and `chat.queue`
also accept at most 8 device/chat-bound attachment IDs. Text may be empty only
when attachments are present. See [attachments](ATTACHMENTS.md) for the multipart
upload route, rooted storage and image/file conversion.

`POST /api/v1/chat/image` reads only a raster image identified by its authorized
chat/turn/item/reference ID. It does not accept a path, expose a public URL or
fetch remote origins. See attachment documentation for allowed roots and limits.

`POST /api/v1/chat/file` downloads an allowed document already referenced by an
assistant message. Requests contain only `{thread,turn,item,file}`; paths and
anonymous file URLs are not accepted. Both clients render projected `files`
metadata and request bytes only on an explicit download/save action. Responses
are attachment-only and bounded to 20 MiB; HTML is not executed in the chat.

`chat.settings` accepts explicitly selected model/effort/mode/permission fields
and the current controls revision. Stale revisions fail. Permissions include
read-only, manual workspace approval, automatic approval reviewer with workspace
sandbox, and explicit-confirmation full access. Settings apply to the next turn;
they do not replay messages or disable the official owner's own arbitration.
Native Goal controls and context compaction remain allowlisted, revision/status
checked operations; compact is rejected while active. Goal creation is text-only
and is not queued. Context use reports actual last-input/window occupancy.

Queued messages belong to the gateway, not the desktop queue. At most 16 pending
items per chat. Skills and attachment IDs are frozen. A head remains until its
client ID is observed natively; ambiguous results pause it, including after a
restart. Device authorization/IP policy and attachment scope are rechecked
before original-owner dispatch.

Accepted steering receives a durable presentation record and native-echo
deduplication; see [sessions](SESSIONS.md). It never manufactures a successful
entry for an uncertain operation.

## Notifications

Read/unread presentation comes only from live original-owner snapshots, including
manual desktop changes. Historical gateway receipts no longer override desktop
state and are not deleted or migrated. Missing desktop flags remain unknown.
The read path does not inspect auth.json or the official global-state file.

`chat.read {thread,readToken}` requires a matching visible reply, an active owner
and a local read context observed through the current native IPC connection.
The official desktop still validates that context; CXPalm never guesses an
identity. A context broadcast is only an outgoing hint, not a read confirmation.
Until the desktop publishes one, read-write capability remains unavailable;
displaying its existing read state and receiving notifications still work.

One native request is sent, with no optimistic local receipt. Only a matching
original-owner snapshot/patch showing read confirms success. Reply, context or
owner changes, disconnection and timeout do not confirm success; an uncertain
attempt for the same reply is not automatically replayed. The native protocol
does not provide a transactional compare-and-set across three UIs, so this is
desktop-authoritative synchronization, not a claim of distributed atomicity.
`readSyncAvailable` and `officialReadSyncAvailable` now describe this native
capability, not gateway receipt storage. No official file is edited.

Live list rows include the same per-session `sequence` as chat snapshots. Web
applies confirmed native read changes to the list immediately and keeps the newer
sequence when list and chat deliveries arrive out of order. Reconnect resets the
remembered sequence; another chat, offline cache or unconfirmed read request
cannot clear unread. When native read synchronization is unavailable, Web shows
an explicit status instead of silently skipping the read operation.

Read broadcasts trigger a coalesced passive refresh of their existing original
owner, not an optimistic overlay or a 15-second maintenance wait. Pending read
confirmation may issue up to three passive snapshot renewals; it never resends
the native read mutation. A bounded four-request per-socket metadata lane keeps
these waits outside ordered chat-command dispatch. Busy reads return unavailable,
not accepted. Meaningful status/read/approval changes wake list subscriptions,
with a 100 ms refresh bound; body-only deltas do not wake catalogue scans. The
one-second metadata fallback and 15-second membership sweep remain separate.


Chats are muted unless explicitly opted in with `chat.notifications`. Preferences
are desktop-installation/chat scoped, shared across authorized receivers and
included in live state. Official account switches, missing `auth.json` and
unavailable official read synchronization do not disable gateway notifications.
Live and replay delivery both filter the current subscription generation.
`notifications.subscribe` remains independent of the displayed conversation.
See [notification semantics](NOTIFICATIONS.md) for cursor and background limits.

`sessions.create.settings` advertises optional `sessions.create.options`
(`model`, `effort`, `permission`, `confirmFullAccess`) and an explicit boolean
`enabled` for the new chat's notification preference. Web and Android remember
only their last confirmed newly created thread, separately per computer/client,
and refresh defaults only from its connected, non-archived desktop state. They
do not inherit requests, grants, instructions, messages or execution ownership.
Full access requires fresh confirmation. Unsupported settings are rejected
before creation; old gateways are not sent options they could silently ignore.

After creation, settings are applied once through the original owner's existing
conditional settings API, while the chat is still empty. Empty-thread metadata
startup overrides alone are not treated as durable settings. The gateway waits
at most 12 seconds for owner connection and acknowledgement, never retries the
settings mutation, and reports an unconfirmed setup alongside the created ID.
Notification-save failure also retains the created ID and warns; neither case
must be treated as a reason to replay creation. Later manual edits remain
available in the normal chat controls.

## Local desktop boundary

Conversation projection includes `sessionError` items in their original turn.
They contain only a bounded display message and stable presentation ID, not raw
error objects, stacks, extra diagnostic fields or response bodies. Common inline
credentials and error URLs are redacted. Turn errors, item errors and rollout
`event_msg/error` messages share this presentation path, including lean streams
and history pages. Failed/interrupted turns without a displayable reason receive
an explicit fallback notice. Clients render these notices as non-collapsible plain
text in the conversation, never as global operation failures or automatic retries.

The `desktop-host` exchanges bounded JSON lines over inherited stdin/stdout,
not a public management listener. Allowlisted operations cover lifecycle,
authorization revocation, metadata/audit, IP policy, login settings and diagnostics.
The renderer is sandboxed and isolated. Connection settings are validated locally
with revision checks; no renderer-selected executable or arbitrary config path
crosses IPC. External gateways and official desktop processes are never adopted
or stopped.

Direct file browsing, shell/terminal, Git execution and side-chat APIs are absent.
Upload support is not permission to read arbitrary computer files. No external
notification channel, public relay or unauthenticated mutation route is added.
