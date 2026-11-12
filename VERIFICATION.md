# Verification

Public verification records exclude real conversation content, device identifiers,
private deployment paths, credentials and raw logs. Tests use synthetic data unless
explicitly described as deployment connectivity or public-byte checks.

## 0.0.11 / build13

- Web and Android reuse image/document bodies only after an authenticated read
  validates the original message reference and rooted file. A content SHA-256
  revision confirms unchanged bodies with an empty HTTP 204 response; changed
  bytes are downloaded again. Deleted files return 404 and revoked access 401,
  even with a previously valid revision. HTTP responses remain `no-store`.
- Media caches retain at most 64 MiB and 24 entries for seven days, separately
  scoped by computer/authorization and exact message identity. Android uses
  encrypted private files with atomic replacement and at most two concurrent
  transfers. Clearing fences pending reads and preserves drafts/exported files.
  This is bandwidth reuse, not an offline grant to read protected files.
- All 103 Node checks and isolated strict-CSP Chromium desktop/mobile checks
  pass. Actual browser fixtures verify one image transfer across preview,
  repeated original views and reload; document revalidation and replacement;
  same-chat reselection; and cleanup without losing the draft. The four README
  images use the current Web client and fabricated content.
- Full Go tests and vet pass; Windows amd64 and macOS amd64/arm64 cross-builds
  pass. All three standalone archives contain the exact tested binaries and
  omit VCS build metadata, configuration, credentials and runtime data.
- Android reports 95 unit checks: 94 pass and one opt-in public-download check
  is initially skipped. Lint reports zero errors and ten existing warnings.
  The normal APK keeps its package and development signer and excludes
  instrumentation/rendering probes and unit-test classes. Cache crypto tests
  use a JVM AES-GCM fixture; no emulator, physical-device or macOS runtime
  acceptance is claimed for this release.
- GitHub repository 1433754725 and owner 129164549 are unchanged after the
  account rename to retired7Coder. New clients use the canonical manifest
  origin and permit only the exact old-to-new account asset path followed by
  the same repository's pinned CDN; altered assets/owners and redirected
  manifests are rejected. Legacy manifest/asset identities remain compatible,
  but build11 and earlier require one manual upgrade past the rename.
- Final publication, updater-download and deployment checks are pending and
  will be recorded after the immutable release assets are publicly verified.

## 0.0.10 / build11

- Corrects the input-suggestion implementation: independent model generation,
  ephemeral prediction threads, client generation timers and the opt-in UI are
  removed. The old `chat.suggest` endpoint is retired and not advertised; a
  regression test uses a server without any bridge or executor to ensure stale
  clients cannot revive generation. Existing drafts and ordinary Tab navigation
  remain intact, including a stored opt-in from the old version.
- Native Composer Predictions are **not synchronized in this release**. A
  passive snapshot inspection of the installed official desktop identified no
  prediction field, and no read-existing-prediction method was found in the
  current desktop IPC. The installed CLI's generated experimental schema
  exposes a prediction request and result notification, which are not treated
  as a cached-result read. No prediction request or real model call was made.
  Only field names and protocol identifiers were inspected; private chat values
  and official application assets are not published.
- Web and Android keep model, permission and context utilization directly on
  the composer row. Model and context are removed from More; context percentage
  is identified as context utilization rather than account credits. Plan/goal
  status cannot displace the Android primary controls.
- Full Go tests and vet pass; Windows amd64 and macOS amd64/arm64 cross-builds
  succeed. All 99 Node tests and the isolated Chromium suite pass. Browser
  checks cover 320/390-pixel primary-control alignment and viewport bounds,
  ordinary draft/Tab behavior, old suggestion preferences, settings persistence,
  and the retained send/steer/approval/history/file/list-runtime behaviors.
