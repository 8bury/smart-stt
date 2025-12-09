import { spawn } from 'node:child_process';
import type { ClipboardOperations } from './interface';

/**
 * Implementação das operações de clipboard para Linux (Ubuntu/X11 e Wayland).
 * Usa xdotool para X11 ou ydotool para Wayland para simular atalhos de teclado.
 */
export class LinuxClipboard implements ClipboardOperations {
  /**
   * Simula Ctrl+V no Linux.
   * Tenta usar xdotool primeiro (X11), se falhar, tenta ydotool (Wayland).
   */
  async simulatePaste(): Promise<void> {
    try {
      await this.executeKeyCombo('ctrl+v');
    } catch (err) {
      // Se xdotool falhar (pode estar no Wayland), tenta ydotool
      await this.executeKeyComboWayland('ctrl+v');
    }
  }

  /**
   * Simula Ctrl+C no Linux.
   * Tenta usar xdotool primeiro (X11), se falhar, tenta ydotool (Wayland).
   */
  async simulateCopy(): Promise<void> {
    try {
      await this.executeKeyCombo('ctrl+c');
    } catch (err) {
      // Se xdotool falhar (pode estar no Wayland), tenta ydotool
      await this.executeKeyComboWayland('ctrl+c');
    }
  }

  /**
   * Executa uma combinação de teclas usando xdotool (X11).
   * @param combo - Combinação de teclas no formato xdotool (ex: 'ctrl+v', 'ctrl+c')
   */
  private executeKeyCombo(combo: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // xdotool key --clearmodifiers garante que modificadores anteriores não interfiram
      const child = spawn('xdotool', ['key', '--clearmodifiers', combo]);
      child.once('error', (err) => reject(err));
      child.once('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`xdotool saiu com código ${code}`));
        }
      });
    });
  }

  /**
   * Executa uma combinação de teclas usando ydotool (Wayland).
   * @param combo - Combinação de teclas no formato ydotool (ex: 'ctrl+v', 'ctrl+c')
   */
  private executeKeyComboWayland(combo: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // ydotool usa sintaxe similar ao xdotool para combinações simples
      const child = spawn('ydotool', ['key', combo]);
      child.once('error', (err) => reject(err));
      child.once('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`ydotool saiu com código ${code}`));
        }
      });
    });
  }
}
