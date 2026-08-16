// ElevenLabs audio generation — manifest-driven, idempotent (skips existing files).
//
// Usage:  node tools/gen-audio.mjs <manifest.json> [--only name] [--force]
// Key:    read from ELEVENLABS_API_KEY env or the key file path in EL_KEY_FILE.
//
// Manifest entry shapes:
//   { "file": "public/assets/sfx/spin.mp3", "type": "sfx",
//     "prompt": "...", "duration_seconds": 1.2, "prompt_influence": 0.5 }
//   { "file": "public/assets/music/base-loop.mp3", "type": "music",
//     "prompt": "...", "music_length_ms": 30000 }
//   { "file": "public/assets/vo/bigwin.mp3", "type": "tts",
//     "text": "...", "voice_id": "...", "stability": 0.5, "similarity": 0.75 }
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';

const args = process.argv.slice(2);
const manifestPath = args.find((a) => !a.startsWith('--'));
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const force = args.includes('--force');
if (!manifestPath) {
  console.error('usage: node tools/gen-audio.mjs <manifest.json> [--only name] [--force]');
  process.exit(1);
}

function apiKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const f = process.env.EL_KEY_FILE || '/home/x/Desktop/Stake-Engine/elevenlabs api.txt';
  const raw = readFileSync(f, 'utf8');
  const m = raw.match(/[A-Za-z0-9_]{20,}/);
  if (!m) throw new Error('no api key found');
  return m[0];
}
const KEY = apiKey();
const BASE = 'https://api.elevenlabs.io';

async function post(path, body, tag) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`${tag}: HTTP ${r.status} ${t.slice(0, 300)}`);
  }
  return Buffer.from(await r.arrayBuffer());
}

async function genSfx(e) {
  return post('/v1/sound-generation', {
    text: e.prompt,
    duration_seconds: Math.max(0.5, Math.min(22, e.duration_seconds ?? 2)),
    prompt_influence: e.prompt_influence ?? 0.45,
  }, e.file);
}

async function genMusic(e) {
  // Eleven Music; fall back to sound-generation (max 22s) if unavailable on this plan.
  try {
    return await post('/v1/music', {
      prompt: e.prompt,
      music_length_ms: Math.min(300000, e.music_length_ms ?? 30000),
    }, e.file);
  } catch (err) {
    console.warn(`  music API failed (${String(err).slice(0, 120)}); falling back to sound-generation loop`);
    return genSfx({ ...e, duration_seconds: 22 });
  }
}

async function genTts(e) {
  return post(`/v1/text-to-speech/${e.voice_id}?output_format=mp3_44100_128`, {
    text: e.text,
    model_id: e.model_id ?? 'eleven_multilingual_v2',
    voice_settings: {
      stability: e.stability ?? 0.45,
      similarity_boost: e.similarity ?? 0.8,
      style: e.style ?? 0.4,
    },
  }, e.file);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
let ok = 0, skip = 0, fail = 0;
for (const e of manifest) {
  const out = resolve(dirname(manifestPath), '..', e.file);
  const name = e.file.split('/').pop();
  if (only && !name.includes(only)) continue;
  if (existsSync(out) && !force) { skip++; continue; }
  try {
    const buf = e.type === 'music' ? await genMusic(e) : e.type === 'tts' ? await genTts(e) : await genSfx(e);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buf);
    console.log(`✓ ${e.file} (${(buf.length / 1024).toFixed(0)} KB)`);
    ok++;
  } catch (err) {
    console.error(`✗ ${e.file}: ${String(err).slice(0, 200)}`);
    fail++;
  }
}
console.log(`done: ${ok} generated, ${skip} skipped, ${fail} failed`);
if (fail) process.exit(2);
