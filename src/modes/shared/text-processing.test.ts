import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanText } from './text-processing';
import { mockCreate } from '../../test-utils/openai-mocks';

vi.mock('openai', () => ({
  OpenAI: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  })),
}));

describe('cleanText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should clean text in Portuguese', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Olá, tudo bem?' } }],
    });

    const result = await cleanText('Olá, é... tudo bem?', 'test-api-key', 'pt');

    expect(result).toBe('Olá, tudo bem?');
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-5-nano',
      messages: [
        {
          role: 'system',
          content: expect.stringContaining('Portuguese'),
        },
        { role: 'user', content: 'Olá, é... tudo bem?' },
      ],
      temperature: 1,
    });
  });

  it('should clean text in English', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Hello, how are you?' } }],
    });

    const result = await cleanText('Hello, um... how are you?', 'test-api-key', 'en');

    expect(result).toBe('Hello, how are you?');
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-5-nano',
      messages: [
        {
          role: 'system',
          content: expect.stringContaining('English'),
        },
        { role: 'user', content: 'Hello, um... how are you?' },
      ],
      temperature: 1,
    });
  });

  it('should return empty string when response content is null', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });

    const result = await cleanText('test', 'test-api-key', 'en');

    expect(result).toBe('');
  });

  it('should return empty string when choices array is empty', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [],
    });

    const result = await cleanText('test', 'test-api-key', 'en');

    expect(result).toBe('');
  });

  it('should trim whitespace from response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '  cleaned text  ' } }],
    });

    const result = await cleanText('test', 'test-api-key', 'en');

    expect(result).toBe('cleaned text');
  });

  it('should propagate API errors', async () => {
    mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

    // Errors are retried, so just expect any error to be thrown
    await expect(cleanText('test', 'test-api-key', 'en')).rejects.toThrow();
  });

  it('should include hesitation removal in system prompt', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'cleaned' } }],
    });

    await cleanText('test', 'test-api-key', 'en');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('hesitations'),
          }),
        ]),
      }),
    );
  });
});
