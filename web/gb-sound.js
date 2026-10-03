// Glassboard SHARED move sounds — one wooden-board sound engine used by BOTH
// Play-AI and human games, so a move sounds the same whoever you're playing.
// Synthesized (no audio files) so it works offline. See gb-assist-ui.js for why
// shared modules exist: parity by construction, not by hand-porting.
(function (global) {
  let soundOn = (() => { try { return localStorage.getItem("gb_sound") === "1"; } catch { return false; } })();
  let audioCtx = null;
  // Physical sounds, synthesized (offline, no files): a wooden piece on a wooden
  // board = a bright contact CLICK (band-passed noise) + the piece's hollow BODY
  // (a falling sine) + the board's low THUMP. `intensity` (0..1) scales loudness
  // and fullness — a hard, fast drop sounds heavier than a gentle placement.
  let noiseBuf = null, sndBus = null;
  function sndCtx() {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    if (!noiseBuf) {
      noiseBuf = audioCtx.createBuffer(1, Math.floor(audioCtx.sampleRate * 0.25), audioCtx.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (!sndBus) { // gentle glue so stacked taps never clip
      sndBus = audioCtx.createDynamicsCompressor();
      sndBus.threshold.value = -14; sndBus.ratio.value = 4; sndBus.connect(audioCtx.destination);
    }
    return audioCtx;
  }
  function env(ctx, at, peak, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(sndBus);
    return g;
  }
  function noiseBurst(ctx, at, type, freq, q, peak, attack, decay) {
    const n = ctx.createBufferSource(); n.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    n.connect(f); f.connect(env(ctx, at, peak, attack, decay));
    n.start(at, Math.random() * 0.15); n.stop(at + attack + decay + 0.02);
  }
  function woodTok(ctx, at, intensity, pitch) {
    const k = Math.max(0.15, Math.min(1, intensity)), p = pitch * (0.96 + Math.random() * 0.08); // no two taps identical
    noiseBurst(ctx, at, "bandpass", 2600 * p, 1.1, 0.55 * k, 0.001, 0.018);       // contact click
    noiseBurst(ctx, at, "bandpass", 850 * p, 5, 0.3 * k, 0.002, 0.05);            // hollow knock
    const o = ctx.createOscillator(); o.type = "sine";                              // piece body
    o.frequency.setValueAtTime(230 * p, at); o.frequency.exponentialRampToValueAtTime(150 * p, at + 0.07);
    o.connect(env(ctx, at, 0.32 * k, 0.003, 0.08)); o.start(at); o.stop(at + 0.1);
    const th = ctx.createOscillator(); th.type = "sine"; th.frequency.value = 85;    // board thump (heavier drops)
    th.connect(env(ctx, at, 0.22 * k * k, 0.004, 0.13)); th.start(at); th.stop(at + 0.15);
  }
  // kind: "lift" | "move" | "capture" | "castle". delayMs lets the sound land WITH
  // the piece's animation instead of when the finger lifts.
  function playSound(kind, intensity, delayMs) {
      if (!soundOn) return;
    try {
      const ctx = sndCtx(), at = ctx.currentTime + Math.max(0, delayMs || 0) / 1000 + 0.005;
      const k = intensity == null ? 0.7 : intensity;
      if (kind === "lift") {          // a soft brush as the piece leaves the felt
        noiseBurst(ctx, at, "highpass", 2800, 0.7, 0.05, 0.006, 0.045);
        woodTok(ctx, at, 0.12, 1.35);
      } else if (kind === "capture") { // the two pieces knock, then the capturer lands
        woodTok(ctx, at, Math.min(1, k * 0.85), 1.3);
        woodTok(ctx, at + 0.045, Math.min(1, k + 0.1), 1);
      } else if (kind === "castle") {  // king, then rook
        woodTok(ctx, at, k, 1);
        woodTok(ctx, at + 0.11, k * 0.8, 1.06);
      } else {
        woodTok(ctx, at, k, 1);
      }
    } catch {}
  }

  function toggleSound() {
    soundOn = !soundOn;
    try { localStorage.setItem("gb_sound", soundOn ? "1" : "0"); } catch {}
    if (soundOn) playSound("move");
    return soundOn;
  }
  global.GBSound = {
    play: playSound,
    toggle: toggleSound,
    isOn: () => soundOn,
    set: (v) => { soundOn = !!v; try { localStorage.setItem("gb_sound", soundOn ? "1" : "0"); } catch {} },
  };
})(window);
