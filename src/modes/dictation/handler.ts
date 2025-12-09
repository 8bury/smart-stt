import { clipboard } from 'electron';
import type { ClipboardOperations } from '../../clipboard';
import { transcribeAudio } from '../shared/transcription';
import { cleanText } from '../shared/text-processing';

/**
 * Processa áudio no modo de ditado.
 * Fluxo: Transcrever → Limpar texto → Copiar para clipboard → Colar
 *
 * @param buffer - Buffer de áudio em formato WebM
 * @param clipboardOps - Implementação de operações de clipboard específica da plataforma
 * @param apiKey - Chave da API OpenAI
 * @param language - Idioma para transcrição ('pt' ou 'en')
 * @returns Texto limpo e transcrito
 */
export async function handleDictationAudio(
  buffer: Buffer,
  clipboardOps: ClipboardOperations,
  apiKey: string,
  language: 'pt' | 'en',
): Promise<string> {
  // eslint-disable-next-line no-console
  console.log('[handleDictationAudio] start');

  const rawText = await transcribeAudio(buffer, apiKey, language);
  const cleanedText = await cleanText(rawText, apiKey, language);

  clipboard.writeText(cleanedText);

  try {
    await clipboardOps.simulatePaste();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Falha ao simular Ctrl+V, texto ficou no clipboard.', err);
  }

  // eslint-disable-next-line no-console
  console.log('[handleDictationAudio] done');
  return cleanedText;
}
