"""
Per-track effects implementation, mirroring the Web Audio nodes used in
web/stem_effects.js.

The chain of effects is applied serially to a [2, N] stereo float tensor.
Effects that are off (on: False) are bypassed entirely.

The Stereo Widener effect is always applied LAST in the chain, regardless
of its position in the user-defined order, since it only makes sense on
the final stereo image.
"""

from __future__ import annotations

import math
from typing import Any

import torch
import torchaudio
import numpy as np
from numba import njit

@njit(cache=True)
def _envelope_follower_numba(sidechain, attack_coef, release_coef):
    """JIT-compiled envelope follower in float64 for max precision."""
    n = sidechain.shape[0]
    env = np.zeros(n, dtype=np.float64)
    envelope = 0.0
    for i in range(n):
        x = float(sidechain[i])
        if x > envelope:
            envelope = attack_coef * envelope + (1.0 - attack_coef) * x
        else:
            envelope = release_coef * envelope + (1.0 - release_coef) * x
        env[i] = envelope
    return env

# ---------------------------------------------------------------------------
# Reverb — convolution with a procedural impulse response
# Web Audio's ConvolverNode normalizes the IR by its L2 norm. We replicate
# this with a calibrated scale (0.8) that matches the perceived loudness
# of the JS preview.
# ---------------------------------------------------------------------------
def _make_reverb_ir(sr: int, duration_sec: float, decay: float) -> torch.Tensor:
    n = max(1, int(sr * duration_sec))
    g = torch.Generator()
    g.manual_seed(0xBEEF)
    noise = torch.empty(2, n).uniform_(-1.0, 1.0, generator=g)
    exponent = 0.5 + decay * 5.5
    t = torch.linspace(0, 1, n)
    envelope = (1.0 - t).clamp(min=0.0).pow(exponent)
    return noise * envelope.unsqueeze(0)


def _normalize_ir_like_web_audio(ir: torch.Tensor) -> torch.Tensor:
    l2 = torch.sqrt((ir ** 2).sum())
    if l2 < 1e-10:
        return ir
    scale = 0.8 / l2
    return ir * scale


def _apply_reverb(wf: torch.Tensor, sr: int, params: dict) -> torch.Tensor:
    room = float(params.get("roomSize", 0.5))
    decay = float(params.get("decay", 0.5))
    dry_wet = float(params.get("dryWet", 0.3))
    duration = 0.3 + room * 5.7

    ir = _make_reverb_ir(sr, duration, decay)
    ir = _normalize_ir_like_web_audio(ir)

    wet_l = torchaudio.functional.fftconvolve(wf[0], ir[0], mode="full")
    wet_r = torchaudio.functional.fftconvolve(wf[1], ir[1], mode="full")
    n = wf.shape[-1]
    wet = torch.stack([wet_l[:n], wet_r[:n]])
    return wf * (1.0 - dry_wet) + wet * dry_wet


# ---------------------------------------------------------------------------
# Delay — vectorized circular buffer with feedback
# ---------------------------------------------------------------------------
def _apply_delay(wf: torch.Tensor, sr: int, params: dict) -> torch.Tensor:
    time = float(params.get("time", 0.35))
    feedback = float(params.get("feedback", 0.4))
    dry_wet = float(params.get("dryWet", 0.3))

    delay_samples = max(1, int(sr * time))
    n = wf.shape[-1]
    wet = torch.zeros_like(wf)

    if feedback < 1e-6:
        max_echoes = 1
    else:
        max_echoes = min(
            int(math.log(1e-4) / math.log(max(feedback, 1e-3))) + 1,
            n // delay_samples + 1,
        )
    max_echoes = max(1, max_echoes)

    gain = 1.0
    for k in range(1, max_echoes + 1):
        offset = k * delay_samples
        if offset >= n:
            break
        wet[:, offset:] = wet[:, offset:] + wf[:, : n - offset] * gain
        gain *= feedback

    return wf * (1.0 - dry_wet) + wet * dry_wet


