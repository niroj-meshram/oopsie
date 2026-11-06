// Offscreen page that rings the end-of-focus alarm. The service worker creates
// it when a focus session ends; Chrome closes it once the sound has finished.
(async () => {
  const ctx = new AudioContext();
  await ctx.resume();
  // Three rounds of a rising two-note chime, about 4 seconds in total.
  const notes = [880, 1175];
  let t = ctx.currentTime + 0.05;
  for (let round = 0; round < 3; round++) {
    for (const freq of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.5);
      t += 0.22;
    }
    t += 0.9;
  }
})();
