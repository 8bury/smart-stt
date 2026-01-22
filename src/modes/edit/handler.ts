import { clipboard } from 'electron';
import type { ClipboardOperations } from '../../clipboard';
import { transcribeAudio } from '../shared/transcription';
import { applyInstructionToText } from './text-editor';
import {
  CancelledError,
  createEditNoTextError,
  createEditEmptyInstructionError,
  createEditEmptyResultError,
  createCopyFailureError,
  createPasteFailureError,
  logError,
} from '../../utils/errors';
import { withTimeout } from '../../utils/timeout';

// Timeout for clipboard operations: 2 seconds
const CLIPBOARD_TIMEOUT_MS = 2000;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Captura texto selecionado ou do clipboard.
 * Simula Ctrl+C para capturar texto selecionado.
 *
 * @param clipboardOps - Implementação de operações de clipboard específica da plataforma
 * @returns Objeto com texto capturado e fonte ('selection' ou 'empty')
 * @throws SmartSTTError if copy operation fails
 */
export async function captureSelectedOrClipboardText(
  clipboardOps: ClipboardOperations,
): Promise<{ text: string; source: 'selection' | 'empty' }> {
  const previousClipboard = clipboard.readText();
  let selection = '';

  try {
    clipboard.clear();
  } catch (err) {
    logError('captureSelectedOrClipboardText:clear', err);
  }

  try {
    await withTimeout(
      () => clipboardOps.simulateCopy(),
      CLIPBOARD_TIMEOUT_MS,
      'clipboard-copy'
    );
    await delay(180);
    selection = clipboard.readText().trim();
  } catch (err) {
    // Copy failed - throw structured error
    throw createCopyFailureError();
  } finally {
    try {
      clipboard.writeText(previousClipboard);
    } catch (err) {
      logError('captureSelectedOrClipboardText:restore', err);
    }
  }

  const text = selection;
  const source = selection ? ('selection' as const) : ('empty' as const);

  return { text, source };
}

/**
 * Processa áudio no modo de edição.
 * Fluxo: Capturar texto base → Transcrever instrução → Aplicar instrução → Copiar resultado → Colar
 *
 * @param buffer - Buffer de áudio em formato WebM
 * @param clipboardOps - Implementação de operações de clipboard específica da plataforma
 * @param apiKey - Chave da API OpenAI
 * @param language - Idioma para transcrição ('pt' ou 'en')
 * @param pendingEditText - Texto base previamente capturado (opcional)
 * @returns Texto editado final
 * @throws SmartSTTError for various edit mode errors
 */
export async function handleEditAudio(
  buffer: Buffer,
  clipboardOps: ClipboardOperations,
  apiKey: string,
  language: 'pt' | 'en',
  pendingEditText: string | null,
  shouldCancel?: () => boolean,
): Promise<string> {
  if (shouldCancel?.()) {
    throw new CancelledError();
  }

  let baseText = pendingEditText;

  if (!baseText) {
    try {
      const { text } = await captureSelectedOrClipboardText(clipboardOps);
      if (text?.trim()) {
        baseText = text;
      }
    } catch (err) {
      logError('handleEditAudio:capture-fallback', err);
      throw err; // Propagate clipboard errors
    }
  }

  if (!baseText) {
    throw createEditNoTextError();
  }

  // eslint-disable-next-line no-console
  console.log('[handleEditAudio] start');

  const instruction = (await transcribeAudio(buffer, apiKey, language)).trim();
  if (shouldCancel?.()) {
    throw new CancelledError();
  }

  if (!instruction) {
    throw createEditEmptyInstructionError();
  }

  const editedText = await applyInstructionToText(
    instruction,
    baseText,
    apiKey,
    language,
  );
  if (shouldCancel?.()) {
    throw new CancelledError();
  }

  if (!editedText) {
    throw createEditEmptyResultError();
  }

  clipboard.writeText(editedText);

  if (shouldCancel?.()) {
    throw new CancelledError();
  }

  try {
    await withTimeout(
      () => clipboardOps.simulatePaste(),
      CLIPBOARD_TIMEOUT_MS,
      'clipboard-paste'
    );
  } catch (err) {
    // Paste failed - text is in clipboard but not pasted
    // This is a non-fatal error (partial success)
    throw createPasteFailureError();
  }

  // eslint-disable-next-line no-console
  console.log('[handleEditAudio] done');
  return editedText;
}
