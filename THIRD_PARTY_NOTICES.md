# Third-Party Components

The project license has not been selected. Third-party components retain their
own copyrights and licenses; they do not acquire a new license from this file.
This is an inventory, not a claim that every transitive license was audited.

## Included Source And Assets

- Vendored Marked and DOMPurify: notices and license texts are in
  `web/MARKDOWN-LICENSES.txt`. Versions are pinned by `web/package-lock.json`.
  Rebuild using `npm ci` then `npm run vendor` in `web` and retain notices.
- CommonMark Java: license text is in
  `android/app/src/main/assets/commonmark-LICENSE.txt`; extension versions are
  declared in `android/app/build.gradle.kts`.
- Project icons are kept in `assets/` and derived client resources. Their
  provenance and distribution rights still require maintainer confirmation
  before selecting a project license; no third-party ownership is asserted.

## Downloaded Dependencies

- Go direct and transitive modules: `go.mod` / `go.sum`.
- Electron, electron-builder and their dependencies: `desktop/package-lock.json`.
- AndroidX, Kotlin, OkHttp and CommonMark dependencies: Android Gradle files.
- QR encoding: `rsc.io/qr v0.2.0`, under its BSD 3-Clause license.
  The pinned module contains the Go Authors copyright and license text.
- Android QR scanning: JourneyApps ZXing Android Embedded 4.3.0 and
  ZXing Core 3.5.4, under Apache License 2.0. Exact versions are declared
  in `android/app/build.gradle.kts`; scanning does not require Google Play Services.

Dependency source, SDKs, caches and `node_modules` are not committed. Obtain
licenses from the exact pinned dependency distributions, including transitive
dependencies, before distributing binaries. Packaging a native runtime may
require additional notices. No complete binary license bundle is claimed here.
