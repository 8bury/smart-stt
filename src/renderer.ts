import './index.css';

type UiState = 'loading' | 'idle' | 'recording' | 'processing' | 'error';
type RecordingMode = 'dictation' | 'edit';

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
    edit?: string;
  };
};

const DEFAULT_RECORD_HOTKEY = 'Ctrl+Shift+S';
const DEFAULT_EDIT_HOTKEY = 'Ctrl+Shift+E';
const DEFAULT_CANCEL_HOTKEY = 'Ctrl+Shift+Q';
let settingsCache: OverlaySettings | null = null;

let mediaRecorder: MediaRecorder | null = null;
let chunks: BlobPart[] = [];
let stream: MediaStream | null = null;
let lastError = '';
let skipProcessing = false;

async function refreshSettings() {
  try {
    const data = await window.overlayAPI.getSettings();
    settingsCache = data;
    const recordHotkey = data.hotkeys?.record || DEFAULT_RECORD_HOTKEY;
    const editHotkey = data.hotkeys?.edit || DEFAULT_EDIT_HOTKEY;
    const cancelHotkey = data.hotkeys?.cancel || DEFAULT_CANCEL_HOTKEY;
    hintEl.textContent = `Use ${recordHotkey} para ditar, ${editHotkey} para editar ou ${cancelHotkey} para cancelar`;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[refreshSettings] failed', err);
    hintEl.textContent = `Use ${DEFAULT_RECORD_HOTKEY} para ditar, ${DEFAULT_EDIT_HOTKEY} para editar ou ${DEFAULT_CANCEL_HOTKEY} para cancelar`;
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
hintEl.textContent = `Use ${DEFAULT_RECORD_HOTKEY} para ditar, ${DEFAULT_EDIT_HOTKEY} para editar ou ${DEFAULT_CANCEL_HOTKEY} para cancelar`;
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
