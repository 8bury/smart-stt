import './index.css';

type UiState = 'loading' | 'idle' | 'recording' | 'processing' | 'error';
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

const WAVE_BAR_COUNT = 10;
const WAVEFORM_GAIN = 2;
const waveformBars: HTMLSpanElement[] = [];
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
    const base = 40 + (index % 2) * 4;
    bar.style.height = `${base}%`;
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
      const baseHeight = 2; // lower floor so quiet input drops further
      const dynamicRange = 44; // keep headroom near the top
      const height = baseHeight + normalized * dynamicRange;
      waveformBars[i].style.height = `${height}%`;
    }
  } else if (waveformMode === 'processing') {
    const t = timestamp / 1000;
    for (let i = 0; i < waveformBars.length; i += 1) {
      const wave = Math.sin(t * 2.9 + i * 0.34) * 3.6;
      const drift = Math.sin(t * 1.6 + i * 0.2) * 2.8;
      const height = 44 + wave + drift;
      waveformBars[i].style.height = `${Math.max(30, Math.min(72, height))}%`;
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
    }[state];
  }

  if (state === 'processing') {
    setWaveformMode('processing');
  } else if (state === 'idle' || state === 'loading' || state === 'error') {
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

    mediaRecorder = new MediaRecorder(stream, { mimeType });
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
      if (!result?.ok) {
        lastError = result?.error || 'Falha ao processar áudio';
        // eslint-disable-next-line no-console
        console.error('[processAudio] failed', result?.error);
        setState('error');
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
