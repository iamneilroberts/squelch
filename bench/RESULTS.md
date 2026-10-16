# Model bench results

<!-- triage -->
## Triage — 2026-10-16

26 cases × 2 rep(s). Routine/not = flagged the right transcripts as newsworthy; Action = new vs. correct open-incident update; Location = geocode query contains the correctly spelled place; PII = no names/phones/plates echoed. Speech = Jev's real-speech check on 16 live-style cases (model filler, name lists, real fragments).

**Jev as a pre-filter** (skip the LLM when newsworthy p is below the threshold): p < 0.1: skips 89% of routine, loses 0% of real incidents; p < 0.2: skips 94% of routine, loses 0% of real incidents; p < 0.3: skips 100% of routine, loses 0% of real incidents; p < 0.5: skips 100% of routine, loses 0% of real incidents.

| Model | Overall | Routine/not | Speech | Action | Category | Type | Location | PII | $ / 1k calls | p50 | Errors |
|---|---|---|---|---|---|---|---|---|---|---|---|
| openai/gpt-6-luna-pro | **99%** | 100% | — | 100% | 96% | 100% | 94% | 100% | $0.50 | 4.8s |  |
| openai/gpt-6-sol | **99%** | 100% | — | 100% | 100% | 97% | 91% | 100% | $2.34 | 1.9s |  |
| anthropic/claude-opus-5.5 | **98%** | 100% | — | 100% | 100% | 100% | 88% | 100% | $8.71 | 3.8s |  |
| openai/gpt-6-luna | **98%** | 100% | — | 100% | 92% | 97% | 94% | 100% | $0.13 | 2.5s |  |
| google/gemini-3.8-flash | **98%** | 100% | — | 100% | 92% | 94% | 97% | 100% | $1.19 | 2.5s |  |
| deepseek/deepseek-v4.1-flash | **97%** | 98% | — | 100% | 100% | 100% | 94% | 100% | $0.54 | 3.2s | 1 |
| moonshotai/kimi-k3 | **97%** | 100% | — | 100% | 92% | 91% | 94% | 100% | $2.59 | 2.5s |  |
| anthropic/claude-sonnet-5.5 | **97%** | 100% | — | 100% | 100% | 100% | 75% | 100% | $4.38 | 2.1s |  |
| z-ai/glm-5.3-flash | **96%** | 100% | — | 100% | 100% | 78% | 91% | 100% | $0.11 | 1.6s |  |
| anthropic/claude-haiku-5.5 | **96%** | 100% | — | 100% | 100% | 88% | 78% | 100% | $0.26 | 1.8s |  |
| google/gemini-3.5-flash-lite | **95%** | 100% | — | 100% | 79% | 91% | 88% | 100% | $0.54 | 0.9s |  |
| qwen/qwen3.7-plus | **95%** | 98% | — | 97% | 100% | 81% | 88% | 100% | $2.17 | 27.8s |  |
| xiaomi/mimo-v2.6-flash | **95%** | 98% | — | 97% | 100% | 75% | 91% | 100% | $0.08 | 2.2s |  |
| qwen/qwen3.8-flash | **91%** | 94% | — | 97% | 100% | 83% | 83% | 100% | $0.62 | 20.2s | 2 |
| minimax/minimax-m3 | **89%** | 94% | — | 91% | 100% | 63% | 75% | 100% | $0.28 | 2.5s |  |
| deepseek/deepseek-v4-flash | **88%** | 92% | — | 100% | 95% | 77% | 90% | 100% | $0.11 | 10.5s | 4 |
| deepseek/deepseek-v4-pro | **87%** | 92% | — | 100% | 95% | 69% | 90% | 100% | $1.56 | 15.1s | 4 |
| mistralai/mistral-small-2603 | **0%** | 0% | — | — | — | — | — | — | — | — | 52 |
| typesafe/jev (gate, p ≥ 0.5) | **—** | 100% | 100% | — | — | — | — | — | $0.02 | 0.3s | 2 |
<!-- /triage -->

<!-- transcribe -->
## Transcribe — 2026-10-16

14 synthetic dispatch/ATC/marine clips (TTS → 300–3000 Hz bandpass, 8 kHz, pink noise), 145 s of audio. Key terms = street names, places and numbers.

