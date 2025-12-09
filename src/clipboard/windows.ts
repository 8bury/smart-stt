import { spawn } from 'node:child_process';
import type { ClipboardOperations } from './interface';

/**
 * Implementação das operações de clipboard para Windows.
 * Usa PowerShell com WScript.Shell para simular atalhos de teclado.
 */
export class WindowsClipboard implements ClipboardOperations {
  /**
   * Simula Ctrl+V no Windows usando PowerShell e WScript.Shell SendKeys.
   * Adiciona um pequeno delay antes de executar para garantir que a janela alvo esteja pronta.
   */
  async simulatePaste(): Promise<void> {
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

  /**
   * Simula Ctrl+C no Windows usando PowerShell e WScript.Shell SendKeys.
   * Adiciona um pequeno delay antes de executar para garantir que a janela alvo esteja pronta.
   */
  async simulateCopy(): Promise<void> {
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
}
