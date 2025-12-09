import { APIError, OpenAI } from 'openai';
import { toFile } from 'openai/uploads';

const logError = (context: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-console
  console.error(`[${context}]`, message, error);
};

/**
 * Transcreve áudio usando a API Whisper da OpenAI.
 *
 * @param buffer - Buffer de áudio em formato WebM
 * @param apiKey - Chave da API OpenAI
 * @param language - Idioma para transcrição ('pt' ou 'en')
 * @returns Texto transcrito do áudio
 * @throws Error se o áudio estiver vazio ou se a API falhar
 */
export async function transcribeAudio(
  buffer: Buffer,
  apiKey: string,
  language: 'pt' | 'en',
): Promise<string> {
  const client = new OpenAI({ apiKey });

  // eslint-disable-next-line no-console
  console.log('[transcribeAudio] size(bytes)=', buffer.length);

  // log primeiros bytes para garantir não estar vazio/corrompido
  const sample = buffer.subarray(0, Math.min(24, buffer.length)).toString('hex');
  // eslint-disable-next-line no-console
  console.log('[transcribeAudio] head(hex)=', sample);

  if (buffer.length === 0) {
    throw new Error('Áudio vazio');
  }

  try {
    const file = await toFile(buffer, 'audio.webm', { type: 'audio/webm' });
    const response = await client.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language,
    });
    return response.text;
  } catch (err) {
    if (err instanceof APIError) {
      const apiErr = err as APIError & { response?: { data?: unknown } };
      // eslint-disable-next-line no-console
      console.error(
        '[transcribeAudio] APIError',
        apiErr.status,
        apiErr.code,
        apiErr.type,
        apiErr.message,
        apiErr.stack,
      );
      // eslint-disable-next-line no-console
      console.error('[transcribeAudio] response data', apiErr.response?.data);
    }
    logError('transcribeAudio', err);
    throw err;
  }
}
