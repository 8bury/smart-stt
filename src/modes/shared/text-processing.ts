import { OpenAI } from 'openai';

const logError = (context: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`[${context}]`, message, error);
};

/**
 * Limpa texto transcrito removendo hesitações, repetições e correções.
 * Usa GPT-5-nano para processar o texto.
 *
 * @param text - Texto bruto transcrito do áudio
 * @param apiKey - Chave da API OpenAI
 * @param language - Idioma do texto ('pt' ou 'en')
 * @returns Texto limpo e processado
 */
export async function cleanText(
  text: string,
  apiKey: string,
  language: 'pt' | 'en',
): Promise<string> {
  const client = new OpenAI({ apiKey });
  const languageLabel = language === 'en' ? 'English' : 'Portuguese';

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-5-nano',
      messages: [
        {
          role: 'system',
          content: `You receive a raw speech transcript in ${languageLabel}. Remove hesitations, repetitions, and earlier corrections (keep only the final intended message), keep the manerisms and don't change the text if you don't have to do so. Reply only with the cleaned text in ${languageLabel}; do not translate or change the language.`,
        },
        { role: 'user', content: text },
      ],
      temperature: 1,
    });

    return response.choices[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    logError('cleanText', err);
    throw err;
  }
}
