import { clipboard } from 'electron';
import type { ClipboardOperations } from '../../clipboard';
import { transcribeAudio } from '../shared/transcription';
import { applyInstructionToText } from './text-editor';

const logError = (context: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`[${context}]`, message, error);
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Captura texto selecionado ou do clipboard.
 * Simula Ctrl+C para capturar texto selecionado.
 *
 * @param clipboardOps - Implementação de operações de clipboard específica da plataforma
 * @returns Objeto com texto capturado e fonte ('selection' ou 'empty')
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
    await clipboardOps.simulateCopy();
    await delay(180);
    selection = clipboard.readText().trim();
  } catch (err) {
    logError('captureSelectedOrClipboardText:copy', err);
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
 */
export async function handleEditAudio(
  buffer: Buffer,
  clipboardOps: ClipboardOperations,
  apiKey: string,
  language: 'pt' | 'en',
  pendingEditText: string | null,
): Promise<string> {
  let baseText = pendingEditText;

  if (!baseText) {
    try {
      const { text } = await captureSelectedOrClipboardText(clipboardOps);
      if (text?.trim()) {
        baseText = text;
      }
    } catch (err) {
      logError('handleEditAudio:capture-fallback', err);
    }
  }

  if (!baseText) {
    throw new Error(
      'Nenhum texto disponível para editar. Selecione ou copie e tente novamente.',
    );
  }

  // eslint-disable-next-line no-console
  console.log('[handleEditAudio] start');

  const instruction = (await transcribeAudio(buffer, apiKey, language)).trim();
  if (!instruction) {
    throw new Error('Instrução de edição vazia.');
  }

  const editedText = await applyInstructionToText(
    instruction,
    baseText,
    apiKey,
    language,
  );
  if (!editedText) {
    throw new Error('A LLM retornou texto vazio ao editar.');
  }

  clipboard.writeText(editedText);

  try {
    await clipboardOps.simulatePaste();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      'Falha ao simular Ctrl+V no modo edição; texto ficou no clipboard.',
      err,
    );
  }

  // eslint-disable-next-line no-console
  console.log('[handleEditAudio] done');
  return editedText;
}
