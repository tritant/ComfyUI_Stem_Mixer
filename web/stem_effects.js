// ComfyUI-StemMixer — FX module
// Per-track effects chain: Reverb / Delay / Chorus / Distortion / Filter / Phaser / Compressor / Stereo Widener
// All effects are implemented with native Web Audio nodes (no dependencies)
// and mirror exactly the Python implementation in effects.py.
//
// Stereo Widener is always processed LAST in the chain regardless of its
// position in the user-defined order (see _rewire).

// ===========================================================================
// Utility
// ===========================================================================
function fxId() {
    return "fx_" + Math.random().toString(36).slice(2, 10);
}

function escFx(s) {
    return String(s).replace(/[<>&"]/g, c => ({
        "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;",
    }[c]));
}

function makeReverbIR(ctx, durationSec, decay) {
    const sr = ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * durationSec));
    const buf = ctx.createBuffer(2, len, sr);
    const exponent = 0.5 + decay * 5.5;
    for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) {
            const t = i / len;
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, exponent);
        }
    }
    return buf;
}

function makeDistortionCurve(drive) {
    const n = 4096;
    const curve = new Float32Array(n);
    const k = drive;
    const deg = Math.PI / 180;
    for (let i = 0; i < n; i++) {
        const x = (i * 2) / n - 1;
        curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
    }
    return curve;
}

