export interface FrameSpec {
  canvas: { w: number; h: number };
  screen: { x: number; y: number; w: number; h: number };
  colors: Record<string, string>; // color name → svg filename within device folder
  frameType?: 'vector' | 'raster' | 'overlay'; // default: 'vector'
  cornerRadius?: number; // overlay frames only — clips screenshot to device's rounded screen
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
  'iphone-13-pro': {
    canvas: { w: 430, h: 884 },
    screen: { x: 20, y: 21, w: 390, h: 842 },
    frameType: 'overlay',
    cornerRadius: 52,
    colors: {
      'sierra-blue': 'sierra-blue.svg',
    },
  },
  'iphone-15-pro': {
    canvas: { w: 423, h: 882 },
    screen: { x: 15, y: 16, w: 393, h: 850 },
    frameType: 'overlay',
    cornerRadius: 58,
    colors: {
      'titanium-nature': 'titanium-nature.svg',
    },
  },
  'iphone-14-pro': {
    canvas: { w: 427, h: 886 },
    screen: { x: 17, y: 18, w: 393, h: 850 },
    frameType: 'overlay',
    cornerRadius: 67,
    colors: {
      'deep-purple': 'deep-purple.svg',
    },
  },
  'iphone-16-pro': {
    canvas: { w: 417, h: 876 },
    screen: { x: 12, y: 13, w: 393, h: 850 },
    frameType: 'overlay',
    cornerRadius: 65,
    colors: {
      'dessert-titanium': 'dessert-titanium.svg',
    },
  },
};

export const DEFAULT_DEVICE = 'iphone-17-pro';
