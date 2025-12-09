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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const store = new Store<AppSettings>({
  name: 'settings',
}) as unknown as SettingsStore;

let overlayWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let isRecording = false;
let recordingMode: RecordingMode = 'dictation';
let pendingEditText: string | null = null;
let cancelInProgress = false;
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

async function simulateCopy(): Promise<void> {
  const psCommand =
    "$wshell = New-Object -ComObject wscript.shell; Start-Sleep -Milliseconds 80; $wshell.SendKeys('^c')";

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

async function captureSelectedOrClipboardText() {
  const previousClipboard = clipboard.readText();
  let selection = '';

  try {
    clipboard.clear();
  } catch (err) {
    logError('captureSelectedOrClipboardText:clear', err);
  }

  try {
    await simulateCopy();
    await delay(120);
    selection = clipboard.readText().trim();
  } catch (err) {
    logError('captureSelectedOrClipboardText:copy', err);
  } finally {
    try {
      clipboard.writeText(previousClipboard);
    } catch (err) {
      logError('captureSelectedOrClipboardText:restore', err);
    }
  }

  const text = selection || previousClipboard.trim();
  const source = selection
    ? ('selection' as const)
    : previousClipboard.trim()
      ? ('clipboard' as const)
      : ('empty' as const);

  return { text, source };
}

async function startEditMode() {
  const { text } = await captureSelectedOrClipboardText();

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
  if (!isRecording) return;
  cancelInProgress = true;
  isRecording = false;
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
      model: 'gpt-5-nano',
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

async function applyInstructionToText(instruction: string, baseText: string) {
  const client = getClient();
  const language = store.get('language') ?? 'pt';
  const languageLabel = language === 'en' ? 'English' : 'Portuguese';

  const systemPrompt = [
    'Você é um assistente de edição de textos.',
    'Recebe uma instrução do usuário e um texto base.',
    'Retorne somente o texto final editado, sem explicações ou marcações extras.',
    `Responda em ${languageLabel} preservando formatação útil (quebras, listas).`,
  ].join(' ');

  const userContent = `Instrução do usuário:\n${instruction.trim()}\n\nTexto base para editar:\n${baseText}`;

  const response = await client.chat.completions.create({
    model: 'gpt-5-nano',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 1,
  });

  return response.choices[0]?.message?.content?.trim() ?? '';
}

async function handleEditAudio(buffer: Buffer) {
  const baseText = pendingEditText;
  if (!baseText) {
    throw new Error('Nenhum texto disponível para editar. Selecione ou copie e tente novamente.');
  }

  try {
    // eslint-disable-next-line no-console
    console.log('[handleEditAudio] start');
    const instruction = (await transcribeAudio(buffer)).trim();
    if (!instruction) {
      throw new Error('Instrução de edição vazia.');
    }

    const editedText = await applyInstructionToText(instruction, baseText);
    if (!editedText) {
      throw new Error('A LLM retornou texto vazio ao editar.');
    }

    clipboard.writeText(editedText);
    try {
      await simulatePaste();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Falha ao simular Ctrl+V no modo edição; texto ficou no clipboard.', err);
    }

    // eslint-disable-next-line no-console
    console.log('[handleEditAudio] done');
    return editedText;
  } finally {
    pendingEditText = null;
  }
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

ipcMain.handle('process-edit', async (_event, arrayBuffer: ArrayBuffer) => {
  const buffer = Buffer.from(arrayBuffer);
  try {
    const text = await handleEditAudio(buffer);
    return { ok: true, text };
  } catch (error) {
    logError('process-edit', error);
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