// ===========================================================================
// FX Registry
// Each entry: label, defaultParams, uiParams, build(ctx, params)
// Optional: customLayout (string) — when set, the popup uses a custom
//           HTML layout instead of the default vertical slider list.
//           Currently only "widener" uses this.
// ===========================================================================
export const FX_REGISTRY = {
    reverb: {
        label: "Reverb",
        defaultParams: { roomSize: 0.5, decay: 0.5, dryWet: 0.3 },
        uiParams: [
            { key: "roomSize", label: "Room",  min: 0, max: 1, step: 0.01, format: v => v.toFixed(2) },
            { key: "decay",    label: "Decay", min: 0, max: 1, step: 0.01, format: v => v.toFixed(2) },
            { key: "dryWet",   label: "Mix",   min: 0, max: 1, step: 0.01, format: v => `${Math.round(v * 100)}%` },
        ],
        build(ctx, params) {
            const input  = ctx.createGain();
            const output = ctx.createGain();
            const dry    = ctx.createGain();
            const wet    = ctx.createGain();
            const conv   = ctx.createConvolver();
            input.connect(dry); input.connect(conv); conv.connect(wet);
            dry.connect(output); wet.connect(output);
            const apply = (p) => {
                const dur = 0.3 + p.roomSize * 5.7;
                conv.buffer = makeReverbIR(ctx, dur, p.decay);
                dry.gain.value = 1 - p.dryWet;
                wet.gain.value = p.dryWet;
            };
            apply(params);
            return { input, output, update: apply };
        },
    },

    delay: {
        label: "Delay",
        defaultParams: { time: 0.35, feedback: 0.4, dryWet: 0.3 },
        uiParams: [
            { key: "time",     label: "Time",     min: 0.01, max: 2,    step: 0.01, format: v => `${(v * 1000).toFixed(0)}ms` },
            { key: "feedback", label: "Feedback", min: 0,    max: 0.95, step: 0.01, format: v => `${Math.round(v * 100)}%` },
            { key: "dryWet",   label: "Mix",      min: 0,    max: 1,    step: 0.01, format: v => `${Math.round(v * 100)}%` },
        ],
        build(ctx, params) {
            const input = ctx.createGain(), output = ctx.createGain();
            const dry = ctx.createGain(), wet = ctx.createGain();
            const dl = ctx.createDelay(2.0), fb = ctx.createGain();
            input.connect(dry); input.connect(dl);
            dl.connect(fb); fb.connect(dl); dl.connect(wet);
            dry.connect(output); wet.connect(output);
            const apply = (p) => {
                dl.delayTime.value = p.time;
                fb.gain.value      = p.feedback;
                dry.gain.value     = 1 - p.dryWet;
                wet.gain.value     = p.dryWet;
            };
            apply(params);
            return { input, output, update: apply };
        },
    },

    chorus: {
        label: "Chorus",
        defaultParams: { rate: 1.5, depth: 0.005, dryWet: 0.4 },
        uiParams: [
            { key: "rate",   label: "Rate",  min: 0.1,   max: 8,     step: 0.05, format: v => `${v.toFixed(2)} Hz` },
            { key: "depth",  label: "Depth", min: 0.001, max: 0.02,  step: 0.0005, format: v => `${(v * 1000).toFixed(2)}ms` },
            { key: "dryWet", label: "Mix",   min: 0,     max: 1,     step: 0.01, format: v => `${Math.round(v * 100)}%` },
        ],
        build(ctx, params) {
            const input = ctx.createGain(), output = ctx.createGain();
            const dry = ctx.createGain(), wet = ctx.createGain();
            const dl = ctx.createDelay(0.05);
            const lfo = ctx.createOscillator(), lfoG = ctx.createGain();
            const baseDelay = 0.015;
            lfo.type = "sine";
            lfo.connect(lfoG); lfoG.connect(dl.delayTime);
            dl.delayTime.value = baseDelay;
            lfo.start();
            input.connect(dry); input.connect(dl); dl.connect(wet);
            dry.connect(output); wet.connect(output);
            const apply = (p) => {
                lfo.frequency.value = p.rate;
                lfoG.gain.value     = p.depth;
                dry.gain.value      = 1 - p.dryWet;
                wet.gain.value      = p.dryWet;
            };
            apply(params);
            const dispose = () => { try { lfo.stop(); } catch (_) {} };
            return { input, output, update: apply, dispose };
        },
    },

    distortion: {
        label: "Distortion",
        defaultParams: { drive: 20, tone: 4000, dryWet: 0.5 },
        uiParams: [
            { key: "drive",  label: "Drive", min: 1,   max: 100,  step: 0.5,  format: v => v.toFixed(0) },
            { key: "tone",   label: "Tone",  min: 200, max: 8000, step: 50,   format: v => `${v.toFixed(0)} Hz` },
            { key: "dryWet", label: "Mix",   min: 0,   max: 1,    step: 0.01, format: v => `${Math.round(v * 100)}%` },
        ],
        build(ctx, params) {
            const input = ctx.createGain(), output = ctx.createGain();
            const dry = ctx.createGain(), wet = ctx.createGain();
            const shaper = ctx.createWaveShaper();
            const lp = ctx.createBiquadFilter();
            shaper.oversample = "4x";
            lp.type = "lowpass";
            input.connect(dry); input.connect(shaper);
            shaper.connect(lp); lp.connect(wet);
            dry.connect(output); wet.connect(output);
            const apply = (p) => {
                shaper.curve = makeDistortionCurve(p.drive);
                lp.frequency.value = p.tone;
                dry.gain.value = 1 - p.dryWet;
                wet.gain.value = p.dryWet;
            };
            apply(params);
            return { input, output, update: apply };
        },
    },

    filter: {
        label: "Filter",
        defaultParams: { type: "lowpass", frequency: 1000, resonance: 0.707 },
        uiParams: [
            // Type is rendered via a select, not a slider — special-cased in renderer
            { key: "type", label: "Type", isSelect: true,
              options: [
                  { value: "lowpass",  label: "Low-Pass"  },
                  { value: "highpass", label: "High-Pass" },
                  { value: "bandpass", label: "Band-Pass" },
              ],
            },
            { key: "frequency", label: "Freq",   min: 20,   max: 20000, step: 1,    format: v => v >= 1000 ? `${(v/1000).toFixed(2)} kHz` : `${v.toFixed(0)} Hz`, isLog: true },
            { key: "resonance", label: "Reso",   min: 0.1,  max: 20,    step: 0.1,  format: v => `Q ${v.toFixed(1)}` },
        ],
        build(ctx, params) {
            const input = ctx.createGain(), output = ctx.createGain();
            const filt = ctx.createBiquadFilter();
            input.connect(filt); filt.connect(output);
            const apply = (p) => {
                filt.type           = p.type;
                filt.frequency.value = p.frequency;
                filt.Q.value         = p.resonance;
            };
            apply(params);
            return { input, output, update: apply };
        },
    },

    phaser: {
        label: "Phaser",
        defaultParams: { rate: 0.5, depth: 0.7, feedback: 0.3, dryWet: 0.5 },
        uiParams: [
            { key: "rate",     label: "Rate",     min: 0.05, max: 8,    step: 0.01, format: v => `${v.toFixed(2)} Hz` },
            { key: "depth",    label: "Depth",    min: 0,    max: 1,    step: 0.01, format: v => `${Math.round(v * 100)}%` },
            { key: "feedback", label: "Feedback", min: 0,    max: 0.95, step: 0.01, format: v => `${Math.round(v * 100)}%` },
            { key: "dryWet",   label: "Mix",      min: 0,    max: 1,    step: 0.01, format: v => `${Math.round(v * 100)}%` },
        ],
        build(ctx, params) {
            const input = ctx.createGain(), output = ctx.createGain();
            const dry = ctx.createGain(), wet = ctx.createGain();
            
            const stages = [];
            const stageBaseFreqs = [350, 600, 1000, 1700];
            for (let i = 0; i < 4; i++) {
                const ap = ctx.createBiquadFilter();
                ap.type = "allpass";
                ap.Q.value = 0.7;
                ap.frequency.value = stageBaseFreqs[i];
                stages.push(ap);
            }
            
            // Cascade
            input.connect(stages[0]);
            for (let i = 0; i < stages.length - 1; i++) {
                stages[i].connect(stages[i + 1]);
            }
            stages[3].connect(wet);
            
            // Feedback with explicit delay
            const fb = ctx.createGain();
            const fbDelay = ctx.createDelay(0.05);
            fbDelay.delayTime.value = 0.001;
            fb.gain.value = 0;
            stages[3].connect(fbDelay);
            fbDelay.connect(fb);
            fb.connect(stages[0]);
            
            // Dry path
            input.connect(dry);
            dry.connect(output); wet.connect(output);
            
            wet.gain.value = 0;
            dry.gain.value = 1;
            
            // LFO modulating each stage's frequency, with a per-stage gain
            // proportional to that stage's base frequency
            const lfo = ctx.createOscillator();
            lfo.type = "sine";
            const stageLfoGains = stages.map((ap, i) => {
                const g = ctx.createGain();
                g.gain.value = 0;  // init to 0, apply() will set the real depth
                lfo.connect(g);
                g.connect(ap.frequency);
                return g;
            });
            lfo.start();
            
            const apply = (p) => {
                lfo.frequency.value = p.rate;
                stages.forEach((ap, i) => {
                    const baseFreq = stageBaseFreqs[i];
                    ap.frequency.value = baseFreq;
                    stageLfoGains[i].gain.value = baseFreq * 0.8 * p.depth;
                });
                fb.gain.value  = p.feedback;
                dry.gain.value = 1 - p.dryWet;
                wet.gain.value = p.dryWet;
            };
            apply(params);
            
            const dispose = () => { try { lfo.stop(); } catch (_) {} };
            return { input, output, update: apply, dispose };
        },
    },

    compressor: {
        label: "Compressor",
        defaultParams: {
            threshold: -20, ratio: 4, attack: 5, release: 100, makeup: 0, dryWet: 1.0,
        },
        uiParams: [
            { key: "threshold", label: "Thresh",   min: -60, max: 0,    step: 0.5, format: v => `${v.toFixed(1)} dB` },
            { key: "ratio",     label: "Ratio",    min: 1,   max: 20,   step: 0.1, format: v => `${v.toFixed(1)}:1` },
            { key: "attack",    label: "Attack",   min: 0.1, max: 100,  step: 0.1, format: v => `${v.toFixed(1)} ms` },
            { key: "release",   label: "Release",  min: 1,   max: 1000, step: 1,   format: v => `${v.toFixed(0)} ms` },
            { key: "makeup",    label: "Makeup",   min: 0,   max: 24,   step: 0.1, format: v => `${v.toFixed(1)} dB` },
            { key: "dryWet",    label: "Mix",      min: 0,   max: 1,    step: 0.01, format: v => `${Math.round(v * 100)}%` },
        ],
        build(ctx, params) {
            const input = ctx.createGain(), output = ctx.createGain();
            const dry = ctx.createGain(), wet = ctx.createGain();
            const makeup = ctx.createGain();
            const comp = ctx.createDynamicsCompressor();
            comp.knee.value = 6;
            input.connect(dry);
            input.connect(comp);
            comp.connect(makeup);
            makeup.connect(wet);
            dry.connect(output); wet.connect(output);
            const apply = (p) => {
                comp.threshold.value = p.threshold;
                comp.ratio.value     = p.ratio;
                comp.attack.value    = p.attack / 1000;   // ms → s
                comp.release.value   = p.release / 1000;
                makeup.gain.value    = Math.pow(10, p.makeup / 20);
                dry.gain.value       = 1 - p.dryWet;
                wet.gain.value       = p.dryWet;
            };
            apply(params);
            return { input, output, update: apply };
        },
    },

    widener: {
        label: "Stereo Widener",
        defaultParams: { width: 1.0 },
        customLayout: "widener",
        uiParams: [
            { key: "width", label: "Width", min: 0, max: 2, step: 0.01,
              format: v => v < 0.05 ? "Mono" : v <= 1.05 ? `${v.toFixed(2)}` : `Wide ${v.toFixed(2)}` },
        ],
        build(ctx, params) {
            const input = ctx.createGain(), output = ctx.createGain();
            // Build a Mid/Side encoder/decoder using native nodes.
            // We use ChannelSplitter / Merger and sum manually.
            const splitter = ctx.createChannelSplitter(2);
            const merger   = ctx.createChannelMerger(2);
            const midGain  = ctx.createGain();
            const sideGain = ctx.createGain();
            // Left channel  L → mid (+1), side (+1)
            // Right channel R → mid (+1), side (-1)
            // We build this with intermediate inverters
            const leftToMid   = ctx.createGain(); leftToMid.gain.value   = 0.5;
            const rightToMid  = ctx.createGain(); rightToMid.gain.value  = 0.5;
            const leftToSide  = ctx.createGain(); leftToSide.gain.value  = 0.5;
            const rightToSide = ctx.createGain(); rightToSide.gain.value = -0.5;
            input.connect(splitter);
            splitter.connect(leftToMid,  0); splitter.connect(rightToMid,  1);
            splitter.connect(leftToSide, 0); splitter.connect(rightToSide, 1);
            leftToMid.connect(midGain); rightToMid.connect(midGain);
            leftToSide.connect(sideGain); rightToSide.connect(sideGain);
            // Decode: L = mid + side, R = mid - side
            const sideInv = ctx.createGain(); sideInv.gain.value = -1;
            sideGain.connect(sideInv);
            // Out L = mid + side (ch 0), Out R = mid - side (ch 1)
            midGain.connect(merger, 0, 0); sideGain.connect(merger, 0, 0);
            midGain.connect(merger, 0, 1); sideInv.connect(merger, 0, 1);
            merger.connect(output);
            const apply = (p) => {
                // mid stays at unity, side scales with width
                midGain.gain.value  = 1.0;
                sideGain.gain.value = 1.0 * p.width;
                sideInv.gain.value  = -1.0;
            };
            apply(params);
            return { input, output, update: apply };
        },
    },
};

