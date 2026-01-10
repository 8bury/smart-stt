import './index.css';

type UiState = 'loading' | 'idle' | 'recording' | 'processing' | 'error' | 'warning';
type RecordingMode = 'dictation' | 'edit';

const statusEl = document.querySelector('#status') as HTMLSpanElement | null;
const hintEl = document.querySelector('#hint') as HTMLDivElement | null;
const overlayEl = document.querySelector('#overlay') as HTMLDivElement;
const waveformEl = document.querySelector('#waveform') as HTMLDivElement | null;

type OverlaySettings = {
  apiKey?: string;
  deviceId?: string;
  language?: 'pt' | 'en';
  hotkeys?: {
    record?: string;
    settings?: string;
    edit?: string;
  };
};

const DEFAULT_RECORD_HOTKEY = 'Ctrl+Shift+S';
const DEFAULT_EDIT_HOTKEY = 'Ctrl+Shift+E';
const DEFAULT_CANCEL_HOTKEY = 'Ctrl+Shift+Q';
let settingsCache: OverlaySettings | null = null;

const WAVE_BAR_COUNT = 12;
const WAVEFORM_GAIN = 2;
const waveformBars: HTMLSpanElement[] = [];
const TARGET_AUDIO_BITRATE = 64_000;
let audioContext: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let waveformSource: MediaStreamAudioSourceNode | null = null;
let waveformData: Uint8Array<ArrayBuffer> | null = null;
let waveformRaf: number | null = null;
let waveformMode: 'idle' | 'live' | 'processing' = 'idle';

let mediaRecorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let stream: MediaStream | null = null;
let lastError = '';
let skipProcessing = false;

