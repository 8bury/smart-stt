import { OpenAI } from 'openai';

/**
 * Aplica uma instrução de voz a um texto base usando GPT.
 *
 * @param instruction - Instrução transcrita do áudio do usuário
 * @param baseText - Texto original a ser editado
 * @param apiKey - Chave da API OpenAI
 * @param language - Idioma para a edição ('pt' ou 'en')
 * @returns Texto editado de acordo com a instrução
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

  const response = await client.chat.completions.create({
    model: 'gpt-5-nano',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: 1,
  });

  return response.choices[0]?.message?.content?.trim() ?? '';
}
