import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyInstructionToText } from './text-editor';
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

describe('applyInstructionToText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should apply instruction to text in Portuguese', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Texto editado em português' } }],
    });

    const result = await applyInstructionToText(
      'Corrija os erros',
      'Texto com erros',
      'test-api-key',
      'pt',
    );

    expect(result).toBe('Texto editado em português');
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-5-nano',
      messages: [
        {
          role: 'system',
          content: expect.stringContaining('Portuguese'),
        },
        {
          role: 'user',
          content: expect.stringContaining('Corrija os erros'),
        },
      ],
      temperature: 1,
    });
  });

  it('should apply instruction to text in English', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'Edited text in English' } }],
    });

    const result = await applyInstructionToText(
      'Fix the grammar',
      'Text with errors',
      'test-api-key',
      'en',
    );

    expect(result).toBe('Edited text in English');
    expect(mockCreate).toHaveBeenCalledWith({
      model: 'gpt-5-nano',
      messages: [
        {
          role: 'system',
          content: expect.stringContaining('English'),
        },
        {
          role: 'user',
          content: expect.stringContaining('Fix the grammar'),
        },
      ],
      temperature: 1,
    });
  });

  it('should include base text in user content', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'result' } }],
    });

    await applyInstructionToText('instruction', 'base text here', 'test-api-key', 'en');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('base text here'),
          }),
        ]),
      }),
    );
  });

  it('should trim instruction whitespace', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'result' } }],
    });

    await applyInstructionToText('  instruction with spaces  ', 'base text', 'test-api-key', 'en');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'user',
            content: expect.stringContaining('instruction with spaces'),
          }),
        ]),
      }),
    );
  });

  it('should return empty string when response content is null', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });

    const result = await applyInstructionToText('instruction', 'base', 'test-api-key', 'en');

    expect(result).toBe('');
  });

  it('should return empty string when choices array is empty', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [],
    });

    const result = await applyInstructionToText('instruction', 'base', 'test-api-key', 'en');

    expect(result).toBe('');
  });

  it('should trim whitespace from response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '  edited result  ' } }],
    });

    const result = await applyInstructionToText('instruction', 'base', 'test-api-key', 'en');

    expect(result).toBe('edited result');
  });

  it('should propagate API errors', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API connection failed'));

    await expect(
      applyInstructionToText('instruction', 'base', 'test-api-key', 'en'),
    ).rejects.toThrow('API connection failed');
  });

  it('should include system prompt about text editing assistant', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'result' } }],
    });

    await applyInstructionToText('instruction', 'base', 'test-api-key', 'pt');

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: 'system',
            content: expect.stringContaining('assistente de edição'),
          }),
        ]),
      }),
    );
  });
});