async function refreshSettings() {
  try {
    const data = await window.overlayAPI.getSettings();
    settingsCache = data;
    if (hintEl) {
      const recordHotkey = data.hotkeys?.record || DEFAULT_RECORD_HOTKEY;
      const editHotkey = data.hotkeys?.edit || DEFAULT_EDIT_HOTKEY;
      const cancelHotkey = data.hotkeys?.cancel || DEFAULT_CANCEL_HOTKEY;
      hintEl.textContent = `Use ${recordHotkey} para ditar, ${editHotkey} para editar ou ${cancelHotkey} para cancelar`;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[refreshSettings] failed', err);
    if (hintEl) {
      hintEl.textContent = `Use ${DEFAULT_RECORD_HOTKEY} para ditar, ${DEFAULT_EDIT_HOTKEY} para editar ou ${DEFAULT_CANCEL_HOTKEY} para cancelar`;
    }
  }
}

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

function setWaveformMode(mode: 'idle' | 'live' | 'processing') {
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

async function attachWaveformToStream(currentStream: MediaStream) {
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
  const backing = new ArrayBuffer(analyser.frequencyBinCount);
  waveformData = new Uint8Array(backing);
  waveformSource = audioContext.createMediaStreamSource(currentStream);
  waveformSource.connect(analyser);

  setWaveformMode('live');
}

function setState(state: UiState, message?: string) {
  overlayEl.dataset.state = state;
  if (statusEl) {
    statusEl.textContent = message || {
      loading: 'Carregando...',
      idle: 'Pronto para gravar',
      recording: 'Gravando...',
      processing: 'Processando...',
      error: lastError || 'Erro',
      warning: lastError || 'Aviso',
    }[state];
  }

  if (state === 'processing') {
    setWaveformMode('processing');
  } else if (state === 'idle' || state === 'loading' || state === 'error' || state === 'warning') {
    setWaveformMode('idle');
  }
}

function resetStream() {
  mediaRecorder = null;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  chunks = [];
  detachWaveformSource();
}

async function startRecording(mode: RecordingMode) {
  if (mediaRecorder) return;
  skipProcessing = false;
  try {
    const settings = settingsCache ?? (await window.overlayAPI.getSettings());
    if (!settingsCache) {
      settingsCache = settings;
    }

    const constraints: MediaStreamConstraints = settings.deviceId
      ? { audio: { deviceId: { exact: settings.deviceId } } }
      : { audio: true };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    await attachWaveformToStream(stream);
    const preferredMime = 'audio/webm;codecs=opus';
    const mimeType = MediaRecorder.isTypeSupported(preferredMime)
      ? preferredMime
      : 'audio/webm';
    // eslint-disable-next-line no-console
    console.log('[startRecording] mimeType=', mimeType);

    mediaRecorder = new MediaRecorder(stream, {
      mimeType,
      audioBitsPerSecond: TARGET_AUDIO_BITRATE,
    });
    chunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      if (skipProcessing) {
        resetStream();
        setState('idle');
        void window.overlayAPI.hideOverlay();
        return;
      }
      const blob = new Blob(chunks, { type: 'audio/webm' });
      resetStream();
      if (blob.size === 0) {
        lastError = 'Nenhum áudio capturado';
        setState('error');
        return;
      }

      setState('processing', mode === 'edit' ? 'Editando texto...' : undefined);
      const buffer = await blob.arrayBuffer();
      const result =
        mode === 'edit'
          ? await window.overlayAPI.processEdit(buffer)
          : await window.overlayAPI.processAudio(buffer);

      // Check if processing was cancelled
      if (result && 'cancelled' in result && result.cancelled) {
        setState('idle', mode === 'edit' ? 'Edição cancelada' : 'Processamento cancelado');
        setTimeout(() => {
          setState('idle');
          void window.overlayAPI.hideOverlay();
        }, 800);
        return;
      }

      // Check for warnings (partial success - e.g. paste failed but text is in clipboard)
      if (result?.ok && result.warning) {
        lastError = result.warning;
        // eslint-disable-next-line no-console
        console.log('[processAudio] warning:', result.warning);
        setState('warning', result.warning);
        // Auto-dismiss warning after 3 seconds
        setTimeout(() => {
          setState('idle');
          void window.overlayAPI.hideOverlay();
        }, 3000);
        return;
      }

      if (!result?.ok) {
        lastError = result?.error || 'Falha ao processar áudio';
        // eslint-disable-next-line no-console
        console.error('[processAudio] failed', result?.error);
        setState('error');
        // Auto-dismiss errors after 5 seconds (unless it's a critical error like API auth)
        const isDismissable = !result?.category || result.category !== 'api_auth';
        if (isDismissable) {
          setTimeout(() => {
            setState('idle');
            void window.overlayAPI.hideOverlay();
          }, 5000);
        }
        return;
      }

      // eslint-disable-next-line no-console
      console.log('[processAudio] success, text copied');
      setState('idle', mode === 'edit' ? 'Texto editado' : 'Texto copiado');
      setTimeout(() => {
        setState('idle');
        window.overlayAPI.hideOverlay();
      }, 1200);
    };

    mediaRecorder.start();
    setState('recording', mode === 'edit' ? 'Gravando instrução...' : undefined);
  } catch (err) {
    lastError =
      err instanceof Error ? err.message : 'Erro ao acessar microfone';
    // eslint-disable-next-line no-console
    console.error('[startRecording] getUserMedia error', err);
    setState('error');
    resetStream();
  }
}

async function stopRecording() {
  if (!mediaRecorder) return;
  mediaRecorder.stop();
}

setState('idle');
if (hintEl) {
  hintEl.textContent = `Use ${DEFAULT_RECORD_HOTKEY} para ditar, ${DEFAULT_EDIT_HOTKEY} para editar ou ${DEFAULT_CANCEL_HOTKEY} para cancelar`;
}
void refreshSettings();

window.overlayAPI.onRecordingToggle(({ recording, mode }) => {
  void refreshSettings();

  if (recording) {
    setState('loading', mode === 'edit' ? 'Preparando edição...' : 'Carregando...');
    startRecording(mode);
  } else {
    stopRecording();
  }
});

window.overlayAPI.onRecordingCancel((mode) => {
  skipProcessing = true;
  stopRecording();
  lastError = '';
  setState('idle', mode === 'edit' ? 'Edição cancelada' : 'Gravação cancelada');
  setTimeout(() => {
    setState('idle');
    void window.overlayAPI.hideOverlay();
  }, 800);
});

window.overlayAPI.onEditWarning((message) => {
  lastError = message;
  setState('error', message);
  setTimeout(() => {
    setState('idle');
    void window.overlayAPI.hideOverlay();
  }, 1500);
});

setState('loading');
setTimeout(() => setState('idle'), 300);
