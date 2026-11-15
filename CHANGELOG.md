# Changelog

## Unreleased

- Accept verified original-owner state protocol 13 alongside 11 after the
  Windows Codex desktop upgrade. Restore live state and follower control
  availability while preserving owner, patch-lineage and non-replay checks.
- Include the received version in unsupported-state errors and clear stale
  revision authority when rejecting an unknown native protocol.

## 0.0.8 (build8)

- Show returned-document cards for Codex file citations and local Markdown
  links. Web downloads through the browser; Android uses the system document
  picker without broad storage permissions. Excel, PDF, HTML and other allowed
  document formats remain ordinary downloads, not executable chat content.
- Resolve opaque file identities against the original assistant message and
  allowed chat/artifact roots. Bound reads to 20 MiB, reject private paths,
  unreferenced files and root escapes, and recheck revocable authorization.
  Download bytes and account tokens are never included in public file URLs.
- Do not arm automatic history pagination when clicking message controls.
  Drop late download results after a chat/authorization change or message removal.

## 0.0.7 (build7)

- Fix accepted guidance drifting behind later output. Persist its insertion
  anchor and preserve one presentation identity when the original owner emits
  the native echo. Distinguish an earlier identical prompt and reserve explicit
  operation matches before text fallback; native patch bases remain unchanged.
- Bind guidance to the displayed task turn and Android composer actions to their
  captured computer/chat. Reject stale or missing turn bindings before dispatch,
  preserve drafts, and do not replay. Guidance requires build7 clients/gateway.
  Resolve paginated active turns through visible order, not unordered entities.
- Give each question its own message identity, including multiple guidance
  messages in one turn. Fix Web/Android navigation and refresh indexes when a
  same-turn user message arrives, including during an earlier index request.
  Late Web receipts cannot clear another chat's draft.

## 0.0.6 (build6)

- Add opt-in AI input suggestions to Web and Android. Tab/tap fills the draft;
  Escape/dismiss hides the current suggestion. Preserve IME composition, caret
  selection and existing drafts; never send a suggestion automatically.
- Generate from bounded recent user/assistant text through a separate ephemeral
  identity using the configured Codex provider and current model. Main threads
  are never resumed. Disable execution features, plugins, MCP and project
  instructions, verify read-only policy, abort interactive requests and stop the
  child process tree on completion/cancellation.
- Bind results to the selected computer/chat/completed reply, coalesce attempts,
  limit concurrency and rate, and discard stale results. Suggestions use model
  quota, default off and may differ from the official desktop's own predictions.

## 0.0.5 (build5)

- Distinguish gateway connection, official desktop synchronization and read-only
  states. Show the last validated native synchronization time when available.
- Keep common mobile composer actions and permission warnings visible; move
  lower-frequency controls into More without changing send/steer/queue behavior.
- Show attachment filenames, upload state and cancellation without fabricated
  percentages or automatic retries. Cancellation does not promise server deletion.
- Show pending operations with human-readable actions, chat titles and submission
  times; keep technical IDs expandable and unknown-write protection intact.
- Confirm gateway stop from both the window and tray, rechecking ownership before
  dispatch. Diagnostics distinguish measured, stale, configured and untested links.

## 0.0.4 (build4)

- Fence Web writes, receipt settlement and unknown-result acknowledgement to
  their original authorization and connection across asynchronous work.
- Handle desktop management pipe errors/EOF and settle pending requests on
  shutdown. Close damaged native IPC streams without replaying failed writes.
- Open history through a rooted directory handle to prevent path replacement
  from escaping the configured history root.
- Expose unavailable local diagnostics, retry failed session markers and record
  Windows session queries separately from actual end notifications. No watchdog
  or confirmed fix for the earlier Codex update-related shutdown is claimed.

## 0.0.3 (build3)

- Show per-turn errors, tool error messages and interrupted/failed fallback notices
  directly inside Web and Android conversations, including read-only history.
- Keep errors bounded and plain-text; omit raw diagnostic objects and redact
  common credentials and error URLs. No automatic message or operation retry.

## 0.0.2 (build2)

- Web and Android can reuse the last newly created chat's notification, model,
  reasoning effort and permission mode, scoped to each computer and client.
- Full access requires fresh confirmation; approval grants and chat content are
  never copied. Reused settings are applied once through the original desktop
  owner after connection, with an explicit warning if not confirmed.

## 0.0.1 (build1)

- Self-hosted Web and Android access to official desktop-owned conversations.
- Device authorization, optional IP allowlisting, conversation controls and approvals.
- Attachments, Markdown/history reading, shared desktop read state and opt-in reminders.
- Android light/system/misty-blue appearance, clear computer switching and compact chat UI.
- Local desktop settings, bounded redacted diagnostics and verified repository updates.
