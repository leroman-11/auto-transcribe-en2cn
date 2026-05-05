---
name: turboscribe
description: Automated TurboScribe transcription via browser automation. Upload audio files, configure whale-model + speaker diarization, wait for completion, and download transcripts. Use when John asks to transcribe audio/video with TurboScribe, convert speech to text, or mentions "转写", "transcribe", "turboscribe". Also handles converting transcript TXT into structured meeting minutes (纪要) and clean verbatim (逐字稿) Markdown files.
---

# TurboScribe

Two workflows:

## Workflow A: Audio → Transcript

Upload audio to TurboScribe via Playwright browser automation.

### Prerequisites

- `playwright-core` installed
- Chromium browser available
- Env vars: `TURBOSCRIBE_EMAIL`, `TURBOSCRIBE_PASSWORD`

### Usage

```bash
node scripts/upload.js <audio-file> [language]
```

- **audio-file**: path to audio/video file (mp3, m4a, wav, mp4, etc.)
- **language** (optional): defaults to `English`. Common: `Chinese`, `Chinese (Simplified)`, `Japanese`, etc.

### Flow

1. Opens persistent browser profile (`~/.openclaw/browser-profiles/turboscribe`)
2. Logs in (pauses for manual Cloudflare Turnstile if needed)
3. Uploads file via dropzone, polls until server processing completes
4. Configures: Whale model (large-v2), speaker diarization=auto, specified language
5. Submits job, polls dashboard every 5min (up to 60min)
6. Downloads transcript to `~/Downloads/turboscribe/`

---

## Workflow B: Transcript → Meeting Minutes

Convert a transcript TXT into two Markdown files following the rules in [meeting-minutes-rules.md](references/meeting-minutes-rules.md).

### When to Use

- User provides a transcript TXT file (or a transcript you already have)
- User asks for "会议纪要", "逐字稿", "整理转写", "meeting minutes"
- User wants structured notes from a conversation/meting transcript

### Output

Two files written to `/Users/johnc/Documents/Obsidian/CXZ/01-Inbox/Upload/`:

| File | Naming | Purpose |
|------|--------|---------|
| 逐字稿 | `{name}-逐字稿.md` | Clean verbatim — all speakers preserved, text-friendly expression |
| 纪要 | `{name}-纪要.md` | Structured minutes — 3-6 topics with bullet points + 其他Q&A |

### Rules

Read **[meeting-minutes-rules.md](references/meeting-minutes-rules.md)** for the complete conversion specification, then apply it. Key points:

- **File 1 (逐字稿)**: Keep all speakers + speaking order, convert oral to written expression, never add or omit information
- **File 2 (纪要)**: Group into 3-6 topics (max 10), use `一、标题` format, bullet points under each, all numbers/proper nouns preserved. Unclassified content goes to `其他Q&A`
- Within each topic segment, content can be freely reorganized for clarity

### Workflow

1. Read the transcript TXT
2. Read `references/meeting-minutes-rules.md`
3. Produce File 1 (逐字稿) — clean and format
4. Produce File 2 (纪要) — segment, structure, bullet-point
5. Write both files alongside the source

---

## Notes

- Large audio files (50MB+) upload time varies
- First login creates persistent browser profile; subsequent runs reuse cookies
- Browser window stays visible during automation — do not close it
- Output directory for transcripts: `~/Downloads/turboscribe/`
