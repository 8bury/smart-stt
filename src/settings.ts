import './index.css';

const form = document.querySelector('form') as HTMLFormElement;
const apiKeyInput = document.querySelector('#apiKey') as HTMLInputElement;
const micSelect = document.querySelector('#micSelect') as HTMLSelectElement;
const languageSelect = document.querySelector(
  '#languageSelect',
) as HTMLSelectElement;
const statusEl = document.querySelector('#status') as HTMLSpanElement;
const refreshBtn = document.querySelector('#refresh') as HTMLButtonElement;
const closeBtn = document.querySelector('#close-btn') as HTMLButtonElement | null;
const saveBtn = document.querySelector('#save-btn') as HTMLButtonElement;
const tabButtons = document.querySelectorAll<HTMLButtonElement>('[data-tab-button]');
const tabPanels = document.querySelectorAll<HTMLElement>('[data-tab-panel]');
const recordHotkeyInput = document.querySelector('#recordHotkey') as HTMLInputElement;
const settingsHotkeyInput = document.querySelector('#settingsHotkey') as HTMLInputElement;
const editHotkeyInput = document.querySelector('#editHotkey') as HTMLInputElement;
const cancelHotkeyInput = document.querySelector('#cancelHotkey') as HTMLInputElement;

let hotkeyInputFocusCount = 0;

const DEFAULT_HOTKEYS = {
  record: 'Ctrl+Shift+S',
  settings: 'Ctrl+Shift+O',
  edit: 'Ctrl+Shift+E',
  cancel: 'Ctrl+Shift+Q',
};

type FormState = 'idle' | 'loading' | 'saving';

function setStatus(text: string, kind: 'info' | 'error' | 'success' = 'info') {
  statusEl.textContent = text;
  statusEl.dataset.kind = kind;
}

function setFormState(state: FormState) {
  const disable = state !== 'idle';
  saveBtn.textContent =
    state === 'saving' ? 'Salvando...' : state === 'loading' ? 'Carregando...' : 'Salvar';
  const controls = form.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLButtonElement
  >('input, select, button');

  controls.forEach((control) => {
    if (control.id === 'close-btn') return;
    control.disabled = disable;
  });

  form.setAttribute('aria-busy', String(disable));
  form.dataset.state = state;
}

function switchTab(tab: 'app' | 'hotkeys') {
  tabButtons.forEach((btn) => {
    const isActive = btn.dataset.tabButton === tab;
    btn.dataset.active = String(isActive);
    btn.setAttribute('aria-selected', String(isActive));
    btn.tabIndex = isActive ? 0 : -1;
  });
  tabPanels.forEach((panel) => {
    const isActive = panel.dataset.tabPanel === tab;
    panel.dataset.active = String(isActive);
    panel.hidden = !isActive;
    panel.setAttribute('aria-hidden', String(!isActive));
  });
}

function setupTabs() {
  const orderedTabs = Array.from(tabButtons);

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tabButton as 'app' | 'hotkeys';
      switchTab(tab);
    });

    btn.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const currentIndex = orderedTabs.indexOf(btn);
      const nextIndex =
        event.key === 'ArrowRight'
          ? (currentIndex + 1) % orderedTabs.length
          : (currentIndex - 1 + orderedTabs.length) % orderedTabs.length;
      orderedTabs[nextIndex].focus();
      const tab = orderedTabs[nextIndex].dataset.tabButton as 'app' | 'hotkeys';
      switchTab(tab);
    });
  });

  switchTab('app');
}

function formatHotkey(event: KeyboardEvent) {
  const key = event.key;
  if (key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta') {
    return null;
  }

  const parts: string[] = [];
  if (event.ctrlKey) parts.push('Ctrl');
  if (event.shiftKey) parts.push('Shift');
  if (event.altKey) parts.push('Alt');
  if (event.metaKey) parts.push('Super');

  const mainKey =
    key === ' ' ? 'Space' : key.length === 1 ? key.toUpperCase() : key;
  parts.push(mainKey);
  return parts.join('+');
}

function bindHotkeyInput(input: HTMLInputElement) {
  input.addEventListener('focus', async () => {
    hotkeyInputFocusCount += 1;
    if (hotkeyInputFocusCount === 1) {
      try {
        await window.settingsAPI.disableHotkeys();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[hotkeys] falha ao desativar atalhos globais', err);
      }
    }
  });

  input.addEventListener('blur', async () => {
    hotkeyInputFocusCount = Math.max(0, hotkeyInputFocusCount - 1);
    if (hotkeyInputFocusCount === 0) {
      try {
        await window.settingsAPI.enableHotkeys();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[hotkeys] falha ao reativar atalhos globais', err);
      }
    }
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Tab') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const hotkey = formatHotkey(event);
    if (!hotkey) return;
    input.value = hotkey;
  });
}

