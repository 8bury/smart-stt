import { spawn } from 'node:child_process';
import type { ClipboardOperations } from './interface';

/**
 * Implementacao das operacoes de clipboard para macOS.
 * Usa osascript e System Events para simular atalhos de teclado.
 */
export class MacOSClipboard implements ClipboardOperations {
  /**
   * Simula Cmd+V no macOS usando AppleScript.
   * Adiciona um pequeno delay antes de executar para garantir que a janela alvo esteja pronta.
   */
  async simulatePaste(): Promise<void> {
    return this.executeKeyCommand('v');
  }

  /**
   * Simula Cmd+C no macOS usando AppleScript.
   * Adiciona um pequeno delay antes de executar para garantir que a janela alvo esteja pronta.
   */
  async simulateCopy(): Promise<void> {
    return this.executeKeyCommand('c');
  }

  private executeKeyCommand(key: 'v' | 'c'): Promise<void> {
    const args = [
      '-e',
      'tell application "System Events"',
      '-e',
      'delay 0.08',
      '-e',
      `keystroke "${key}" using {command down}`,
      '-e',
      'end tell',
    ];

    return new Promise((resolve, reject) => {
      const child = spawn('osascript', args);
      child.once('error', (err) => reject(err));
      child.once('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`osascript saiu com codigo ${code}`));
        }
      });
    });
  }
}
