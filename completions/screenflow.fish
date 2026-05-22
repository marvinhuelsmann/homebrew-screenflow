function __fish_screenflow_no_subcommand
    for i in (commandline -opc)
        if contains -- $i video devices config set-default author
            return 1
        end
    end
    return 0
end

# Global flags
complete -c screenflow -s v -l version -d 'Output the version number'
complete -c screenflow -s h -l help    -d 'Display help'

# Subcommands (only when no subcommand has been given yet)
complete -c screenflow -n '__fish_screenflow_no_subcommand' -f -a 'video'       -d 'Create a 9-second animated marketing video apple-watch-ultra\t"Apple Watch Ultra"'
complete -c screenflow -n '__fish_screenflow_no_subcommand' -f -a 'devices'     -d 'List all available devices and their colors'
complete -c screenflow -n '__fish_screenflow_no_subcommand' -f -a 'config'      -d 'Show saved defaults'
complete -c screenflow -n '__fish_screenflow_no_subcommand' -f -a 'set-default' -d 'Set a default device and color interactively'
complete -c screenflow -n '__fish_screenflow_no_subcommand' -f -a 'author'      -d 'About the author'

# Frame options (no subcommand — default frame command)
complete -c screenflow -n '__fish_screenflow_no_subcommand' -s o -l output -r -d 'Output file path'
complete -c screenflow -n '__fish_screenflow_no_subcommand'      -l png       -d 'Output as PNG instead of SVG'
complete -c screenflow -n '__fish_screenflow_no_subcommand'      -l jpeg      -d 'Output as JPEG instead of SVG'
complete -c screenflow -n '__fish_screenflow_no_subcommand' -s d -l device -r -d 'Device frame'
complete -c screenflow -n '__fish_screenflow_no_subcommand' -s c -l color  -r -d 'Frame color'

# Video options
complete -c screenflow -n '__fish_seen_subcommand_from video' -s o -l output -r -d 'Output file path'
complete -c screenflow -n '__fish_seen_subcommand_from video' -s d -l device -r -d 'Device frame'
complete -c screenflow -n '__fish_seen_subcommand_from video' -s c -l color  -r -d 'Frame color'
complete -c screenflow -n '__fish_seen_subcommand_from video' -s s -l style  -r -d 'Animation style' \
  -a 'zoom-in\t"Zoom in 1× → 2.2×, pan upward (default)" zoom-out\t"Zoom out 2.2× → 1×" pan-down\t"Pan top → bottom" pan-left\t"Pan right → left" pan-right\t"Pan left → right"'
complete -c screenflow -n '__fish_seen_subcommand_from video' -s t -l tilt   -r -d 'Perspective tilt downward in degrees (0–45)'
complete -c screenflow -n '__fish_seen_subcommand_from video'      -l fps    -r -d 'Frame rate' -a '24\t"24 fps" 30\t"30 fps" 60\t"60 fps (default)" 120\t"120 fps"'

# Devices
set -l __screenflow_devices 'iphone-17-pro\t"iPhone 17 Pro (default)" iphone-17\t"iPhone 17" iphone-16-pro\t"iPhone 16 Pro" iphone-16\t"iPhone 16" iphone-air\t"iPhone Air" ipad-pro-11\t"iPad Pro 11" ipad-pro-13\t"iPad Pro 13" imac\t"iMac"'

complete -c screenflow -n '__fish_screenflow_no_subcommand'    -l device -r -a $__screenflow_devices
complete -c screenflow -n '__fish_seen_subcommand_from video'  -l device -r -a $__screenflow_devices

# Colors — scoped per device
set -l __sf_colors_17pro  'silver\t"Silver (default)" deep-blue\t"Deep Blue" cosmic-orange\t"Cosmic Orange"'
set -l __sf_colors_17     'black\t"Black" lavender\t"Lavender" mist-blue\t"Mist Blue" sage\t"Sage" white\t"White"'
set -l __sf_colors_16pro  'dessert-titanium\t"Desert Titanium" black\t"Black" natural\t"Natural" white\t"White"'
set -l __sf_colors_16     'black\t"Black" pink\t"Pink" teal\t"Teal" ultramarine\t"Ultramarine" white\t"White"'
set -l __sf_colors_air    'black\t"Black" blue\t"Blue" gold\t"Gold" white\t"White"'
set -l __sf_colors_11     'silver\t"Silver" silver-with-apple-pencil\t"Silver + Pencil" space-gray\t"Space Gray" space-gray-with-apple-pencil\t"Space Gray + Pencil"'
set -l __sf_colors_13     'silver\t"Silver" space-gray\t"Space Gray"'
set -l __sf_colors_imac   'blue\t"Blue" green\t"Green" orange\t"Orange" pink\t"Pink" purple\t"Purple" silver\t"Silver" yellow\t"Yellow"'

for __sf_sub in '' video
    set -l __sf_cond (test -n "$__sf_sub"; and echo "__fish_seen_subcommand_from $__sf_sub"; or echo '__fish_screenflow_no_subcommand')

    complete -c screenflow -n "$__sf_cond" -l color -r \
      -n 'not __fish_seen_argument -s d --device; or __fish_seen_argument --device iphone-17-pro' \
      -a $__sf_colors_17pro
    complete -c screenflow -n "$__sf_cond" -l color -r -n '__fish_seen_argument --device iphone-17'      -a $__sf_colors_17
    complete -c screenflow -n "$__sf_cond" -l color -r -n '__fish_seen_argument --device iphone-16-pro'  -a $__sf_colors_16pro
    complete -c screenflow -n "$__sf_cond" -l color -r -n '__fish_seen_argument --device iphone-16'      -a $__sf_colors_16
    complete -c screenflow -n "$__sf_cond" -l color -r -n '__fish_seen_argument --device iphone-air'     -a $__sf_colors_air
    complete -c screenflow -n "$__sf_cond" -l color -r -n '__fish_seen_argument --device ipad-pro-11'    -a $__sf_colors_11
    complete -c screenflow -n "$__sf_cond" -l color -r -n '__fish_seen_argument --device ipad-pro-13'    -a $__sf_colors_13
    complete -c screenflow -n "$__sf_cond" -l color -r -n '__fish_seen_argument --device imac'           -a $__sf_colors_imac
end

complete -c screenflow -l color -r -d 'Frame color' \
  -n '__fish_seen_argument --device apple-watch-ultra' \
  -a 'black-alpine-loop\t"Black Alpine Loop" black-milanese\t"Black Milanese" natural-alpine-loop\t"Natural Alpine Loop" natural-milanese\t"Natural Milanese"'
