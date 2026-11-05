#!/usr/bin/env node
/**
 * RHYTHM end-to-end check: drives the real app in headless Chromium with the real
 * keyboard and verifies the *audio* (FFT of the master bus, decoded recordings),
 * not just the UI state.
 *
 *   npm run build && npm run test:e2e
 *
 * Needs Playwright with Chromium (`npm i -D playwright && npx playwright install chromium`).
 * Set RHYTHM_URL to test an already running server; otherwise `vite preview` is started.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'scripts', '.e2e-out');
mkdirSync(out, { recursive: true });

// ───────────────────────── test audio ─────────────────────────
const SR = 44100;
function wav(path, seconds, fn, channels = 2) {
  const n = Math.round(seconds * SR);
  const buf = Buffer.alloc(44 + n * channels * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * channels * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * channels * 2, 28);
  buf.writeUInt16LE(channels * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * channels * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, fn(i / SR)));
    for (let c = 0; c < channels; c++) buf.writeInt16LE(Math.round(v * 32767), 44 + (i * channels + c) * 2);
  }
  writeFileSync(path, buf);
  return path;
}
let seed = 9;
const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1;
const files = {
  // Deck A: 60 Hz (bass) + 440 Hz tones. Deck B: 1000 Hz tone. Clean FFT separation.
  a: wav(join(out, 'tone-a.wav'), 40, (t) => 0.35 * Math.sin(2 * Math.PI * 60 * t) + 0.3 * Math.sin(2 * Math.PI * 440 * t)),
  b: wav(join(out, 'tone-b.wav'), 40, (t) => 0.4 * Math.sin(2 * Math.PI * 1000 * t)),
  // 140 BPM half-time groove for tempo detection.
  drums: wav(join(out, 'grime-140.wav'), 45, (t) => {
    const beat = 60 / 140;
    const b = t / beat;
    const inBar = b % 8;
    let v = 0;
    const kickAt = (p) => {
      const d = (inBar - p) * beat;
      if (d >= 0 && d < 0.3) v += 0.8 * Math.sin(2 * Math.PI * (50 + 110 * Math.exp(-d * 30)) * d) * Math.exp(-d * 10);
    };
    kickAt(0);
    kickAt(2.75);
    kickAt(4.5);
    const sd = (inBar - 4) * beat;
    if (sd >= 0 && sd < 0.2) v += 0.5 * rand() * Math.exp(-sd * 16);
    const hd = ((b * 2) % 1) * (beat / 2);
    if (hd < 0.05) v += 0.15 * rand() * Math.exp(-hd * 70);
    return v;
  }),
  sample: wav(join(out, 'my-snare.wav'), 0.3, (t) => 0.8 * rand() * Math.exp(-t * 18), 1),
  junk: (() => {
    const p = join(out, 'not-audio.mp3');
    writeFileSync(p, 'definitely not audio');
    return p;
  })(),
};

// ───────────────────────── harness ─────────────────────────
let server;
let url = process.env.RHYTHM_URL;
if (!url) {
  url = 'http://localhost:4319/';
  server = spawn('npx', ['vite', 'preview', '--port', '4319', '--strictPort'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(url);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? `  — ${detail}` : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 880 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

try {
  await page.goto(url);
  await page.waitForFunction(() => window.rhythm?.state.pads.every((p) => !p.loading));
  await page.mouse.click(5, 5); // user gesture

  // Probe: FFT of the master bus (post limiter = what you hear and what gets recorded).
  await page.evaluate(() => {
    const e = window.rhythm;
    const an = e.ctx.createAnalyser();
    an.fftSize = 16384;
    an.smoothingTimeConstant = 0;
    e.limiter.connect(an);
    const data = new Float32Array(an.frequencyBinCount);
    window.__mag = (f) => {
      an.getFloatFrequencyData(data);
      const bin = (f / e.ctx.sampleRate) * an.fftSize;
      let m = -200;
      for (let i = Math.floor(bin) - 2; i <= Math.ceil(bin) + 2; i++) m = Math.max(m, data[i]);
      return m;
    };
    window.__peakFreq = (lo, hi) => {
      an.getFloatFrequencyData(data);
      const k = e.ctx.sampleRate / an.fftSize;
      let best = 0;
      for (let i = Math.floor(lo / k); i <= Math.ceil(hi / k); i++) if (data[i] > data[best] || best === 0) best = i;
      const a = data[best - 1], b = data[best], c = data[best + 1];
      const off = (0.5 * (a - c)) / (a - 2 * b + c);
      return (best + off) * k;
    };
  });
  const mag = (f) => page.evaluate((f) => window.__mag(f), f);
  const st = () => page.evaluate(() => {
    const s = window.rhythm.state;
    return { A: s.decks.A, B: s.decks.B, x: s.crossfader, master: s.masterVolume, rec: s.recording.active, takes: s.takes.length };
  });
  const pos = (id) => page.evaluate((id) => window.rhythm.decks[id].position(), id);
  const key = async (k, ms = 40) => {
    await page.keyboard.down(k);
    await sleep(ms);
    await page.keyboard.up(k);
  };

  console.log('\nLOADING');
  await page.setInputFiles('.deck--a input[type=file]', files.a);
  await page.setInputFiles('.deck--b input[type=file]', files.b);
  await page.waitForFunction(() => window.rhythm.state.decks.A.status === 'ready' && window.rhythm.state.decks.B.status === 'ready');
  let s = await st();
  check('Deck A loads a local WAV', s.A.status === 'ready' && Math.abs(s.A.duration - 40) < 0.1, `${s.A.title}, ${s.A.duration.toFixed(2)} s`);
  check('Deck B loads independently', s.B.status === 'ready' && s.B.title === 'tone-b');
  await page.setInputFiles('.deck--a input[type=file]', files.junk);
  await sleep(400);
  s = await st();
  check('A non-audio file is rejected without touching the loaded track', s.A.title === 'tone-a' && s.A.status === 'ready');
  await sleep(200);
  s = await st();
  check('Tempo is not invented for material without a pulse', s.A.bpm === null && !s.A.analyzing);

  console.log('\nPLAYBACK (keyboard)');
  await key('KeyQ');
  await key('KeyO');
  const p0 = [await pos('A'), await pos('B')];
  await sleep(1000);
  const p1 = [await pos('A'), await pos('B')];
  s = await st();
  check('Q / O play both decks simultaneously', s.A.playing && s.B.playing);
  check('Both playheads advance in real time', Math.abs(p1[0] - p0[0] - 1) < 0.15 && Math.abs(p1[1] - p0[1] - 1) < 0.15, `A +${(p1[0] - p0[0]).toFixed(3)} s, B +${(p1[1] - p0[1]).toFixed(3)} s`);
  await sleep(150);
  const both = [await mag(440), await mag(1000), await mag(60)];
  check('Master carries both decks at center', both[0] > -45 && both[1] > -45, `440 Hz ${both[0].toFixed(1)} dB, 1 kHz ${both[1].toFixed(1)} dB`);

  console.log('\nCROSSFADER (hold A / D)');
  const xs = [];
  await page.keyboard.down('KeyA');
  for (let i = 0; i < 6; i++) {
    await sleep(70);
    xs.push((await st()).x);
  }
  await page.keyboard.up('KeyA');
  const xRel = (await st()).x;
  await sleep(250);
  const xAfter = (await st()).x;
  const monotonic = xs.every((v, i) => i === 0 || v < xs[i - 1]);
  check('Holding A moves the fader continuously', monotonic && xs[0] < 0 && xs.length === 6, xs.map((v) => v.toFixed(2)).join(' → '));
  check('Releasing A stops the fader', Math.abs(xAfter - xRel) < 1e-9, `${xRel.toFixed(3)} stays ${xAfter.toFixed(3)}`);
  await page.keyboard.down('KeyA');
  await sleep(1600);
  await page.keyboard.up('KeyA');
  await sleep(200);
  s = await st();
  const fullA = [await mag(440), await mag(1000)];
  check('Full A: only Deck A is heard', s.x === -1 && fullA[0] > -45 && fullA[1] < -90, `440 Hz ${fullA[0].toFixed(1)} dB, 1 kHz ${fullA[1].toFixed(1)} dB`);
  await page.keyboard.down('KeyD');
  await sleep(2700);
  await page.keyboard.up('KeyD');
  await sleep(200);
  s = await st();
  const fullB = [await mag(440), await mag(1000)];
  check('Full B: only Deck B is heard', s.x === 1 && fullB[1] > -45 && fullB[0] < -90, `440 Hz ${fullB[0].toFixed(1)} dB, 1 kHz ${fullB[1].toFixed(1)} dB`);
  await key('KeyS');
  await sleep(400);
  check('S returns the fader to center', (await st()).x === 0);

  console.log('\nSPEED (Z / X)');
  await key('KeyX');
  s = await st();
  check('Tap X nudges Deck A speed by one fine step', Math.abs(s.A.rate - 1.002) < 1e-6, `rate ${s.A.rate}`);
  await page.keyboard.down('KeyX');
  await sleep(1500);
  await page.keyboard.up('KeyX');
  s = await st();
  const rate = s.A.rate;
  await sleep(300);
  const f = await page.evaluate(() => window.__peakFreq(400, 520));
  const q0 = await pos('A');
  await sleep(1000);
  const q1 = await pos('A');
  check('Holding X raises the speed continuously', rate > 1.02, `rate ${rate.toFixed(4)}`);
  check('Speed changes the actual audio (pitch-linked)', Math.abs(f - 440 * rate) < 1.5, `440 Hz tone now at ${f.toFixed(1)} Hz (expected ${(440 * rate).toFixed(1)})`);
  check('Playhead runs at the new rate', Math.abs(q1 - q0 - rate) < 0.1, `+${(q1 - q0).toFixed(3)} s per second`);
  await page.keyboard.down('KeyZ');
  await page.keyboard.down('KeyX');
  await sleep(60);
  await page.keyboard.up('KeyZ');
  await page.keyboard.up('KeyX');
  check('Z + X together resets the speed', (await st()).A.rate === 1);
  await sleep(500); // let the 370 ms FFT window flush the previous pitch

  console.log('\nBASS (C / V) · VOLUME (⇧C / ⇧V) · MUTE');
  const bassBefore = [await mag(60), await mag(440)];
  await page.keyboard.down('KeyC');
  await sleep(1700);
  await page.keyboard.up('KeyC');
  await sleep(300);
  s = await st();
  const bassAfter = [await mag(60), await mag(440)];
  check('Holding C cuts Deck A bass to kill', s.A.bassDb === -26, `${s.A.bassDb} dB`);
  check('Bass cut removes lows from the real signal, mids stay', bassBefore[0] - bassAfter[0] > 15 && Math.abs(bassBefore[1] - bassAfter[1]) < 4, `60 Hz ${bassBefore[0].toFixed(1)} → ${bassAfter[0].toFixed(1)} dB, 440 Hz ${bassBefore[1].toFixed(1)} → ${bassAfter[1].toFixed(1)} dB`);
  await page.keyboard.down('KeyC');
  await page.keyboard.down('KeyV');
  await sleep(50);
  await page.keyboard.up('KeyV');
  await page.keyboard.up('KeyC');
  check('C + V together returns bass to 0 dB', (await st()).A.bassDb === 0);
  const volBefore = await mag(440);
  await page.keyboard.down('Shift');
  await page.keyboard.down('KeyC');
  await sleep(600);
  await page.keyboard.up('KeyC');
  await page.keyboard.up('Shift');
  await sleep(300);
  s = await st();
  const volAfter = await mag(440);
  check('Shift + C lowers Deck A volume', s.A.volume < 0.6 && volBefore - volAfter > 4, `fader ${s.A.volume.toFixed(2)}, 440 Hz ${volBefore.toFixed(1)} → ${volAfter.toFixed(1)} dB`);
  await page.evaluate(() => window.rhythm.setVolume('A', 0.9));
  await key('Slash');
  await sleep(500);
  check('/ mutes Deck B in the audio', (await st()).B.muted && (await mag(1000)) < -90, `1 kHz ${(await mag(1000)).toFixed(1)} dB`);
  await key('Slash');
  await sleep(500);
  check('/ again unmutes Deck B', !(await st()).B.muted && (await mag(1000)) > -45);

  console.log('\nLOOP (W / F / G)');
  await key('KeyW');
  s = await st();
  const loop = s.A.loop;
  check('W starts a loop on Deck A', !!loop, loop ? `${loop.start.toFixed(3)} → ${loop.end.toFixed(3)} (${(loop.end - loop.start).toFixed(3)} s, no BPM = time loop)` : '');
  const samples = [];
  for (let i = 0; i < 12; i++) {
    await sleep(250);
    samples.push(await pos('A'));
  }
  const inside = samples.every((p) => p >= loop.start - 0.01 && p < loop.end + 0.01);
  const wrapped = samples.some((p, i) => i > 0 && p < samples[i - 1]);
  check('Playhead stays inside the loop and wraps', inside && wrapped, `${samples.map((p) => p.toFixed(2)).join(' ')}`);
  await key('KeyF');
  s = await st();
  check('F halves the active loop', s.A.loop && Math.abs(s.A.loop.end - s.A.loop.start - (loop.end - loop.start) / 2) < 0.01, `${(s.A.loop.end - s.A.loop.start).toFixed(3)} s`);
  await sleep(1200);
  const pl = await pos('A');
  check('Halved loop keeps playing inside the new bounds', pl >= s.A.loop.start - 0.01 && pl < s.A.loop.end + 0.01);
  await key('KeyG');
  await key('KeyW');
  await sleep(2600);
  s = await st();
  const pe = await pos('A');
  check('W again exits the loop and playback continues', !s.A.loop && pe > loop.end, `pos ${pe.toFixed(2)} > ${loop.end.toFixed(2)}`);

  console.log('\nCUE (E)');
  await key('KeyQ'); // pause A
  await page.evaluate(() => window.rhythm.seek('A', 12));
  await page.keyboard.down('KeyE');
  await sleep(700);
  s = await st();
  const during = await pos('A');
  check('E while paused sets the cue point and previews while held', s.A.previewing && s.A.playing && Math.abs(s.A.cuePoint - 12) < 0.01 && during > 12.4, `cue ${s.A.cuePoint.toFixed(2)}, preview at ${during.toFixed(2)}`);
  await page.keyboard.up('KeyE');
  await sleep(100);
  s = await st();
  check('Releasing E returns to the cue point', !s.A.playing && Math.abs((await pos('A')) - 12) < 0.01);
  await key('KeyQ');
  await sleep(800);
  await key('KeyE');
  await sleep(100);
  s = await st();
  check('E while playing jumps back to cue and pauses', !s.A.playing && Math.abs((await pos('A')) - 12) < 0.01);

  console.log('\nDRUM PAD (1–9)');
  await key('KeyQ'); // A playing again for the recording below
  const voices = await page.evaluate(async () => {
    const e = window.rhythm;
    return e.sampler.pads.map((p) => p.buffer?.duration ?? 0);
  });
  check('All nine pads hold decoded samples', voices.every((d) => d > 0.05), voices.map((d) => d.toFixed(2)).join(' '));
  for (const k of ['Digit1', 'Digit2', 'Digit5', 'Digit9']) await page.keyboard.down(k);
  const active = await page.evaluate(() => window.rhythm.sampler.activeVoices());
  for (const k of ['Digit1', 'Digit2', 'Digit5', 'Digit9']) await page.keyboard.up(k);
  check('Several pads play simultaneously', active >= 4, `${active} voices`);
  await page.evaluate(() => {
    const ev = new KeyboardEvent('keydown', { code: 'Digit1', key: '1', repeat: true, bubbles: true });
    window.dispatchEvent(ev);
  });
  await sleep(30);
  await page.setInputFiles('.pad:nth-child(3) input[type=file]', files.sample);
  await page.waitForFunction(() => window.rhythm.state.pads[2].source === 'user');
  s = await page.evaluate(() => window.rhythm.state.pads[2]);
  check('A pad accepts a custom sample', s.name === 'MY-SNARE' && s.source === 'user', `${s.name} (${s.duration.toFixed(2)} s)`);
  const stored = await page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open('rhythm', 1);
        r.onsuccess = () => {
          const g = r.result.transaction('kit').objectStore('kit').get(2);
          g.onsuccess = () => res(!!g.result?.data);
        };
        r.onerror = () => res(false);
      }),
  );
  check('Custom sample is persisted for the next session', stored);

  console.log('\nRECORDING (R / T)');
  await key('KeyR');
  await sleep(300);
  check('R starts recording', (await st()).rec);
  for (let i = 0; i < 6; i++) {
    await key('Digit1', 30);
    await sleep(220);
  }
  await page.keyboard.down('KeyD');
  await sleep(1300);
  await page.keyboard.up('KeyD');
  await sleep(800);
  await key('KeyT');
  await page.waitForFunction(() => window.rhythm.state.takes.length === 1);
  const take = await page.evaluate(async () => {
    const e = window.rhythm;
    const t = e.state.takes[0];
    const blob = await (await fetch(t.url)).blob();
    const buf = await e.ctx.decodeAudioData(await blob.arrayBuffer());
    const d = buf.getChannelData(0);
    const goertzel = (from, to, f) => {
      const k = 2 * Math.cos((2 * Math.PI * f) / buf.sampleRate);
      let s1 = 0, s2 = 0;
      for (let i = from; i < to; i++) {
        const s0 = d[i] + k * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      return Math.sqrt(s1 * s1 + s2 * s2 - k * s1 * s2) / (to - from);
    };
    const n = buf.length;
    const early = [Math.floor(n * 0.15), Math.floor(n * 0.3)];
    const late = [Math.floor(n * 0.85), n - 1];
    let rms = 0;
    for (let i = 0; i < n; i++) rms += d[i] * d[i];
    return {
      size: blob.size,
      type: blob.type,
      seconds: buf.duration,
      claimed: t.duration,
      rms: Math.sqrt(rms / n),
      early440: goertzel(early[0], early[1], 440),
      early1k: goertzel(early[0], early[1], 1000),
      late440: goertzel(late[0], late[1], 440),
      late1k: goertzel(late[0], late[1], 1000),
    };
  });
  check('T stops and stores a take', take.size > 5000, `${take.type}, ${(take.size / 1024).toFixed(0)} KB`);
  check('Take duration matches the session', Math.abs(take.seconds - take.claimed) < 0.4 && take.seconds > 3, `decoded ${take.seconds.toFixed(2)} s, shown ${take.claimed.toFixed(2)} s`);
  check('Recording contains real audio', take.rms > 0.05, `rms ${take.rms.toFixed(3)}`);
  check(
    'Recording captured the crossfade from both decks to Deck B',
    take.early440 > 0.02 && take.early1k > 0.02 && take.late1k > 0.02 && take.late440 < take.early440 / 20,
    `start 440/1k ${take.early440.toFixed(3)}/${take.early1k.toFixed(3)}, end ${take.late440.toFixed(4)}/${take.late1k.toFixed(3)}`,
  );
  const dl = page.waitForEvent('download');
  await page.evaluate(() => window.rhythm.downloadTake(window.rhythm.state.takes[0].id, 'wav'));
  const download = await dl;
  const wavPath = join(out, download.suggestedFilename());
  await download.saveAs(wavPath);
  const head = readFileSync(wavPath);
  check('WAV export is a valid PCM file', head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE' && head.length > 100_000, `${download.suggestedFilename()} ${(head.length / 1024).toFixed(0)} KB`);
  await key('KeyR');
  await sleep(600);
  await key('KeyT');
  await page.waitForFunction(() => window.rhythm.state.takes.length === 2);
  check('Multiple takes in one session', true, '2 takes listed');

  console.log('\nTEMPO + TIME-BASED LOOPS');
  await page.setInputFiles('.deck--b input[type=file]', files.drums);
  await page.waitForFunction(() => window.rhythm.state.decks.B.title === 'grime-140' && !window.rhythm.state.decks.B.analyzing);
  s = await st();
  check('BPM detected from a 140 BPM half-time groove', s.B.bpm !== null && Math.abs(s.B.bpm - 140) < 0.2, `${s.B.bpm} BPM`);
  await key('KeyO');
  await key('KeyP');
  s = await st();
  const len = s.B.loop.end - s.B.loop.start;
  check('Loops use the BPM (1 bar at 140 BPM)', Math.abs(len - (4 * 60) / 140) < 0.006, `${len.toFixed(4)} s vs ${((4 * 60) / 140).toFixed(4)} s`);
  await key('KeyP');

  console.log('\nKEYBOARD RULES');
  const before = (await st()).A.playing;
  await page.click('.deck--a .deck-bpm-value');
  await page.keyboard.type('q174');
  await page.keyboard.press('Enter');
  s = await st();
  check('Shortcuts are ignored while typing in a field', s.A.playing === before && s.A.bpm === 174, `typed “q174”: BPM ${s.A.bpm}, deck A playing ${before} → ${s.A.playing}`);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', key: 'q', metaKey: true, bubbles: true })));
  check('⌘ shortcuts are left to the OS / browser', (await st()).A.playing === before);
  const p1Before = (await st()).A.playing;
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', key: 'q', repeat: true, bubbles: true })));
  check('OS key repeat does not re-trigger toggles', (await st()).A.playing === p1Before);
  await page.keyboard.down('KeyA');
  await sleep(100);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  const xb = (await st()).x;
  await sleep(200);
  check('Window blur releases held keys (no stuck fader)', (await st()).x === xb);
  await page.keyboard.up('KeyA');

  console.log('\nEMERGENCY STOP');
  await key('Digit9');
  await key('Escape');
  await sleep(100);
  s = await st();
  const left = await page.evaluate(() => window.rhythm.sampler.activeVoices());
  check('Esc stops both decks and every pad', !s.A.playing && !s.B.playing && left === 0);

  await page.screenshot({ path: join(out, 'final.png') });
  check('No runtime errors in the page', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('E2E run completed', false, e.stack || String(e));
} finally {
  await browser.close();
  server?.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