- Android unit tests: 91 total, 90 pass and one opt-in publication check skipped.
  Lint reports zero errors and ten warnings. The normal version 0.0.10/code11
  APK builds using the existing development signer. A separate fixture-only APK
  is installed solely in a new blank Android 35 x86_64 emulator. Native
  instrumentation at 320dp and 390dp verifies model, approval and context
  controls are visible on the same row; both screenshots are visually reviewed.
  The staged public APK is separately checked to exclude the rendering fixture.
- The complete 76-file Windows package matches the reviewed application sources
  and tested gateway. All three standalone gateway archives match the tested
  cross-builds and contain only a binary plus two metadata files. The README
  gallery is refreshed from the current Web client using synthetic data.
- The new immutable Web entry and three resources are deployed; fresh public
  bytes match staged SHA-256 values. An isolated Chromium browser loads the
  public login page and modules without page errors or private login. Public
  browser/file endpoints continue returning HTTP 401 to unauthenticated callers.
- The complete local desktop/gateway runtime reports 0.0.10 and connects to the
  official desktop. All 76 files match the package; configuration, device
  authorizations, preferences, shortcut and startup settings match the original
  snapshot.
- Public release `v0.0.10-build11` contains ten assets, all anonymously fetched
  and verified by size and SHA-256 before main is advanced. The fixed Android
  and desktop feeds match staged build11 manifests. The previously skipped
  Android publication test passes when separately enabled, using its real
  manifest/download/hash code. Electron's real updater discovers 0.0.10,
  downloads the installer and passes installation preflight without executing
  it. The public README and four gallery images also match committed bytes.
- The inspected running official desktop is package 26.1103.3517.0. Native
  prediction mirroring remains unavailable in CXPalm, rather than being replaced
  by another generation request. Android physical-phone installation and macOS
  runtime acceptance are not performed; Android emulator UI checks are separate.

## 0.0.9 / build9

- Web list rows display independent live runtime and approval-waiting elapsed
  time before a chat is opened. Terminal rows show normalized official duration
  when available. Missing or inconsistent timing stays pending; disconnected
  rows do not keep a live clock. Tool execution and approval waits are included.
- The gateway projects only the latest visible official turn identity, status,
  start and duration into list summaries. Existing passive subscriptions are
  reused. Clock observations do not make unchanged lists stream every second,
  and body-only patches do not wake catalogue scans.
- Full Go tests and vet pass. Windows amd64 and macOS amd64/arm64 cross-builds
  succeed. All 100 Node tests pass. Isolated Chromium desktop/mobile checks cover
  simultaneous running/waiting rows without opening chats, a skewed gateway
  clock, new-turn reset, stale/missing timing, interruption with zero duration,
  offline hiding, stable focus and mobile width. Screenshots were reviewed.
- A passive read of the real official desktop confirms latest-turn timing in
  the list projection; the inspected snapshot contained 11 turns with start
  times and 10 completed durations. No model request, message or native mutation
  was sent.
- Android unit tests: 92 total, 91 pass, one opt-in publication check skipped.
  Lint reports zero errors and ten warnings. APK build succeeds with version
  0.0.9/code9 and the existing development signer. The complete Windows package
  contains 76 files; packaged application sources and the gateway match the
  reviewed source and tested binary. All three standalone gateway archives
  match the tested cross-builds and contain only a binary and two metadata files.
- The initial Web entry and three immutable build9 resources are deployed;
  fresh public bytes match the staged SHA-256 values. An isolated Chromium
  browser loads the public login page, immutable modules and icon with no page
  errors and without logging in. Public browser/file APIs still reject
  unauthenticated requests with HTTP 401.
- The full local desktop/gateway runtime is deployed and reports 0.0.9 with
  an official desktop connection. All 76 runtime files match the package.
  Configuration, authorizations, preferences, shortcut and startup settings
  match the pre-update snapshot.
