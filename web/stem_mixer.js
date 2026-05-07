// ComfyUI-StemMixer — frontend extension
// V1.5: loop + selection (drag to select, drag edges to resize, drag inside
//       to move, double-click to clear). Native sample-accurate looping
//       via AudioBufferSourceNode.loop. Per-track 3-band EQ (popup).
//       Master volume + master VU, total duration, drag & drop loading.

import { app } from "../../scripts/app.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function genId() {
    return crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function formatTime(s) {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
}
function esc(str) {
    return String(str).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------
const STYLES = `
.stemmixer-root {
    padding: 8px;
    font-family: sans-serif;
    font-size: 12px;
    color: #ccc;
    box-sizing: border-box;
    width: 100%;
    overflow-x: hidden;
    overflow-y: auto;
    transition: outline 0.1s ease;
}
.stemmixer-root.sm-drag-active {
    outline: 2px dashed #4a9eff;
    outline-offset: -4px;
    background: #1a6abf22;
}
.sm-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
}
.sm-transport { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.sm-time {
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    color: #aaa;
    min-width: 78px;
    flex-shrink: 0;
}
.sm-spacer { flex: 1; }

/* Master cluster in the header */
.sm-master {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
    padding: 0 6px;
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 5px;
    height: 26px;
}
.sm-master-label {
    font-size: 10px;
    color: #888;
    flex-shrink: 0;
}
.sm-master-slider {
    flex: 1;
    accent-color: #ff9f0a;
    cursor: pointer;
    min-width: 0;
}
.sm-master-val {
    font-size: 10px;
    color: #ccc;
    min-width: 36px;
    text-align: right;
    flex-shrink: 0;
}
.sm-master-vu {
    width: 14px;
    height: 18px;
    background: #1a1a1a;
    border-radius: 2px;
    flex-shrink: 0;
    display: block;
}
.sm-btn {
    background: #3a3a3a;
    border: 1px solid #555;
    border-radius: 4px;
    color: #ccc;
    cursor: pointer;
    font-size: 11px;
    padding: 3px 8px;
    transition: background 0.15s;
    white-space: nowrap;
    flex-shrink: 0;
    line-height: 1.4;
}
.sm-btn:hover    { background: #4a4a4a; }
.sm-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.sm-btn.active   { background: #1a6abf; border-color: #4a9eff; color: #fff; }
/* EQ button glows orange when EQ is engaged but popup closed */
.sm-btn.eq-engaged {
    background: #4a3000;
    border-color: #ff9f0a;
    color: #ff9f0a;
}

/* ----- EQ Popup ----- */
.sm-eq-popup {
    position: fixed;
    width: 480px;
    height: 320px;
    background: #2a2a2a;
    border: 1px solid #555;
    border-radius: 6px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.6);
    z-index: 9999;
    color: #ccc;
    font-family: sans-serif;
    font-size: 12px;
    user-select: none;
    display: flex;
    flex-direction: column;
}
.sm-eq-titlebar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    background: #1e1e1e;
    border-bottom: 1px solid #444;
    border-radius: 6px 6px 0 0;
    cursor: move;
    flex-shrink: 0;
}
.sm-eq-title {
    font-size: 12px;
    color: #ddd;
    font-weight: 500;
}
.sm-eq-titleactions {
    display: flex;
    align-items: center;
    gap: 4px;
}
.sm-eq-reset {
    background: #3a3a3a;
    border: 1px solid #555;
    border-radius: 3px;
    color: #ccc;
    cursor: pointer;
    font-size: 10px;
    padding: 2px 8px;
    transition: background 0.15s;
}
.sm-eq-reset:hover {
    background: #4a4a4a;
    border-color: #ff9f0a;
    color: #ff9f0a;
}
.sm-eq-close {
    background: transparent;
    border: none;
    color: #aaa;
    font-size: 14px;
    cursor: pointer;
    padding: 0 6px;
}
.sm-eq-close:hover { color: #fff; }
.sm-eq-body {
    display: flex;
    flex: 1;
    padding: 10px;
    gap: 12px;
    overflow: hidden;
}
.sm-eq-graph {
    width: 230px;
    height: 100%;
    background: #1a1a1a;
    border-radius: 4px;
    flex-shrink: 0;
}
.sm-eq-bands {
    display: flex;
    flex: 1;
    gap: 8px;
}
.sm-eq-band {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 4px;
    background: #1e1e1e;
    border: 1px solid #444;
    border-radius: 4px;
    min-width: 0;
}
.sm-eq-bandlbl {
    font-size: 10px;
    color: #888;
    letter-spacing: 0.5px;
}
.sm-eq-dbval {
    font-size: 11px;
    color: #ddd;
    font-variant-numeric: tabular-nums;
    min-height: 14px;
}
.sm-eq-slider {
    appearance: slider-vertical;
    -webkit-appearance: slider-vertical;
    writing-mode: vertical-lr;
    direction: rtl;
    width: 24px;
    flex: 1;
    accent-color: #ff9f0a;
    cursor: pointer;
}
.sm-eq-onoff {
    background: #3a3a3a;
    border: 1px solid #555;
    border-radius: 3px;
    color: #888;
    cursor: pointer;
    font-size: 10px;
    padding: 2px 8px;
    width: 100%;
}
.sm-eq-onoff.on  { background: #1a6abf; border-color: #4a9eff; color: #fff; }
.sm-eq-onoff.off { opacity: 0.6; }
.sm-eq-freqlbl {
    font-size: 10px;
    color: #777;
    margin-top: 2px;
}
.sm-track {
    background: #2a2a2a;
    border: 1px solid #444;
    border-radius: 6px;
    margin-bottom: 8px;
    padding: 6px 8px;
    box-sizing: border-box;
}
.sm-track-header {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 5px;
}
.sm-track-name {
    background: #1e1e1e;
    border: 1px solid #555;
    border-radius: 3px;
    color: #ddd;
    flex: 1;
    font-size: 11px;
    padding: 2px 6px;
    min-width: 0;
}
.sm-gain-row, .sm-pan-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 5px;
}
.sm-gain-label, .sm-pan-label { font-size: 10px; color: #888; width: 28px; flex-shrink: 0; }
.sm-gain-slider, .sm-pan-slider { flex: 1; accent-color: #4a9eff; cursor: pointer; min-width: 0; }
.sm-gain-val, .sm-pan-val { font-size: 10px; color: #aaa; min-width: 34px; text-align: right; flex-shrink: 0; }

.sm-wf-row {
    display: flex;
    gap: 4px;
    align-items: stretch;
}
.sm-waveform {
    border-radius: 4px;
    overflow: hidden;
    background: #1a1a1a;
    position: relative;
    flex: 1;
    height: var(--sm-wf-h, 64px);
    box-sizing: border-box;
    cursor: pointer;
    transition: height 0.15s ease;
}
.sm-waveform-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    height: var(--sm-wf-h, 64px);
    color: #555;
    font-size: 11px;
}
.sm-vu {
    width: 14px;
    height: var(--sm-wf-h, 64px);
    background: #1a1a1a;
    border-radius: 3px;
    flex-shrink: 0;
    display: block;
}
`;

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------
const HEADER_H      =  52;   // transport row + margins
const PADDING_H     =  16;   // bottom padding
const TRACK_FIXED_H = 116;   // per track fixed part: header(40) + gain(25) + pan(25) + gaps(26)
const WF_MIN        =  32;   // waveform min height px
const WF_MAX        =  64;   // waveform max height px

// ---------------------------------------------------------------------------
// StemMixerUI
// ---------------------------------------------------------------------------
class StemMixerUI {
    constructor(node, stateWidget) {
        this.node        = node;
        this.stateWidget = stateWidget;
        this.tracks      = [];

        this.ctx               = null;
        this.masterGain        = null;
        this.masterSplitter    = null;   // for stereo metering
        this.masterAnalyserL   = null;
        this.masterAnalyserR   = null;
        this.masterVolume      = 1.0;
        this.masterVuPeakL     = 0;
        this.masterVuPeakR     = 0;

        this.isPlaying  = false;
        this.startedAt  = 0;       // ctx.currentTime when playback began
        this.offsetSec  = 0;       // playhead position when paused
        this._rafId     = null;

        // Loop + selection state
        this.loopOn        = false;
        this.selection     = null;   // { start: sec, end: sec } or null
        this._dragSel      = null;   // active drag operation, see _onWaveMouseDown

        // Sequential decode queue — Chrome can't handle concurrent
        // decodeAudioData reliably. Each decode opens its own AudioContext
        // and closes it (await) before the next one starts.
        this._decodeQueue = Promise.resolve();

        // ResizeObserver — fires on any size change of the DOM widget
        this._ro = new ResizeObserver(() => this._onContainerResize());

        // Restore flag: prevents the deferred default restore from running
        // if loadedGraphNode arrives first.
        this._restored = false;

        this.container = this._buildShell();
        this._injectCSS();

        // Try restoring after a short delay. If loadedGraphNode (which fires
        // when a saved workflow is loaded) runs first, it will set _restored
        // and we skip the default fallback.
        this._restoreTimer = setTimeout(() => {
            if (this._restored) return;
            this._restoreState();
            this._restored = true;
        }, 100);
    }

    // -----------------------------------------------------------------------
    // AudioContext
    // -----------------------------------------------------------------------
    _ensureCtx() {
        if (this.ctx) return;
        this.ctx              = new AudioContext();
        this.masterGain       = this.ctx.createGain();
        this.masterGain.gain.value = this.masterVolume;
        // Master metering: gain → splitter → [analyserL, analyserR]
        //                       → destination
        this.masterSplitter   = this.ctx.createChannelSplitter(2);
        this.masterAnalyserL  = this.ctx.createAnalyser();
        this.masterAnalyserR  = this.ctx.createAnalyser();
        this.masterAnalyserL.fftSize = 512;
        this.masterAnalyserR.fftSize = 512;
        this.masterGain.connect(this.masterSplitter);
        this.masterSplitter.connect(this.masterAnalyserL, 0);
        this.masterSplitter.connect(this.masterAnalyserR, 1);
        this.masterGain.connect(this.ctx.destination);
    }

    // -----------------------------------------------------------------------
    // Shell
    // -----------------------------------------------------------------------
    _buildShell() {
        const el = document.createElement("div");
        el.className = "stemmixer-root";
        el.innerHTML = `
            <div class="sm-header">
                <div class="sm-transport">
                    <button class="sm-btn sm-play" title="Play / Pause">▶</button>
                    <button class="sm-btn sm-stop" title="Stop">■</button>
                    <button class="sm-btn sm-rewind" title="Return to start">⏮</button>
                    <button class="sm-btn sm-loop" title="Loop (selection if any, otherwise full)">⟲</button>
                    <span class="sm-time">0:00 / 0:00</span>
                </div>
                <div class="sm-master">
                    <span class="sm-master-label">Master</span>
                    <input class="sm-master-slider" type="range"
                           min="0" max="1.5" step="0.01" value="1" />
                    <span class="sm-master-val">100%</span>
                    <canvas class="sm-master-vu"></canvas>
                </div>
                <button class="sm-btn sm-add">+ Add stem</button>
            </div>
            <div class="sm-tracks"></div>
        `;
        el.querySelector(".sm-play").addEventListener("click",   () => this._togglePlay());
        el.querySelector(".sm-stop").addEventListener("click",   () => this._stop());
        el.querySelector(".sm-rewind").addEventListener("click", () => this._rewind());
        el.querySelector(".sm-loop").addEventListener("click",   () => this._toggleLoop());
        el.querySelector(".sm-add").addEventListener("click",    () => this._addTrack());

        // Master volume slider
        const mSlider = el.querySelector(".sm-master-slider");
        const mLabel  = el.querySelector(".sm-master-val");
        mSlider.addEventListener("input", e => {
            this.masterVolume = parseFloat(e.target.value);
            mLabel.textContent = `${Math.round(this.masterVolume * 100)}%`;
            this._applyMasterVolume();
            this._saveState();
        });
        // Double-click master slider to reset to 100%
        mSlider.addEventListener("dblclick", () => {
            this.masterVolume = 1;
            mSlider.value = 1;
            mLabel.textContent = "100%";
            this._applyMasterVolume();
            this._saveState();
        });

        // Stash master VU canvas + slider/label refs
        this._masterVuCanvas = el.querySelector(".sm-master-vu");
        this._masterSlider   = mSlider;
        this._masterLabel    = mLabel;

        // Drag & drop on the whole root — drop a file anywhere to add a stem
        el.addEventListener("dragover", e => {
            if (!e.dataTransfer?.types?.includes("Files")) return;
            e.preventDefault();
            el.classList.add("sm-drag-active");
        });
        el.addEventListener("dragleave", e => {
            // Only react when the cursor truly leaves the root
            if (e.target === el) el.classList.remove("sm-drag-active");
        });
        el.addEventListener("drop", async e => {
            if (!e.dataTransfer?.files?.length) return;
            e.preventDefault();
            el.classList.remove("sm-drag-active");
            for (const file of e.dataTransfer.files) {
                if (!/\.(wav|flac|mp3|ogg|m4a|aiff|aif)$/i.test(file.name)) continue;
                await this._addStemFromFile(file);
            }
        });

        // Observe the container itself
        this._ro.observe(el);

        return el;
    }

    // Add a new stem and immediately upload-and-load the given File.
    async _addStemFromFile(file) {
        // Create a fresh empty track in the UI
        await this._addTrack();
        const track = this.tracks[this.tracks.length - 1];
        const row   = this._tracksEl().querySelector(`[data-id="${track.id}"]`);
        if (row) await this._uploadAndLoad(file, track, row);
    }

    _injectCSS() {
        if (!document.getElementById("stemmixer-css")) {
            const s = document.createElement("style");
            s.id = "stemmixer-css";
            s.textContent = STYLES;
            document.head.appendChild(s);
        }
    }

    _tracksEl() { return this.container.querySelector(".sm-tracks"); }
    _playBtn()  { return this.container.querySelector(".sm-play"); }
    _timeEl()   { return this.container.querySelector(".sm-time"); }

    // -----------------------------------------------------------------------
    // Adaptive waveform height — clamp between WF_MIN and WF_MAX
    // -----------------------------------------------------------------------
    _calcWfHeight() {
        if (this.tracks.length === 0) return WF_MAX;
        const nodeH     = this.node.size[1] - 40;  // subtract LiteGraph title bar
        const available = nodeH - HEADER_H - PADDING_H
                          - this.tracks.length * TRACK_FIXED_H;
        const perTrack  = Math.floor(available / this.tracks.length);
        return Math.min(WF_MAX, Math.max(WF_MIN, perTrack));
    }

    // Apply height + redraw all waveforms
    _applyWfHeight() {
        const h = this._calcWfHeight();
        if (h === this._lastWfH) return;
        this._lastWfH = h;
        this.container.style.setProperty("--sm-wf-h", `${h}px`);
        // Redraw all canvases at new size
        const pos = this._getCurrentTime();
        for (const t of this.tracks) {
            if (t.canvas && t.duration > 0) {
                this._drawWaveform(t, Math.min(pos / t.duration, 1));
            }
        }
    }

    // -----------------------------------------------------------------------
    // ResizeObserver callback — redraw all waveforms
    // -----------------------------------------------------------------------
    _onContainerResize() {
        this._applyWfHeight();
    }

    // -----------------------------------------------------------------------
    // Track management
    // -----------------------------------------------------------------------
    async _addTrack(data = null) {

        const track = {
            id:       data?.id       ?? genId(),
            name:     data?.name     ?? `Stem ${this.tracks.length + 1}`,
            filename: data?.filename ?? null,
            gain:     data?.gain     != null ? data.gain : 1.0,
            pan:      data?.pan      != null ? data.pan  : 0.0,
            mute:     data?.mute     ?? false,
            solo:     data?.solo     ?? false,
            // EQ state — 3 bands (low shelf 100Hz, peak 1kHz, high shelf 8kHz)
            eq: {
                low:  { gain: data?.eq?.low?.gain  ?? 0, on: data?.eq?.low?.on  ?? true },
                mid:  { gain: data?.eq?.mid?.gain  ?? 0, on: data?.eq?.mid?.on  ?? true },
                high: { gain: data?.eq?.high?.gain ?? 0, on: data?.eq?.high?.on ?? true },
            },
            eqWindow: data?.eqWindow ?? null,    // {x, y} or null if never opened
            // Audio data
            buffer:       null,    // AudioBuffer, decoded once
            duration:     0,
            // Web Audio nodes (created in _loadTrack, persistent until dispose)
            pannerNode:   null,
            eqLowNode:    null,
            eqMidNode:    null,
            eqHighNode:   null,
            gainNode:     null,
            splitter:     null,
            analyserL:    null,
            analyserR:    null,
            // Active source (recreated for each play/seek)
            source:       null,
            // VU peak hold values
            vuPeakL:      0,
            vuPeakR:      0,
            // Display state
            peaks:        null,
            canvas:       null,
            wfEl:         null,
            vuCanvas:     null,
            eqPopup:      null,    // DOM element when popup is open, else null
            url:          null,
        };

        const row = this._buildRow(track);
        this._tracksEl().appendChild(row);
        this.tracks.push(track);
        this._autoResizeNode();

        if (track.filename) await this._loadTrack(track, row);
    }

    _buildRow(track) {
        const row = document.createElement("div");
        row.className = "sm-track";
        row.dataset.id = track.id;
        row.innerHTML = `
            <div class="sm-track-header">
                <input class="sm-track-name" type="text" value="${esc(track.name)}" />
                <button class="sm-btn sm-load-btn">📂 Load</button>
                <button class="sm-btn sm-eq-btn" title="EQ">EQ</button>
                <button class="sm-btn sm-mute-btn ${track.mute ? 'active' : ''}">M</button>
                <button class="sm-btn sm-solo-btn ${track.solo ? 'active' : ''}">S</button>
                <button class="sm-btn sm-remove-btn">✕</button>
            </div>
            <div class="sm-gain-row">
                <span class="sm-gain-label">Gain</span>
                <input class="sm-gain-slider" type="range" min="0" max="2" step="0.01"
                       value="${track.gain}" />
                <span class="sm-gain-val">${Math.round(track.gain * 100)}%</span>
            </div>
            <div class="sm-pan-row">
                <span class="sm-pan-label">Pan</span>
                <input class="sm-pan-slider" type="range" min="-1" max="1" step="0.01"
                       value="${track.pan}" />
                <span class="sm-pan-val">${this._formatPan(track.pan)}</span>
            </div>
            <div class="sm-wf-row">
                <div class="sm-waveform">
                    <div class="sm-waveform-placeholder">No file — click 📂 Load</div>
                </div>
                <canvas class="sm-vu"></canvas>
            </div>
        `;

        row.querySelector(".sm-track-name").addEventListener("change", e => {
            track.name = e.target.value; this._saveState();
            // Update EQ popup title if open
            if (track.eqPopup) {
                const t = track.eqPopup.querySelector(".sm-eq-title");
                if (t) t.textContent = `EQ — ${track.name}`;
            }
        });
        row.querySelector(".sm-load-btn").addEventListener("click", () => this._pickFile(track, row));
        const eqBtn = row.querySelector(".sm-eq-btn");
        eqBtn.addEventListener("click", () => this._toggleEQPopup(track, row));
        this._refreshEQButton(track, eqBtn);
        row.querySelector(".sm-mute-btn").addEventListener("click", e => {
            track.mute = !track.mute;
            e.target.classList.toggle("active", track.mute);
            this._applyGain(track); this._saveState();
        });
        row.querySelector(".sm-solo-btn").addEventListener("click", e => {
            const newSolo = !track.solo;
            for (const t of this.tracks) {
                if (t.id !== track.id && t.solo) {
                    t.solo = false;
                    const btn = this._tracksEl()
                        .querySelector(`[data-id="${t.id}"] .sm-solo-btn`);
                    if (btn) btn.classList.remove("active");
                }
            }
            track.solo = newSolo;
            e.target.classList.toggle("active", track.solo);
            this._applyAllGains(); this._saveState();
        });
        row.querySelector(".sm-remove-btn").addEventListener("click", () => {
            // Close EQ popup if open (with proper listener cleanup)
            if (track.eqPopup) {
                try { track.eqPopup._cleanup?.(); } catch (_) {}
                track.eqPopup.remove();
                track.eqPopup = null;
            }
            this._disposeTrackAudio(track);
            row.remove();
            this.tracks = this.tracks.filter(t => t.id !== track.id);
            this._autoResizeNode();
            this._saveState();
            this._applyAllGains();
        });

        // Gain slider
        const gainSlider = row.querySelector(".sm-gain-slider");
        const gainLabel  = row.querySelector(".sm-gain-val");
        gainSlider.addEventListener("input", e => {
            track.gain = parseFloat(e.target.value);
            gainLabel.textContent = `${Math.round(track.gain * 100)}%`;
            this._applyGain(track); this._saveState();
        });

        // Pan slider
        const panSlider = row.querySelector(".sm-pan-slider");
        const panLabel  = row.querySelector(".sm-pan-val");
        panSlider.addEventListener("input", e => {
            track.pan = parseFloat(e.target.value);
            panLabel.textContent = this._formatPan(track.pan);
            this._applyPan(track); this._saveState();
        });
        // Double-click pan slider to reset to center
        panSlider.addEventListener("dblclick", () => {
            track.pan = 0;
            panSlider.value = 0;
            panLabel.textContent = this._formatPan(0);
            this._applyPan(track); this._saveState();
        });

        // Waveform mouse interactions: click=seek, drag=selection,
        // dblclick=clear, drag near edges=resize, drag inside=move
        const wfEl = row.querySelector(".sm-waveform");
        wfEl.addEventListener("mousedown",   e => this._onWaveMouseDown(e, track, wfEl));
        wfEl.addEventListener("mousemove",   e => this._onWaveMouseMove(e, track, wfEl));
        wfEl.addEventListener("mouseleave",  () => { wfEl.style.cursor = ""; });
        wfEl.addEventListener("dblclick",    () => this._clearSelection());

        // Stash VU canvas reference
        track.vuCanvas = row.querySelector(".sm-vu");

        return row;
    }

    _formatPan(p) {
        if (Math.abs(p) < 0.01) return "C";
        const v = Math.round(Math.abs(p) * 100);
        return p < 0 ? `L${v}` : `R${v}`;
    }

    // -----------------------------------------------------------------------
    // Selection / loop — mouse interactions on waveforms
    // -----------------------------------------------------------------------
    // Translate a mouse X within a waveform element into a time in seconds,
    // using the longest track as reference (the timeline shared by all stems).
    _xToTime(clientX, wfEl) {
        const rect  = wfEl.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return ratio * this._maxDuration();
    }

    // What "zone" the mouse is over relative to the current selection?
    // Returns "left-edge", "right-edge", "inside", or null.
    _selZone(clientX, wfEl) {
        if (!this.selection) return null;
        const rect  = wfEl.getBoundingClientRect();
        const total = this._maxDuration();
        if (total <= 0) return null;
        const xL = rect.left + (this.selection.start / total) * rect.width;
        const xR = rect.left + (this.selection.end   / total) * rect.width;
        const EDGE = 6;
        if (Math.abs(clientX - xL) <= EDGE) return "left-edge";
        if (Math.abs(clientX - xR) <= EDGE) return "right-edge";
        if (clientX > xL && clientX < xR)   return "inside";
        return null;
    }

    _onWaveMouseMove(e, track, wfEl) {
        // Only update cursor when not actively dragging
        if (this._dragSel) return;
        const zone = this._selZone(e.clientX, wfEl);
        if (zone === "left-edge" || zone === "right-edge") {
            wfEl.style.cursor = "ew-resize";
        } else if (zone === "inside") {
            wfEl.style.cursor = "move";
        } else {
            wfEl.style.cursor = "crosshair";
        }
    }

    _onWaveMouseDown(e, track, wfEl) {
        if (e.button !== 0) return;          // left button only
        if (this._maxDuration() <= 0) return;
        e.preventDefault();

        const zone     = this._selZone(e.clientX, wfEl);
        const startSec = this._xToTime(e.clientX, wfEl);
        const startX   = e.clientX;

        // Begin a drag operation. We don't know yet whether this is a click,
        // a new selection, a resize, or a move — that's resolved on mousemove.
        this._dragSel = {
            mode:        zone || "new",   // "left-edge" | "right-edge" | "inside" | "new"
            startX,
            startSec,
            wfEl,
            // Original selection at drag start (for "inside" move)
            origSel: this.selection ? { ...this.selection } : null,
            // For "new" mode: anchor point (where mousedown landed)
            anchorSec: startSec,
            // Set true once we exceed the click-vs-drag threshold
            committed: false,
        };

        const onMove = (ev) => this._onDragMove(ev);
        const onUp   = (ev) => this._onDragUp(ev, onMove, onUp);
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup",   onUp);
    }

    _onDragMove(e) {
        const d = this._dragSel;
        if (!d) return;

        const dx = e.clientX - d.startX;
        const total = this._maxDuration();

        // Click-vs-drag threshold: 5 pixels
        if (!d.committed && Math.abs(dx) < 5) return;
        d.committed = true;

        const curSec = this._xToTime(e.clientX, d.wfEl);

        // Capture current playhead position BEFORE mutating selection,
        // so wrap calculation uses the still-valid old loop range.
        const playheadBefore = this.isPlaying ? this._getCurrentTime() : null;

        if (d.mode === "new") {
            const a = Math.min(d.anchorSec, curSec);
            const b = Math.max(d.anchorSec, curSec);
            this.selection = { start: a, end: b };
        } else if (d.mode === "left-edge") {
            const newStart = Math.max(0,
                Math.min(curSec, d.origSel.end - 0.05));
            this.selection = { start: newStart, end: d.origSel.end };
        } else if (d.mode === "right-edge") {
            const newEnd = Math.min(total,
                Math.max(curSec, d.origSel.start + 0.05));
            this.selection = { start: d.origSel.start, end: newEnd };
        } else if (d.mode === "inside") {
            const len = d.origSel.end - d.origSel.start;
            const offsetSec = curSec - d.startSec;
            let newStart = d.origSel.start + offsetSec;
            newStart = Math.max(0, Math.min(newStart, total - len));
            this.selection = { start: newStart, end: newStart + len };
        }

        // Live update: redraw all waveforms with the new selection overlay
        this._redrawAllWaveforms();

        // Live audio sync — only if we're playing AND looping is engaged.
        // We MUST seek (full restart) rather than just patching loop bounds,
        // because _getCurrentTime relies on offsetSec + startedAt + loopRange,
        // and changing the loop range mid-playback desyncs the calculation.
        // Throttle the restart to 1 per animation frame to avoid audio glitches
        // when the user drags rapidly.
        if (this.isPlaying && this.loopOn && this.selection && playheadBefore != null) {
            let resumeAt = playheadBefore;
            if (resumeAt < this.selection.start || resumeAt > this.selection.end) {
                resumeAt = this.selection.start;
            }
            this._pendingResume = resumeAt;
            if (!this._resumeRafScheduled) {
                this._resumeRafScheduled = true;
                requestAnimationFrame(() => {
                    this._resumeRafScheduled = false;
                    if (this._pendingResume != null && this.isPlaying) {
                        const t = this._pendingResume;
                        this._pendingResume = null;
                        this._seekTo(t);
                    }
                });
            }
        }
    }

    _onDragUp(e, onMove, onUp) {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup",   onUp);
        const d = this._dragSel;
        this._dragSel = null;
        if (!d) return;

        if (!d.committed) {
            // Click without significant drag → seek (selection is preserved)
            this._seekTo(d.startSec);
            return;
        }

        // Drag finished: validate selection
        if (this.selection &&
            (this.selection.end - this.selection.start) < 0.05) {
            this.selection = null;
            this._redrawAllWaveforms();
        }
        this._saveState();
    }

    _clearSelection() {
        if (!this.selection) return;
        this.selection = null;
        this._redrawAllWaveforms();
        this._saveState();
        // If looping on and currently playing, switch to full-loop
        if (this.isPlaying && this.loopOn) this._applyLoopToSources();
    }

    _redrawAllWaveforms() {
        const t = this._getCurrentTime();
        for (const tr of this.tracks) {
            if (tr.canvas && tr.duration > 0) {
                this._drawWaveform(tr, Math.min(t / tr.duration, 1));
            }
        }
    }

    // -----------------------------------------------------------------------
    // Loop control
    // -----------------------------------------------------------------------
    _toggleLoop() {
        this.loopOn = !this.loopOn;
        const btn = this.container.querySelector(".sm-loop");
        if (btn) btn.classList.toggle("active", this.loopOn);
        this._saveState();
        // If currently playing, update the running sources' loop config
        if (this.isPlaying) this._applyLoopToSources();
    }

    // Compute the current loop window (start, end) in seconds.
    // - Loop OFF: returns null
    // - Loop ON  + no selection: full track range
    // - Loop ON  + selection:    selection range
    _loopRange() {
        if (!this.loopOn) return null;
        if (this.selection) {
            return { start: this.selection.start, end: this.selection.end };
        }
        const total = this._maxDuration();
        return { start: 0, end: total };
    }

    // Apply the current loop range to every active BufferSource in real time.
    // Used when the user toggles loop, selects/moves/resizes during playback.
    _applyLoopToSources() {
        const range = this._loopRange();
        for (const t of this.tracks) {
            if (!t.source) continue;
            if (range) {
                t.source.loop      = true;
                t.source.loopStart = Math.max(0, range.start);
                t.source.loopEnd   = Math.min(t.duration, range.end);
            } else {
                t.source.loop = false;
            }
        }
    }

    // -----------------------------------------------------------------------
    // File upload
    // -----------------------------------------------------------------------
    _pickFile(track, row) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".wav,.flac,.mp3,.ogg,.m4a,.aiff,.aif";
        input.addEventListener("change", async () => {
            if (input.files[0]) await this._uploadAndLoad(input.files[0], track, row);
        });
        input.click();
    }

    async _uploadAndLoad(file, track, row) {
        const btn = row.querySelector(".sm-load-btn");
        const setBtn = (txt, busy) => {
            if (!btn) return;
            btn.textContent = txt;
            btn.disabled    = busy;
        };
        setBtn("⏳ Upload…", true);
        try {
            const fd = new FormData();
            fd.append("file", file);
            const resp = await fetch("/stem_mixer/upload", { method: "POST", body: fd });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();
            track.filename = data.filename;
            track.name = data.original_name.replace(/\.[^.]+$/, "");
            const nameEl = row.querySelector(".sm-track-name");
            if (nameEl) nameEl.value = track.name;
            this._saveState();

            setBtn("⏳ Decode…", true);
            await this._loadTrack(track, row);
        } catch (err) {
            console.error("[StemMixer] Upload error:", err);
            alert(`StemMixer upload error: ${err.message}`);
        } finally {
            setBtn("📂 Load", false);
        }
    }

    // -----------------------------------------------------------------------
    // Dispose all audio resources of a track. Used when reloading a file
    // and when removing a track entirely.
    // -----------------------------------------------------------------------
    _disposeTrackAudio(track) {
        // Stop and discard active source if any
        if (track.source) {
            try { track.source.stop(); } catch (_) {}
            try { track.source.disconnect(); } catch (_) {}
            track.source = null;
        }
        // Close EQ popup and remove listeners
        if (track.eqPopup) {
            try { track.eqPopup._cleanup?.(); } catch (_) {}
            track.eqPopup.remove();
            track.eqPopup = null;
        }
        // Disconnect persistent graph nodes
        for (const k of ["pannerNode", "eqLowNode", "eqMidNode", "eqHighNode",
                         "gainNode", "splitter", "analyserL", "analyserR"]) {
            if (track[k]) {
                try { track[k].disconnect(); } catch (_) {}
                track[k] = null;
            }
        }
        // Free the decoded AudioBuffer (lets GC reclaim ~30MB/min stereo)
        track.buffer  = null;
        track.peaks   = null;
        track.vuPeakL = 0;
        track.vuPeakR = 0;
    }

    // -----------------------------------------------------------------------
    // Load — fetch + decodeAudioData + build persistent audio graph
    // -----------------------------------------------------------------------
    async _loadTrack(track, row) {
        if (!track.filename) return;

        // Full cleanup of any previous state for this track —
        // critical for re-loads (replacing the file on an existing track).
        this._disposeTrackAudio(track);

        const fname     = track.filename.split("/").pop();
        const subfolder = track.filename.includes("/")
            ? track.filename.split("/").slice(0, -1).join("/")
            : "stem_mixer";
        const url   = `/view?filename=${encodeURIComponent(fname)}&type=input&subfolder=${encodeURIComponent(subfolder)}`;
        track.url   = url;

        // 1. Fetch the file as ArrayBuffer
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const arrayBuf = await resp.arrayBuffer();

        // 2. Decode to AudioBuffer through a strict serial queue.
        //    Concurrent decodeAudioData() calls hang in Chromium beyond the
        //    2nd-3rd one. Each decode opens an AudioContext, awaits its
        //    close() before chaining the next.
        track.buffer = await this._decodeSerial(arrayBuf);
        track.duration = track.buffer.duration;

        // 3. Build the persistent audio graph for this track:
        //   [bufferSource] → panner → eqLow → eqMid → eqHigh → gain → splitter
        //                                                              ├→ analyserL
        //                                                              └→ analyserR
        //                                                            → masterGain
        this._ensureCtx();
        track.pannerNode = this.ctx.createStereoPanner();
        track.eqLowNode  = this.ctx.createBiquadFilter();
        track.eqMidNode  = this.ctx.createBiquadFilter();
        track.eqHighNode = this.ctx.createBiquadFilter();
        track.gainNode   = this.ctx.createGain();
        track.splitter   = this.ctx.createChannelSplitter(2);
        track.analyserL  = this.ctx.createAnalyser();
        track.analyserR  = this.ctx.createAnalyser();
        track.analyserL.fftSize = 512;
        track.analyserR.fftSize = 512;

        // Configure EQ filter types and frequencies (gains set by _applyEQ)
        track.eqLowNode.type      = "lowshelf";
        track.eqLowNode.frequency.value = 100;
        track.eqMidNode.type      = "peaking";
        track.eqMidNode.frequency.value = 1000;
        track.eqMidNode.Q.value         = 0.7;
        track.eqHighNode.type     = "highshelf";
        track.eqHighNode.frequency.value = 8000;

        track.pannerNode.connect(track.eqLowNode);
        track.eqLowNode.connect(track.eqMidNode);
        track.eqMidNode.connect(track.eqHighNode);
        track.eqHighNode.connect(track.gainNode);
        track.gainNode.connect(track.splitter);
        track.splitter.connect(track.analyserL, 0);
        track.splitter.connect(track.analyserR, 1);
        track.gainNode.connect(this.masterGain);

        this._applyGain(track);
        this._applyPan(track);
        this._applyEQ(track);

        // 4. Build the waveform peaks array directly from the AudioBuffer
        //    (no need for a separate decode pass like before)
        const ch0 = track.buffer.getChannelData(0);
        const N   = 3000;
        const step = Math.max(1, Math.floor(ch0.length / N));
        const peaks = new Float32Array(Math.ceil(ch0.length / step));
        for (let i = 0, j = 0; i < ch0.length; i += step, j++) {
            peaks[j] = Math.abs(ch0[i]);
        }
        track.peaks = peaks;

        // 5. Canvas waveform — wait one frame so wfEl has layout dimensions
        const wfEl = row.querySelector(".sm-waveform");
        wfEl.innerHTML = "";
        track.wfEl = wfEl;

        const wfH    = this._calcWfHeight();
        const canvas = document.createElement("canvas");
        canvas.style.cssText = "width:100%;height:100%;display:block;";
        wfEl.appendChild(canvas);
        track.canvas = canvas;

        this.container.style.setProperty("--sm-wf-h", `${wfH}px`);
        this._lastWfH = wfH;

        await new Promise(r => requestAnimationFrame(r));
        this._drawWaveform(track, 0);

        // Update total time display (the new track may extend the total)
        this._timeEl().textContent = this._formatTimeWithTotal(this._getCurrentTime());

        // 6. Join playback if already running
        if (this.isPlaying) this._startTrackSource(track);
    }

    // Sequential decode helper — chains every decode through a single promise
    // and closes the temporary AudioContext between each.
    _decodeSerial(arrayBuffer) {
        const result = this._decodeQueue.then(async () => {
            const ctx = new AudioContext();
            try {
                // decodeAudioData detaches arrayBuffer in some browsers,
                // so we copy it to keep the original usable elsewhere if needed.
                return await ctx.decodeAudioData(arrayBuffer.slice(0));
            } finally {
                try { await ctx.close(); } catch (_) {}
            }
        });
        // Store a non-throwing version so a single failed decode doesn't
        // poison the entire queue
        this._decodeQueue = result.catch(() => {});
        return result;
    }

    // Draw waveform on canvas — peaks is Float32Array of abs amplitudes, progress 0-1
    _drawWaveform(track, progress) {
        const canvas = track.canvas;
        if (!canvas) return;
        const W = canvas.offsetWidth  || track.wfEl?.offsetWidth  || 400;
        const H = canvas.offsetHeight || track.wfEl?.offsetHeight || 64;
        canvas.width  = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, W, H);
        const mid    = H / 2;
        const peaks  = track.peaks;
        const progX  = Math.floor(progress * W);

        if (!peaks || peaks.length === 0) {
            ctx.strokeStyle = "#4a9eff44";
            ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();
        } else {
            const pLen = peaks.length;
            for (let x = 0; x < W; x++) {
                const amp = peaks[Math.floor((x / W) * pLen)] * mid;
                ctx.fillStyle = x < progX ? "#1a6abf" : "#4a9eff";
                ctx.fillRect(x, mid - amp, 1, Math.max(amp * 2, 1));
            }
        }

        // Selection overlay — uses the global timeline (max duration), not
        // this track's individual duration, so all stems show the same span.
        if (this.selection) {
            const total = this._maxDuration();
            if (total > 0) {
                const xL = Math.floor((this.selection.start / total) * W);
                const xR = Math.ceil ((this.selection.end   / total) * W);
                ctx.fillStyle = "rgba(74, 158, 255, 0.18)";
                ctx.fillRect(xL, 0, xR - xL, H);
                ctx.strokeStyle = "rgba(74, 158, 255, 0.85)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(xL + 0.5, 0); ctx.lineTo(xL + 0.5, H);
                ctx.moveTo(xR - 0.5, 0); ctx.lineTo(xR - 0.5, H);
                ctx.stroke();
            }
        }

        // Cursor
        ctx.strokeStyle = "#ffffff99";
        ctx.lineWidth   = 1;
        ctx.beginPath(); ctx.moveTo(progX, 0); ctx.lineTo(progX, H); ctx.stroke();
    }

    // ---------------------------------------------------------------------
    // VU meter — stereo, post-fader, dB scale with peak hold
    // ---------------------------------------------------------------------
    _drawVU(track) {
        this._paintVU(track.vuCanvas, track.analyserL, track.analyserR, track,
                      "vuPeakL", "vuPeakR");
    }

    _drawMasterVU() {
        this._paintVU(this._masterVuCanvas, this.masterAnalyserL,
                      this.masterAnalyserR, this, "masterVuPeakL", "masterVuPeakR");
    }

    // Generic stereo VU painter. peakHolder is any object that stores the
    // decaying peak values under peakLKey / peakRKey.
    _paintVU(cv, analyserL, analyserR, peakHolder, peakLKey, peakRKey) {
        if (!cv) return;

        const W = cv.offsetWidth  || 14;
        const H = cv.offsetHeight || 64;
        if (cv.width !== W || cv.height !== H) {
            cv.width = W; cv.height = H;
        }
        const ctx = cv.getContext("2d");
        ctx.clearRect(0, 0, W, H);

        // Read RMS amplitude per channel
        let rmsL = 0, rmsR = 0;
        if (analyserL && analyserR && this.isPlaying) {
            const buf = new Float32Array(analyserL.fftSize);
            analyserL.getFloatTimeDomainData(buf);
            let s = 0;
            for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
            rmsL = Math.sqrt(s / buf.length);

            analyserR.getFloatTimeDomainData(buf);
            s = 0;
            for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
            rmsR = Math.sqrt(s / buf.length);
        }

        // Peak hold with decay
        const DECAY = 0.985;
        peakHolder[peakLKey] = Math.max(rmsL, peakHolder[peakLKey] * DECAY);
        peakHolder[peakRKey] = Math.max(rmsR, peakHolder[peakRKey] * DECAY);

        const ampToY = (amp) => {
            if (amp <= 0) return H;
            const db   = 20 * Math.log10(amp);
            const norm = Math.max(0, Math.min(1, (db + 60) / 60));
            return H - Math.floor(norm * H);
        };

        const halfW = Math.floor(W / 2) - 1;
        const yL    = ampToY(rmsL);
        const yR    = ampToY(rmsR);

        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0.0,  "#ff3b30");
        grad.addColorStop(0.15, "#ff9f0a");
        grad.addColorStop(0.30, "#ffd60a");
        grad.addColorStop(0.45, "#34c759");
        grad.addColorStop(1.0,  "#0a5d2e");

        ctx.fillStyle = grad;
        ctx.fillRect(0, yL, halfW, H - yL);
        ctx.fillRect(halfW + 2, yR, halfW, H - yR);

        const yPL = ampToY(peakHolder[peakLKey]);
        const yPR = ampToY(peakHolder[peakRKey]);
        ctx.fillStyle = "#fff";
        if (yPL < H) ctx.fillRect(0,         Math.max(0, yPL - 1), halfW, 1);
        if (yPR < H) ctx.fillRect(halfW + 2, Math.max(0, yPR - 1), halfW, 1);
    }

    // -----------------------------------------------------------------------
    // Web Audio transport — sample-accurate sync via scheduled BufferSources
    // -----------------------------------------------------------------------
    _getCurrentTime() {
        if (!this.isPlaying || !this.ctx) return this.offsetSec;
        const elapsed = this.ctx.currentTime - this.startedAt;
        const linear  = this.offsetSec + elapsed;

        // Without active loop, time advances linearly until track end.
        const range = this._loopRange();
        if (!range || range.end <= range.start) return linear;

        // With loop: as long as the playhead hasn't reached the loop end yet,
        // it advances linearly (allows pre-roll before a selection start).
        if (linear < range.end) return linear;

        // Once we cross loopEnd, the buffer source has been wrapping inside
        // [loopStart, loopEnd]. We compute virtual position by wrapping the
        // distance past loopStart modulo the loop length.
        const loopLen = range.end - range.start;
        const past    = linear - range.start;
        return range.start + (past % loopLen);
    }

    _maxDuration() {
        return Math.max(0, ...this.tracks.map(t => t.duration || 0));
    }

    _updateCursors(currentTime) {
        for (const t of this.tracks) {
            if (t.canvas && t.duration > 0) {
                this._drawWaveform(t, Math.min(currentTime / t.duration, 1));
            }
        }
    }

    // Start one track's source at the current playhead position.
    // The source is scheduled at ctx.currentTime so all tracks started
    // in the same call share the exact same start moment.
    _startTrackSource(track, scheduledStartTime = null) {
        if (!track.buffer || !track.pannerNode || !this.ctx) return;
        // Stop any leftover source first (safety)
        if (track.source) {
            try { track.source.stop(); } catch (_) {}
            try { track.source.disconnect(); } catch (_) {}
            track.source = null;
        }

        const src = this.ctx.createBufferSource();
        src.buffer = track.buffer;
        src.connect(track.pannerNode);

        // Native looping — Web Audio handles the wrap at sample level
        const range = this._loopRange();
        if (range && range.end > range.start) {
            src.loop      = true;
            src.loopStart = Math.max(0, range.start);
            src.loopEnd   = Math.min(track.buffer.duration, range.end);
        }

        const offset = Math.min(this.offsetSec, track.buffer.duration);
        const when   = scheduledStartTime ?? this.ctx.currentTime;
        src.start(when, offset);
        track.source = src;

        src.onended = () => {
            // Native loops don't fire onended unless we explicitly call stop().
            // If loop is on, this is either the user stopping or a bug — ignore.
            if (!this.isPlaying || this.loopOn) return;
            const elapsed = this.ctx.currentTime - this.startedAt;
            const t = this.offsetSec + elapsed;
            const allDone = this.tracks.every(
                tr => !tr.buffer || t >= (tr.duration - 0.05)
            );
            if (allDone) this._stop();
        };
    }

    _startAllSources() {
        if (!this.ctx) return;
        if (this.ctx.state === "suspended") this.ctx.resume();

        // If loop ON with selection but the playhead is outside, snap to start
        const range = this._loopRange();
        if (range && (this.offsetSec < range.start || this.offsetSec >= range.end)) {
            this.offsetSec = range.start;
        }

        // Schedule everyone at the SAME ctx time → sample-accurate sync.
        const scheduledStart = this.ctx.currentTime + 0.05;
        this.startedAt = scheduledStart;

        for (const t of this.tracks) {
            if (!t.buffer) continue;
            this._startTrackSource(t, scheduledStart);
        }
        this._startRAF();
    }

    _pauseAllSources() {
        // Capture position before stopping
        this.offsetSec = this._getCurrentTime();
        for (const t of this.tracks) {
            if (t.source) {
                try { t.source.stop(); } catch (_) {}
                try { t.source.disconnect(); } catch (_) {}
                t.source = null;
            }
        }
        this._stopRAF();
    }

    _stopTrack(track) {
        // Used by _disposeTrackAudio (file replacement / removal)
        if (track.source) {
            try { track.source.stop(); } catch (_) {}
            try { track.source.disconnect(); } catch (_) {}
            track.source = null;
        }
    }

    _startRAF() {
        this._stopRAF();
        const tick = () => {
            if (!this.isPlaying) return;
            const t = this._getCurrentTime();
            this._timeEl().textContent = this._formatTimeWithTotal(t);
            this._updateCursors(t);
            for (const tr of this.tracks) this._drawVU(tr);
            this._drawMasterVU();
            this._rafId = requestAnimationFrame(tick);
        };
        this._rafId = requestAnimationFrame(tick);
    }

    _stopRAF() {
        if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = null; }
        for (const t of this.tracks) {
            t.vuPeakL = 0;
            t.vuPeakR = 0;
            this._drawVU(t);
        }
        this.masterVuPeakL = 0;
        this.masterVuPeakR = 0;
        this._drawMasterVU();
    }

    _formatTimeWithTotal(currentSec) {
        const total = this._maxDuration();
        return `${formatTime(currentSec)} / ${formatTime(total)}`;
    }

    async _togglePlay() {
        this._ensureCtx();
        if (!this.tracks.some(t => t.buffer)) return;
        if (this.isPlaying) {
            this.isPlaying = false;
            this._playBtn().textContent = "▶";
            this._pauseAllSources();
        } else {
            this.isPlaying = true;
            this._playBtn().textContent = "⏸";
            this._startAllSources();
        }
    }

    _stop() {
        this.isPlaying = false;
        this._playBtn().textContent = "▶";
        this._pauseAllSources();
        this.offsetSec = 0;
        this._timeEl().textContent = this._formatTimeWithTotal(0);
        this._updateCursors(0);
    }

    _rewind() { this._seekTo(0); }

    _seekTo(sec) {
        const wasPlaying = this.isPlaying;
        if (wasPlaying) this._pauseAllSources();
        this.offsetSec = Math.max(0, Math.min(sec, this._maxDuration()));
        this._updateCursors(this.offsetSec);
        this._timeEl().textContent = this._formatTimeWithTotal(this.offsetSec);
        if (wasPlaying) this._startAllSources();
    }

    // -----------------------------------------------------------------------
    // Gain / pan / solo
    // -----------------------------------------------------------------------
    _applyGain(track) {
        if (!track.gainNode) return;
        const anySolo  = this.tracks.some(t => t.solo);
        const silenced = track.mute || (anySolo && !track.solo);
        track.gainNode.gain.value = silenced ? 0 : track.gain;
    }
    _applyAllGains() { for (const t of this.tracks) this._applyGain(t); }

    _applyPan(track) {
        if (!track.pannerNode) return;
        track.pannerNode.pan.value = Math.max(-1, Math.min(1, track.pan));
    }

    _applyMasterVolume() {
        if (!this.masterGain) return;
        this.masterGain.gain.value = this.masterVolume;
    }

    // -----------------------------------------------------------------------
    // EQ — apply gains to the BiquadFilter nodes
    // -----------------------------------------------------------------------
    _applyEQ(track) {
        if (!track.eqLowNode) return;
        track.eqLowNode.gain.value  = track.eq.low.on  ? track.eq.low.gain  : 0;
        track.eqMidNode.gain.value  = track.eq.mid.on  ? track.eq.mid.gain  : 0;
        track.eqHighNode.gain.value = track.eq.high.on ? track.eq.high.gain : 0;
    }

    // Returns true if EQ is "active" (any band has a non-zero gain AND is on)
    _isEQActive(track) {
        const e = track.eq;
        return (e.low.on  && Math.abs(e.low.gain)  > 0.01) ||
               (e.mid.on  && Math.abs(e.mid.gain)  > 0.01) ||
               (e.high.on && Math.abs(e.high.gain) > 0.01);
    }

    // Update the EQ button color in the track header
    _refreshEQButton(track, btn = null) {
        if (!btn) {
            const row = this._tracksEl().querySelector(`[data-id="${track.id}"]`);
            btn = row?.querySelector(".sm-eq-btn");
        }
        if (!btn) return;
        const open   = !!track.eqPopup;
        const active = this._isEQActive(track);
        btn.classList.toggle("active",      open);
        btn.classList.toggle("eq-engaged", !open && active);
    }

    // -----------------------------------------------------------------------
    // EQ popup — floating, draggable, one per track
    // -----------------------------------------------------------------------
    _toggleEQPopup(track, row) {
        if (track.eqPopup) {
            this._closeEQPopup(track);
        } else {
            this._openEQPopup(track, row);
        }
    }

    _closeEQPopup(track) {
        if (!track.eqPopup) return;
        // Save final position
        const r = track.eqPopup.getBoundingClientRect();
        track.eqWindow = { x: r.left, y: r.top };
        try { track.eqPopup._cleanup?.(); } catch (_) {}
        track.eqPopup.remove();
        track.eqPopup = null;
        this._refreshEQButton(track);
        this._saveState();
    }

    _openEQPopup(track, row) {
        const popup = document.createElement("div");
        popup.className = "sm-eq-popup";
        popup.innerHTML = `
            <div class="sm-eq-titlebar">
                <span class="sm-eq-title">EQ — ${esc(track.name)}</span>
                <div class="sm-eq-titleactions">
                    <button class="sm-eq-reset" title="Reset all bands to 0 dB">Reset</button>
                    <button class="sm-eq-close" title="Close">✕</button>
                </div>
            </div>
            <div class="sm-eq-body">
                <canvas class="sm-eq-graph"></canvas>
                <div class="sm-eq-bands">
                    ${["low", "mid", "high"].map(band => {
                        const cfg  = track.eq[band];
                        const freq = band === "low" ? "100 Hz"
                                   : band === "mid" ? "1 kHz" : "8 kHz";
                        const labl = band === "low" ? "LOW"
                                   : band === "mid" ? "MID" : "HIGH";
                        return `
                        <div class="sm-eq-band" data-band="${band}">
                            <div class="sm-eq-bandlbl">${labl}</div>
                            <div class="sm-eq-dbval">${cfg.gain.toFixed(1)} dB</div>
                            <input class="sm-eq-slider" type="range" orient="vertical"
                                   min="-18" max="18" step="0.1" value="${cfg.gain}" />
                            <button class="sm-eq-onoff ${cfg.on ? 'on' : 'off'}">
                                ${cfg.on ? "ON" : "OFF"}
                            </button>
                            <div class="sm-eq-freqlbl">${freq}</div>
                        </div>`;
                    }).join("")}
                </div>
            </div>
        `;

        // Initial position — use saved one or anchor near the row
        let x, y;
        if (track.eqWindow && typeof track.eqWindow.x === "number") {
            x = Math.max(0, Math.min(track.eqWindow.x, window.innerWidth  - 100));
            y = Math.max(0, Math.min(track.eqWindow.y, window.innerHeight - 50));
        } else {
            const r = row.getBoundingClientRect();
            x = Math.min(r.right + 10, window.innerWidth - 500);
            y = Math.max(20,           r.top);
        }
        popup.style.left = `${x}px`;
        popup.style.top  = `${y}px`;

        document.body.appendChild(popup);
        track.eqPopup = popup;

        // --- Drag the popup by its titlebar ---
        const titlebar = popup.querySelector(".sm-eq-titlebar");
        let dragOff = null;
        titlebar.addEventListener("mousedown", e => {
            if (e.target.closest(".sm-eq-close")) return;
            if (e.target.closest(".sm-eq-reset")) return;
            const r = popup.getBoundingClientRect();
            dragOff = { dx: e.clientX - r.left, dy: e.clientY - r.top };
            e.preventDefault();
        });
        const onMove = e => {
            if (!dragOff) return;
            const x = Math.max(0, Math.min(e.clientX - dragOff.dx,
                                            window.innerWidth  - 100));
            const y = Math.max(0, Math.min(e.clientY - dragOff.dy,
                                            window.innerHeight - 30));
            popup.style.left = `${x}px`;
            popup.style.top  = `${y}px`;
        };
        const onUp = () => {
            if (dragOff) {
                dragOff = null;
                const r = popup.getBoundingClientRect();
                track.eqWindow = { x: r.left, y: r.top };
                this._saveState();
            }
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup",   onUp);
        // Stash so we can remove these on close
        popup._cleanup = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup",   onUp);
        };

        // --- Close button ---
        popup.querySelector(".sm-eq-close").addEventListener("click", () => {
            this._closeEQPopup(track);
        });

        // --- Reset button — bring all bands back to 0 dB and turn them ON ---
        popup.querySelector(".sm-eq-reset").addEventListener("click", () => {
            for (const band of ["low", "mid", "high"]) {
                track.eq[band].gain = 0;
                track.eq[band].on   = true;
                // Update sliders + labels + ON buttons in the popup
                const bandEl = popup.querySelector(`.sm-eq-band[data-band="${band}"]`);
                if (bandEl) {
                    bandEl.querySelector(".sm-eq-slider").value = 0;
                    bandEl.querySelector(".sm-eq-dbval").textContent = "0.0 dB";
                    const onBtn = bandEl.querySelector(".sm-eq-onoff");
                    onBtn.classList.add("on");
                    onBtn.classList.remove("off");
                    onBtn.textContent = "ON";
                }
            }
            this._applyEQ(track);
            this._drawEQResponse(track);
            this._refreshEQButton(track);
            this._saveState();
        });

        // --- Sliders + ON/OFF per band ---
        for (const bandEl of popup.querySelectorAll(".sm-eq-band")) {
            const band = bandEl.dataset.band;
            const slider = bandEl.querySelector(".sm-eq-slider");
            const dbVal  = bandEl.querySelector(".sm-eq-dbval");
            const onBtn  = bandEl.querySelector(".sm-eq-onoff");

            slider.addEventListener("input", e => {
                track.eq[band].gain = parseFloat(e.target.value);
                dbVal.textContent = `${track.eq[band].gain.toFixed(1)} dB`;
                this._applyEQ(track);
                this._drawEQResponse(track);
                this._refreshEQButton(track);
                this._saveState();
            });
            // Double-click to reset to 0
            slider.addEventListener("dblclick", () => {
                track.eq[band].gain = 0;
                slider.value = 0;
                dbVal.textContent = "0.0 dB";
                this._applyEQ(track);
                this._drawEQResponse(track);
                this._refreshEQButton(track);
                this._saveState();
            });

            onBtn.addEventListener("click", () => {
                track.eq[band].on = !track.eq[band].on;
                onBtn.classList.toggle("on",  track.eq[band].on);
                onBtn.classList.toggle("off", !track.eq[band].on);
                onBtn.textContent = track.eq[band].on ? "ON" : "OFF";
                this._applyEQ(track);
                this._drawEQResponse(track);
                this._refreshEQButton(track);
                this._saveState();
            });
        }

        // --- Initial graph draw (need a frame for canvas dimensions) ---
        requestAnimationFrame(() => this._drawEQResponse(track));

        this._refreshEQButton(track);
    }

    // Draw the EQ frequency response curve (20 Hz → 20 kHz log, ±18 dB)
    _drawEQResponse(track) {
        if (!track.eqPopup) return;
        const cv = track.eqPopup.querySelector(".sm-eq-graph");
        if (!cv) return;
        const W = cv.offsetWidth || 220;
        const H = cv.offsetHeight || 160;
        cv.width  = W;
        cv.height = H;
        const ctx = cv.getContext("2d");
        ctx.clearRect(0, 0, W, H);

        // Background grid
        ctx.fillStyle = "#1a1a1a";
        ctx.fillRect(0, 0, W, H);

        // 0 dB centerline + ±6 ±12 dB lines
        ctx.strokeStyle = "#333";
        ctx.lineWidth = 1;
        for (const db of [-12, -6, 0, 6, 12]) {
            const y = H/2 - (db / 18) * (H/2);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(W, y);
            ctx.stroke();
        }
        // Highlight the 0 dB line
        ctx.strokeStyle = "#555";
        ctx.beginPath();
        ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();

        // Frequency grid (100 Hz, 1 kHz, 10 kHz)
        const fMin = 20, fMax = 20000;
        const xForFreq = f => (Math.log10(f) - Math.log10(fMin)) /
                              (Math.log10(fMax) - Math.log10(fMin)) * W;
        ctx.strokeStyle = "#333";
        for (const f of [100, 1000, 10000]) {
            const x = xForFreq(f);
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
        }

        // Compute combined response
        // For each band, compute a simplified shelf/peak response
        const e = track.eq;
        const bands = [
            { type: "lowshelf",  f: 100,  gain: e.low.on  ? e.low.gain  : 0 },
            { type: "peak",      f: 1000, gain: e.mid.on  ? e.mid.gain  : 0, q: 0.7 },
            { type: "highshelf", f: 8000, gain: e.high.on ? e.high.gain : 0 },
        ];

        ctx.strokeStyle = this._isEQActive(track) ? "#ff9f0a" : "#4a9eff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let x = 0; x <= W; x++) {
            const f = Math.pow(10, Math.log10(fMin) +
                                    (x / W) * (Math.log10(fMax) - Math.log10(fMin)));
            let dbTotal = 0;
            for (const b of bands) {
                if (b.gain === 0) continue;
                if (b.type === "lowshelf") {
                    // Smooth shelf transition centered on b.f
                    const k = 1 / (1 + Math.pow(f / b.f, 2));
                    dbTotal += b.gain * k;
                } else if (b.type === "highshelf") {
                    const k = 1 / (1 + Math.pow(b.f / f, 2));
                    dbTotal += b.gain * k;
                } else { // peak
                    const ratio = Math.log2(f / b.f);
                    const bw = 1 / (b.q || 0.7);   // bandwidth in octaves (~)
                    const k = Math.exp(-Math.pow(ratio / bw, 2) * 2);
                    dbTotal += b.gain * k;
                }
            }
            const y = H/2 - (dbTotal / 18) * (H/2);
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // Label corners
        ctx.fillStyle = "#666";
        ctx.font = "10px sans-serif";
        ctx.fillText("+18", 4, 12);
        ctx.fillText("0",   4, H/2 + 4);
        ctx.fillText("-18", 4, H - 4);
        ctx.fillText("20Hz", 4, H - 14);
        ctx.fillText("20kHz", W - 38, H - 14);
    }

    // -----------------------------------------------------------------------
    // State JSON — accepts both legacy array format and new object format.
    //   Legacy:  [ {track}, {track}, ... ]
    //   Current: { "tracks": [...], "masterVolume": 1.0 }
    // -----------------------------------------------------------------------
    _saveState() {
        const state = {
            tracks: this.tracks.map(t => ({
                id: t.id, name: t.name, filename: t.filename,
                gain: t.gain, pan: t.pan, mute: t.mute, solo: t.solo,
                eq: {
                    low:  { gain: t.eq.low.gain,  on: t.eq.low.on  },
                    mid:  { gain: t.eq.mid.gain,  on: t.eq.mid.on  },
                    high: { gain: t.eq.high.gain, on: t.eq.high.on },
                },
                eqWindow: t.eqWindow ?? null,
            })),
            masterVolume: this.masterVolume,
            loopOn:       this.loopOn,
            selection:    this.selection,
        };
        this.stateWidget.value = JSON.stringify(state);
        this.node.setDirtyCanvas(true, false);
    }

    async _restoreState() {
        // Wipe any previously-built tracks (handles double-restore safety)
        for (const t of [...this.tracks]) {
            this._disposeTrackAudio(t);
            const row = this._tracksEl().querySelector(`[data-id="${t.id}"]`);
            if (row) row.remove();
        }
        this.tracks = [];

        let parsed = null;
        try { parsed = JSON.parse(this.stateWidget.value || "{}"); } catch { parsed = null; }

        let trackList = [];
        if (Array.isArray(parsed)) {
            trackList = parsed;
        } else if (parsed && typeof parsed === "object") {
            trackList = Array.isArray(parsed.tracks) ? parsed.tracks : [];
            if (typeof parsed.masterVolume === "number") {
                this.masterVolume = parsed.masterVolume;
                if (this._masterSlider) this._masterSlider.value = this.masterVolume;
                if (this._masterLabel)  {
                    this._masterLabel.textContent = `${Math.round(this.masterVolume * 100)}%`;
                }
            }
            if (parsed.loopOn === true) {
                this.loopOn = true;
                const btn = this.container.querySelector(".sm-loop");
                if (btn) btn.classList.add("active");
            }
            if (parsed.selection &&
                typeof parsed.selection.start === "number" &&
                typeof parsed.selection.end === "number" &&
                parsed.selection.end > parsed.selection.start) {
                this.selection = {
                    start: parsed.selection.start,
                    end:   parsed.selection.end,
                };
            }
        }
        for (const t of trackList) await this._addTrack(t);
        if (this.selection) this._redrawAllWaveforms();
    }

    // -----------------------------------------------------------------------
    // Auto-resize node — fits content, waveform height adapts to result
    // -----------------------------------------------------------------------
    _autoResizeNode() {
        const wfH = this._calcWfHeight();
        const trackH = TRACK_FIXED_H + wfH;
        const h = HEADER_H + this.tracks.length * trackH + PADDING_H;
        this.node.size = [this.node.size[0], Math.max(h, 80)];
        this.node.setDirtyCanvas(true, true);
        // Apply height immediately after resize
        this._lastWfH = null;   // force reapply
        this._applyWfHeight();
        // Refresh total time display (max duration may have changed)
        if (!this.isPlaying) {
            this._timeEl().textContent = this._formatTimeWithTotal(this.offsetSec);
        }
    }
}

