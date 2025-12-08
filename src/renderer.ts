import './index.css';

type UiState = 'loading' | 'idle' | 'recording' | 'processing' | 'error';

const statusEl = document.querySelector('#status') as HTMLSpanElement;
const hintEl = document.querySelector('#hint') as HTMLDivElement;
const overlayEl = document.querySelector('#overlay') as HTMLDivElement;

type OverlaySettings = {
  apiKey?: string;
  deviceId?: string;
  language?: 'pt' | 'en';
  hotkeys?: {
    record?: string;
    settings?: string;
  };
};

const DEFAULT_RECORD_HOTKEY = 'Ctrl+Shift+S';
let settingsCache: OverlaySettings | null = null;

let mediaRecorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let stream: MediaStream | null = null;
let lastError = '';

async function refreshSettings() {
  try {
    const data = await window.overlayAPI.getSettings();
    settingsCache = data;
    const recordHotkey = data.hotkeys?.record || DEFAULT_RECORD_HOTKEY;
    hintEl.textContent = `Use ${recordHotkey} para gravar`;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[refreshSettings] failed', err);
    hintEl.textContent = `Use ${DEFAULT_RECORD_HOTKEY} para gravar`;
  }
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
}

function resetStream() {
  mediaRecorder = null;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  chunks = [];
}

async function startRecording() {
  if (mediaRecorder) return;
  try {
    const settings = settingsCache ?? (await window.overlayAPI.getSettings());
    if (!settingsCache) {
      settingsCache = settings;
    }

    const constraints: MediaStreamConstraints = settings.deviceId
      ? { audio: { deviceId: { exact: settings.deviceId } } }
      : { audio: true };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
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
      const blob = new Blob(chunks, { type: 'audio/webm' });
      resetStream();
      if (blob.size === 0) {
        lastError = 'Nenhum áudio capturado';
        setState('error');
        return;
      }

      setState('processing');
      const buffer = await blob.arrayBuffer();
      const result = await window.overlayAPI.processAudio(buffer);
      if (!result?.ok) {
        lastError = result?.error || 'Falha ao processar áudio';
        // eslint-disable-next-line no-console
        console.error('[processAudio] failed', result?.error);
        setState('error');
        return;
      }

      // eslint-disable-next-line no-console
      console.log('[processAudio] success, text copied');
      setState('idle', 'Texto copiado');
      setTimeout(() => {
        setState('idle');
        window.overlayAPI.hideOverlay();
      }, 1200);
    };

    mediaRecorder.start();
    setState('recording');
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
hintEl.textContent = `Use ${DEFAULT_RECORD_HOTKEY} para gravar`;
void refreshSettings();

window.overlayAPI.onRecordingToggle((recording) => {
  void refreshSettings();

  if (recording) {
    setState('loading', 'Carregando...');
    startRecording();
  } else {
    stopRecording();
  }
});

setState('loading');
setTimeout(() => setState('idle'), 300);
