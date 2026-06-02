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
# → screenshot_iphone-17-pro_cosmic-orange.svg
```

### Commands

| Command | Description |
|---|---|
| `screenflow <file>` | Frame a screenshot (default) |
| `screenflow video <file>` | Create an animated marketing video |
| `screenflow devices` | List all available devices and their colors |
| `screenflow config` | Show your saved defaults |
| `screenflow set-default` | Set a default device and color interactively |
| `screenflow author` | About the author |

### Frame options

| Option | Short | Description |
|---|---|---|
| `--device <device>` | `-d` | Device frame (default: `iphone-17-pro`) |
| `--color <color>` | `-c` | Frame color (default: first color for the chosen device) |
| `--png` | | Output as PNG instead of SVG |
| `--jpeg` | | Output as JPEG instead of SVG |
| `--output <path>` | `-o` | Custom output file path |

### Examples

```bash
# Default — iPhone 17 Pro, Cosmic Orange frame, SVG output
screenflow screenshot.png

# Deep Blue frame
screenflow screenshot.png --color deep-blue

# Cosmic Orange, exported as PNG
screenflow screenshot.png -c cosmic-orange --png

# Render your screen recording into a static mockup
screenflow simulator.mov

# iPad Pro 11, Space Gray
screenflow screenshot.png -d ipad-pro-11 -c space-gray --png

# Custom output path
screenflow screenshot.png -o framed/app_store.svg

# JPEG for smaller file size
screenflow screenshot.png --jpeg

# Set a persistent default device and color
screenflow set-default

# List all available devices and colors
screenflow devices
```

### Video animation

`screenflow video <file>` renders an animated MP4 marketing clip. **Requires ffmpeg** — screenflow will offer to install it automatically via Homebrew if it's not present.

#### Video options

| Option | Short | Description |
|---|---|---|
| `--style <style>` | `-s` | Animation style (default: `zoom-in`) |
| `--duration <seconds>` | | Animation length in seconds, 1–60 (default: `9`) |
| `--tilt <degrees>` | `-t` | Perspective tilt downward in degrees, 0–45 (default: `0`) |
| `--fps <fps>` | | Frame rate: 24, 30, 60, or 120 (default: `60`) |
| `--device <device>` | `-d` | Device frame |
| `--color <color>` | `-c` | Frame color |
| `--output <path>` | `-o` | Custom output file path |

#### Animation styles

| Style | Description |
|---|---|
| `zoom-in` *(default)* | 2× zoom, pan from bottom to top |
| `zoom-out` | Zoom out 1.8× → 1×, centered |
| `pan-down` | Constant 1.4× zoom, pan from top to bottom |
| `pan-left` | Full device visible, slides from right to left across the frame |
| `pan-right` | Full device visible, slides from left to right across the frame |

```bash
# Default zoom-in style (9 seconds)
screenflow video screenshot.png
# → screenshot_iphone-17-pro_cosmic-orange.mp4

# 15-second video
screenflow video screenshot.png --duration 15

# Pan from top to bottom
screenflow video screenshot.png --style pan-down

# Zoom out with specific device and color
screenflow video screenshot.png -d iphone-16-pro -c dessert-titanium --style zoom-out

# Pan left with custom output
screenflow video screenshot.png --style pan-left -o ~/Desktop/promo.mp4

# Zoom-in with 15° downward tilt
screenflow video screenshot.png --tilt 15

