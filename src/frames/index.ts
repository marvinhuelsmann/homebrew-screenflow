export interface FrameSpec {
  canvas: { w: number; h: number };
  screen: { x: number; y: number; w: number; h: number };
  colors: Record<string, string>; // color name → svg filename within device folder
  frameType?: 'vector' | 'raster'; // default: 'vector'
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
};

export const DEFAULT_DEVICE = 'iphone-17-pro';