- Public release `v0.0.9-build9` contains ten assets, all fetched anonymously
  and verified by size and SHA-256. The fixed Android and desktop update feeds
  on main match the staged build9 manifests. Android's real update transport
  passes the separately enabled public-feed/download/hash test that was
  initially skipped. Electron's real updater discovers build9, downloads the
  installer and passes installation preflight; it does not execute the installer.
- Android physical-device installation and macOS runtime acceptance have not
  been performed.
- The README gallery is refreshed from the actual build9 Web client with
  isolated synthetic sessions. The desktop view shows running, waiting and
  completed list timing; mobile views show list timing, conversation and
  approval. All four images are visually reviewed, have no horizontal page
  overflow or error banner, and contain no real chat or authorization data.
  Mobile images represent the responsive Web client, not Android-device tests.

## 0.0.8 / build8

- Web and Android expose document cards for assistant file citations and local
  Markdown links, including existing history. Web saves with the browser download
  manager; Android uses the system document picker. HTML and office documents
  remain downloads, with no script execution or embedded office editor.
- Tests cover opaque message-bound IDs, citation/link deduplication, private and
  remote path rejection, outside-root and oversized reads, missing files,
  attachment response headers, Origin/authentication checks and revocation.
  Rooted opens retain traversal protection. Symlink fixtures run only when the
  host grants symlink creation; this Windows account does not grant that privilege.
- Two existing locally generated documents (XLSX and HTML) are
  located through read-only original history and downloaded through an isolated
  local HTTP server with a temporary authentication store. Both SHA-256 values
  match the original local files. No chat resumes, model calls, production device
  authorization changes or edits to those files occur.
- Chromium checks pass under the existing strict CSP, including desktop/mobile
  file cards, Unicode filenames, exact saved bytes, HTML downloads, missing-file
  errors and dropped late results after message removal. Clicking message
  controls no longer arms automatic history loading. Screenshots were reviewed.
- Full Go tests and vet pass; Windows amd64 and macOS amd64/arm64 cross-builds
  pass. All 99 Node checks pass. Android reports 92 tests: 91 pass and one
  publication-only updater check skips. Lint has zero errors and ten warnings.
  APK identity is 0.0.8/code8 and retains the existing development signer.
  Physical Android saving and macOS runtime acceptance have not been performed.
- All 12 desktop source/UI files and extra resources match their tested inputs;
  selected privacy checks report no findings. All 76 installed runtime files
  match the package. After restart the gateway reports 0.0.8 and completes the
  official desktop IPC handshake. Configuration, authorizations, account
  settings, preferences, shortcuts and login startup are unchanged.
- The initial Web entry and three immutable build8 resources are deployed and fresh
  HTTPS bytes match staged sizes/hashes. The public file endpoint returns 401
  without authorization. Native packages/manifests are staged locally; both
  public native feeds reported 0.0.3/build3 at this initial deployment.
  Native publication is recorded separately after public-byte verification.
  No phone installation or server/firewall change occurred.
- After explicit publication authorization, release `v0.0.8-build8` and its
  corresponding source commit are public. Both fixed native feeds now return
  0.0.8/build8 and match the staged manifests exactly. All ten assets were fetched
  through their public release URLs and allowed repository CDN redirects; sizes
  and SHA-256 values match the local artifacts. The downloaded APK retains its
  original package identity, code8 and development signer. Gateway archives
  contain only the tested binary, build metadata and README.
- The previously skipped Android publication check passes separately using the
  production update transport and fixed public feed, without account credentials.
  An isolated Electron desktop updater verifies discovery from an older version,
  the real installer download and the installation preflight hash. No installer
  is executed and no phone installation or physical-device acceptance is claimed.

## 0.0.7 / build7

- Guidance captures its insertion anchor before dispatch, persists it with the
  accepted receipt and retains a stable presentation identity on the native echo.
  Synthetic regressions cover later output, repeated identical prompts, multiple
  guidance receipts, delayed/out-of-order echoes, idempotent projection and
  unchanged native patch bases. Legacy receipts without anchors are preserved;
  their original positions cannot be reconstructed.
