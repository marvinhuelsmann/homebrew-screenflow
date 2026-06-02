import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { confirm } from '@inquirer/prompts';
import { cyan } from './ui';

// ── Input classification ───────────────────────────────────────────────────────

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi']);

export type InputKind = 'image' | 'video';

// Screen recordings drive the video pipeline; everything else (png/jpg/heic/…)
// is treated as a still and handled by sharp.
export function detectInputKind(file: string): InputKind {
  return VIDEO_EXTS.has(path.extname(file).toLowerCase()) ? 'video' : 'image';
}

// ── ffmpeg / ffprobe availability ───────────────────────────────────────────────

export function ffmpegAvailable(): boolean {
  const r = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  return !r.error;
}

export async function ensureFfmpeg(): Promise<void> {
  if (ffmpegAvailable()) return;

  console.log(`${cyan('✦')} ffmpeg is required but was not found.`);
  const install = await confirm({ message: 'Install ffmpeg via Homebrew now?' });
  if (!install) throw new Error('ffmpeg is required — install it with: brew install ffmpeg');

  console.log(`${cyan('✦')} Installing ffmpeg via Homebrew...`);
  const r = spawnSync('brew', ['install', 'ffmpeg'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Homebrew install failed. Run: brew install ffmpeg');
  if (!ffmpegAvailable()) throw new Error('ffmpeg still not found after install — check your PATH');
}

export function runFfmpeg(args: string[]): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const errChunks: Buffer[] = [];
    proc.stderr?.on('data', (d: Buffer) => errChunks.push(d));
    proc.on('error', reject);
    proc.on('close', code => resolve({ exitCode: code ?? 1, stderr: Buffer.concat(errChunks).toString() }));
  });
}

// ── ffprobe ──────────────────────────────────────────────────────────────────────

export interface VideoInfo {
  durationSec: number;
  width: number;
  height: number;
  avgFps: number;
  hasAudio: boolean;
}

// Parses an ffprobe rate string like "30000/1001" or "24/1" into fps.
function parseRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [n, d] = rate.split('/').map(Number);
  if (!isFinite(n) || !isFinite(d) || d === 0) return 0;
  return n / d;
}

// Reads container/stream metadata. ffprobe ships with ffmpeg, so ensureFfmpeg()
// covers it too.
export function probeVideo(file: string): VideoInfo {
  const r = spawnSync(
    'ffprobe',
    ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', file],
    { encoding: 'utf8' },
  );
  if (r.error || r.status !== 0) {
    throw new Error(`Could not read video "${path.basename(file)}" — is it a valid media file?`);
  }

  let probe: any;
  try {
    probe = JSON.parse(r.stdout);
  } catch {
    throw new Error(`ffprobe returned unreadable output for "${path.basename(file)}"`);
  }

  const streams: any[] = probe.streams ?? [];
  const video = streams.find(s => s.codec_type === 'video');
  if (!video) throw new Error(`No video stream found in "${path.basename(file)}"`);

  const hasAudio = streams.some(s => s.codec_type === 'audio');
  const durationSec = parseFloat(probe.format?.duration ?? video.duration ?? '0');
  if (!isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`Could not determine duration of "${path.basename(file)}"`);
  }

  const avgFps = parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate) || 30;

  return {
    durationSec,
    width: Number(video.width) || 0,
    height: Number(video.height) || 0,
    avgFps,
    hasAudio,
  };
}
