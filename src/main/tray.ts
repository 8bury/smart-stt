import { Tray, Menu, nativeImage, app } from 'electron';

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

export function createTray(showSettings: () => void): Tray {
  const icon = createTrayIcon();
  const tray = new Tray(icon);
  tray.setToolTip('Smart STT');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Configuracoes', click: showSettings },
    { type: 'separator' },
    {
      label: 'Sair',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  return tray;
}