// ===========================================================================
// StemFXChain
// ===========================================================================
export class StemFXChain {
    constructor(ctx, mixer, track) {
        this.ctx    = ctx;
        this.mixer  = mixer;
        this.track  = track;
        this.fxIn   = ctx.createGain();
        this.fxOut  = ctx.createGain();
        this.slots  = [];
        this._externalEdges = [];
        this._rewire();
    }

    dispose() {
        if (this._externalEdges) {
            for (const [src, dst] of this._externalEdges) {
                try { src.disconnect(dst); } catch (_) {}
            }
            this._externalEdges = null;
        }
        for (const s of this.slots) this._disposeSlot(s);
        this.slots = [];
    }

    _disposeSlot(slot) {
        if (slot.popup) {
            try { slot.popup._cleanup?.(); } catch (_) {}
            slot.popup.remove();
            slot.popup = null;
        }
        if (slot.instance) {
            try { slot.instance.dispose?.(); } catch (_) {}
            slot.instance = null;
        }
    }

    // Order the slots: non-widener first (in user order), widener last.
    // Matches the Python `apply_fx_chain` ordering.
    _orderedSlots() {
        const main = this.slots.filter(s => s.type !== "widener");
        const wid  = this.slots.filter(s => s.type === "widener");
        return [...main, ...wid];
    }

