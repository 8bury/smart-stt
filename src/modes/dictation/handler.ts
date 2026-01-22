import { clipboard } from 'electron';
import type { ClipboardOperations } from '../../clipboard';
import { transcribeAudio } from '../shared/transcription';
import { cleanText } from '../shared/text-processing';
import { CancelledError, createPasteFailureError } from '../../utils/errors';
import { withTimeout } from '../../utils/timeout';

// Timeout for clipboard paste operation: 2 seconds
const PASTE_TIMEOUT_MS = 2000;

/**
 * Processa áudio no modo de ditado.
 * Fluxo: Transcrever → Limpar texto → Copiar para clipboard → Colar
 *
 * @param buffer - Buffer de áudio em formato WebM
 * @param clipboardOps - Implementação de operações de clipboard específica da plataforma
 * @param apiKey - Chave da API OpenAI
 * @param language - Idioma para transcrição ('pt' ou 'en')
 * @returns Texto limpo e transcrito
 * @throws SmartSTTError with CLIPBOARD category if paste fails (non-fatal)
 */
export async function handleDictationAudio(
  buffer: Buffer,
  clipboardOps: ClipboardOperations,
  apiKey: string,
  language: 'pt' | 'en',
  shouldCancel?: () => boolean,
): Promise<string> {
  // eslint-disable-next-line no-console
  console.log('[handleDictationAudio] start');

  if (shouldCancel?.()) {
    throw new CancelledError();
  }

  const rawText = await transcribeAudio(buffer, apiKey, language);
  if (shouldCancel?.()) {
    throw new CancelledError();
  }

  const cleanedText = await cleanText(rawText, apiKey, language);
  if (shouldCancel?.()) {
    throw new CancelledError();
  }

  clipboard.writeText(cleanedText);

  if (shouldCancel?.()) {
    throw new CancelledError();
  }

  try {
    await withTimeout(
      () => clipboardOps.simulatePaste(),
      PASTE_TIMEOUT_MS,
      'clipboard-paste'
    );
  } catch (err) {
    // Paste failed - text is in clipboard but not pasted
    // This is a non-fatal error (partial success)
    throw createPasteFailureError();
  }

  // eslint-disable-next-line no-console
  console.log('[handleDictationAudio] done');
  return cleanedText;
}