| Model | WER (lower = better) | Key-term recall | $ / audio hour | p50 | Errors |
|---|---|---|---|---|---|
| google/gemini-3.8-flash | **2%** | 97% | $0.52 | 4.1s |  |
| google/gemini-3.5-flash | **3%** | 96% | $2.10 | 3.9s |  |
| xiaomi/mimo-v2.6-pro | **3%** | 96% | $0.10 | 6.7s |  |
| qwen/qwen3.8-omni-flash | **4%** | 95% | $0.08 | 4.0s |  |
| openai/gpt-audio-mini | **4%** | 95% | $0.10 | 1.0s |  |
| xiaomi/mimo-v2.6-flash | **4%** | 95% | $0.02 | 1.0s |  |
| mistralai/voxtral-small-24b-2507 | **5%** | 95% | $0.35 | 0.9s |  |
| google/gemini-3.1-flash-lite | **5%** | 95% | $0.08 | 1.4s |  |
| google/gemini-3.5-flash-lite | **7%** | 93% | $0.08 | 1.9s |  |
| nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free | **99%** | 1% | $0.0000 | 7.9s | 2 |
<!-- /transcribe -->

<!-- digest -->
## Digest — 2026-10-16

169-call synthetic day with 7 planted storylines. Recall = storylines found; precision = highlights that are a planted storyline; completeness = share of each found storyline's transmissions cited.

| Model | Gold recall | Precision | Storyline completeness | Highlights | $ / day | Time | Errors |
|---|---|---|---|---|---|---|---|
| xiaomi/mimo-v2.6-flash | **100%** | 100% | 100% | 7.0 | $0.0008 | 12s |  |
| openai/gpt-6-luna | **100%** | 100% | 100% | 7.0 | $0.0009 | 15s |  |
| z-ai/glm-5.3-flash | **100%** | 100% | 100% | 7.0 | $0.0010 | 5s |  |
| openai/gpt-6-luna-pro | **100%** | 100% | 100% | 7.0 | $0.0020 | 18s |  |
| google/gemini-3.5-flash-lite | **100%** | 100% | 100% | 7.0 | $0.0043 | 4s |  |
| qwen/qwen3.8-flash | **100%** | 100% | 100% | 7.0 | $0.0044 | 118s |  |
| deepseek/deepseek-v4-pro | **100%** | 100% | 100% | 7.0 | $0.0047 | 71s |  |
| google/gemini-3.8-flash | **100%** | 100% | 100% | 7.0 | $0.0073 | 9s |  |
| qwen/qwen3.7-plus | **100%** | 100% | 100% | 7.0 | $0.0080 | 99s |  |
| openai/gpt-6-sol | **100%** | 100% | 100% | 7.0 | $0.01 | 10s |  |
| moonshotai/kimi-k3 | **100%** | 100% | 100% | 7.0 | $0.02 | 9s |  |
| anthropic/claude-sonnet-5.5 | **100%** | 100% | 100% | 7.0 | $0.03 | 11s |  |
| anthropic/claude-opus-5.5 | **100%** | 100% | 100% | 7.0 | $0.06 | 23s |  |
| anthropic/claude-haiku-5.5 | **100%** | 94% | 100% | 7.5 | $0.0017 | 13s |  |
| deepseek/deepseek-v4.1-flash | **93%** | 100% | 100% | 7.0 | $0.0040 | 17s |  |
| deepseek/deepseek-v4-flash | **57%** | 100% | 100% | 4.0 | $0.0003 | 64s |  |
| minimax/minimax-m3 | **57%** | 100% | 100% | 4.0 | $0.0037 | 20s |  |
| mistralai/mistral-small-2603 | **0%** | 0% | — | — | — | — | 2 |
<!-- /digest -->

## Notes

- **Defaults chosen:** transcription `xiaomi/mimo-v2.6-flash`, triage `openai/gpt-6-luna`, digest `openai/gpt-6-luna-pro`. Full bench spend: ~$1.90.
- **Digest suite is saturated** — 13/18 models found every planted storyline, so it only separates weak models. Make the day harder (subtler storylines, near-miss distractors) before using it to rank strong ones.
- **Transcription audio is synthetic** (TTS through a radio filter). Real P25 vocoder audio is harder; re-run on recorded clips once live feeds are flowing.
- `mistralai/mistral-small-2603` fails most requests under strict JSON-schema routing (`provider.require_parameters`); `nvidia/nemotron…:free` returns no transcript for audio.
