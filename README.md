# ComfyUI-Stem-Mixer 🎚️

A professional multitrack stem mixer node for ComfyUI. Load audio stems directly into the node, mix them in real time with a full set of DAW-style controls, and produce a single mixed `AUDIO` output when the workflow runs.

---
<img width="1780" height="967" alt="Capture d&#39;écran 2026-05-09 133035" src="https://github.com/user-attachments/assets/9850cfdd-c3a5-4836-bda6-bc2ed851c652" />


## Features

### Loading & file management
- **No audio inputs** — the node has no AUDIO input ports. Files are loaded directly inside the node.
- **📂 Load button** per track — opens a file picker (WAV, FLAC, MP3, OGG, M4A, AIFF/AIF).
- **Drag & drop** — drag one or more audio files from your file explorer onto the node to add them instantly.
- **Replace a file** — click Load on an existing track to swap it with a new file. The track name updates automatically.
- Files are stored in `ComfyUI/input/stem_mixer/` and referenced by the workflow JSON.

### Transport
- **▶ Play / ⏸ Pause** — starts or pauses all stems simultaneously.
- **■ Stop** — stops playback and returns to the current playhead position.
- **⏮ Rewind** — returns the playhead to 0:00 without stopping playback.
- **⟲ Loop** — toggles looping on/off. When active, loops over the full track (if no selection) or over the selected region.
- **Time display** — shows current position and total duration: `0:34 / 3:27`.
- **Sample-accurate sync** — all stems are scheduled on the same `AudioContext` clock via `AudioBufferSourceNode`. No drift, regardless of stem count or session length.

### Selection & loop region
- **Drag on any waveform** — creates a selection (blue overlay shown on all tracks simultaneously).
- **Drag a selection edge** (within 6 px of the border) — resizes the selection; cursor changes to `ew-resize`.
- **Drag inside the selection** — moves the whole selection; cursor changes to `move`.
- **Click** — seeks to the clicked position; the selection is preserved.
- **Double-click** — clears the selection.
- **Loop + selection** — when Loop is active and a selection exists, playback loops natively within `[start, end]` at sample accuracy via `AudioBufferSourceNode.loop`.
- Selection and loop state are saved in the workflow JSON and restored on reopen.

### Per-track controls
- **Track name** — editable text field, auto-filled from the file name on first load.
- **Gain slider** — 0 % to 200 %, controls the track level.
- **Pan slider** — from L100 to R100, center = C. Equal-power pan law (same as professional DAWs). **Double-click to reset to center.**
- **M (Mute)** — silences the track.
- **S (Solo)** — exclusive solo: only one track can be soloed at a time.
- **EQ button** — opens the per-track EQ popup (see below).
- **✕ Remove** — removes the track and frees all resources.
- **8 FX (reverb, stereo widener and more)** — add multi effects per track.

### Per-track EQ (popup)
- **Floating, draggable popup** — one per track, positioned freely on screen. Multiple popups can be open simultaneously. Position is saved per track in the workflow JSON.
- **3 bands:**
  - **LOW** — Low-shelf at 100 Hz, ±18 dB
  - **MID** — Peaking at 1 kHz (Q = 0.7), ±18 dB
  - **HIGH** — High-shelf at 8 kHz, ±18 dB
- **Vertical sliders** — one per band, with live dB readout above.
- **Double-click a slider** — resets that band to 0 dB.
- **ON / OFF button** per band — individual band bypass.
- **Reset button** (in the titlebar) — resets all three bands to 0 dB and turns them all ON in one click.
- **Frequency response graph** — real-time curve drawn from 20 Hz to 20 kHz with dB grid. Orange when EQ is active, blue when flat.
- **EQ indicator on track button** — the EQ button glows orange when the popup is closed but the EQ is doing something (any band ≠ 0 dB and ON).
- EQ is applied identically in Python for the final render (RBJ biquad coefficients via `torchaudio.functional.biquad`).

### Per-track stereo VU meters
- Post-fader, post-EQ level meters shown to the right of each waveform.
- Two narrow bars: L (left) and R (right).
- RMS measurement for natural, musical movement.
- **Peak hold** — white line that decays slowly (~12 dB/sec) to show transient peaks.
- **Color scale:** dark green (−60 dB) → bright green → yellow → orange → red (0 dB).
- Meters reset to zero when playback stops.

### Master section (in the header)
- **Master fader** — 0 % to 150 %, controls the overall output level of the mix. **Double-click to reset to 100 %.**
- **Master stereo VU** — post-master level meter using the same dB/color scale as the track meters.
- Master volume is applied to both the live preview and the rendered mix in Python.

### Waveform display
- Waveform drawn from decoded audio peaks — instant rendering, no separate analysis pass.
- Progress bar (darker blue) advances with playback.
- Cursor line (white) shows the current playhead.
- **Adaptive height** — waveforms scale between 32 and 64 px depending on the node height. Resize the node manually to give more or less space to each track.
- **Resize-responsive** — waveforms redraw cleanly when the node is resized in any direction.

### Persistent state
All settings are saved in the workflow JSON and restored when the workflow is reopened:
- Track list: names, file paths, order
- Gain, pan, mute, solo per track
- EQ gains, ON/OFF per band, popup position per track
- Master volume
- Loop on/off
- Selection region (start/end in seconds)

The JSON format is backward-compatible with earlier versions of the node.

---

## Final mix (Python)

When the workflow is executed, the `AudioStemMixer` node:

1. Parses the JSON state.
2. Loads each non-muted stem from disk with `torchaudio` (resamples to a common sample rate if needed, forces stereo).
3. Applies per-track **EQ** (RBJ biquad: low-shelf 100 Hz, peaking 1 kHz Q=0.7, high-shelf 8 kHz) using `torchaudio.functional.biquad`.
4. Applies per-track **gain** and **equal-power pan** (same law as the Web Audio `StereoPannerNode`).
5. Respects **mute** and **solo** (only soloed tracks contribute if any track is soloed).
6. Sums all stems, pads shorter ones with silence.
7. Applies **master volume**.
8. Applies **soft-clip protection** (scales down if the peak exceeds 0 dBFS, without hard clipping).
9. Returns a standard ComfyUI `AUDIO` dict ready for `PreviewAudio`, `SaveAudio`, or any downstream audio node.

---

## Installation

Clone or copy this repository into `ComfyUI/custom_nodes/`:

```
ComfyUI/custom_nodes/ComfyUI-StemMixer/
```

Restart ComfyUI. The node appears under `audio/mixer` as **Audio Stem Mixer 🎚️**.

### Requirements

- ComfyUI (any recent version)
- `torch` and `torchaudio` (already installed by ComfyUI)

No additional Python packages required.

---

## License

MIT