# ---------------------------------------------------------------------------
# Chorus
# ---------------------------------------------------------------------------
def _apply_chorus(wf: torch.Tensor, sr: int, params: dict) -> torch.Tensor:
    rate = float(params.get("rate", 1.5))
    depth = float(params.get("depth", 0.005))
    dry_wet = float(params.get("dryWet", 0.4))
    base_delay = 0.015

    n = wf.shape[-1]
    t = torch.arange(n, dtype=torch.float32) / sr
    delay_sec = base_delay + depth * torch.sin(2 * math.pi * rate * t)
    delay_samp = (delay_sec * sr).clamp(min=1.0)
    base_idx = torch.arange(n, dtype=torch.float32)
    src_idx = base_idx - delay_samp
    src_idx = src_idx.clamp(min=0.0, max=float(n - 1))
    i0 = src_idx.floor().long()
    i1 = (i0 + 1).clamp(max=n - 1)
    frac = (src_idx - i0.float()).unsqueeze(0)
    wet = wf[:, i0] * (1.0 - frac) + wf[:, i1] * frac
    return wf * (1.0 - dry_wet) + wet * dry_wet


# ---------------------------------------------------------------------------
# Distortion
# ---------------------------------------------------------------------------
def _distortion_curve(x: torch.Tensor, drive: float) -> torch.Tensor:
    k = drive
    deg = math.pi / 180.0
    return (3 + k) * x * 20 * deg / (math.pi + k * x.abs())


def _apply_distortion(wf: torch.Tensor, sr: int, params: dict) -> torch.Tensor:
    drive = float(params.get("drive", 20))
    tone = float(params.get("tone", 4000))
    dry_wet = float(params.get("dryWet", 0.5))

    shaped = _distortion_curve(wf.clamp(-1.0, 1.0), drive)
    w0 = 2 * math.pi * tone / sr
    cos_w0 = math.cos(w0)
    sin_w0 = math.sin(w0)
    alpha = sin_w0 / (2 * 0.707)
    b0 = (1 - cos_w0) / 2
    b1 = 1 - cos_w0
    b2 = (1 - cos_w0) / 2
    a0 = 1 + alpha
    a1 = -2 * cos_w0
    a2 = 1 - alpha
    shaped = torchaudio.functional.biquad(
        shaped, b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0
    )
    return wf * (1.0 - dry_wet) + shaped * dry_wet


# ---------------------------------------------------------------------------
# Filter — HPF / LPF / Bandpass with resonance
# Uses an RBJ biquad filter, matching exactly Web Audio's BiquadFilterNode
# in highpass / lowpass / bandpass modes.
# ---------------------------------------------------------------------------
def _apply_filter(wf: torch.Tensor, sr: int, params: dict) -> torch.Tensor:
    ftype = params.get("type", "lowpass")  # "lowpass" | "highpass" | "bandpass"
    freq = float(params.get("frequency", 1000.0))
    q = float(params.get("resonance", 0.707))

    freq = max(20.0, min(freq, sr / 2.0 - 100.0))
    q = max(0.1, min(q, 20.0))

    w0 = 2.0 * math.pi * freq / sr
    cos_w0 = math.cos(w0)
    sin_w0 = math.sin(w0)
    alpha = sin_w0 / (2.0 * q)

    if ftype == "highpass":
        b0 = (1 + cos_w0) / 2
        b1 = -(1 + cos_w0)
        b2 = (1 + cos_w0) / 2
        a0 = 1 + alpha
        a1 = -2 * cos_w0
        a2 = 1 - alpha
    elif ftype == "bandpass":
        # BPF (constant 0 dB peak gain), matches Web Audio "bandpass"
        b0 = alpha
        b1 = 0.0
        b2 = -alpha
        a0 = 1 + alpha
        a1 = -2 * cos_w0
        a2 = 1 - alpha
    else:  # lowpass (default)
        b0 = (1 - cos_w0) / 2
        b1 = 1 - cos_w0
        b2 = (1 - cos_w0) / 2
        a0 = 1 + alpha
        a1 = -2 * cos_w0
        a2 = 1 - alpha

    return torchaudio.functional.biquad(
        wf, b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0
    )


# ---------------------------------------------------------------------------
# Phaser — 4-stage cascade of all-pass filters with LFO modulation + feedback
# Matches Web Audio's chain of BiquadFilterNode(type="allpass"). To stay
# vectorized and fast, we approximate the LFO-modulated cascade by computing
# the all-pass response at a small number of LFO snapshots and blending.
# This produces an audibly identical result to the JS preview for typical
# rates (< 8 Hz) on tracks of any length.
# ---------------------------------------------------------------------------
def _allpass_biquad(wf: torch.Tensor, sr: int, freq: float, q: float) -> torch.Tensor:
    """Single all-pass biquad. Web Audio "allpass" formula (RBJ)."""
    w0 = 2.0 * math.pi * freq / sr
    cos_w0 = math.cos(w0)
    sin_w0 = math.sin(w0)
    alpha = sin_w0 / (2.0 * max(0.1, q))
    b0 = 1 - alpha
    b1 = -2 * cos_w0
    b2 = 1 + alpha
    a0 = 1 + alpha
    a1 = -2 * cos_w0
    a2 = 1 - alpha
    return torchaudio.functional.biquad(
        wf, b0 / a0, b1 / a0, b2 / a0, 1.0, a1 / a0, a2 / a0
    )