- Guidance requires the client's displayed task turn and rechecks it immediately
  before original-owner dispatch. Missing/stale bindings are rejected, not
  replayed. Visible paginated turn order takes priority over unordered entities.
  Android actions retain their captured computer/chat, and late Web receipts
  retain their originating chat. Guidance requires updated build7 clients/gateway.
- Question indexes identify individual user items, including multiple guidance
  messages within one turn. Web and Android use this identity for navigation and
  refresh indexes for new same-turn user messages. Chromium desktop and 390px
  mobile fixtures verify exact second-guidance positioning, active markers and
  no accidental send; screenshots were visually reviewed.
- Full Go tests and vet pass. Windows amd64 and macOS amd64/arm64 cross-builds
  pass. All 98 Node checks pass. Android reports 91 tests: 90 pass and one
  publication-only updater check skips; lint has zero errors and ten warnings.
  APK identity is 0.0.7/code7, retaining the existing development signer.
- All 12 packaged desktop source/UI files and extra resources match tested
  inputs; selected privacy checks report no findings. All 76 installed runtime
  files match the package. The restarted gateway reports 0.0.7 and completes the
  official desktop IPC handshake. Configuration, device authorizations, account
  settings, preferences, shortcuts and login startup remain unchanged.
- The Web entry and three immutable build7 resources are deployed; fresh HTTPS
  downloads match staged sizes and SHA-256 values. The public API still requires
  authorization. Android/desktop packages and manifests are staged locally; both
  public native feeds still report 0.0.3/build3. No source commit/push, native feed
  promotion, phone installation or service/firewall configuration change occurred.
  No real guidance was sent to a private chat, and no physical Android or macOS
  runtime acceptance is claimed.

## 0.0.6 / build6

- Web and Android add opt-in input suggestions, disabled by default with a Codex
  quota notice. Tab/tap fills a draft; Escape/dismiss hides the current suggestion.
  A suggestion never sends a message. Existing drafts, caret selections, IME
  composition, stale reply identities and offline state gate acceptance.
- Full Go tests and vet pass. Windows amd64 and macOS amd64/arm64 cross-builds
  pass. All 97 Node checks pass. Isolated Chromium covers desktop/mobile
  suggestions, prefix completion, IME and Shift-Tab preservation, caret selection,
  Escape dismissal, late results and acceptance without sending. Screenshots
  were visually reviewed.
- The installed official CLI and the CLI selected by the gateway both pass a
  localhost synthetic-provider integration. Each prediction uses a new ephemeral
  identity with a verified read-only/never-approve policy, no persistent rollout
  and no main-chat resume. The test checks that executable tools are absent,
  configured MCP commands do not run and an interactive request aborts without
  another model request. No external model or real chat is used in these tests.
- Suggestions contain only bounded recent user/assistant text. Execution
  features, plugins, MCP, project instructions and environment access are
  disabled. Interactive requests are never answered. Selection changes,
  authorization revocation and deadlines cancel the bounded background lane.
  Child process trees are stopped when generation ends. Independent predictions
  can differ from the official desktop; real-model quality was not evaluated.
- Android reports 90 tests: 89 pass and one publication-only updater check skips.
  Lint has zero errors and ten warnings. APK identity is 0.0.6/code6, with the
  existing development signer. No physical Android or macOS runtime acceptance
  is claimed.
- All 12 packaged desktop source/UI files and extra resources match their tested
  inputs; privacy candidate checks report no findings. All 76 installed runtime
  files match the package. After restart, the local gateway reports 0.0.6 and
  completes the official desktop IPC handshake. Configuration, authorizations,
  account settings, preferences, shortcuts and login startup remain unchanged.
- The Web entry and three immutable build6 resources are deployed; fresh HTTPS
  downloads match staged sizes and SHA-256 values. The public API requires
  authorization. Android/desktop packages and manifests are staged locally;
  both public native update feeds still report 0.0.3/build3. No source commit,
  push, native feed promotion, phone installation or service/firewall
  configuration change was performed.

