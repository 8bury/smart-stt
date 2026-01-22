import { app, BrowserWindow, ipcMain, Tray } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import Store from 'electron-store';
import { APIError } from 'openai';
import { getClipboardOperations } from './clipboard';
import { handleDictationAudio } from './modes/dictation';
import { handleEditAudio, captureSelectedOrClipboardText } from './modes/edit';
import { createOverlayWindow, createSettingsWindow, positionOverlayWindow } from './main/windows';
import { createTray } from './main/tray';
import { registerShortcuts, unregisterShortcuts, getHotkeys } from './main/shortcuts';
import type { AppSettings, HotkeySettings, SettingsStore } from './types/settings';
import type { RecordingMode } from './types/recording';
import { SmartSTTError, createMissingApiKeyError, isCancelledError } from './utils/errors';

type ProcessResponse = {
  ok: boolean;
  text?: string;
  error?: string;
  warning?: string;
  category?: string;
  canRetry?: boolean;
  cancelled?: boolean;
};

const logError = (context: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`[${context}]`, message, error);
};

const store = new Store<AppSettings>({
  name: 'settings',
}) as unknown as SettingsStore;

let overlayWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let isRecording = false;
let isProcessing = false;
let recordingMode: RecordingMode = 'dictation';
let pendingEditText: string | null = null;
let tray: Tray | null = null;
let cancelGeneration = 0;
let overlayReady = false;
const overlayQueue: Array<{ channel: string; payload?: unknown }> = [];
const clipboardOps = getClipboardOperations();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const overlayUrl =
  MAIN_WINDOW_VITE_DEV_SERVER_URL ||
  `file://${path.join(
    __dirname,
    `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
  )}`;

const settingsUrl =
  (MAIN_WINDOW_VITE_DEV_SERVER_URL &&
    `${MAIN_WINDOW_VITE_DEV_SERVER_URL}/settings.html`) ||
  `file://${path.join(
    __dirname,
    `../renderer/${MAIN_WINDOW_VITE_NAME}/settings.html`,
  )}`;

function markOverlayNotReady(clearQueue = false) {
  overlayReady = false;
  if (clearQueue) {
    overlayQueue.length = 0;
  }
}

function flushOverlayQueue() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  overlayQueue.splice(0).forEach((item) => {
    overlayWindow?.webContents.send(item.channel, item.payload);
  });
}

function sendOverlayMessage(channel: string, payload?: unknown) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;

  if (!overlayReady) {
    overlayQueue.push({ channel, payload });
    return;
  }

  overlayWindow.webContents.send(channel, payload);
}

function createOverlay() {
  const preloadPath = path.join(__dirname, 'preload.js');
  overlayWindow = createOverlayWindow(preloadPath, overlayUrl);
  markOverlayNotReady();

  overlayWindow.webContents.on('did-finish-load', () => {
    markOverlayNotReady();
  });

  overlayWindow.on('closed', () => {
    overlayWindow = null;
    markOverlayNotReady(true);
  });
}

function createSettings() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  const preloadPath = path.join(__dirname, 'preload.js');
  settingsWindow = createSettingsWindow(preloadPath, settingsUrl);
  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function toggleRecording(mode: RecordingMode = 'dictation') {
  if (!overlayWindow) {
    createOverlay();
  }

  const willStart = !isRecording;
  if (willStart) {
    recordingMode = mode;
  }

  isRecording = !isRecording;
  if (isRecording) {
    if (overlayWindow) {
      positionOverlayWindow(overlayWindow);
    }
    overlayWindow?.showInactive();
  } else {
    pendingEditText = null;
    // Mantem visivel para mostrar estado de processamento; ocultamos via IPC apos concluir.
    overlayWindow?.showInactive();
  }
  sendOverlayMessage('recording-toggle', {
    recording: isRecording,
    mode: recordingMode,
  });
}

function showSettings() {
  if (!settingsWindow) {
    createSettings();
  } else {
    settingsWindow.show();
    settingsWindow.focus();
  }
}

function toggleSettingsWindow() {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    createSettings();
    return;
  }

  if (settingsWindow.isVisible()) {
    settingsWindow.hide();
  } else {
    settingsWindow.show();
    settingsWindow.focus();
  }
}

async function startEditMode() {
  const { text } = await captureSelectedOrClipboardText(clipboardOps);

  if (!text) {
    if (!overlayWindow) {
      createOverlay();
    }
    overlayWindow?.showInactive();
    sendOverlayMessage('edit-warning', 'Selecione ou copie um texto e tente de novo.');
    return;
  }

  pendingEditText = text;
  toggleRecording('edit');
}

function cancelRecording() {
  if (!isRecording && !isProcessing) return;

  cancelGeneration += 1;
  isRecording = false;
  isProcessing = false;
  pendingEditText = null;
  sendOverlayMessage('recording-cancel', { mode: recordingMode });
}

function createCancelChecker() {
  const token = cancelGeneration;
  return () => cancelGeneration !== token;
}

function registerAppShortcuts() {
  registerShortcuts(store, {
    record: () => toggleRecording('dictation'),
    edit: () => {
      void startEditMode();
    },
    cancel: cancelRecording,
    settings: toggleSettingsWindow,
  });
}

function mapProcessError(error: unknown): ProcessResponse {
  if (error instanceof SmartSTTError) {
    // Clipboard errors are warnings (partial success - text is in clipboard)
    if (error.category === 'clipboard') {
      return { ok: true, text: '', warning: error.userMessage, category: error.category };
    }

    return {
      ok: false,
      error: error.userMessage,
      category: error.category,
      canRetry: error.canRetry,
    };
  }

  let message = error instanceof Error ? error.message : 'Erro desconhecido';
  if (error instanceof APIError) {
    const apiErr = error as APIError & {
      response?: { data?: { error?: { message?: string } } };
    };
    message =
      apiErr.response?.data?.error?.message ||
      `${apiErr.status || 400} ${apiErr.code || ''} ${apiErr.message}`;
  }

  return { ok: false, error: message };
}

async function processAudioRequest(
  context: 'process-audio' | 'process-edit',
  mode: RecordingMode,
  buffer: Buffer,
): Promise<ProcessResponse> {
  const shouldCancel = createCancelChecker();
  isProcessing = true;

  try {
    const apiKey = store.get('apiKey');
    if (!apiKey) {
      throw createMissingApiKeyError();
    }

    if (shouldCancel()) {
      return { ok: false, cancelled: true };
    }

    const language = store.get('language') ?? 'pt';
    const text =
      mode === 'edit'
        ? await handleEditAudio(
            buffer,
            clipboardOps,
            apiKey,
            language,
            pendingEditText,
            shouldCancel,
          )
        : await handleDictationAudio(
            buffer,
            clipboardOps,
            apiKey,
            language,
            shouldCancel,
          );

    if (shouldCancel()) {
      pendingEditText = null;
      return { ok: false, cancelled: true };
    }

    pendingEditText = null;
    return { ok: true, text };
  } catch (error) {
    pendingEditText = null;

    if (shouldCancel() || isCancelledError(error)) {
      return { ok: false, cancelled: true };
    }

    logError(context, error);
    return mapProcessError(error);
  } finally {
    isProcessing = false;
  }
}

ipcMain.on('overlay:ready', () => {
  overlayReady = true;
  flushOverlayQueue();
});

ipcMain.handle('settings:get', () => ({
  apiKey: store.get('apiKey') ?? '',
  deviceId: store.get('deviceId') ?? '',
  language: store.get('language') ?? 'pt',
  hotkeys: getHotkeys(store),
}));

ipcMain.handle(
  'settings:save',
  (
    _event,
    payload: {
      apiKey?: string;
      deviceId?: string;
      language?: 'pt' | 'en';
      hotkeys?: HotkeySettings;
    },
  ) => {
    let hotkeysChanged = false;

    if (typeof payload.apiKey === 'string') {
      store.set('apiKey', payload.apiKey.trim());
    }
    if (typeof payload.deviceId === 'string') {
      store.set('deviceId', payload.deviceId);
    }
    if (payload.language === 'pt' || payload.language === 'en') {
      store.set('language', payload.language);
    }
    if (payload.hotkeys) {
      const current = getHotkeys(store);
      const next: Required<HotkeySettings> = { ...current };

      if (typeof payload.hotkeys.record === 'string') {
        const record = payload.hotkeys.record.trim();
        if (record) {
          next.record = record;
          hotkeysChanged = hotkeysChanged || record !== current.record;
        }
      }
      if (typeof payload.hotkeys.settings === 'string') {
        const settings = payload.hotkeys.settings.trim();
        if (settings) {
          next.settings = settings;
          hotkeysChanged = hotkeysChanged || settings !== current.settings;
        }
      }
      if (typeof payload.hotkeys.cancel === 'string') {
        const cancel = payload.hotkeys.cancel.trim();
        if (cancel) {
          next.cancel = cancel;
          hotkeysChanged = hotkeysChanged || cancel !== current.cancel;
        }
      }
      if (typeof payload.hotkeys.edit === 'string') {
        const edit = payload.hotkeys.edit.trim();
        if (edit) {
          next.edit = edit;
          hotkeysChanged = hotkeysChanged || edit !== current.edit;
        }
      }

      store.set('hotkeys', next);
    }

    if (hotkeysChanged) {
      registerAppShortcuts();
    }
  },
);

ipcMain.handle('hotkeys:disable', () => {
  unregisterShortcuts();
});

ipcMain.handle('hotkeys:enable', () => {
  registerAppShortcuts();
});

ipcMain.handle('process-audio', async (_event, arrayBuffer: ArrayBuffer) => {
  const buffer = Buffer.from(arrayBuffer);
  return processAudioRequest('process-audio', 'dictation', buffer);
});

ipcMain.handle('process-edit', async (_event, arrayBuffer: ArrayBuffer) => {
  const buffer = Buffer.from(arrayBuffer);
  return processAudioRequest('process-edit', 'edit', buffer);
});

ipcMain.handle('overlay:hide', () => {
  overlayWindow?.hide();
});

app.whenReady().then(() => {
  createOverlay();
  registerAppShortcuts();
  tray = createTray(showSettings);
});

app.on('activate', () => {
  if (overlayWindow === null) {
    createOverlay();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  unregisterShortcuts();
});

app.on('before-quit', () => {
  tray?.destroy();
  tray = null;
});
