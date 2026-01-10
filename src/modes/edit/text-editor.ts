import { OpenAI } from 'openai';
import { withRetry, createAPIRetryConfig } from '../../utils/retry';
import { withTimeout } from '../../utils/timeout';
import { categorizeAPIError, logError } from '../../utils/errors';

// Timeout for GPT text editing: 20 seconds
const GPT_EDIT_TIMEOUT_MS = 20000;

/**
 * Aplica uma instrução de voz a um texto base usando GPT.
 *
 * @param instruction - Instrução transcrita do áudio do usuário
 * @param baseText - Texto original a ser editado
 * @param apiKey - Chave da API OpenAI
 * @param language - Idioma para a edição ('pt' ou 'en')
 * @returns Texto editado de acordo com a instrução
 * @throws SmartSTTError se a API falhar
 */
export async function applyInstructionToText(
  instruction: string,
  baseText: string,
  apiKey: string,
  language: 'pt' | 'en',
): Promise<string> {
  const client = new OpenAI({ apiKey });
  const languageLabel = language === 'en' ? 'English' : 'Portuguese';

  const systemPrompt = [
    'Você é um assistente de edição de textos.',
    'Recebe uma instrução do usuário e um texto base.',
    'Retorne somente o texto final editado, sem explicações ou marcações extras.',
    `Responda em ${languageLabel} preservando formatação útil (quebras, listas).`,
  ].join(' ');

  const userContent = `Instrução do usuário:\n${instruction.trim()}\n\nTexto base para editar:\n${baseText}`;

  try {
    // Wrap API call with retry logic and timeout
    const response = await withRetry(
      () => withTimeout(
        () => client.chat.completions.create({
          model: 'gpt-5-nano',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: 1,
        }),
        GPT_EDIT_TIMEOUT_MS,
        'gpt-edit-text'
      ),
      createAPIRetryConfig()
    );

    return response.choices[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    // Categorize and rethrow error
    const smartError = categorizeAPIError(err);
    logError('applyInstructionToText', smartError);
    throw smartError;
  }
}
