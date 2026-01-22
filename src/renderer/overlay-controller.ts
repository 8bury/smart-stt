import type { AppSettings } from '../types/settings';
import { DEFAULT_HOTKEYS } from '../types/settings';
import type { RecordingMode } from '../types/recording';
import { createWaveformController } from './waveform';

type UiState = 'loading' | 'idle' | 'recording' | 'processing' | 'error' | 'warning';

const TARGET_AUDIO_BITRATE = 64_000;

type ProcessResult = {
  ok: boolean;
  text?: string;
  warning?: string;
  error?: string;
  cancelled?: boolean;
  category?: string;
};

export function createOverlayController() {
  const statusEl = document.querySelector('#status') as HTMLSpanElement | null;
  const hintEl = document.querySelector('#hint') as HTMLDivElement | null;
  const overlayEl = document.querySelector('#overlay') as HTMLDivElement;
  const waveformEl = document.querySelector('#waveform') as HTMLDivElement | null;
  const waveform = createWaveformController(waveformEl);

  let settingsCache: AppSettings | null = null;
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let stream: MediaStream | null = null;
  let lastError = '';
  let skipProcessing = false;

  function setHint(text: string) {
    if (hintEl) {
      hintEl.textContent = text;
    }
  }

  function setState(state: UiState, message?: string) {
    overlayEl.dataset.state = state;
    if (statusEl) {
      statusEl.textContent =
        message ||
        {
          loading: 'Carregando...',
          idle: 'Pronto para gravar',
          recording: 'Gravando...',
          processing: 'Processando...',
          error: lastError || 'Erro',
          warning: lastError || 'Aviso',
        }[state];
    }

    if (state === 'processing') {
      waveform.setMode('processing');
    } else if (state === 'idle' || state === 'loading' || state === 'error' || state === 'warning') {
      waveform.setMode('idle');
    }
  }

  function resetStream() {
    mediaRecorder = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    chunks = [];
    waveform.reset();
  }

  async function refreshSettings() {
    try {
      const data = await window.overlayAPI.getSettings();
      settingsCache = data;
      const recordHotkey = data.hotkeys?.record || DEFAULT_HOTKEYS.record;
      const editHotkey = data.hotkeys?.edit || DEFAULT_HOTKEYS.edit;
      const cancelHotkey = data.hotkeys?.cancel || DEFAULT_HOTKEYS.cancel;
      setHint(
        `Use ${recordHotkey} para ditar, ${editHotkey} para editar ou ${cancelHotkey} para cancelar`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[refreshSettings] failed', err);
      setHint(
        `Use ${DEFAULT_HOTKEYS.record} para ditar, ${DEFAULT_HOTKEYS.edit} para editar ou ${DEFAULT_HOTKEYS.cancel} para cancelar`,
      );
    }
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
      await waveform.attachToStream(stream);
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
          lastError = 'Nenhum audio capturado';
          setState('error');
          return;
        }

        setState('processing', mode === 'edit' ? 'Editando texto...' : undefined);
        const buffer = await blob.arrayBuffer();
        const result: ProcessResult =
          mode === 'edit'
            ? await window.overlayAPI.processEdit(buffer)
            : await window.overlayAPI.processAudio(buffer);

        if (result?.cancelled) {
          setState('idle', mode === 'edit' ? 'Edicao cancelada' : 'Processamento cancelado');
          setTimeout(() => {
            setState('idle');
            void window.overlayAPI.hideOverlay();
          }, 800);
          return;
        }

        if (result?.ok && result.warning) {
          lastError = result.warning;
          // eslint-disable-next-line no-console
          console.log('[processAudio] warning:', result.warning);
          setState('warning', result.warning);
          setTimeout(() => {
            setState('idle');
            void window.overlayAPI.hideOverlay();
          }, 3000);
          return;
        }

        if (!result?.ok) {
          lastError = result?.error || 'Falha ao processar audio';
          // eslint-disable-next-line no-console
          console.error('[processAudio] failed', result?.error);
          setState('error');
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
          void window.overlayAPI.hideOverlay();
        }, 1200);
      };

      mediaRecorder.start();
      setState('recording', mode === 'edit' ? 'Gravando instrucao...' : undefined);
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Erro ao acessar microfone';
      // eslint-disable-next-line no-console
      console.error('[startRecording] getUserMedia error', err);
      setState('error');
      resetStream();
    }
  }

  function stopRecording() {
    if (!mediaRecorder) return;
    mediaRecorder.stop();
  }

  function handleRecordingToggle(payload: { recording: boolean; mode: RecordingMode }) {
    void refreshSettings();

    if (payload.recording) {
      setState('loading', payload.mode === 'edit' ? 'Preparando edicao...' : 'Carregando...');
      startRecording(payload.mode);
    } else {
      stopRecording();
    }
  }

  function handleRecordingCancel(mode: RecordingMode) {
    skipProcessing = true;
    stopRecording();
    lastError = '';
    setState('idle', mode === 'edit' ? 'Edicao cancelada' : 'Gravacao cancelada');
    setTimeout(() => {
      setState('idle');
      void window.overlayAPI.hideOverlay();
    }, 800);
  }

  function handleEditWarning(message: string) {
    lastError = message;
    setState('error', message);
    setTimeout(() => {
      setState('idle');
      void window.overlayAPI.hideOverlay();
    }, 1500);
  }

  function init() {
    setState('idle');
    setHint(
      `Use ${DEFAULT_HOTKEYS.record} para ditar, ${DEFAULT_HOTKEYS.edit} para editar ou ${DEFAULT_HOTKEYS.cancel} para cancelar`,
    );
    void refreshSettings();
    setState('loading');
    setTimeout(() => setState('idle'), 300);
  }

  return {
    init,
    handleRecordingToggle,
    handleRecordingCancel,
    handleEditWarning,
  };
}
