import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
} from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import Store from 'electron-store';
import { APIError } from 'openai';
import { getClipboardOperations } from './clipboard';
import { handleDictationAudio } from './modes/dictation';
import { handleEditAudio, captureSelectedOrClipboardText } from './modes/edit';

type HotkeySettings = {
  record?: string;
  settings?: string;
  edit?: string;
  cancel?: string;
};

type AppSettings = {
  apiKey?: string;
  deviceId?: string;
  language?: 'pt' | 'en';
  hotkeys?: HotkeySettings;
};

type SettingsStore = {
  get: <K extends keyof AppSettings>(key: K) => AppSettings[K];
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
};

const defaultHotkeys: Required<HotkeySettings> = {
  record: 'Ctrl+Shift+S',
  settings: 'Ctrl+Shift+O',
  edit: 'Ctrl+Shift+E',
  cancel: 'Ctrl+Shift+Q',
};

type RecordingMode = 'dictation' | 'edit';

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
let cancelInProgress = false;
let tray: Tray | null = null;
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

function createTrayIcon() {
  const width = 16;
  const height = 16;
  const buffer = Buffer.alloc(width * height * 4);

  // Simple solid accent color to ensure visibility in the system tray.
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      buffer[idx] = 0xf8; // blue (B)
      buffer[idx + 1] = 0xbd; // green (G)
      buffer[idx + 2] = 0x38; // red (R)
      buffer[idx + 3] = 0xff; // alpha
    }
  }

  return nativeImage.createFromBitmap(buffer, { width, height });
}

function createTray() {
  if (tray) return;

  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Smart STT');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Configurações', click: showSettings },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 520,
    height: 180,
    frame: false,
    transparent: true,
    resizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    focusable: true,
    useContentSize: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  overlayWindow.loadURL(overlayUrl);
  overlayWindow.setIgnoreMouseEvents(true);
  positionOverlayWindow();

  overlayWindow.on('closed', () => {
    overlayWindow = null;
  });
}

function positionOverlayWindow() {
  if (!overlayWindow) return;
  const { width: winW, height: winH } = overlayWindow.getBounds();
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + (workArea.width - winW) / 2);
  const y = Math.round(workArea.y + workArea.height - winH - 12);
  overlayWindow.setBounds({ x, y, width: winW, height: winH });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 460,
    height: 840,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    fullscreenable: false,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  settingsWindow.loadURL(settingsUrl);
  settingsWindow.once('ready-to-show', () => settingsWindow?.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function toggleRecording(mode: RecordingMode = 'dictation') {
  if (!overlayWindow) {
    createOverlayWindow();
  }

  if (cancelInProgress) return;

  const willStart = !isRecording;
  if (willStart) {
    recordingMode = mode;
  }

  isRecording = !isRecording;
  if (isRecording) {
    positionOverlayWindow();
    overlayWindow?.showInactive();
  } else {
    pendingEditText = null;
    // Mantém visível para mostrar estado de processamento; ocultamos via IPC após concluir.
    overlayWindow?.showInactive();
  }
  overlayWindow?.webContents.send('recording-toggle', {
    recording: isRecording,
    mode: recordingMode,
  });
}

function showSettings() {
  if (!settingsWindow) {
    createSettingsWindow();
  } else {
    settingsWindow.show();
    settingsWindow.focus();
  }
}

function toggleSettingsWindow() {
  if (!settingsWindow || settingsWindow.isDestroyed()) {
    createSettingsWindow();
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
      createOverlayWindow();
    }
    overlayWindow?.showInactive();
    overlayWindow?.webContents.send(
      'edit-warning',
      'Selecione ou copie um texto e tente de novo.',
    );
    return;
  }

  pendingEditText = text;
  toggleRecording('edit');
}

function cancelRecording() {
  if (!isRecording && !isProcessing) return;
  cancelInProgress = true;
  isRecording = false;
  isProcessing = false;
  pendingEditText = null;
  overlayWindow?.webContents.send('recording-cancel', { mode: recordingMode });
  setTimeout(() => {
    cancelInProgress = false;
  }, 50);
}

function getHotkeys(): Required<HotkeySettings> {
  const saved = store.get('hotkeys') ?? {};
  return {
    record: saved.record?.trim() || defaultHotkeys.record,
    settings: saved.settings?.trim() || defaultHotkeys.settings,
    edit: saved.edit?.trim() || defaultHotkeys.edit,
    cancel: saved.cancel?.trim() || defaultHotkeys.cancel,
  };
}

