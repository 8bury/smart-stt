import { contextBridge, ipcRenderer } from 'electron';

type HotkeySettings = {
  record?: string;
  settings?: string;
  edit?: string;
  cancel?: string;
};

type SettingsPayload = {
  apiKey?: string;
  deviceId?: string;
  language?: 'pt' | 'en';
  hotkeys?: HotkeySettings;
};

type RecordingMode = 'dictation' | 'edit';

type RecordingTogglePayload = {
  recording: boolean;
  mode: RecordingMode;
};

const overlayAPI = {
  onRecordingToggle: (callback: (payload: RecordingTogglePayload) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: RecordingTogglePayload,
    ) => callback(payload);
    ipcRenderer.on('recording-toggle', listener);
    return () => ipcRenderer.removeListener('recording-toggle', listener);
  },
  onRecordingCancel: (callback: (mode: RecordingMode) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { mode: RecordingMode }) =>
      callback(data.mode);
    ipcRenderer.on('recording-cancel', listener);
    return () => ipcRenderer.removeListener('recording-cancel', listener);
  },
  onEditWarning: (callback: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) =>
      callback(message);
    ipcRenderer.on('edit-warning', listener);
    return () => ipcRenderer.removeListener('edit-warning', listener);
  },
  processAudio: (arrayBuffer: ArrayBuffer) =>
    ipcRenderer.invoke('process-audio', arrayBuffer),
  processEdit: (arrayBuffer: ArrayBuffer) =>
    ipcRenderer.invoke('process-edit', arrayBuffer),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  hideOverlay: () => ipcRenderer.invoke('overlay:hide'),
};

const settingsAPI = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (payload: SettingsPayload) => ipcRenderer.invoke('settings:save', payload),
  disableHotkeys: () => ipcRenderer.invoke('hotkeys:disable'),
  enableHotkeys: () => ipcRenderer.invoke('hotkeys:enable'),
};

contextBridge.exposeInMainWorld('overlayAPI', overlayAPI);
contextBridge.exposeInMainWorld('settingsAPI', settingsAPI);

declare global {
  interface Window {
    overlayAPI: typeof overlayAPI;
    settingsAPI: typeof settingsAPI;
  }
}