async function loadDevices() {
  try {
    let devices = await navigator.mediaDevices.enumerateDevices();
    const missingLabels = devices.some(
      (d) => d.kind === 'audioinput' && !d.label,
    );

    if (missingLabels) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch (err) {
        setStatus(
          err instanceof Error ? err.message : 'Permissão de microfone negada',
          'error',
        );
      }
    }

    const mics = devices.filter((d) => d.kind === 'audioinput');
    micSelect.innerHTML = '';
    if (mics.length === 0) {
      const opt = document.createElement('option');
      opt.text = 'Nenhum microfone encontrado';
      opt.value = '';
      micSelect.appendChild(opt);
      setStatus('Nenhum microfone encontrado', 'error');
      return;
    }

    for (const mic of mics) {
      const opt = document.createElement('option');
      opt.value = mic.deviceId;
      opt.text = mic.label || 'Microfone';
      micSelect.appendChild(opt);
    }

    setStatus('Microfones prontos', 'info');
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Não foi possível listar microfones.';
    setStatus(message, 'error');
  }
}

async function loadSettings() {
  const { apiKey, deviceId, language, hotkeys } = await window.settingsAPI.getSettings();
  apiKeyInput.value = apiKey || '';

  if (deviceId) {
    micSelect.value = deviceId;
  }

  languageSelect.value = language || 'pt';
  recordHotkeyInput.value = hotkeys?.record || DEFAULT_HOTKEYS.record;
  settingsHotkeyInput.value = hotkeys?.settings || DEFAULT_HOTKEYS.settings;
  editHotkeyInput.value = hotkeys?.edit || DEFAULT_HOTKEYS.edit;
  cancelHotkeyInput.value = hotkeys?.cancel || DEFAULT_HOTKEYS.cancel;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setFormState('saving');
  setStatus('Salvando configurações...', 'info');
  try {
    await window.settingsAPI.saveSettings({
      apiKey: apiKeyInput.value.trim(),
      deviceId: micSelect.value,
      language: languageSelect.value as 'pt' | 'en',
      hotkeys: {
        record: recordHotkeyInput.value.trim() || DEFAULT_HOTKEYS.record,
        settings: settingsHotkeyInput.value.trim() || DEFAULT_HOTKEYS.settings,
        edit: editHotkeyInput.value.trim() || DEFAULT_HOTKEYS.edit,
        cancel: cancelHotkeyInput.value.trim() || DEFAULT_HOTKEYS.cancel,
      },
    });
    setStatus('Configurações salvas', 'success');
    setTimeout(() => window.close(), 400);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Não foi possível salvar. Tente novamente.';
    setStatus(message, 'error');
    setFormState('idle');
  }
});

refreshBtn.addEventListener('click', async (event) => {
  event.preventDefault();
  refreshBtn.disabled = true;
  micSelect.disabled = true;
  setStatus('Atualizando microfones...', 'info');
  try {
    await loadDevices();
    setStatus('Lista de microfones atualizada');
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Não foi possível atualizar microfones.';
    setStatus(message, 'error');
  } finally {
    refreshBtn.disabled = false;
    micSelect.disabled = false;
  }
});

closeBtn?.addEventListener('click', () => {
  window.close();
});

setupTabs();
recordHotkeyInput.readOnly = true;
settingsHotkeyInput.readOnly = true;
editHotkeyInput.readOnly = true;
cancelHotkeyInput.readOnly = true;
recordHotkeyInput.value = DEFAULT_HOTKEYS.record;
settingsHotkeyInput.value = DEFAULT_HOTKEYS.settings;
editHotkeyInput.value = DEFAULT_HOTKEYS.edit;
cancelHotkeyInput.value = DEFAULT_HOTKEYS.cancel;
bindHotkeyInput(recordHotkeyInput);
bindHotkeyInput(settingsHotkeyInput);
bindHotkeyInput(editHotkeyInput);
bindHotkeyInput(cancelHotkeyInput);

window.addEventListener('beforeunload', async () => {
  try {
    await window.settingsAPI.enableHotkeys();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[hotkeys] falha ao reativar atalhos globais ao fechar', err);
  }
});

async function init() {
  setFormState('loading');
  setStatus('Carregando configurações...', 'info');

  try {
    await loadDevices();
    await loadSettings();
    setStatus('', 'info');
    setFormState('idle');
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Não foi possível carregar as configurações.';
    setStatus(message, 'error');
    setFormState('idle');
  }
}

init();

