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

## Release workflow

Bump `"version"` in `package.json`, commit, push to `master`. The **Auto Tag** workflow (`.github/workflows/tag.yml`) reads the version and pushes a `v*` tag automatically. The **Release** workflow (`.github/workflows/release.yml`) then creates the GitHub release and updates `Formula/screenflow.rb` with the new tarball URL and SHA256.

The source code and Homebrew formula live in the same repo (`homebrew-screenflow`). `brew tap marvinhuelsmann/screenflow` resolves to this repo because Homebrew prepends `homebrew-` to tap repo names.