    _rewire() {
        const ctx = this.ctx;
        const FADE = 0.005;

        const doRewire = () => {
            if (this._externalEdges) {
                for (const [src, dst] of this._externalEdges) {
                    try { src.disconnect(dst); } catch (_) {}
                }
            }
            const edges = [];
            let prev = this.fxIn;
            for (const s of this._orderedSlots()) {
                if (!s.on || !s.instance) continue;
                edges.push([prev, s.instance.input]);
                prev = s.instance.output;
            }
            edges.push([prev, this.fxOut]);
            for (const [src, dst] of edges) {
                try { src.connect(dst); } catch (_) {}
            }
            this._externalEdges = edges;
        };

        if (ctx.state !== "running") {
            doRewire();
            return;
        }
        const now = ctx.currentTime;
        try {
            this.fxIn.gain.cancelScheduledValues(now);
            this.fxIn.gain.setValueAtTime(this.fxIn.gain.value, now);
            this.fxIn.gain.linearRampToValueAtTime(0, now + FADE);
        } catch (_) {}
        setTimeout(() => {
            doRewire();
            try {
                const t = ctx.currentTime;
                this.fxIn.gain.cancelScheduledValues(t);
                this.fxIn.gain.setValueAtTime(0, t);
                this.fxIn.gain.linearRampToValueAtTime(1, t + FADE);
            } catch (_) {}
        }, FADE * 1000 + 1);
    }

    isActive() { return this.slots.some(s => s.on); }

    addEffect(type, data = null) {
        const def = FX_REGISTRY[type];
        if (!def) return null;
        const params = { ...(def.defaultParams), ...(data?.params || {}) };
        const slot = {
            id: data?.id ?? fxId(),
            type, on: data?.on ?? true,
            params,
            fxWindow: data?.fxWindow ?? null,
            instance: null, popup: null,
        };
        slot.instance = def.build(this.ctx, slot.params);
        this.slots.push(slot);
        this._rewire();
        return slot;
    }

    removeEffect(id) {
        const idx = this.slots.findIndex(s => s.id === id);
        if (idx < 0) return;
        this._disposeSlot(this.slots[idx]);
        this.slots.splice(idx, 1);
        this._rewire();
    }

    toggleEffect(id) {
        const slot = this.slots.find(s => s.id === id);
        if (!slot) return;
        slot.on = !slot.on;
        this._rewire();
    }

    updateParams(id, params) {
        const slot = this.slots.find(s => s.id === id);
        if (!slot || !slot.instance) return;
        Object.assign(slot.params, params);
        slot.instance.update?.(slot.params);
    }

    serialize() {
        return this.slots.map(s => ({
            id: s.id, type: s.type, on: s.on,
            params: { ...s.params },
            fxWindow: s.fxWindow,
        }));
    }
}

