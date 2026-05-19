complete -c screenflow -s v -l version   -d 'Output the version number'
complete -c screenflow -s h -l help      -d 'Display help'
complete -c screenflow      -l author    -d 'About the author'
complete -c screenflow -s o -l output -r -d 'Output file path'
complete -c screenflow      -l png       -d 'Output as PNG instead of SVG'
complete -c screenflow      -l jpeg      -d 'Output as JPEG instead of SVG'
complete -c screenflow      -l color  -r -d 'Frame color' \
  -a 'silver\t"Silver frame (default)" deep-blue\t"Deep Blue frame" cosmic-orange\t"Cosmic Orange frame"'
