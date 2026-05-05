---
name: turboscribe
description: Automated TurboScribe transcription via browser automation. Upload audio files, configure whale-model + speaker diarization, wait for completion, and download transcripts. Use when John asks to transcribe audio/video with TurboScribe, convert speech to text, or mentions "转写", "transcribe", "turboscribe".
---

# TurboScribe

Upload audio to TurboScribe with Playwright, configure whale-mode + speaker diarization, poll for completion, download transcript.

## Prerequisites

- `playwright-core` installed (global or in NODE_PATH)
- Chromium browser available
- Environment variables set:
  - `TURBOSCRIBE_EMAIL` — TurboScribe login email
  - `TURBOSCRIBE_PASSWORD` — TurboScribe login password

## Usage

```bash
node scripts/upload.js <audio-file> [language]
```

- **audio-file**: path to audio/video file (mp3, m4a, wav, mp4, etc.)
- **language** (optional): defaults to `English`. Common values: `Chinese`, `Chinese (Simplified)`, `Japanese`, `Korean`, `French`, `German`, `Spanish`

## What it does

1. Opens persistent browser profile (cookies preserved at `~/.openclaw/browser-profiles/turboscribe`)
2. Logs in (handles Cloudflare Turnstile by pausing for manual intervention if needed)
3. Opens upload modal, selects file via dropzone
4. Polls upload progress until server-side processing completes
5. Configures: Whale model (large-v2), speaker diarization (auto-detect), specified language
6. Submits transcription job
7. Polls dashboard every 5 minutes (up to 60 min) until status shows "已完成"
8. Clicks into completed transcript, downloads result to `~/Downloads/turboscribe/`

## Notes

- Large files (50MB+) upload over HTTP; proxy/upload time varies
- The browser window stays visible — do not close it
- If Cloudflare Turnstile blocks login, the script waits 2 minutes for manual completion
- First login creates a persistent browser profile; subsequent runs reuse cookies
- Output directory: `~/Downloads/turboscribe/`
- Default settings: Whale model, speaker diarization=auto, no translate-to-English, no audio cleanup