# Zoom-in at 120 fps for 5 seconds
screenflow video screenshot.png --fps 120 --duration 5
```

Output is always `1920 × 1080` H.264 MP4, CRF 12.

### Screen recordings & HEIC input

The commands are the same — just hand them a **screen recording** (`.mp4`, `.mov`, `.m4v`, `.webm`, `.mkv`, `.avi`) or any still image (including **`.heic`/`.heif`**) instead of a PNG/JPG. screenflow detects the input type automatically (**requires ffmpeg** for video).

| Input | `screenflow <file>` (default) | `screenflow video <file>` |
|---|---|---|
| **Still image** (PNG/JPG/HEIC) | Static framed image (SVG/PNG/JPEG) | Animated marketing clip (`--duration` seconds) |
| **Screen recording** (MP4/MOV/…) | Device stays still, the **screen plays the recording** | Camera animation (zoom/pan/tilt) runs **while the screen plays** |

For a screen recording the output is **always a video whose length matches the recording**. `--duration` is therefore ignored for the `video` command, and `--png`/`--jpeg` don't apply to the default command.

```bash
# Static framing of a screen recording → transparent .mov (ProRes 4444), audio kept
screenflow recording.mov -d iphone-17-pro
# → recording_iphone-17-pro_cosmic-orange.mov

# Force an H.264 .mp4 on a black background instead
screenflow recording.mov -o framed.mp4

# Drop the audio track
screenflow recording.mov --mute

# Animate a screen recording (length = recording), 15° tilt
screenflow video recording.mov --style zoom-in --tilt 15

# HEIC still works just like a PNG
screenflow shot.heic -d iphone-17 --png
```

- **Default command + recording** → transparent **`.mov` (ProRes 4444)** by default so it matches the transparent still output; pass `-o <name>.mp4` for an H.264 clip on a black background.
- **`video` command + recording** → `1920 × 1080` H.264 MP4 (the established marketing format).
- Audio from the recording is kept by default; use `--mute` to strip it.

> Note: large canvases (iMac, iPad) as transparent ProRes can produce very large files.

### Supported Devices

| Device | ID | Colors |
|---|---|---|
| iPhone 17 Pro | `iphone-17-pro` | `cosmic-orange`, `deep-blue`, `silver` |
| iPhone 16 Pro | `iphone-16-pro` | `dessert-titanium`, `black`, `natural`, `white` |
| iPad Pro 11" | `ipad-pro-11` | `silver`, `silver-with-apple-pencil`, `space-gray`, `space-gray-with-apple-pencil` |
| iPad Pro 13" | `ipad-pro-13` | `silver`, `space-gray` |
| iPhone Air | `iphone-air` | `black`, `blue`, `gold`, `white` |
| iPhone 17" | `iphone-17` | `black`, `lavender`, `mist-blue`, `sage`, `white` |
| iPhone 16" | `iphone-16` | `black`, `pink`, `teal`, `ultramarine`, `white` |
| Imac | `imac` | `blue`, `green`, `orange`, `pink`, `purple`, `silver`, `yellow` |
| Apple Watch Ultra | `apple-watch-ultra` | `black-alpine-loop`, `black-milanese`, `natural-alpine-loop`, `natural-milanese` |
| Apple Watch Series 11" | `apple-watch-series-11` | `titanium-gold-magnetic-link-sage-gray`, `titanium-gold-milanese-loop`, `titanium-natural-magnetic-link-caramel`, `titanium-natural-sport-band-stone-gray`, `titanium-slate-magnetic-link-navy`, `titanium-slate-milanese-loop` |

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
  composer.ts       ← SVG compositing, output rendering + buildFrameAssets (video overlay/mask)
  config.ts         ← Config class (reads/writes ~/.config/screenflow/config.json)
  ui.ts             ← shared terminal helpers (spinner, colors, name formatting)
  ffmpeg.ts         ← shared ffmpeg/ffprobe helpers + input-kind detection
  video-compose.ts  ← ffmpeg filtergraph for compositing a recording inside a frame
  frames/
    index.ts        ← FRAMES registry — source of truth for devices, colors, dimensions
    iphone-17-pro/  ← SVG frame files per color
      cosmic-orange.svg
      deep-blue.svg
      silver.svg
    ipad-pro-11/
    ipad-pro-13/
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

The first color registered for a device is used as that device's automatic default.

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
3. Push and open a PR against `develop`:
   ```bash
   git push origin feat/iphone-18-pro
   ```
4. In the PR description include:
   - Which device / color was added
   - A sample output screenshot so the result can be reviewed visually

---

## License

MIT © [Marvin Hülsmann](https://marvhuelsmann.com)
