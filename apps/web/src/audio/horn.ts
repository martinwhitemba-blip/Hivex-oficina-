/** Claxon del coche con WebAudio (sin archivos de audio). */
let ctx: AudioContext | null = null;

export function honk() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    gain.gain.setValueAtTime(0.18, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    gain.gain.setValueAtTime(0.0001, now + 0.2);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.22);
    gain.gain.setValueAtTime(0.18, now + 0.42);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1800;
    gain.connect(filter).connect(ctx.destination);
    for (const f of [415, 523]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(gain);
      o.start(now);
      o.stop(now + 0.55);
    }
  } catch { /* sin audio disponible */ }
}
