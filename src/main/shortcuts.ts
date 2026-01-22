import { globalShortcut } from 'electron';
import type { HotkeySettings, SettingsStore } from '../types/settings';
import { DEFAULT_HOTKEYS } from '../types/settings';

export type HotkeyActions = {
  record: () => void;
  settings: () => void;
  edit: () => void;
  cancel: () => void;
};

export function getHotkeys(store: SettingsStore): Required<HotkeySettings> {
  const saved = store.get('hotkeys') ?? {};
  return {
    record: saved.record?.trim() || DEFAULT_HOTKEYS.record,
    settings: saved.settings?.trim() || DEFAULT_HOTKEYS.settings,
    edit: saved.edit?.trim() || DEFAULT_HOTKEYS.edit,
    cancel: saved.cancel?.trim() || DEFAULT_HOTKEYS.cancel,
  };
}

export function registerShortcuts(store: SettingsStore, actions: HotkeyActions): void {
  unregisterShortcuts();

  const { record, settings, edit, cancel } = getHotkeys(store);
  const used = new Set<string>();
  const register = (accel: string, action: () => void, label: string) => {
    if (used.has(accel)) {
      // eslint-disable-next-line no-console
      console.warn(`Duplicate shortcut ignored (${label}): ${accel}`);
      return;
    }
    used.add(accel);
    const ok = globalShortcut.register(accel, action);
    if (!ok) {
      // eslint-disable-next-line no-console
      console.warn(`Failed to register shortcut (${label}): ${accel}`);
    }
  };

  register(record, actions.record, 'Record');
  register(edit, actions.edit, 'Edit');
  register(cancel, actions.cancel, 'Cancel');
  register(settings, actions.settings, 'Settings');
}

export function unregisterShortcuts(): void {
  globalShortcut.unregisterAll();
}
