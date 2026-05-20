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
| `--color <color>` | Frame color (default: `silver`) |
| `--png` | Output as PNG instead of SVG |
| `--jpeg` | Output as JPEG instead of SVG |
| `--video` | Create a 5-second marketing video animation (requires ffmpeg) |
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

# iPad Pro 11, Space Gray
screenflow screenshot.png --device ipad-pro-11 --color space-gray --png

# Custom output path
screenflow screenshot.png -o framed/app_store.svg

# JPEG for smaller file size
screenflow screenshot.png --jpeg

# Set a persistent default device and color
screenflow --set-default

# List all available devices and colors
screenflow --devices
```

### Video animation

The `--video` flag renders a 5-second MP4 marketing clip with a 3D perspective tilt, a quick zoom-in, and a smooth upward pan. **Requires ffmpeg** — screenflow will offer to install it automatically via Homebrew if it's not present.

```bash
# Render video next to the input file
screenflow screenshot.png --video
# → screenshot_iphone-17-pro_silver.mp4

# With specific device and color
screenflow screenshot.png --device iphone-16-pro --color dessert-titanium --video

# Custom output path
screenflow screenshot.png --video -o ~/Desktop/promo.mp4
```

Animation sequence:
1. **0 – 1.3 s** — full mockup visible on a 1920 × 1080 canvas
2. **1.3 s** — zoom in to 2.2× toward the bottom of the device
3. **1.3 – 5 s** — smooth upward pan with 3D perspective tilt (cosine ease-in-out, 60 fps)

Output is always `1920 × 1080` H.264 MP4 at 60 fps, CRF 18.

### Supported Devices

| Device | ID | Colors |
|---|---|---|
| iPhone 17 Pro | `iphone-17-pro` | `silver`, `deep-blue`, `cosmic-orange` |
| iPhone 16 Pro | `iphone-16-pro` | `dessert-titanium`, `black`, `natural`, `white` |
| iPhone 15 Pro | `iphone-15-pro` | `titanium-nature` |
| iPhone 14 Pro | `iphone-14-pro` | `deep-purple` |
| iPhone 13 Pro | `iphone-13-pro` | `sierra-blue` |
| iPad Pro 11" | `ipad-pro-11` | `silver`, `silver-with-apple-pencil`, `space-gray`, `space-gray-with-apple-pencil` |
| iPad Pro 13" | `ipad-pro-13` | `silver`, `space-gray` |
| iPhone Air | `iphone-air` | `black`, `blue`, `gold`, `white` |
| iPhone 17" | `iphone-17` | `black`, `lavender`, `mist-blue`, `sage`, `white` |

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
    iphone-13-pro/
    iphone-14-pro/
    iphone-15-pro/
    iphone-16-pro/
  commands/
    frame.ts        ← frame a screenshot
    video.ts        ← render a 5-second marketing video animation
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
    space-gray.svg
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

> **Vector frames** (like the iPhone 17 Pro SVGs) have a `<path id="Screen mask">` element. The script registers them but cannot auto-detect screen coordinates from vector paths — check the logged output and correct the values in `src/frames/index.ts` manually if needed.

---

### Adding a new color to an existing device

1. Drop the SVG into the device folder (e.g. `src/frames/iphone-17-pro/midnight.svg`)
2. Add the color entry in `src/frames/index.ts` under the device's `colors` map
3. Add the color to both completion files (`completions/screenflow.fish` and `completions/_screenflow`)
4. Build and test

---

### Opening a pull request

1. Fork the repo and create a branch:
   ```bash
   git checkout -b feat/iphone-18-pro
   ```
2. Make your changes and build cleanly:
   ```bash
   npm run build
   node dist/index.js screenshot.png --device iphone-18-pro
   ```
3. Push and open a PR against `master`:
   ```bash
   git push origin feat/iphone-18-pro
   ```
4. In the PR description include:
   - Which device / color was added
   - A sample output screenshot so the result can be reviewed visually

---

## License

MIT © [Marvin Hülsmann](https://marvhuelsmann.com)
