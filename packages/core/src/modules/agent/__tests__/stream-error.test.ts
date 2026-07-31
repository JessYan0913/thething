import { InvalidToolInputError } from 'ai';
import { describe, expect, it } from 'vitest';
import { agentStreamOnError, REDACTED_ERROR_MESSAGE } from '../stream-error';

describe('agentStreamOnError', () => {
  it.each(['ENOENT', 'EISDIR', 'ENOTDIR', 'EACCES'])('passes through safe filesystem error %s', (code) => {
    const error = Object.assign(new Error(`${code}: cannot access target`), { code });
    expect(agentStreamOnError(error)).toBe(`${code}: cannot access target`);
  });

  it('passes through a safe code embedded in a string error', () => {
    expect(agentStreamOnError('ENOENT: missing file')).toBe('ENOENT: missing file');
  });

  it('exposes invalid tool input errors so the model can repair the call', () => {
    const error = new InvalidToolInputError({
      toolName: 'save_wiki',
      toolInput: '{"actions": [not valid json',
      cause: new SyntaxError('Unexpected token n in JSON at position 13'),
    });
    const result = agentStreamOnError(error);
    expect(result).toContain('save_wiki');
    expect(result).not.toBe(REDACTED_ERROR_MESSAGE);
  });

  it('redacts unknown errors that may contain sensitive details', () => {
    expect(agentStreamOnError(new Error('Authorization: Bearer secret-token'))).toBe(REDACTED_ERROR_MESSAGE);
    expect(agentStreamOnError('provider response included api_key=secret')).toBe(REDACTED_ERROR_MESSAGE);
    expect(agentStreamOnError({ message: 'internal database failure' })).toBe(REDACTED_ERROR_MESSAGE);
  });
});
