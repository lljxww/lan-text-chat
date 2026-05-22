# Publishing Checklist

This extension is prepared for VS Code Marketplace packaging, but the publisher-specific fields must be reviewed before publishing.

## Required Account Setup

1. Create or choose a Visual Studio Marketplace publisher.
2. Replace `publisher` in `package.json` with that publisher id.
3. Replace placeholder `repository`, `bugs`, and `homepage` URLs with the real public repository URLs.
4. Create a Personal Access Token with Marketplace publish permissions.

## Build

```powershell
npm install
npm run compile
npx vsce package --allow-missing-repository
```

Remove `--allow-missing-repository` after replacing the placeholder repository metadata.

## Publish

```powershell
npx vsce login <publisher-id>
npx vsce publish
```

## Files Included for Marketplace

- `README.md`
- `CHANGELOG.md`
- `LICENSE`
- `resources/icon.png`
- `.vscodeignore`
- `package.json` metadata

## Pre-Publish Checks

- Confirm the Rust chat server README/run instructions are accurate.
- Confirm the default `lanTextChat.serverUrl` matches the supported server.
- Confirm no generated `.vsix`, `node_modules`, TypeScript sources, maps, or test output are packaged.
