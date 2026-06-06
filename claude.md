# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build          # tsc + copy frame SVGs to dist/
npm run dev -- <args>  # run via ts-node without building
node dist/index.js     # run the built CLI

node scripts/add-device.js <device-id> ['Display Name']  # register a new device
```

There are no tests and no linter configured.

## Architecture

The CLI entry point is `src/index.ts` (3 lines) → `src/cli.ts` (argument parsing, pre-parse routing) → `src/commands/*.ts` (one file per command).

There is a **second entry point** `src/mcp.ts` (bin `screenflow-mcp`) — an MCP server (stdio) exposing `frame_screenshot`, `frame_recording`, `create_appstore_screenshot`, `list_devices`. It must only call **side-effect-free** core functions (`compose`, `composeStaticVideo`, `renderAppStore`), never the `*Action` command wrappers, because those print to stdout and stdout is reserved for the MCP protocol. `renderAppStore` (in `commands/appstore.ts`) is the pure renderer; `appstoreAction` wraps it with the spinner/logging. Uses `zod` v3 (v4 breaks the SDK's schema conversion).

### Frame registry — single source of truth

`src/frames/index.ts` holds the `FRAMES` object. Every device entry declares:
- `canvas` — full SVG dimensions
- `screen` — position and size of the transparent screen hole
- `frameType` — `'vector'` (default) or `'raster'`
- `colors` — map of color name → SVG filename

All other code (composer, CLI listing, completions) derives from this registry.

### Two compositing paths (`src/composer.ts`)

**Vector** (`frameType` omitted / `'vector'`): pure SVG frames (iPhone style). The frame SVG must contain `<path id="Screen mask">` and `<g id="Phone">`. The composer extracts the second subpath of `Screen mask` as a `<clipPath>`, injects `<image>` inside `<g id="Phone">`, and writes SVG. PNG/JPEG output is rendered via sharp's SVG rasterizer.

**Raster** (`frameType: 'raster'`): iPad-style frames where a PNG is base64-encoded inside an SVG wrapper. The composer extracts the PNG buffer, composites the screenshot behind the frame using `sharp.composite`, and writes PNG/JPEG directly. SVG output embeds both as `<image>` elements (screenshot first, frame on top).

### Config persistence

`src/config.ts` — `Config` class reads/writes `~/.config/screenflow/config.json`. Priority chain for every run: CLI flag → saved config → built-in default.

### Build copies frames

`dist/` is gitignored. The build script must include a `cp -r src/frames/<device> dist/frames/` for every device — the `add-device` script handles this automatically.

## Adding a new device

1. Create `src/frames/<device-id>/` with one SVG per color (filename = color name).
2. Run `node scripts/add-device.js <device-id>` — auto-detects frame type and screen coordinates, then updates `src/frames/index.ts`, `package.json`, both completion files, and `README.md`.
3. `npm run build` and test.

For **vector frames** the script cannot auto-detect screen coordinates — verify and correct the `screen` values in `src/frames/index.ts` manually.

### cornerRadius detection in add-device.js

**Overlay frames** (`frameType: 'overlay'`): the script parses the SVG for the inner black `<rect>` (the one with `stroke="black"`) and computes `innerRadius = rx - stroke_width/2`. This is exact geometry — no pixel scanning. Fall back to the diagonal pixel scan if no such rect is found.

**Raster frames** (`frameType: 'raster'`): the frame PNG has a rectangular transparent hole for the screen. Apple devices use "continuous curvature" (squircle) corners, not simple circles. The script uses a **multi-angle diagonal scan**: starting from the screen's top-left corner `(screen.x, screen.y)`, it scans along 6 diagonal directions (ratios 0.5, 0.75, 1.0, 1.25, 1.5, 2.0). Each diagonal exits the outside-device transparent area, passes through the opaque corner arc, then enters the transparent screen hole. At the exit point `(dx, dy)`, the circle equation gives `R = (dx + dy) + sqrt(2·dx·dy)`. Averaging over all 6 angles cancels quantisation error.

Expected accuracy (tested against existing devices):
- iphone-16: exact (165)
- iphone-17: ±1px (detects 189, stored 190)
- iphone-air: ±3px (detects 188, stored 185)

Note: `iphone-14-pro` has `cornerRadius: 47` in the registry, but the SVG geometry gives 56 (`rx=62, stroke-width=12 → 62-6=56`). The stored 47 appears to have come from the old buggy pixel-scan algorithm. All other overlay frames match the formula exactly. If re-running `add-device` on iphone-14-pro, it would register 56.

## Versioning rule

**Every time any change is made to this repository, bump the patch version in `package.json` before finishing.** Increment the last number (e.g. `0.2.58` → `0.2.59`). No exceptions — every change ships a new version.

## Git workflow

**Always commit and push to `develop` first.** Never push directly to `master`. Only merge `develop` → `master` when the user explicitly gives the go-ahead.

```bash
git checkout develop   # work here
git push origin develop
# wait for user approval, then:
git checkout master && git merge develop && git push origin master
```

## Release workflow

Bump `"version"` in `package.json`, commit, push to `master`. The **Auto Tag** and Release workflow (`.github/workflows/tag.yml`) reads the version and pushes a `v*` tag automatically. The **Release** workflow (`.github/workflows/release.yml`) then creates the GitHub release and updates `Formula/screenflow.rb` with the new tarball URL and SHA256. The **npm publish** workflow (`.github/workflows/npm-publish.yml`) fires on the `v*` tag and runs `npm publish` (needs an `NPM_TOKEN` repo secret).

The source code and Homebrew formula live in the same repo (`homebrew-screenflow`). `brew tap marvinhuelsmann/screenflow` resolves to this repo because Homebrew prepends `homebrew-` to tap repo names.

### Distribution & MCP auto-registration

npm publish requires the `files` whitelist in `package.json` (it overrides the gitignored `dist/`); without it the published package would ship no `dist/`. Both `screenflow` and `screenflow-mcp` bins point into `dist/`.

Installing the CLI auto-registers the MCP server with detected AI agents: the npm `postinstall` script (`scripts/postinstall.js`) runs `mcpInstallAction` **only on global installs** (`npm_config_global === 'true'`, so dev/CI installs are a no-op), and the Homebrew formula's `post_install` runs `screenflow mcp install`. The worker lives in `src/commands/mcpSetup.ts` (Claude Code via the `claude` CLI; Codex/Cursor/Claude Desktop via their config files) — idempotent and never throws.
