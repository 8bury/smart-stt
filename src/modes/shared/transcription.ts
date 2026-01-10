import { OpenAI } from 'openai';
import { toFile } from 'openai/uploads';
import { withRetry, createAPIRetryConfig } from '../../utils/retry';
import { withTimeout } from '../../utils/timeout';
import { createEmptyAudioError, categorizeAPIError, logError } from '../../utils/errors';

// Timeout for Whisper transcription: 30 seconds
const WHISPER_TIMEOUT_MS = 30000;

/**
 * Transcreve áudio usando a API Whisper da OpenAI.
 *
 * @param buffer - Buffer de áudio em formato WebM
 * @param apiKey - Chave da API OpenAI
 * @param language - Idioma para transcrição ('pt' ou 'en')
 * @returns Texto transcrito do áudio
 * @throws SmartSTTError se o áudio estiver vazio ou se a API falhar
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
    throw createEmptyAudioError();
  }

  try {
    const file = await toFile(buffer, 'audio.webm', { type: 'audio/webm' });

    // Wrap API call with retry logic and timeout
    const response = await withRetry(
      () => withTimeout(
        () => client.audio.transcriptions.create({
          file,
          model: 'whisper-1',
          language,
        }),
        WHISPER_TIMEOUT_MS,
        'whisper-transcription'
      ),
      createAPIRetryConfig()
    );

    return response.text;
  } catch (err) {
    // Categorize and rethrow error
    const smartError = categorizeAPIError(err);
    logError('transcribeAudio', smartError);
    throw smartError;
  }
}