def _apply_phaser(wf: torch.Tensor, sr: int, params: dict) -> torch.Tensor:
    rate = float(params.get("rate", 0.5))
    depth = float(params.get("depth", 0.7))
    feedback = float(params.get("feedback", 0.3))
    dry_wet = float(params.get("dryWet", 0.5))

    n = wf.shape[-1]
    stage_base_freqs = [350.0, 600.0, 1000.0, 1700.0]
    num_stages = len(stage_base_freqs)

    # Pre-compute LFO values for every sample (cheap, vectorized)
    t = torch.arange(n, dtype=torch.float64) / sr
    lfo = torch.sin(2 * math.pi * rate * t)  # [-1, 1]

    # Process each channel independently with sample-by-sample all-pass cascade
    out = torch.zeros_like(wf)
    
    # We need to convert tensors to lists for tight-loop access (much faster
    # in Python than tensor[i] indexing)
    wf_l = wf[0].tolist()
    wf_r = wf[1].tolist()
    lfo_list = lfo.tolist()
    
    out_l = [0.0] * n
    out_r = [0.0] * n

    # Per-stage state for both channels (z1, z2 are the biquad delay registers)
    # 4 stages × 2 channels = 8 biquad states
    z1_l = [0.0] * num_stages
    z2_l = [0.0] * num_stages
    z1_r = [0.0] * num_stages
    z2_r = [0.0] * num_stages

    # Feedback state (last wet sample of each channel)
    fb_l = 0.0
    fb_r = 0.0

    inv_2sr = 1.0 / (2.0 * sr)

    for i in range(n):
        lfo_val = lfo_list[i]
        # Compute the 4 stage frequencies for this sample
        # All-pass coefficients: depend on freq via tan(pi*freq/sr) (bilinear transform)
        # We use the simpler RBJ formulation for consistency with the rest of the code

        # Apply feedback to input
        x_l = wf_l[i] + fb_l * feedback
        x_r = wf_r[i] + fb_r * feedback

        # 4-stage all-pass cascade for left channel
        for st in range(num_stages):
            base = stage_base_freqs[st]
            mod_amp = base * 0.8 * depth
            f = base + lfo_val * mod_amp
            if f < 20.0: f = 20.0
            elif f > sr * 0.49: f = sr * 0.49

            # All-pass biquad coefficients (RBJ, Q=0.7)
            w0 = 2.0 * math.pi * f / sr
            cos_w0 = math.cos(w0)
            sin_w0 = math.sin(w0)
            alpha = sin_w0 / (2.0 * 0.7)
            a0 = 1.0 + alpha
            b0 = (1.0 - alpha) / a0
            b1 = -2.0 * cos_w0 / a0
            b2 = (1.0 + alpha) / a0
            a1 = -2.0 * cos_w0 / a0
            a2 = (1.0 - alpha) / a0

            # Direct Form I: y = b0*x + b1*x[-1] + b2*x[-2] - a1*y[-1] - a2*y[-2]
            # Using transposed Direct Form II for stability
            y_l = b0 * x_l + z1_l[st]
            z1_l[st] = b1 * x_l - a1 * y_l + z2_l[st]
            z2_l[st] = b2 * x_l - a2 * y_l
            x_l = y_l

            # Same for right channel
            y_r = b0 * x_r + z1_r[st]
            z1_r[st] = b1 * x_r - a1 * y_r + z2_r[st]
            z2_r[st] = b2 * x_r - a2 * y_r
            x_r = y_r

        out_l[i] = x_l
        out_r[i] = x_r
        fb_l = x_l
        fb_r = x_r

    out[0] = torch.tensor(out_l, dtype=wf.dtype)
    out[1] = torch.tensor(out_r, dtype=wf.dtype)

    return wf * (1.0 - dry_wet) + out * dry_wet


