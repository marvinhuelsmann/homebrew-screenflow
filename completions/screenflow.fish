complete -c screenflow -s v -l version    -d 'Output the version number'
complete -c screenflow -s h -l help       -d 'Display help'
complete -c screenflow      -l author     -d 'About the author'
complete -c screenflow -s o -l output  -r -d 'Output file path'
complete -c screenflow      -l png        -d 'Output as PNG instead of SVG'
complete -c screenflow      -l jpeg       -d 'Output as JPEG instead of SVG'
complete -c screenflow      -l video      -d 'Create a 5-second zoom-in video animation (requires ffmpeg)'
complete -c screenflow      -l devices    -d 'List all devices and their available colors'
complete -c screenflow      -l set-default -d 'Save --device and/or --color as your personal defaults'
complete -c screenflow      -l show-config -d 'Show your saved defaults'

# Devices
complete -c screenflow -l device -r -d 'Device frame' \
  -a 'iphone-17-pro\t"iPhone 17 Pro (default)" ipad-pro-11\t"iPad Pro 11" ipad-pro-13\t"iPad Pro 13" iphone-13-pro\t"iPhone 13 Pro" iphone-14-pro\t"iPhone 14 Pro" iphone-15-pro\t"iPhone 15 Pro" iphone-16-pro\t"iPhone 16 Pro" iphone-air\t"iPhone Air" imac\t"Imac"'

# Colors — scoped per device (add a new block for each new device)
complete -c screenflow -l color -r -d 'Frame color' \
  -n 'not __fish_seen_argument --device; or __fish_seen_argument --device iphone-17-pro' \
  -a 'silver\t"Silver (default)" deep-blue\t"Deep Blue" cosmic-orange\t"Cosmic Orange"'

complete -c screenflow -l color -r -d 'Frame color' \
  -n '__fish_seen_argument --device ipad-pro-11' \
  -a 'silver\t"Silver" silver-with-apple-pencil\t"Silver with Apple Pencil" space-gray\t"Space Gray" space-gray-with-apple-pencil\t"Space Gray with Apple Pencil"'

complete -c screenflow -l color -r -d 'Frame color' \
  -n '__fish_seen_argument --device ipad-pro-13' \
  -a 'silver\t"Silver" space-gray\t"Space Gray"'

complete -c screenflow -l color -r -d 'Frame color' \
  -n '__fish_seen_argument --device iphone-13-pro' \
  -a 'sierra-blue\t"Sierra Blue"'

complete -c screenflow -l color -r -d 'Frame color' \
  -n '__fish_seen_argument --device iphone-14-pro' \
  -a 'deep-purple\t"Deep Purple"'

complete -c screenflow -l color -r -d 'Frame color' \
  -n '__fish_seen_argument --device iphone-15-pro' \
  -a 'titanium-nature\t"Desert Titanium"'

complete -c screenflow -l color -r -d 'Frame color' \
  -n '__fish_seen_argument --device iphone-16-pro' \
  -a 'dessert-titanium\t"Desert Titanium" black\t"Black" natural\t"Natural" white\t"White"'

complete -c screenflow -l color -r -d 'Frame color' \
  -n '__fish_seen_argument --device iphone-air' \
  -a 'black\t"Black" blue\t"Blue" gold\t"Gold" white\t"White"'

complete -c screenflow -l color -r -d 'Frame color' \
  -n '__fish_seen_argument --device imac' \
  -a 'blue\t"Blue" green\t"Green" orange\t"Orange" pink\t"Pink" purple\t"Purple" silver\t"Silver" yellow\t"Yellow"'