function registerShortcuts() {
  unregisterShortcuts();

  const { record, settings, edit, cancel } = getHotkeys();
  const used = new Set<string>();
  const register = (accel: string, action: () => void, label: string) => {
    if (used.has(accel)) {
      // eslint-disable-next-line no-console
      console.warn(`Atalho duplicado ignorado (${label}): ${accel}`);
      return;
    }
    used.add(accel);
    const ok = globalShortcut.register(accel, action);
    if (!ok) {
      // eslint-disable-next-line no-console
      console.warn(`Não foi possível registrar atalho (${label}): ${accel}`);
    }
  };

  register(record, () => toggleRecording('dictation'), 'Gravar');
  register(edit, () => {
    void startEditMode();
  }, 'Edição');
  register(cancel, cancelRecording, 'Cancelar gravação/edição');
  register(settings, toggleSettingsWindow, 'Configurações');
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}


ipcMain.handle('settings:get', () => ({
  apiKey: store.get('apiKey') ?? '',
  deviceId: store.get('deviceId') ?? '',
  language: store.get('language') ?? 'pt',
  hotkeys: getHotkeys(),
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
      const current = getHotkeys();
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
      registerShortcuts();
    }
  },
);

ipcMain.handle('hotkeys:disable', () => {
  unregisterShortcuts();
});

ipcMain.handle('hotkeys:enable', () => {
  registerShortcuts();
});

ipcMain.handle('process-audio', async (_event, arrayBuffer: ArrayBuffer) => {
  const buffer = Buffer.from(arrayBuffer);
  isProcessing = true;
  try {
    const apiKey = store.get('apiKey');
    if (!apiKey) {
      throw new Error('Configure a chave da OpenAI nas configurações.');
    }
    if (cancelInProgress) {
      isProcessing = false;
      return { ok: false, error: 'Cancelado', cancelled: true };
    }
    const language = store.get('language') ?? 'pt';
    const text = await handleDictationAudio(buffer, clipboardOps, apiKey, language);
    if (cancelInProgress) {
      isProcessing = false;
      return { ok: false, error: 'Cancelado', cancelled: true };
    }
    isProcessing = false;
    return { ok: true, text };
  } catch (error) {
    isProcessing = false;
    logError('process-audio', error);

    // Check if this is a SmartSTTError
    if (error && typeof error === 'object' && 'category' in error && 'userMessage' in error) {
      const smartError = error as { category: string; userMessage: string; canRetry: boolean };

      // Clipboard errors are warnings (partial success - text is in clipboard)
      if (smartError.category === 'clipboard') {
        return { ok: true, text: '', warning: smartError.userMessage, category: smartError.category };
      }

      return {
        ok: false,
        error: smartError.userMessage,
        category: smartError.category,
        canRetry: smartError.canRetry
      };
    }

    // Fallback for non-SmartSTTError
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
});

ipcMain.handle('process-edit', async (_event, arrayBuffer: ArrayBuffer) => {
  const buffer = Buffer.from(arrayBuffer);
  isProcessing = true;
  try {
    const apiKey = store.get('apiKey');
    if (!apiKey) {
      throw new Error('Configure a chave da OpenAI nas configurações.');
    }
    if (cancelInProgress) {
      isProcessing = false;
      pendingEditText = null;
      return { ok: false, error: 'Cancelado', cancelled: true };
    }
    const language = store.get('language') ?? 'pt';
    const text = await handleEditAudio(
      buffer,
      clipboardOps,
      apiKey,
      language,
      pendingEditText,
    );
    if (cancelInProgress) {
      isProcessing = false;
      pendingEditText = null;
      return { ok: false, error: 'Cancelado', cancelled: true };
    }
    pendingEditText = null;
    isProcessing = false;
    return { ok: true, text };
  } catch (error) {
    isProcessing = false;
    pendingEditText = null;
    logError('process-edit', error);

    // Check if this is a SmartSTTError
    if (error && typeof error === 'object' && 'category' in error && 'userMessage' in error) {
      const smartError = error as { category: string; userMessage: string; canRetry: boolean };

      // Clipboard errors are warnings (partial success - text is in clipboard)
      if (smartError.category === 'clipboard') {
        return { ok: true, text: '', warning: smartError.userMessage, category: smartError.category };
      }

      return {
        ok: false,
        error: smartError.userMessage,
        category: smartError.category,
        canRetry: smartError.canRetry
      };
    }

    // Fallback for non-SmartSTTError
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
});

ipcMain.handle('overlay:hide', () => {
  overlayWindow?.hide();
});

app.whenReady().then(() => {
  createOverlayWindow();
  registerShortcuts();
  createTray();
});

app.on('activate', () => {
  if (overlayWindow === null) {
    createOverlayWindow();
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