// ===========================================================================
// FX Add Menu
// ===========================================================================
export function showFXMenu(track, anchorBtn, mixer) {
    const existing = document.querySelector(".sm-fx-menu");
    if (existing) {
        const wasForSame = existing.dataset.anchorId === anchorBtn.dataset?.fxAnchorId;
        existing.remove();
        const oldBackdrop = document.querySelector(".sm-fx-menu-backdrop");
        if (oldBackdrop) oldBackdrop.remove();
        if (wasForSame) return;
    }
    if (!anchorBtn.dataset.fxAnchorId) {
        anchorBtn.dataset.fxAnchorId = "btn_" + Math.random().toString(36).slice(2, 8);
    }

    const backdrop = document.createElement("div");
    backdrop.className = "sm-fx-menu-backdrop";
    document.body.appendChild(backdrop);

    const menu = document.createElement("div");
    menu.className = "sm-fx-menu";
    menu.dataset.anchorId = anchorBtn.dataset.fxAnchorId;
    const r = anchorBtn.getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.top  = `${r.bottom + 4}px`;

    const closeMenu = () => {
        menu.remove(); backdrop.remove();
        document.removeEventListener("keydown", onKey);
    };
    const onKey = (e) => { if (e.key === "Escape") closeMenu(); };
    document.addEventListener("keydown", onKey);
    backdrop.addEventListener("mousedown", closeMenu);

    if (track.fxChain && track.fxChain.slots.length > 0) {
        const header = document.createElement("div");
        header.className = "sm-fx-menu-header";
        header.textContent = "Active effects";
        menu.appendChild(header);
        for (const slot of track.fxChain.slots) {
            const def = FX_REGISTRY[slot.type];
            const item = document.createElement("div");
            item.className = "sm-fx-menu-item sm-fx-menu-active";
            item.innerHTML = `
                <span class="sm-fx-menu-name ${slot.on ? '' : 'sm-fx-off'}">${escFx(def.label)}</span>
                <button class="sm-fx-menu-toggle" title="${slot.on ? 'Bypass' : 'Enable'}">${slot.on ? "ON" : "OFF"}</button>
                <button class="sm-fx-menu-remove" title="Remove">✕</button>
            `;
            item.querySelector(".sm-fx-menu-name").onclick = () => {
                closeMenu(); openFXPopup(track, slot, mixer);
            };
            item.querySelector(".sm-fx-menu-toggle").onclick = (e) => {
                e.stopPropagation();
                track.fxChain.toggleEffect(slot.id);
                mixer._refreshFXButton(track); mixer._saveState();
                closeMenu(); showFXMenu(track, anchorBtn, mixer);
            };
            item.querySelector(".sm-fx-menu-remove").onclick = (e) => {
                e.stopPropagation();
                if (slot.popup) { try { slot.popup._cleanup?.(); } catch (_) {} slot.popup.remove(); }
                track.fxChain.removeEffect(slot.id);
                mixer._refreshFXButton(track); mixer._saveState();
                closeMenu(); showFXMenu(track, anchorBtn, mixer);
            };
            menu.appendChild(item);
        }
        const sep = document.createElement("div");
        sep.className = "sm-fx-menu-sep";
        menu.appendChild(sep);
    }

    const addHeader = document.createElement("div");
    addHeader.className = "sm-fx-menu-header";
    addHeader.textContent = "Add effect";
    menu.appendChild(addHeader);

    for (const [type, def] of Object.entries(FX_REGISTRY)) {
        const item = document.createElement("div");
        item.className = "sm-fx-menu-item";
        item.textContent = "+ " + def.label;
        item.onclick = () => {
            const slot = track.fxChain.addEffect(type);
            closeMenu();
            mixer._refreshFXButton(track); mixer._saveState();
            openFXPopup(track, slot, mixer);
        };
        menu.appendChild(item);
    }

    const sep2 = document.createElement("div");
    sep2.className = "sm-fx-menu-sep";
    menu.appendChild(sep2);
    const closeItem = document.createElement("div");
    closeItem.className = "sm-fx-menu-item sm-fx-menu-close";
    closeItem.textContent = "Cancel";
    closeItem.onclick = closeMenu;
    menu.appendChild(closeItem);

    document.body.appendChild(menu);
}

// ===========================================================================
// FX Popup — default layout + custom layouts (widener)
// ===========================================================================
function _renderDefaultBody(slot, def) {
    return def.uiParams.map(p => {
        if (p.isSelect) {
            return `
                <div class="sm-fx-param" data-key="${p.key}">
                    <div class="sm-fx-paramlbl">${escFx(p.label)}</div>
                    <select class="sm-fx-select">
                        ${p.options.map(o =>
                            `<option value="${o.value}" ${o.value === slot.params[p.key] ? "selected" : ""}>${escFx(o.label)}</option>`
                        ).join("")}
                    </select>
                </div>
            `;
        }
        return `
            <div class="sm-fx-param" data-key="${p.key}">
                <div class="sm-fx-paramlbl">${escFx(p.label)}</div>
                <div class="sm-fx-paramval">${escFx(p.format(slot.params[p.key]))}</div>
                <input class="sm-fx-slider" type="range"
                       min="${p.min}" max="${p.max}" step="${p.step}"
                       value="${slot.params[p.key]}" />
            </div>
        `;
    }).join("");
}

