export interface FrameSpec {
  canvas: { w: number; h: number };
  screen: { x: number; y: number; w: number; h: number };
  colors: Record<string, string>; // color name → svg filename within device folder
  frameType?: 'vector' | 'raster' | 'overlay'; // default: 'vector'
  cornerRadius?: number; // clips screenshot corners to match the frame's rounded screen edge
  cutoutBleed?: number; // expands vector screen cutout covers to hide native screenshot hardware UI
}

export const FRAMES: Record<string, FrameSpec> = {
  'iphone-17-pro': {
    canvas: { w: 880, h: 1832 },
    screen: { x: 38, y: 42, w: 804, h: 1748 },
    colors: {
      'silver':         'silver.svg',
      'deep-blue':      'deep-blue.svg',
      'cosmic-orange':  'cosmic-orange.svg',
    },
    cutoutBleed: 8,
  },
  'ipad-pro-11': {
    canvas: { w: 2788, h: 2068 },
    screen: { x: 200, y: 200, w: 2388, h: 1668 },
    frameType: 'raster',
    colors: {
      'silver':                    'silver.svg',
      'silver-with-apple-pencil':  'silver-with-apple-pencil.svg',
      'space-gray':                'space-gray.svg',
      'space-gray-with-apple-pencil': 'space-gray-with-apple-pencil.svg',
    },
  },
  'ipad-pro-13': {
    canvas: { w: 3132, h: 2448 },
    screen: { x: 200, y: 200, w: 2732, h: 2048 },
    frameType: 'raster',
    colors: {
      'silver': 'silver.svg',
      'space-gray': 'space-gray.svg',
    },
  },
  'iphone-16-pro': {
    canvas: { w: 417, h: 876 },
    screen: { x: 12, y: 13, w: 393, h: 850 },
    frameType: 'overlay',
    cornerRadius: 58,
    colors: {
      'dessert-titanium': 'dessert-titanium.svg',
      'natural': 'natural.svg',
      'white': 'white.svg',
      'black': 'black.svg',
    },
  },
  'iphone-air': {
    canvas: { w: 1380, h: 2880 },
    screen: { x: 60, y: 72, w: 1260, h: 2736 },
    frameType: 'raster',
    cornerRadius: 185,
    colors: {
      'black': 'black.svg',
      'blue': 'blue.svg',
      'gold': 'gold.svg',
      'white': 'white.svg',
    },
  },
  'iphone-17': {
    canvas: { w: 1350, h: 2760 },
    screen: { x: 72, y: 69, w: 1206, h: 2622 },
    frameType: 'raster',
    cornerRadius: 190,
    colors: {
      'black': 'black.svg',
      'lavender': 'lavender.svg',
      'mist-blue': 'mist-blue.svg',
      'sage': 'sage.svg',
      'white': 'white.svg',
    },
  },
  'iphone-16': {
    canvas: { w: 1359, h: 2736 },
    screen: { x: 90, y: 90, w: 1179, h: 2556 },
    frameType: 'raster',
    cornerRadius: 165,
    colors: {
      'black': 'black.svg',
      'pink': 'pink.svg',
      'teal': 'teal.svg',
      'ultramarine': 'ultramarine.svg',
      'white': 'white.svg',
    },
  },
  'imac': {
    canvas: { w: 4096, h: 3485 },
    screen: { x: 121, y: 129, w: 3854, h: 2167 },
    frameType: 'raster',
    colors: {
      'blue': 'blue.svg',
      'green': 'green.svg',
      'orange': 'orange.svg',
      'pink': 'pink.svg',
      'purple': 'purple.svg',
      'silver': 'silver.svg',
      'yellow': 'yellow.svg',
    },
  },
  'apple-watch-ultra': {
    canvas: { w: 600, h: 960 },
    screen: { x: 89, y: 223, w: 422, h: 514 },
    frameType: 'raster',
    cornerRadius: 115,
    colors: {
      'black-alpine-loop': 'black-alpine-loop.svg',
      'black-milanese': 'black-milanese.svg',
      'natural-alpine-loop': 'natural-alpine-loop.svg',
      'natural-milanese': 'natural-milanese.svg',
    },
  },
};

export const DEFAULT_DEVICE = 'iphone-17-pro';
