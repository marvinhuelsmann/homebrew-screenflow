# screenflow

Wrap iOS simulator screenshots in a pixel-perfect device frame — straight from your terminal. No Figma, no design tools, no fuss.

## Installation

```bash
brew install marvinhuelsmann/screenflow/screenflow
```

## Usage

```bash
screenflow <screenshot>
```

Output defaults to SVG and is placed next to your input file.

```bash
screenflow screenshot.png
# → screenshot_iphone-17-pro_silver.svg
```

### Options

| Option | Description |
|---|---|
| `--device <device>` | Device frame (default: `iphone-17-pro`) |
| `--color <color>` | Frame color: `silver` (default), `deep-blue`, `cosmic-orange` |
| `--png` | Output as PNG instead of SVG |
| `--jpeg` | Output as JPEG instead of SVG |
| `-o <path>` | Custom output file path |
| `--devices` | List all devices and their available colors |
| `--set-default` | Save a default device and color interactively |
| `--show-config` | Show your saved defaults |
| `-v` | Show version |
| `--author` | About the author |

### Examples

```bash
# Default — iPhone 17 Pro, Silver frame, SVG output
screenflow screenshot.png

# Deep Blue frame
screenflow screenshot.png --color deep-blue

# Cosmic Orange, exported as PNG
screenflow screenshot.png --color cosmic-orange --png

# Custom output path
screenflow screenshot.png -o framed/app_store.svg

# JPEG for smaller file size
screenflow screenshot.png --jpeg

# Set a persistent default device and color
screenflow --set-default

# List all available devices and colors
screenflow --devices
```

### Supported Devices

| Device | ID | Colors |
|---|---|---|
| iPhone 17 Pro | `iphone-17-pro` | `silver`, `deep-blue`, `cosmic-orange` |
| iPad Pro 11" | `ipad-pro-11` | `silver`, `silver-with-apple-pencil`, `space-gray`, `space-gray-with-apple-pencil` |
| iPad Pro 13" | `ipad-pro-13` | `silver`, `space-gray` |

## Updating

```bash
brew upgrade screenflow
```

---

## Project Structure

```
src/
  index.ts          ← entry point (3 lines)
  cli.ts            ← program setup + command routing
  composer.ts       ← SVG compositing and output rendering
  config.ts         ← Config class (reads/writes ~/.config/screenflow/config.json)
  frames/
    index.ts        ← FRAMES registry — source of truth for devices, colors, dimensions
    iphone-17-pro/  ← SVG frame files per color
      silver.svg
      deep-blue.svg
      cosmic-orange.svg
    ipad-pro-11/
    ipad-pro-13/
  commands/
    frame.ts        ← frame a screenshot
    setDefault.ts   ← interactive default picker
    devices.ts      ← list devices and colors
    showConfig.ts   ← print saved defaults
    author.ts       ← author info
scripts/
  add-device.js     ← automation: registers a new device across all files
```

---

## Contributing

Contributions are welcome — new devices, new color variants, bug fixes. Here's how everything fits together.

### Setup

```bash
git clone https://github.com/marvinhuelsmann/screenflow.git
cd screenflow
npm install
```

### Development

```bash
# Run directly without building
npm run dev -- screenshot.png

# Build
npm run build

# Test your build
node dist/index.js screenshot.png
```

---

### Adding a new device

**1. Export the SVG frames** from your design tool — one file per color variant. Name each file after its color (e.g. `silver.svg`, `space-gray.svg`).

**2. Create the device folder** and drop in the SVGs:

```
src/frames/
  iphone-17-pro/       ← existing
  your-new-device/     ← new
    silver.svg
    deep-blue.svg
```

**3. Run the `add-device` script:**

```bash
npm run add-device your-new-device
# or with a custom display name:
npm run add-device your-new-device 'Your New Device'
```

The script automatically:
- Detects the frame type (vector SVG or raster PNG-in-SVG)
- Calculates the screen coordinates by scanning for the transparent screen area
- Registers the device in `src/frames/index.ts`
- Adds the `cp` command to the `package.json` build script
- Adds the device and its colors to both completion files
- Adds a row to the device table in `README.md`

**4. Build and test:**

```bash
npm run build
node dist/index.js screenshot.png --device your-new-device --color silver
```

> **Vector frames** (like the iPhone SVGs) have a `<path id="Screen mask">` element. The script registers them but cannot auto-detect screen coordinates from vector paths — check the logged output and correct the values in `src/frames/index.ts` manually if needed.

---

### Adding a new color to an existing device

1. Drop the SVG into the device folder (e.g. `src/frames/iphone-17-pro/midnight.svg`)
2. Add the color entry in `src/frames/index.ts` under the device's `colors` map
3. Add the color to both completion files
4. Build and test

---

### Opening a pull request

1. Fork the repo and create a branch:
   ```bash
   git checkout -b feat/iphone-16-pro
   ```
2. Make your changes and build cleanly:
   ```bash
   npm run build
   node dist/index.js screenshot.png --device iphone-16-pro
   ```
3. Push and open a PR against `master`:
   ```bash
   git push origin feat/iphone-16-pro
   ```
4. In the PR description include:
   - Which device / color was added
   - A sample output screenshot so the result can be reviewed visually

---

## License

MIT © [Marvin Hülsmann](https://marvhuelsmann.com)
