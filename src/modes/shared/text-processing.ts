import { OpenAI } from 'openai';
import { withRetry, createAPIRetryConfig } from '../../utils/retry';
import { withTimeout } from '../../utils/timeout';
import { categorizeAPIError, logError } from '../../utils/errors';

// Timeout for GPT text cleaning: 15 seconds
const GPT_CLEAN_TIMEOUT_MS = 15000;

/**
 * Limpa texto transcrito removendo hesitações, repetições e correções.
 * Usa GPT-5-nano para processar o texto.
 *
 * @param text - Texto bruto transcrito do áudio
 * @param apiKey - Chave da API OpenAI
 * @param language - Idioma do texto ('pt' ou 'en')
 * @returns Texto limpo e processado
 * @throws SmartSTTError se a API falhar
 */
export async function cleanText(
  text: string,
  apiKey: string,
  language: 'pt' | 'en',
): Promise<string> {
  const client = new OpenAI({ apiKey });
  const languageLabel = language === 'en' ? 'English' : 'Portuguese';

  try {
    // Wrap API call with retry logic and timeout
    const response = await withRetry(
      () => withTimeout(
        () => client.chat.completions.create({
          model: 'gpt-5-nano',
          messages: [
            {
              role: 'system',
              content: `You receive a raw speech transcript in ${languageLabel}. Remove hesitations, repetitions, and earlier corrections (keep only the final intended message), keep the manerisms and don't change the text if you don't have to do so. Reply only with the cleaned text in ${languageLabel}; do not translate or change the language.`,
            },
            { role: 'user', content: text },
          ],
          temperature: 1,
        }),
        GPT_CLEAN_TIMEOUT_MS,
        'gpt-clean-text'
      ),
      createAPIRetryConfig()
    );

    return response.choices[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    // Categorize and rethrow error
    const smartError = categorizeAPIError(err);
    logError('cleanText', smartError);
    throw smartError;
  }
}
