import type { App } from 'electron';

export function configureLinuxGlobalShortcuts(app: Pick<App, 'commandLine'>, platform = process.platform): void {
  if (platform !== 'linux') {
    return;
  }

  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
}