function _renderWidenerBody(slot, def) {
    const p = def.uiParams[0];
    return `
        <div class="sm-fx-widener-body">
            <canvas class="sm-fx-widener-graph" width="120" height="120"></canvas>
            <div class="sm-fx-widener-control">
                <div class="sm-fx-paramlbl">${escFx(p.label)}</div>
                <div class="sm-fx-paramval sm-fx-widener-val">${escFx(p.format(slot.params[p.key]))}</div>
                <input class="sm-fx-slider sm-fx-vslider" data-key="${p.key}"
                       type="range" orient="vertical"
                       min="${p.min}" max="${p.max}" step="${p.step}"
                       value="${slot.params[p.key]}" />
            </div>
        </div>
    `;
}

// Draw the widener visualization: two crossed lines that spread / collapse
// based on width. width=0 → vertical line (mono), width=1 → 90° X,
// width=2 → wide X opening up to ~140°.
function _drawWidenerGraph(canvas, width) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    // Background
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, W, H);
    // Grid: center crosshair
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H);
    ctx.moveTo(0, H/2); ctx.lineTo(W, H/2);
    ctx.stroke();
    // Bounding circle
    ctx.beginPath();
    ctx.arc(W/2, H/2, Math.min(W, H) / 2 - 8, 0, Math.PI * 2);
    ctx.stroke();
    // Compute spread angle from width
    // width=0 → 0° (collapsed to vertical)
    // width=1 → 90° (perfect X)
    // width=2 → 140° (wide)
    const angle = (Math.PI / 4) * Math.max(0, Math.min(width, 2));
    const r = Math.min(W, H) / 2 - 12;
    // L line: from center, going up-left
    const lx = W/2 - Math.sin(angle) * r;
    const ly = H/2 - Math.cos(angle) * r;
    const rx = W/2 + Math.sin(angle) * r;
    const ry = H/2 - Math.cos(angle) * r;
    // Color: orange when widened, blue at unity
    const isWide = width > 1.05;
    const isMono = width < 0.05;
    const color = isMono ? "#ff3b30" : isWide ? "#ff9f0a" : "#4a9eff";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    // Draw L line
    ctx.beginPath();
    ctx.moveTo(W/2, H/2); ctx.lineTo(lx, ly);
    ctx.stroke();
    // Draw R line
    ctx.beginPath();
    ctx.moveTo(W/2, H/2); ctx.lineTo(rx, ry);
    ctx.stroke();
    // Labels
    ctx.fillStyle = "#666";
    ctx.font = "10px sans-serif";
    ctx.fillText("L", lx - 12, ly + 4);
    ctx.fillText("R", rx + 4,  ry + 4);
    // Status text at bottom
    ctx.fillStyle = color;
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    const status = isMono ? "MONO" : isWide ? "WIDE" : "STEREO";
    ctx.fillText(status, W/2, H - 4);
    ctx.textAlign = "left";
}

