export type HotkeySettings = {
  record?: string;
  settings?: string;
  edit?: string;
  cancel?: string;
};

export type AppSettings = {
  apiKey?: string;
  deviceId?: string;
  language?: 'pt' | 'en';
  hotkeys?: HotkeySettings;
};

export type SettingsPayload = AppSettings;

export type SettingsStore = {
  get: <K extends keyof AppSettings>(key: K) => AppSettings[K];
  set: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
};

export const DEFAULT_HOTKEYS: Required<HotkeySettings> = {
  record: 'Ctrl+Shift+S',
  settings: 'Ctrl+Shift+O',
  edit: 'Ctrl+Shift+E',
  cancel: 'Ctrl+Shift+Q',
};
