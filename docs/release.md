# Release Checklist

This repo publishes these artifacts for each release:

- npm package: `@agegr/pi-web`
- Windows NSIS installer with an embedded Node.js runtime
- GitHub Release: `agegr/pi-web`

Use this checklist from a clean `main` checkout.

## 1. Preflight

```bash
git status --short --branch
git log --oneline --decorate -5
gh auth status
npm whoami
node -e "const p=require('./package.json'); console.log(p.version)"
```

Expected:

- `git status` is clean, or only contains changes you intentionally plan to release.
- GitHub is authenticated as an account that can push and create releases.
- npm is authenticated as an account that can publish `@agegr/pi-web`.

## 2. Publish to npm

```bash
npm run release
```

The release script runs:

```bash
npm version patch --no-git-tag-version && npm run build && npm publish --access public
```

Notes:

- This bumps `package.json` and `package-lock.json`.
- It intentionally runs a production build. Do not run `next build` during normal development; release work is the exception.
- The production build uses the vendored Noto Sans Mono files in `app/fonts` and does not contact Google Fonts.
- If `npm view @agegr/pi-web version` briefly shows the previous version, check the exact version instead:

```bash
npm view @agegr/pi-web@<version> version --registry https://registry.npmjs.org/
npm view @agegr/pi-web versions --json --registry https://registry.npmjs.org/
```

## 3. Generate the Windows Installer

Run this after `npm run release` so the installer uses the newly bumped package version. Stop any local dev server first because the production build replaces `.next/`, then run from CMD:

```cmd
npm run package
```

The command creates `build/release/Wireless-ATE-Agent-Setup-<version>-win-<arch>.exe`. It uses Next.js standalone output, validates and copies `bundled-resources`, downloads the matching official Node.js Windows distribution, verifies it against the release `SHASUMS256.txt`, and embeds Node.js with npm/npx and its license. Bundled Skills are loaded through the packaged Pi runtime before and after copying, and their complete resource trees are inspected; any diagnostic, same-scene name collision, path escape, or filesystem link stops packaging. Bundled MCP integrations additionally require a valid manifest, exact SHA-256 coverage, a structurally valid PE32+ executable, and a matching target platform/architecture. `npm install` idempotently applies the pinned `pi-mcp-adapter` server-scoping compatibility patch; `prepack` and installer packaging fail if that patch is absent or the dependency version no longer matches. Empty reserved Skill and MCP root directories remain valid. The current BreakHub runtime is Windows x64 only, so Windows arm64 packaging intentionally fails until an arm64 runtime is added. The command does not bump the version or publish anything.

Install the Setup EXE in a test directory, confirm that `app/bundled-resources/scenes/integration/mcp/breakhub/runtime/win-x64/breakhub_targets.json` exists beside `breakhub-mcp.exe`, then open an integration session and confirm that the seed is copied to the Pi user directory under `integrations/breakhub/`. Edit the user copy, restart the session, and verify it is preserved. Finally verify all five scenes plus local and LAN access, then run the generated uninstaller. The installer defaults to `0.0.0.0:30141`, allowing another computer on the same trusted LAN to open `http://<host-LAN-IP>:30141`.

Never expose the service directly to the internet because it has no application-level authentication.

## 4. Commit the Version Bump

Replace `<version>` with the new package version, for example `0.7.5`.

```bash
git diff -- package.json package-lock.json
git add package.json package-lock.json
git commit -m "Release v<version>"
```

## 5. Tag and Push

```bash
git tag -a v<version> -m "v<version>"
git push origin main --tags
```

Confirm the tag does not already exist before creating it when unsure:

```bash
git ls-remote --tags origin v<version>
gh release view v<version> --repo agegr/pi-web
```

## 6. Generate Release Notes from Commits

Use the previous release tag as the base.

```bash
git log --oneline --decorate v<previous>..v<version>
git log --format='%h%x09%s%n%b' v<previous>..v<version>
git diff --stat v<previous>..v<version>
```

Write the release notes from those commits, not from memory. Include both Chinese and English sections. Keep commit hashes next to each item when useful.

Suggested structure:

```markdown
## 中文

基于 `v<previous>..v<version>` 的提交整理。

### 新增

- ...

### 修复

- ...

### 改进

- ...

### 内部调整

- 发布 npm 包 `@agegr/pi-web@<version>`。

## English

Prepared from commits in `v<previous>..v<version>`.

### Added

- ...

### Fixed

- ...

### Improved

- ...

### Internal

- Published npm package `@agegr/pi-web@<version>`.
```

## 7. Create or Update the GitHub Release

Create a new release:

```bash
gh release create v<version> \
  --repo agegr/pi-web \
  --verify-tag \
  --title "v<version>" \
  --notes-file release-notes.md \
  "build/release/Wireless-ATE-Agent-Setup-<version>-win-<arch>.exe"
```

If the release already exists and only the notes need updating:

```bash
gh release edit v<version> \
  --repo agegr/pi-web \
  --notes-file release-notes.md
```

You can avoid a temporary file by passing notes through stdin:

```bash
gh release edit v<version> --repo agegr/pi-web --notes-file - <<'EOF'
## 中文

...

## English

...
EOF
```

Upload or replace the Windows installer on an existing release with:

```bash
gh release upload v<version> \
  --repo agegr/pi-web \
  --clobber \
  "build/release/Wireless-ATE-Agent-Setup-<version>-win-<arch>.exe"
```

## 8. Final Verification

```bash
gh release view v<version> --repo agegr/pi-web
gh release view v<version> --repo agegr/pi-web --json assets
npm view @agegr/pi-web@<version> version --registry https://registry.npmjs.org/
git status --short --branch
git log --oneline --decorate -3
```

Expected:

- GitHub Release exists and is not a draft unless intentionally published as one.
- npm exact version resolves.
- `main` is aligned with `origin/main`.
- `HEAD` points at the release commit and `v<version>` tag.
