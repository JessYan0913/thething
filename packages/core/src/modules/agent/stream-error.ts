import { InvalidToolInputError } from 'ai';

const SAFE_ERROR_CODES = new Set(['ENOENT', 'EISDIR', 'ENOTDIR', 'EACCES']);
const SAFE_CODE_PATTERN = /\b(ENOENT|EISDIR|ENOTDIR|EACCES)\b/;
const REDACTED_ERROR_MESSAGE = 'An error occurred.';

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === 'string') return error;
  return undefined;
}

/**
 * AI SDK stream error handler.
 *
 * Only expected filesystem failures are safe to expose to the model/UI. Unknown
 * errors may contain provider responses, credentials, headers, or internal paths,
 * so they retain the SDK's generic redacted message.
 */
export function agentStreamOnError(error: unknown): string {
  // Model-produced malformed tool input: the message only describes the model's
  // own JSON/schema mistake, and exposing it lets the model repair and retry
  // instead of seeing an opaque "An error occurred.".
  if (InvalidToolInputError.isInstance(error)) {
    return `Invalid input for tool ${error.toolName}: ${error.message}`;
  }

  const message = getErrorMessage(error);
  const code = getErrorCode(error);

  if ((code && SAFE_ERROR_CODES.has(code)) || (message && SAFE_CODE_PATTERN.test(message))) {
    return message ?? code ?? REDACTED_ERROR_MESSAGE;
  }

  return REDACTED_ERROR_MESSAGE;
}

export { REDACTED_ERROR_MESSAGE };
