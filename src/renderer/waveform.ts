type WaveformMode = 'idle' | 'live' | 'processing';

const WAVE_BAR_COUNT = 12;
const WAVEFORM_GAIN = 2;

export function createWaveformController(waveformEl: HTMLDivElement | null) {
  const waveformBars: HTMLSpanElement[] = [];
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let waveformSource: MediaStreamAudioSourceNode | null = null;
  let waveformData: Uint8Array | null = null;
  let waveformRaf: number | null = null;
  let waveformMode: WaveformMode = 'idle';

  function ensureWaveformBars() {
    if (!waveformEl || waveformBars.length) return;
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < WAVE_BAR_COUNT; i += 1) {
      const bar = document.createElement('span');
      bar.className = 'bar';
      fragment.appendChild(bar);
      waveformBars.push(bar);
    }
    waveformEl.appendChild(fragment);
  }

  function renderIdleWaveform() {
    ensureWaveformBars();
    waveformBars.forEach((bar, index) => {
      // Minimal, subtle pattern for idle state
      const variation = (index % 3) * 5;
      const base = 30 + variation;
      bar.style.height = `${base}%`;
      bar.style.opacity = '0.4';
    });
  }

  function detachWaveformSource() {
    waveformSource?.disconnect();
    waveformSource = null;
    analyser = null;
    waveformData = null;
  }

  function setMode(mode: WaveformMode) {
    waveformMode = mode;
    if (!waveformEl) {
      if (waveformRaf) {
        cancelAnimationFrame(waveformRaf);
        waveformRaf = null;
      }
      return;
    }

    ensureWaveformBars();
    if (waveformBars.length === 0) return;

    if (mode === 'idle') {
      if (waveformRaf) {
        cancelAnimationFrame(waveformRaf);
        waveformRaf = null;
      }
      renderIdleWaveform();
      return;
    }

    if (!waveformRaf) {
      waveformRaf = requestAnimationFrame(animateWaveform);
    }
  }

  function animateWaveform(timestamp: number) {
    if (waveformMode === 'live' && analyser && waveformData) {
      analyser.getByteTimeDomainData(waveformData);
      const slice = Math.max(1, Math.floor(waveformData.length / WAVE_BAR_COUNT));

      for (let i = 0; i < waveformBars.length; i += 1) {
        const start = i * slice;
        let peak = 0;
        for (let j = start; j < start + slice && j < waveformData.length; j += 1) {
          const sample = Math.abs(waveformData[j] - 128);
          if (sample > peak) peak = sample;
        }

        const boosted = peak * WAVEFORM_GAIN;
        const normalized = Math.min(1, boosted / 36);

        const baseHeight = 10;
        const dynamicRange = 60;
        const height = baseHeight + normalized * dynamicRange;

        waveformBars[i].style.height = `${Math.max(10, height)}%`;
        waveformBars[i].style.opacity = `${0.5 + normalized * 0.5}`;
      }
    } else if (waveformMode === 'processing') {
      const t = timestamp / 1000;
      for (let i = 0; i < waveformBars.length; i += 1) {
        // Simple, clean wave motion
        const wave = Math.sin(t * 3 + i * 0.5) * 15;
        const height = 40 + wave;

        waveformBars[i].style.height = `${Math.max(20, Math.min(70, height))}%`;
        waveformBars[i].style.opacity = '0.6';
      }
    }

    waveformRaf = requestAnimationFrame(animateWaveform);
  }

  async function attachToStream(currentStream: MediaStream) {
    if (!waveformEl) return;

    ensureWaveformBars();
    if (!audioContext) {
      audioContext = new AudioContext();
    } else if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    detachWaveformSource();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.82;
    waveformData = new Uint8Array(analyser.frequencyBinCount);
    waveformSource = audioContext.createMediaStreamSource(currentStream);
    waveformSource.connect(analyser);

    setMode('live');
  }

  function reset() {
    detachWaveformSource();
    setMode('idle');
  }

  return {
    attachToStream,
    reset,
    setMode,
  };
}
