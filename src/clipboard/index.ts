import type { ClipboardOperations } from './interface';
import { WindowsClipboard } from './windows';
import { LinuxClipboard } from './linux';

/**
 * Factory function que retorna a implementação correta de ClipboardOperations
 * baseada na plataforma do sistema operacional.
 *
 * @returns Instância de ClipboardOperations específica para a plataforma
 * @throws Error se a plataforma não for suportada
 */
export function getClipboardOperations(): ClipboardOperations {
  const platform = process.platform;

  switch (platform) {
    case 'win32':
      return new WindowsClipboard();
    case 'linux':
      return new LinuxClipboard();
    default:
      throw new Error(`Plataforma não suportada: ${platform}`);
  }
}

export type { ClipboardOperations };
export { WindowsClipboard } from './windows';
export { LinuxClipboard } from './linux';