## 0.0.5 / build5

- First-batch UX changes cover connection/sync/read-only presentation, compact
  mobile controls with visible permission warnings, cancellable attachment
  uploads, readable pending-operation cards and confirmed desktop gateway stop.
  Unknown writes and interrupted uploads are not automatically replayed.
- Native sync time comes only from validated original-owner snapshots/patches.
  Projection/read overlays and transport heartbeats do not renew it; old gateways
  remain compatible and show an unknown sync time. Focused Go tests cover this.
- Full uncached Go tests and vet pass; Windows amd64 and macOS amd64/arm64 builds
  use Go 1.27.3. All 96 Node checks pass. Isolated Chromium covers 320/390px and
  desktop layouts, upload cancellation/late replies, stable cancel-button focus,
  pending details and native sync evidence. Screenshots were visually reviewed.
- Isolated Electron tests cover both stop entry points, default cancellation,
  ownership loss after confirmation, duplicate requests, diagnostic staleness
  and English layouts. These tests do not stop a real official desktop task.
- Android reports 89 tests: 88 pass and one publication-only updater check skips.
  Lint has zero errors and ten warnings; two new warnings are existing icon
  resources no longer used by the compact controls. The normal APK builds with
  version 0.0.5/code5, retains the existing development signer and excludes
  rendering-probe code. No physical Android or macOS runtime acceptance is claimed.
- All 12 packaged desktop source/UI files and extra resources match the tested
  inputs; the selected privacy checks report zero findings. All 76 installed
  runtime files match the package. Configuration, device authorizations, account
  settings, preferences, shortcuts and login startup remain unchanged.
- The updated local gateway reports 0.0.5, writes fresh lifecycle diagnostics and
  passes the official desktop IPC handshake. It starts hidden according to the
  existing preference. Public API connectivity returns 401 without authorization.
  No real message, approval or model execution was used to verify the deployment.
- The Web entry and three immutable build5 assets are deployed; fresh HTTPS
  downloads match staged sizes and SHA-256 values. The Android package and native
  manifests are staged, but both public native feeds still report 0.0.3/build3.
  No Git commit/push, phone installation, service installation or server/firewall
  configuration change was performed. Native feed promotion still requires a
  separately authorized commit; a staged manifest is not a published update.

## 0.0.4 / build4

- Web mutation tests reproduce the old cross-connection dispatch race. Writes
  and manual unknown-result acknowledgements now require the original socket
  and authorization; late receipts settle only their original pending journal.
- Desktop pipe error/EOF tests confirm pending calls fail without an uncaught
  stream error or replay. Shutdown clears concurrent pending calls. Partial
  native IPC header/payload write tests fail against the old implementation and
  pass after closing the damaged connection.
- History opens use an `os.Root` handle after normalized containment checks.
  Boundary and Windows long/extended-path tests pass. The concurrent symlink
  replacement test skips because this Windows account lacks symlink privilege;
  no permission or system setting was changed to enable it.
- Diagnostics report unavailable log/marker writes without stopping the gateway,
  retry failed markers and distinguish Windows session query/end notifications.
  Unit tests and isolated Electron clean/abrupt/unwritable-path checks pass.
  These fixtures do not reproduce or prove a fix for the earlier update shutdown.
- Full uncached Go tests and vet pass. Windows amd64 and macOS amd64/arm64 builds
  use Go 1.27.3. All 88 Node checks pass, including version consistency. Isolated
  Chromium UI checks pass. Android has 84 passing tests and one publication-only
  updater check skipped; lint has zero errors and eight warnings, and APK build
  succeeds with version 0.0.4/code4 and the same development signer as build3.
- Packaged desktop identity, all 11 packaged source files and extra resources
  match the tested inputs; the selected privacy checks report zero findings.
  This is not a complete binary-secret audit or physical Android/macOS acceptance.
