import { encodeWav } from './wav';

const MIME_CANDIDATES: Array<[string, string]> = [
  ['audio/webm;codecs=opus', 'webm'],
  ['audio/webm', 'webm'],
  ['audio/ogg;codecs=opus', 'ogg'],
  ['audio/mp4;codecs=mp4a.40.2', 'm4a'],
  ['audio/mp4', 'm4a'],
];

export interface Take {
  id: number;
  name: string;
  blob: Blob;
  url: string;
  mime: string;
  ext: string;
  duration: number;
  createdAt: number;
}

function pickMime(): [string, string] | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const c of MIME_CANDIDATES) if (MediaRecorder.isTypeSupported(c[0])) return c;
  return ['', 'webm'];
}

/**
 * Records the final master output (post master volume + limiter) through a
 * MediaStreamAudioDestinationNode. What you hear is what gets recorded.
 */
export class Recorder {
  readonly node: MediaStreamAudioDestinationNode;
  readonly supported: boolean;
  readonly mime: string;
  private readonly ext: string;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private counter = 0;

  constructor(private readonly ctx: AudioContext) {
    this.node = ctx.createMediaStreamDestination();
    this.node.channelCount = 2;
    const m = pickMime();
    this.supported = m !== null;
    this.mime = m ? m[0] : '';
    this.ext = m ? m[1] : 'webm';
  }

  get active() {
    return this.recorder !== null && this.recorder.state === 'recording';
  }

  start(): boolean {
    if (!this.supported || this.active) return false;
    const opts: MediaRecorderOptions = { audioBitsPerSecond: 256_000 };
    if (this.mime) opts.mimeType = this.mime;
    const rec = new MediaRecorder(this.node.stream, opts);
    this.chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    rec.start(500);
    this.recorder = rec;
    this.startedAt = performance.now();
    return true;
  }

  stop(): Promise<Take | null> {
    const rec = this.recorder;
    if (!rec) return Promise.resolve(null);
    this.recorder = null;
    const duration = (performance.now() - this.startedAt) / 1000;
    return new Promise((resolve) => {
      rec.onstop = () => {
        const mime = rec.mimeType || this.mime || 'audio/webm';
        const blob = new Blob(this.chunks, { type: mime });
        this.chunks = [];
        if (blob.size === 0) {
          resolve(null);
          return;
        }
        const id = ++this.counter;
        resolve({
          id,
          name: `TAKE ${String(id).padStart(2, '0')}`,
          blob,
          url: URL.createObjectURL(blob),
          mime,
          ext: this.ext,
          duration,
          createdAt: Date.now(),
        });
      };
      rec.stop();
    });
  }

  /** Decode a take and re-encode it as 16-bit WAV. */
  async toWav(take: Take): Promise<Blob> {
    const data = await take.blob.arrayBuffer();
    const buffer = await this.ctx.decodeAudioData(data);
    return new Blob([encodeWav(buffer, 16)], { type: 'audio/wav' });
  }
}
