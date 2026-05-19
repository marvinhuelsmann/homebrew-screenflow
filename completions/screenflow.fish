complete -c screenflow -s v -l version   -d 'Output the version number'
complete -c screenflow -s h -l help      -d 'Display help'
complete -c screenflow      -l author    -d 'About the author'
complete -c screenflow -s o -l output -r -d 'Output file path'
complete -c screenflow      -l png       -d 'Output as PNG instead of SVG'
complete -c screenflow      -l jpeg      -d 'Output as JPEG instead of SVG'

# Devices
complete -c screenflow -l device -r -d 'Device frame' \
  -a 'iphone-17-pro\t"iPhone 17 Pro (default)"'

# Colors — scoped per device (add a new block for each new device)
complete -c screenflow -l color -r -d 'Frame color' \
  -n 'not __fish_seen_subcommand_from --device; or __fish_seen_argument --device iphone-17-pro' \
  -a 'silver\t"Silver (default)" deep-blue\t"Deep Blue" cosmic-orange\t"Cosmic Orange"'