- The Web entry and three immutable build4 assets are deployed and freshly
  downloaded HTTPS bytes match staged sizes/SHA-256 values. Native installers and
  local update manifests are staged only. The desktop launch approval timed out,
  so the running installation was not stopped/replaced and its health remains
  0.0.3. Both public native feeds still report 0.0.3/build3. No Git commit/push,
  service installation, authorization or server/firewall configuration change
  was performed. Native feed promotion requires a separately authorized commit.
- An online npm advisory scan was not authorized because it would send dependency
  metadata to a third party. The source review is not a claim of zero remaining
  vulnerabilities or current upstream dependency/advisory coverage.

## 0.0.3 / build3

- Turn error messages, tool error messages and rollout error events are projected
  as conversation-local `sessionError` items. Failed/interrupted turns without a
  detailed reason receive an explicit fallback. Empty failed turns are visible;
  normal completed turns do not acquire error cards. Native patch bases remain
  unchanged and lean/history reprojection does not duplicate notices.
- Error cards are expanded plain text in Web and Android. They do not execute
  HTML/Markdown or introduce retries, global blocking or execution-owner changes.
  Messages are limited to 4,000 characters plus a truncation notice; only display
  messages are selected, with common credentials and URLs redacted. Raw error
  objects, additional details and stacks are not forwarded.
- Full Go tests and vet pass. Windows amd64 and macOS amd64/arm64 gateway builds
  use Go 1.27.3. All 79 Node checks pass. Isolated Chromium verifies error-card
  text, turn scoping, removal on subsequent state, XSS resistance and layouts.
- Android reports 85 unit tests: 84 pass and one publication-only updater test is
  skipped before release. Lint and normal assembly pass; version 0.0.3/code 3,
  original package/signing identity and absence of rendering probes are verified.
  All 12 packaged desktop source/manifest files pass the selected privacy scan.
  Public-byte checks are recorded after release. No physical Android or macOS
  runtime acceptance or real model-error reproduction is claimed.
- Publication checks pass for all ten public assets and both main-branch feeds.
  Actual Electron check/download/hash/pre-install verification passes without
  running an installer; Android's public updater test passes with one test and
  no skips. The Web entry and three versioned assets match their public hashes.
- All 76 installed Windows runtime files match the package. The app is reopened
  through its independent application launcher and restores its gateway using
  existing preferences. Health reports 0.0.3 and official desktop IPC connects.
  Desktop/host/listener/tunnel ownership, remote reverse health and public API
  authorization (401 without a session) are verified. Windows TCP enumeration
  did not expose this SSH process's sockets; connectivity is established by the
  actual reverse HTTP check, not inferred from an empty TCP query.
- Configuration, device authorization, IP policy, desktop preferences, shortcuts
  and login-startup registration are unchanged across deployment. All 296 staged
  source blobs pass the selected privacy scan; unrelated local tooling remains
  uncommitted. No runtime data, diagnostic logs or packages are committed.

## 0.0.2 / build2

- Web and Android remember the last confirmed newly created chat's notification,
  model, reasoning effort and permission mode, separately per computer/client.
  Only connected desktop state updates defaults; approval grants, messages,
  instructions and execution ownership are not copied. Full access requires
  fresh confirmation and unsupported model/effort selections are rejected.
- Empty-thread startup overrides were not durable in an isolated official CLI
  check. The implementation instead applies settings once through the original
  desktop owner's conditional settings API, after connection and while the new
  chat remains empty. Unknown/rejected results never replay the settings write
  or creation. Synthetic original-owner, rejection, disconnect and nonempty-chat
  tests pass; this is not a real conversation or physical-device acceptance.
- Full Go tests and vet pass. Windows amd64 and macOS amd64/arm64 artifacts are
  rebuilt with Go 1.27.3, trimmed paths and no Git VCS build metadata.
