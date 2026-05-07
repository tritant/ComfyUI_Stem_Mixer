"""
AudioStemMixer node.

The node has no audio inputs. All state lives in a hidden multiline STRING
widget that is read/written by the JS frontend. The JSON state is a list of
track descriptors:

    [
        {"id": "uuid", "filename": "stem_mixer/foo.wav", "name": "vocals",
         "gain": 1.0, "pan": 0.0, "mute": false, "solo": false},
        ...
    ]

`filename` is relative to ComfyUI's `input/` directory.
`pan` is in [-1.0, 1.0] (-1 = full left, 0 = center, +1 = full right).
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from typing import Any

import torch
import torchaudio

import folder_paths


DEFAULT_STATE = "[]"


# ---------------------------------------------------------------------------
# Biquad filter coefficients (RBJ Audio EQ Cookbook)
# ---------------------------------------------------------------------------
def _biquad_lowshelf(fs: float, f0: float, gain_db: float):
    """Low-shelf filter coefficients matching Web Audio's BiquadFilterNode."""
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * f0 / fs
    cos_w0, sin_w0 = math.cos(w0), math.sin(w0)
    S = 1.0
    alpha = sin_w0 / 2 * math.sqrt((A + 1/A) * (1/S - 1) + 2)
    sqrtA = math.sqrt(A)

    b0 =    A*((A+1) - (A-1)*cos_w0 + 2*sqrtA*alpha)
    b1 =  2*A*((A-1) - (A+1)*cos_w0)
    b2 =    A*((A+1) - (A-1)*cos_w0 - 2*sqrtA*alpha)
    a0 =       (A+1) + (A-1)*cos_w0 + 2*sqrtA*alpha
    a1 =   -2*((A-1) + (A+1)*cos_w0)
    a2 =       (A+1) + (A-1)*cos_w0 - 2*sqrtA*alpha
    return [b0/a0, b1/a0, b2/a0], [1.0, a1/a0, a2/a0]


def _biquad_highshelf(fs: float, f0: float, gain_db: float):
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * f0 / fs
    cos_w0, sin_w0 = math.cos(w0), math.sin(w0)
    S = 1.0
    alpha = sin_w0 / 2 * math.sqrt((A + 1/A) * (1/S - 1) + 2)
    sqrtA = math.sqrt(A)

    b0 =    A*((A+1) + (A-1)*cos_w0 + 2*sqrtA*alpha)
    b1 = -2*A*((A-1) + (A+1)*cos_w0)
    b2 =    A*((A+1) + (A-1)*cos_w0 - 2*sqrtA*alpha)
    a0 =       (A+1) - (A-1)*cos_w0 + 2*sqrtA*alpha
    a1 =    2*((A-1) - (A+1)*cos_w0)
    a2 =       (A+1) - (A-1)*cos_w0 - 2*sqrtA*alpha
    return [b0/a0, b1/a0, b2/a0], [1.0, a1/a0, a2/a0]


def _biquad_peaking(fs: float, f0: float, gain_db: float, q: float = 0.7):
    A = 10 ** (gain_db / 40.0)
    w0 = 2 * math.pi * f0 / fs
    cos_w0, sin_w0 = math.cos(w0), math.sin(w0)
    alpha = sin_w0 / (2 * q)

    b0 = 1 + alpha*A
    b1 = -2*cos_w0
    b2 = 1 - alpha*A
    a0 = 1 + alpha/A
    a1 = -2*cos_w0
    a2 = 1 - alpha/A
    return [b0/a0, b1/a0, b2/a0], [1.0, a1/a0, a2/a0]


def _apply_biquad(waveform: torch.Tensor, b: list, a: list) -> torch.Tensor:
    """Apply a biquad filter (Direct Form I) to each channel."""
    return torchaudio.functional.biquad(
        waveform, b[0], b[1], b[2], a[0], a[1], a[2]
    )


def _apply_eq(waveform: torch.Tensor, sr: int, eq: dict) -> torch.Tensor:
    """Apply 3-band EQ (low shelf 100Hz, peak 1kHz Q=0.7, high shelf 8kHz)
    to a stereo waveform [2, N]. eq is the per-track JSON section."""
    if not eq:
        return waveform

    # Low shelf
    low = eq.get("low", {})
    if low.get("on", True) and abs(low.get("gain", 0)) > 0.01:
        b, a = _biquad_lowshelf(sr, 100.0, float(low["gain"]))
        waveform = _apply_biquad(waveform, b, a)
    # Peak (mid)
    mid = eq.get("mid", {})
    if mid.get("on", True) and abs(mid.get("gain", 0)) > 0.01:
        b, a = _biquad_peaking(sr, 1000.0, float(mid["gain"]), 0.7)
        waveform = _apply_biquad(waveform, b, a)
    # High shelf
    high = eq.get("high", {})
    if high.get("on", True) and abs(high.get("gain", 0)) > 0.01:
        b, a = _biquad_highshelf(sr, 8000.0, float(high["gain"]))
        waveform = _apply_biquad(waveform, b, a)
    return waveform


def _input_path(filename: str) -> str:
    """Resolve a filename (relative to ComfyUI's input/) to an absolute path."""
    return os.path.join(folder_paths.get_input_directory(), filename)


def _load_stem(filename: str, target_sr: int | None) -> tuple[torch.Tensor, int]:
    """
    Load a stem from disk, resample to target_sr if provided.
    Returns (waveform [channels, samples], sample_rate).
    """
    path = _input_path(filename)
    waveform, sr = torchaudio.load(path)  # [channels, samples], float32 in [-1, 1]

    # Force stereo. Mono -> duplicate, >2 channels -> downmix to first 2.
    if waveform.shape[0] == 1:
        waveform = waveform.repeat(2, 1)
    elif waveform.shape[0] > 2:
        waveform = waveform[:2, :]

    if target_sr is not None and sr != target_sr:
        waveform = torchaudio.functional.resample(waveform, sr, target_sr)
        sr = target_sr

    return waveform, sr


