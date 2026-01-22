import { BrowserWindow, screen } from 'electron';

export function createOverlayWindow(
  preloadPath: string,
  overlayUrl: string,
): BrowserWindow {
  const window = new BrowserWindow({
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
      preload: preloadPath,
    },
  });

  window.loadURL(overlayUrl);
  window.setIgnoreMouseEvents(true);
  positionOverlayWindow(window);
  return window;
}

export function positionOverlayWindow(window: BrowserWindow): void {
  const { width: winW, height: winH } = window.getBounds();
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + (workArea.width - winW) / 2);
  const y = Math.round(workArea.y + workArea.height - winH - 12);
  window.setBounds({ x, y, width: winW, height: winH });
}

export function createSettingsWindow(
  preloadPath: string,
  settingsUrl: string,
): BrowserWindow {
  const window = new BrowserWindow({
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
      preload: preloadPath,
    },
  });

  window.loadURL(settingsUrl);
  return window;
}