export function openFXPopup(track, slot, mixer) {
    if (slot.popup) { slot.popup.style.zIndex = String(Date.now()); return; }
    const def = FX_REGISTRY[slot.type];
    if (!def) return;

    const popup = document.createElement("div");
    popup.className = "sm-fx-popup";
    if (def.customLayout === "widener") popup.classList.add("sm-fx-popup-widener");

    const bodyHTML = def.customLayout === "widener"
        ? _renderWidenerBody(slot, def)
        : _renderDefaultBody(slot, def);

    popup.innerHTML = `
        <div class="sm-fx-titlebar">
            <span class="sm-fx-title">${escFx(def.label)} — ${escFx(track.name)}</span>
            <div class="sm-fx-titleactions">
                <button class="sm-fx-onoff ${slot.on ? 'on' : 'off'}">${slot.on ? "ON" : "OFF"}</button>
                <button class="sm-fx-reset" title="Reset to default">Reset</button>
                <button class="sm-fx-close" title="Close">✕</button>
            </div>
        </div>
        <div class="sm-fx-body">${bodyHTML}</div>
    `;

    let x, y;
    if (slot.fxWindow && typeof slot.fxWindow.x === "number") {
        x = Math.max(0, Math.min(slot.fxWindow.x, window.innerWidth  - 100));
        y = Math.max(0, Math.min(slot.fxWindow.y, window.innerHeight - 50));
    } else {
        x = Math.max(20, window.innerWidth / 2 - 220);
        y = Math.max(20, window.innerHeight / 2 - 140);
    }
    popup.style.left = `${x}px`;
    popup.style.top  = `${y}px`;

    document.body.appendChild(popup);
    slot.popup = popup;

    // Drag
    const titlebar = popup.querySelector(".sm-fx-titlebar");
    let dragOff = null;
    titlebar.addEventListener("mousedown", e => {
        if (e.target.closest(".sm-fx-close, .sm-fx-reset, .sm-fx-onoff")) return;
        const r = popup.getBoundingClientRect();
        dragOff = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        e.preventDefault();
    });
    const onMove = e => {
        if (!dragOff) return;
        const x = Math.max(0, Math.min(e.clientX - dragOff.dx, window.innerWidth  - 100));
        const y = Math.max(0, Math.min(e.clientY - dragOff.dy, window.innerHeight - 30));
        popup.style.left = `${x}px`;
        popup.style.top  = `${y}px`;
    };
    const onUp = () => {
        if (dragOff) {
            dragOff = null;
            const r = popup.getBoundingClientRect();
            slot.fxWindow = { x: r.left, y: r.top };
            mixer._saveState();
        }
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
    popup._cleanup = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
    };

    // Close
    popup.querySelector(".sm-fx-close").addEventListener("click", () => {
        try { popup._cleanup?.(); } catch (_) {}
        popup.remove();
        slot.popup = null;
    });

    // ON/OFF
    const onBtn = popup.querySelector(".sm-fx-onoff");
    onBtn.addEventListener("click", () => {
        track.fxChain.toggleEffect(slot.id);
        onBtn.classList.toggle("on",  slot.on);
        onBtn.classList.toggle("off", !slot.on);
        onBtn.textContent = slot.on ? "ON" : "OFF";
        mixer._refreshFXButton(track); mixer._saveState();
    });

    // Reset
    popup.querySelector(".sm-fx-reset").addEventListener("click", () => {
        const def2 = FX_REGISTRY[slot.type];
        const newParams = { ...def2.defaultParams };
        track.fxChain.updateParams(slot.id, newParams);
        // Refresh UI
        for (const p of def2.uiParams) {
            const wrap = popup.querySelector(`.sm-fx-param[data-key="${p.key}"]`);
            if (wrap) {
                if (p.isSelect) {
                    wrap.querySelector(".sm-fx-select").value = newParams[p.key];
                } else {
                    wrap.querySelector(".sm-fx-slider").value = newParams[p.key];
                    wrap.querySelector(".sm-fx-paramval").textContent = p.format(newParams[p.key]);
                }
            }
            // Widener custom layout
            const vSlider = popup.querySelector(`.sm-fx-vslider[data-key="${p.key}"]`);
            if (vSlider) {
                vSlider.value = newParams[p.key];
                const valEl = popup.querySelector(".sm-fx-widener-val");
                if (valEl) valEl.textContent = p.format(newParams[p.key]);
                const cv = popup.querySelector(".sm-fx-widener-graph");
                if (cv) _drawWidenerGraph(cv, newParams[p.key]);
            }
        }
        mixer._refreshFXButton(track); mixer._saveState();
    });

    // Hook up sliders / selects
    if (def.customLayout === "widener") {
        const slider = popup.querySelector(".sm-fx-vslider");
        const valEl  = popup.querySelector(".sm-fx-widener-val");
        const cv     = popup.querySelector(".sm-fx-widener-graph");
        const p      = def.uiParams[0];
        _drawWidenerGraph(cv, slot.params.width);
        slider.addEventListener("input", e => {
            const v = parseFloat(e.target.value);
            track.fxChain.updateParams(slot.id, { [p.key]: v });
            valEl.textContent = p.format(v);
            _drawWidenerGraph(cv, v);
            mixer._refreshFXButton(track); mixer._saveState();
        });
        slider.addEventListener("dblclick", () => {
            track.fxChain.updateParams(slot.id, { [p.key]: 1.0 });
            slider.value = 1.0;
            valEl.textContent = p.format(1.0);
            _drawWidenerGraph(cv, 1.0);
            mixer._refreshFXButton(track); mixer._saveState();
        });
    } else {
        for (const p of def.uiParams) {
            const wrap = popup.querySelector(`.sm-fx-param[data-key="${p.key}"]`);
            if (!wrap) continue;
            if (p.isSelect) {
                const sel = wrap.querySelector(".sm-fx-select");
                sel.addEventListener("change", e => {
                    track.fxChain.updateParams(slot.id, { [p.key]: e.target.value });
                    mixer._refreshFXButton(track); mixer._saveState();
                });
            } else {
                const slider = wrap.querySelector(".sm-fx-slider");
                const label  = wrap.querySelector(".sm-fx-paramval");
                slider.addEventListener("input", e => {
                    const v = parseFloat(e.target.value);
                    track.fxChain.updateParams(slot.id, { [p.key]: v });
                    label.textContent = p.format(v);
                    mixer._refreshFXButton(track); mixer._saveState();
                });
            }
        }
    }
}

