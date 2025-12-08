import { contextBridge, ipcRenderer } from 'electron';

type HotkeySettings = {
  record?: string;
  settings?: string;
};

type SettingsPayload = {
  apiKey?: string;
  deviceId?: string;
  language?: 'pt' | 'en';
  hotkeys?: HotkeySettings;
};

const overlayAPI = {
  onRecordingToggle: (callback: (recording: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, recording: boolean) =>
      callback(recording);
    ipcRenderer.on('recording-toggle', listener);
    return () =>
      ipcRenderer.removeListener('recording-toggle', listener);
  },
  processAudio: (arrayBuffer: ArrayBuffer) =>
    ipcRenderer.invoke('process-audio', arrayBuffer),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  hideOverlay: () => ipcRenderer.invoke('overlay:hide'),
};

const settingsAPI = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (payload: SettingsPayload) => ipcRenderer.invoke('settings:save', payload),
};

contextBridge.exposeInMainWorld('overlayAPI', overlayAPI);
contextBridge.exposeInMainWorld('settingsAPI', settingsAPI);

declare global {
  interface Window {
    overlayAPI: typeof overlayAPI;
    settingsAPI: typeof settingsAPI;
  }
}
