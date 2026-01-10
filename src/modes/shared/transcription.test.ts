import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transcribeAudio } from './transcription';
import { mockCreate } from '../../test-utils/openai-mocks';

vi.mock('openai', () => ({
  OpenAI: vi.fn().mockImplementation(() => ({
    audio: {
      transcriptions: {
        create: mockCreate,
      },
    },
  })),
  APIError: class APIError extends Error {
    status: number;
    code: string | null;
    type: string | null;
    constructor(
      status: number,
      message: string,
      code: string | null = null,
      type: string | null = null,
    ) {
      super(message);
      this.status = status;
      this.code = code;
      this.type = type;
      this.name = 'APIError';
    }
  },
}));

vi.mock('openai/uploads', () => ({
  toFile: vi.fn().mockResolvedValue({ name: 'audio.webm' }),
}));

describe('transcribeAudio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should throw an error for empty audio buffer', async () => {
    const emptyBuffer = Buffer.alloc(0);

    await expect(transcribeAudio(emptyBuffer, 'test-api-key', 'en')).rejects.toThrow(
      'Áudio vazio',
    );
  });

  it('should successfully transcribe audio with Portuguese language', async () => {
    const audioBuffer = Buffer.from('fake-audio-data');
    mockCreate.mockResolvedValueOnce({ text: 'Olá mundo' });

    const result = await transcribeAudio(audioBuffer, 'test-api-key', 'pt');

    expect(result).toBe('Olá mundo');
    expect(mockCreate).toHaveBeenCalledWith({
      file: expect.any(Object),
      model: 'whisper-1',
      language: 'pt',
    });
  });

  it('should successfully transcribe audio with English language', async () => {
    const audioBuffer = Buffer.from('fake-audio-data');
    mockCreate.mockResolvedValueOnce({ text: 'Hello world' });

    const result = await transcribeAudio(audioBuffer, 'test-api-key', 'en');

    expect(result).toBe('Hello world');
    expect(mockCreate).toHaveBeenCalledWith({
      file: expect.any(Object),
      model: 'whisper-1',
      language: 'en',
    });
  });

  it('should propagate API errors', async () => {
    const audioBuffer = Buffer.from('fake-audio-data');
    const { APIError } = await import('openai');
    const apiError = new APIError(401, 'Invalid API key');
    mockCreate.mockRejectedValueOnce(apiError);

    await expect(transcribeAudio(audioBuffer, 'invalid-key', 'en')).rejects.toThrow(
      'Invalid API key',
    );
  });

  it('should handle generic errors', async () => {
    const audioBuffer = Buffer.from('fake-audio-data');
    mockCreate.mockRejectedValueOnce(new Error('Network error'));

    await expect(transcribeAudio(audioBuffer, 'test-api-key', 'en')).rejects.toThrow(
      'Network error',
    );
  });
});