// ===========================================================================
// CSS injection
// ===========================================================================
export function injectFXCSS() {
    if (document.getElementById("stem-mixer-fx-css")) return;
    const style = document.createElement("style");
    style.id = "stem-mixer-fx-css";
    style.textContent = `
.sm-btn.fx-engaged {
    background: #4a3000; border-color: #ff9f0a; color: #ff9f0a;
}
.sm-fx-menu-backdrop {
    position: fixed; inset: 0; z-index: 9998; background: transparent;
}
.sm-fx-menu {
    position: fixed; z-index: 9999;
    background: #2a2a2a; border: 1px solid #555; border-radius: 5px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.6);
    color: #ccc; font-family: sans-serif; font-size: 11px;
    min-width: 180px; padding: 4px 0; user-select: none;
}
.sm-fx-menu-close { color: #888; text-align: center; font-style: italic; }
.sm-fx-menu-close:hover { background: #3a3a3a; color: #fff; }
.sm-fx-menu-header {
    font-size: 9px; color: #777; letter-spacing: 0.5px;
    padding: 4px 10px 2px; text-transform: uppercase;
}
.sm-fx-menu-item {
    padding: 6px 10px; cursor: pointer;
    display: flex; align-items: center; gap: 6px;
}
.sm-fx-menu-item:hover { background: #3a3a3a; }
.sm-fx-menu-active .sm-fx-menu-name { flex: 1; cursor: pointer; }
.sm-fx-menu-name.sm-fx-off { opacity: 0.5; }
.sm-fx-menu-toggle, .sm-fx-menu-remove {
    background: #1e1e1e; border: 1px solid #444; border-radius: 3px;
    color: #aaa; cursor: pointer; font-size: 9px; padding: 2px 6px;
}
.sm-fx-menu-toggle:hover, .sm-fx-menu-remove:hover { background: #333; color: #fff; }
.sm-fx-menu-sep { height: 1px; background: #444; margin: 4px 0; }

.sm-fx-popup {
    position: fixed; width: 460px;
    background: #2a2a2a; border: 1px solid #555; border-radius: 6px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.6);
    z-index: 9999; color: #ccc; font-family: sans-serif; font-size: 12px;
    user-select: none;
}
.sm-fx-popup-widener { width: 320px; }
.sm-fx-titlebar {
    display: flex; justify-content: space-between; align-items: center;
    padding: 6px 10px; background: #1e1e1e; border-bottom: 1px solid #444;
    border-radius: 6px 6px 0 0; cursor: move;
}
.sm-fx-title { font-size: 12px; color: #ddd; font-weight: 500; }
.sm-fx-titleactions { display: flex; align-items: center; gap: 4px; }
.sm-fx-onoff {
    background: #3a3a3a; border: 1px solid #555; border-radius: 3px;
    color: #888; cursor: pointer; font-size: 10px; padding: 2px 8px;
}
.sm-fx-onoff.on  { background: #1a6abf; border-color: #4a9eff; color: #fff; }
.sm-fx-onoff.off { opacity: 0.6; }
.sm-fx-reset {
    background: #3a3a3a; border: 1px solid #555; border-radius: 3px;
    color: #ccc; cursor: pointer; font-size: 10px; padding: 2px 8px;
}
.sm-fx-reset:hover { background: #4a4a4a; border-color: #ff9f0a; color: #ff9f0a; }
.sm-fx-close {
    background: transparent; border: none; color: #aaa; font-size: 14px;
    cursor: pointer; padding: 0 6px;
}
.sm-fx-close:hover { color: #fff; }
.sm-fx-body { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.sm-fx-param {
    display: grid; grid-template-columns: 70px 1fr 80px;
    align-items: center; gap: 8px;
}
.sm-fx-paramlbl { font-size: 11px; color: #888; letter-spacing: 0.5px; }
.sm-fx-slider {
    flex: 1; accent-color: #ff9f0a; cursor: pointer; width: 100%;
}
.sm-fx-paramval {
    font-size: 11px; color: #ddd; text-align: right;
    font-variant-numeric: tabular-nums;
}
.sm-fx-select {
    background: #1e1e1e; border: 1px solid #555; border-radius: 3px;
    color: #ddd; font-size: 11px; padding: 2px 6px; grid-column: 2 / span 2;
    cursor: pointer;
}

/* Widener-specific layout */
.sm-fx-widener-body {
    display: flex; gap: 16px; align-items: center; justify-content: center;
    padding: 8px;
}
.sm-fx-widener-graph {
    background: #1a1a1a; border-radius: 4px; flex-shrink: 0;
}
.sm-fx-widener-control {
    display: flex; flex-direction: column; align-items: center;
    gap: 6px;
}
.sm-fx-widener-control .sm-fx-paramlbl {
    font-size: 10px; color: #888;
}
.sm-fx-widener-val {
    font-size: 11px; color: #ddd; min-height: 14px;
}
.sm-fx-vslider {
    appearance: slider-vertical; -webkit-appearance: slider-vertical;
    writing-mode: vertical-lr; direction: rtl;
    width: 24px; height: 100px;
    accent-color: #ff9f0a; cursor: pointer;
}
`;
    document.head.appendChild(style);
}