- All 78 Node checks and isolated Chromium UI checks pass, including first-use
  defaults, parameter reuse, explicit full-access confirmation and opting out.
- Android reports 84 unit tests: 83 pass and one publication-only updater test
  is skipped before release. Lint and normal assembly pass. The APK reports
  version 0.0.2/code 2, retains its package/signing identity and excludes rendering
  probes and checked private runtime files. No phone installation is performed.
- All 12 packaged desktop source/manifest files pass the selected privacy scan;
  executable source files match tested inputs and generated package identity
  matches source metadata. All 294 staged source blobs pass the selected privacy
  scan; unrelated local development tooling is not committed.
- All ten published assets are freshly downloaded and match staged sizes and
  SHA-256 values. Both main-branch update feeds report 0.0.2/build2. Actual
  Electron check/download/pre-install verification passes without executing an
  installer; higher-version downgrade and legacy-line protections remain active.
  Android's public update/download/hash check passes with one test and no skips.
- The Web entry and three versioned assets match their public hashes. All 76
  installed Windows runtime files match the package. Gateway health reports
  0.0.2; official desktop IPC connects, the desktop owns its host, listener and
  established tunnel, reverse health succeeds and unauthorized public API returns
  401. Configuration, authorizations, IP policy, preferences, shortcuts and startup
  registration remain unchanged. No physical Android or macOS runtime acceptance
  or real conversation/model execution is claimed.

## 0.0.1 / build1

The release starts a new repository/version line. Android, Windows desktop and
Web/gateway use version 0.0.1; Android versionCode and desktop release build are 1.
Native updates are bound to this repository identity and desktop release line
`fresh-001`. Hash, signature, package identity and downgrade checks remain enabled.

Existing installations from another version line are not silently downgraded.
Android installation over a higher versionCode is refused by the platform; users
must handle any manual transition and local data preservation themselves. No phone
is uninstalled, no account data is migrated and no model request is simulated as
real acceptance.

## Build And Package Checks

- Full Go tests and vet pass. Windows amd64 and macOS amd64/arm64 gateway
  archives are rebuilt with Go 1.27.3 and without previous Git VCS metadata.
- All 77 Node checks pass, including shared-version/build consistency,
  strict update transport and credential/private-file detection regressions.
- Isolated Chromium and Electron UI checks pass. These use synthetic execution
  data and do not claim a real model run or physical-device acceptance.
- Android reports 83 unit tests: 82 pass and one opt-in public-update check is
  skipped before publication. Lint and normal APK assembly pass. The APK reports
  version 0.0.1/code 1, retains its signing identity, includes appearance and
  computer-switching features and excludes rendering-probe classes.
- Packaged desktop sources match tested inputs and pass the selected privacy
  scan. Current source and new Git history are checked separately before upload.

## Published Release And Deployment

- The new repository has a parentless initial root, no inherited source history,
  only the main branch and one v0.0.1-build1 release/tag. Source author metadata
  uses the maintainer's GitHub noreply address. Private backups are not uploaded.
- All ten published assets are downloaded and match staged sizes and SHA-256
  values. Both main-branch update manifests report 0.0.1/build1. GitHub asset
  redirects are verified against the new repository's numeric resource identity.
- Actual Electron check/download/pre-install verification passes without running
  an installer. A higher installed version is not offered a downgrade, and the
  previous release line is rejected. Android's public download/hash test passes
  with one test and no skips; no phone install or uninstall is performed.
- The Web entry and three versioned assets match their public hashes. All 76
  installed Windows runtime files match the new package. The gateway reports
  0.0.1, official desktop IPC connects, the desktop owns its Agent and established
  tunnel, reverse health succeeds and unauthenticated public API returns 401.
- Configuration, authorizations, IP policy, preferences, shortcuts and startup
  registration remain unchanged. Local diagnostics are active. Windows/macOS
  cross-compilation is not physical Android or macOS runtime acceptance.
