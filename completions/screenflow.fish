complete -c screenflow -s v -l version   -d 'Output the version number'
complete -c screenflow -s h -l help      -d 'Display help'
complete -c screenflow      -l author    -d 'About the author'
complete -c screenflow -s o -l output -r -d 'Output file path'
complete -c screenflow      -l png       -d 'Output as PNG instead of SVG'
complete -c screenflow      -l jpeg      -d 'Output as JPEG instead of SVG'

# Devices
complete -c screenflow -l device -r -d 'Device frame' \
  -a 'iphone-17-pro\t"iPhone 17 Pro (default)" ipad-pro-11\t"iPad Pro" ipad-pro-13\t"iPad Pro 13"" iphone-13-pro\t"iPhone 13 Pro" iphone-15-pro\t"iPhone 15 Pro" iphone-14-pro\t"iPhone 14 Pro" iphone-16-pro\t"iPhone 16 Pro"'

# Colors — scoped per device (add a new block for each new device)
complete -c screenflow -l color -r -d 'Frame color' \
  -n 'not __fish_seen_subcommand_from --device; or __fish_seen_argument --device iphone-17-pro' \
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
  -n '__fish_seen_argument --device iphone-15-pro' \
  -a 'titanium-nature\t"Dessert Titanium"'

complete -c screenflow -l color -r -d 'Frame color' \
  -n '__fish_seen_argument --device iphone-14-pro' \
  -a 'deep-purple\t"Deep Purple"'

complete -c screenflow -l color -r -d 'Frame color' \
  -n '__fish_seen_argument --device iphone-16-pro' \
  -a 'dessert-titanium\t"Dessert Titanium"'
