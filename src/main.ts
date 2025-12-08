import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  screen,
  Tray,
  Menu,
  nativeImage,
} from 'electron';
import path from 'node:path';
import { spawn } from 'node:child_process';
import started from 'electron-squirrel-startup';
import Store from 'electron-store';
import { APIError, OpenAI } from 'openai';
import { toFile } from 'openai/uploads';

type HotkeySettings = {
  record?: string;
  settings?: string;
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
let tray: Tray | null = null;

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
    height: 670,
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

function toggleRecording() {
  if (!overlayWindow) {
    createOverlayWindow();
  }

  isRecording = !isRecording;
  if (isRecording) {
    positionOverlayWindow();
    overlayWindow?.showInactive();
  } else {
    // Mantém visível para mostrar estado de processamento; ocultamos via IPC após concluir.
    overlayWindow?.showInactive();
  }
  overlayWindow?.webContents.send('recording-toggle', isRecording);
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

function getHotkeys(): Required<HotkeySettings> {
  const saved = store.get('hotkeys') ?? {};
  return {
    record: saved.record?.trim() || defaultHotkeys.record,
    settings: saved.settings?.trim() || defaultHotkeys.settings,
  };
}

function registerShortcuts() {
  unregisterShortcuts();

  const { record, settings } = getHotkeys();
  const register = (accel: string, action: () => void, label: string) => {
    const ok = globalShortcut.register(accel, action);
    if (!ok) {
      // eslint-disable-next-line no-console
      console.warn(`Não foi possível registrar atalho (${label}): ${accel}`);
    }
  };

  register(record, toggleRecording, 'Gravar');
  if (record === settings) {
    // eslint-disable-next-line no-console
    console.warn('Atalhos duplicados; usando o de gravação para ambos.');
    return;
  }
  register(settings, toggleSettingsWindow, 'Configurações');
}

function unregisterShortcuts() {
  globalShortcut.unregisterAll();
}

function getClient(): OpenAI {
  const apiKey = store.get('apiKey');
  if (!apiKey) {
    throw new Error('Configure a chave da OpenAI nas configurações.');
  }
  return new OpenAI({ apiKey });
}

async function transcribeAudio(buffer: Buffer) {
  const client = getClient();
  const language = store.get('language') ?? 'pt';
  // eslint-disable-next-line no-console
  console.log('[transcribeAudio] size(bytes)=', buffer.length);
  // log primeiros bytes para garantir não estar vazio/corrompido
  const sample = buffer.subarray(0, Math.min(24, buffer.length)).toString('hex');
  // eslint-disable-next-line no-console
  console.log('[transcribeAudio] head(hex)=', sample);
  if (buffer.length === 0) {
    throw new Error('Áudio vazio');
  }
  try {
    const file = await toFile(buffer, 'audio.webm', { type: 'audio/webm' });
    const response = await client.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language,
    });
    return response.text;
  } catch (err) {
    if (err instanceof APIError) {
      const apiErr = err as APIError & { response?: { data?: unknown } };
      // eslint-disable-next-line no-console
      console.error(
        '[transcribeAudio] APIError',
        apiErr.status,
        apiErr.code,
        apiErr.type,
        apiErr.message,
        apiErr.stack,
      );
      // eslint-disable-next-line no-console
      console.error('[transcribeAudio] response data', apiErr.response?.data);
    }
    logError('transcribeAudio', err);
    throw err;
  }
}

async function cleanText(text: string) {
  const client = getClient();
  const language = store.get('language') ?? 'pt';
  const languageLabel = language === 'en' ? 'English' : 'Portuguese';
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [
        {
          role: 'system',
          content:
            `You receive a raw speech transcript in ${languageLabel}. Remove hesitations, repetitions, and earlier corrections (keep only the final intended message), keep the manerisms and don't change the text if you don't have to do so. Reply only with the cleaned text in ${languageLabel}; do not translate or change the language.`,
        },
        { role: 'user', content: text },
      ],
      temperature: 1,
    });

    return response.choices[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    logError('cleanText', err);
    throw err;
  }
}

function simulatePaste(): Promise<void> {
  // Usa PowerShell para disparar Ctrl+V sem dependência nativa.
  const psCommand =
    "$wshell = New-Object -ComObject wscript.shell; Start-Sleep -Milliseconds 80; $wshell.SendKeys('^v')";

  return new Promise((resolve, reject) => {
    const child = spawn('powershell', ['-NoProfile', '-Command', psCommand]);
    child.once('error', (err) => reject(err));
    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`SendKeys saiu com código ${code}`));
      }
    });
  });
}

async function handleAudio(buffer: Buffer) {
  // eslint-disable-next-line no-console
  console.log('[handleAudio] start');
  const rawText = await transcribeAudio(buffer);
  const cleanedText = await cleanText(rawText);

  clipboard.writeText(cleanedText);
  try {
    await simulatePaste();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Falha ao simular Ctrl+V, texto ficou no clipboard.', err);
  }

  // eslint-disable-next-line no-console
  console.log('[handleAudio] done');
  return cleanedText;
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

      store.set('hotkeys', next);
    }

    if (hotkeysChanged) {
      registerShortcuts();
    }
  },
);

ipcMain.handle('process-audio', async (_event, arrayBuffer: ArrayBuffer) => {
  const buffer = Buffer.from(arrayBuffer);
  try {
    const text = await handleAudio(buffer);
    return { ok: true, text };
  } catch (error) {
    logError('process-audio', error);
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