// ---------------------------------------------------------------------------
// ComfyUI extension
// ---------------------------------------------------------------------------
app.registerExtension({
    name: "comfy.stem_mixer",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== "AudioStemMixer") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = async function () {
            onNodeCreated?.apply(this, arguments);

            // Find the hidden state widget — it MUST keep its default
            // serialize behaviour so ComfyUI saves/loads it with the workflow.
            const stateWidget = this.widgets?.find(w => w.name === "state");

            if (stateWidget) {
                // Shrink the widget's logical footprint so it takes no space
                stateWidget.computeSize = () => [0, -4];

                // Force-hide the underlying DOM element on every redraw.
                // ComfyUI sometimes recreates the textarea when the node
                // scrolls in/out of view, so a one-time hide is not enough.
                const origDraw = this.onDrawForeground;
                this.onDrawForeground = function (ctx) {
                    if (origDraw) origDraw.apply(this, arguments);
                    const el = stateWidget.inputEl;
                    if (el) {
                        if (el.style.display !== "none") el.style.display = "none";
                        const parent = el.parentElement;
                        if (parent && parent.style.display !== "none") {
                            parent.style.display = "none";
                        }
                    }
                };
            }

            // Build the UI. The constructor schedules a delayed default
            // restore (100ms). loadedGraphNode below will pre-empt it if
            // a saved workflow is being loaded.
            const ui = new StemMixerUI(this, stateWidget ?? { value: "{}" });
            this._stemMixerUI = ui;

            this.addDOMWidget("stem_mixer_ui", "div", ui.container, {
                getValue:    () => stateWidget?.value ?? "{}",
                setValue:    () => {},
                computeSize: (w) => [w, this.size[1] - 40],
            });

            this.size = [520, 80];
            this.setDirtyCanvas(true, true);
        };
    },

    // Called once ComfyUI has finished deserializing a node from a saved
    // workflow. The state widget value is now populated.
    async loadedGraphNode(node) {
        if (node.comfyClass !== "AudioStemMixer") return;
        const ui = node._stemMixerUI;
        if (!ui) return;

        // Cancel the default-config fallback timer — we have real data
        if (ui._restoreTimer) {
            clearTimeout(ui._restoreTimer);
            ui._restoreTimer = null;
        }
        if (ui._restored) return;
        ui._restored = true;

        await ui._restoreState();
    },
});