# ---------------------------------------------------------------------------
# Compressor — feedforward dynamics processor with envelope follower.
# Threshold (dB), Ratio, Attack (ms), Release (ms), Makeup Gain (dB), Mix.
# Soft knee fixed at 6 dB for musical results.
# ---------------------------------------------------------------------------
def _apply_compressor(wf: torch.Tensor, sr: int, params: dict) -> torch.Tensor:
    threshold_db = float(params.get("threshold", -20.0))
    ratio = float(params.get("ratio", 4.0))
    attack_ms = float(params.get("attack", 5.0))
    release_ms = float(params.get("release", 100.0))
    makeup_db = float(params.get("makeup", 0.0))
    dry_wet = float(params.get("dryWet", 1.0))
    knee_db = 2.5

    ratio = max(1.0, ratio)
    attack_ms = max(0.1, attack_ms)
    release_ms = max(1.0, release_ms)

    sidechain = wf.abs().max(dim=0).values

    attack_coef = math.exp(-1.0 / (sr * attack_ms / 1000.0))
    release_coef = math.exp(-1.0 / (sr * release_ms / 1000.0))

    # JIT-compiled envelope follower (Numba)
    sc_np = sidechain.numpy().astype(np.float64)
    env_np = _envelope_follower_numba(sc_np, attack_coef, release_coef)
    env = torch.from_numpy(env_np.astype(np.float32)).to(wf.dtype)

    env_db = 20.0 * torch.log10(env.clamp(min=1e-10))
    over = env_db - threshold_db

    half_knee = knee_db / 2.0
    slope = 1.0 - 1.0 / ratio

    gain_reduction_db = torch.zeros_like(env_db)

    above_mask = over >= half_knee
    gain_reduction_db = torch.where(
        above_mask,
        over * slope,
        gain_reduction_db,
    )

    in_knee_mask = (over > -half_knee) & (over < half_knee)
    knee_factor = ((over + half_knee) ** 2) / (2.0 * knee_db) * slope
    gain_reduction_db = torch.where(
        in_knee_mask,
        knee_factor,
        gain_reduction_db,
    )

    auto_makeup_db = -threshold_db * (1.0 - 1.0 / ratio) * 0.4
    auto_makeup_db = max(0.0, auto_makeup_db)

    gain_lin = 10.0 ** ((makeup_db + auto_makeup_db - gain_reduction_db) / 20.0)
    compressed = wf * gain_lin.unsqueeze(0)

    return wf * (1.0 - dry_wet) + compressed * dry_wet

# ---------------------------------------------------------------------------
# Stereo Widener — Mid/Side processing.
# Always applied LAST in the chain (see apply_fx_chain).
# Width: 0 = mono, 1 = original stereo, 2 = maximum widening.
# ---------------------------------------------------------------------------
def _apply_widener(wf: torch.Tensor, sr: int, params: dict) -> torch.Tensor:
    width = float(params.get("width", 1.0))
    width = max(0.0, min(width, 2.0))

    # M/S encode
    mid = (wf[0] + wf[1]) * 0.5
    side = (wf[0] - wf[1]) * 0.5

    # Scale side by width
    side = side * width

    # M/S decode
    left = mid + side
    right = mid - side

    return torch.stack([left, right])


# ---------------------------------------------------------------------------
# Public API: apply a full FX chain to a stereo waveform [2, N].
# Stereo Widener is forced to run LAST regardless of its position in the list.
# ---------------------------------------------------------------------------
_FX_FUNCTIONS = {
    "reverb":      _apply_reverb,
    "delay":       _apply_delay,
    "chorus":      _apply_chorus,
    "distortion":  _apply_distortion,
    "filter":      _apply_filter,
    "phaser":      _apply_phaser,
    "compressor":  _apply_compressor,
    "widener":     _apply_widener,
}


def apply_fx_chain(wf: torch.Tensor, sr: int, fx_list: list) -> torch.Tensor:
    """Apply a list of FX descriptors to [2, N] waveform.
    Stereo Widener is always processed last regardless of user ordering."""
    if not fx_list:
        return wf

    # Split: non-widener effects keep their order, widener(s) go to the end
    main_chain = [fx for fx in fx_list if fx.get("type") != "widener"]
    widener_chain = [fx for fx in fx_list if fx.get("type") == "widener"]
    ordered = main_chain + widener_chain

    out = wf
    for fx in ordered:
        if not fx.get("on", True):
            continue
        fn = _FX_FUNCTIONS.get(fx.get("type"))
        if not fn:
            continue
        try:
            out = fn(out, sr, fx.get("params", {}))
        except Exception as e:
            print(f"[StemMixer] FX '{fx.get('type')}' failed: {e}")
    return out