def _silent_audio(sample_rate: int = 44100) -> dict[str, Any]:
    """Return a 1-sample silent stereo AUDIO dict (ComfyUI AUDIO format)."""
    return {
        "waveform": torch.zeros(1, 2, 1, dtype=torch.float32),
        "sample_rate": sample_rate,
    }


class AudioStemMixer:
    """
    Multitrack stem mixer with interactive WaveSurfer UI.

    Inputs are managed entirely through the hidden `state` widget, written by
    the JS frontend. On execution, this node loads each stem from disk,
    applies gain/mute/solo, sums them, and outputs a single AUDIO.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                # Hidden widget. multiline=True is REQUIRED for JSON state
                # transfer to work reliably across save/load cycles.
                "state": ("STRING", {
                    "default": DEFAULT_STATE,
                    "multiline": True,
                }),
            }
        }

    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    FUNCTION = "mix"
    CATEGORY = "audio/mixer"

    @classmethod
    def IS_CHANGED(cls, state: str = DEFAULT_STATE, **kwargs) -> str:
        """
        Hash the state JSON + the mtime of every referenced file. This way:
          - Changing gain/mute/pan/master -> state string changes -> re-execute.
          - Replacing a file on disk -> mtime changes -> re-execute.
        """
        h = hashlib.sha256()
        h.update(state.encode("utf-8"))
        try:
            parsed = json.loads(state) if state else None
            if isinstance(parsed, dict):
                tracks = parsed.get("tracks", [])
            elif isinstance(parsed, list):
                tracks = parsed
            else:
                tracks = []
            for t in tracks:
                fn = t.get("filename")
                if not fn:
                    continue
                path = _input_path(fn)
                if os.path.exists(path):
                    h.update(str(os.path.getmtime(path)).encode("utf-8"))
        except (json.JSONDecodeError, TypeError):
            pass
        return h.hexdigest()

    def mix(self, state: str = DEFAULT_STATE) -> tuple[dict[str, Any]]:
        try:
            parsed = json.loads(state) if state else None
        except json.JSONDecodeError as e:
            print(f"[StemMixer] Invalid state JSON: {e}")
            return (_silent_audio(),)

        # Accept both legacy array format and new object format
        if isinstance(parsed, list):
            tracks = parsed
            master_volume = 1.0
        elif isinstance(parsed, dict):
            tracks = parsed.get("tracks", [])
            master_volume = float(parsed.get("masterVolume", 1.0))
        else:
            return (_silent_audio(),)

        if not isinstance(tracks, list) or len(tracks) == 0:
            return (_silent_audio(),)

        # If any track is soloed, only soloed (and non-muted) tracks contribute.
        any_solo = any(t.get("solo", False) for t in tracks)

        # Each entry is (waveform [2, N], gain, pan).
        loaded: list[tuple[torch.Tensor, float, float]] = []
        target_sr: int | None = None

        for t in tracks:
            filename = t.get("filename")
            if not filename:
                continue
            if t.get("mute", False):
                continue
            if any_solo and not t.get("solo", False):
                continue

            try:
                wf, sr = _load_stem(filename, target_sr)
                if target_sr is None:
                    target_sr = sr
            except Exception as e:
                print(f"[StemMixer] Failed to load '{filename}': {e}")
                continue

            # Apply per-track EQ (low-shelf 100Hz, peak 1kHz, high-shelf 8kHz)
            eq = t.get("eq")
            if eq:
                wf = _apply_eq(wf, sr, eq)

            gain = float(t.get("gain", 1.0))
            pan  = float(t.get("pan", 0.0))
            pan  = max(-1.0, min(1.0, pan))
            loaded.append((wf, gain, pan))

        if not loaded:
            return (_silent_audio(target_sr or 44100),)

        # Pad all stems to the longest, then sum with gain + equal-power pan.
        max_len = max(wf.shape[-1] for wf, _, _ in loaded)
        mix_buf = torch.zeros(2, max_len, dtype=torch.float32)
        for wf, gain, pan in loaded:
            if wf.shape[-1] < max_len:
                pad = max_len - wf.shape[-1]
                wf = torch.nn.functional.pad(wf, (0, pad))

            # Equal-power pan law: theta in [0, pi/2]
            #   pan = -1 -> theta = 0     (full L: cos=1, sin=0)
            #   pan =  0 -> theta = pi/4  (center: cos=sin=√2/2)
            #   pan = +1 -> theta = pi/2  (full R: cos=0, sin=1)
            theta = (pan + 1.0) * (math.pi / 4.0)
            l_gain = math.cos(theta) * gain
            r_gain = math.sin(theta) * gain
            # wf shape: [2, N]. Apply per-channel gain, then mix.
            mix_buf[0] = mix_buf[0] + wf[0] * l_gain * math.sqrt(2)
            mix_buf[1] = mix_buf[1] + wf[1] * r_gain * math.sqrt(2)

        # Master volume (applied after summing tracks, before clip protection)
        if master_volume != 1.0:
            mix_buf = mix_buf * master_volume

        # Soft-clip protection
        peak = mix_buf.abs().max().item()
        if peak > 1.0:
            mix_buf = mix_buf / peak

        return ({
            "waveform": mix_buf.unsqueeze(0),
            "sample_rate": target_sr or 44100,
        },)
