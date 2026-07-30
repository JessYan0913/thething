import { describe, it, expect } from 'vitest';
import type { UIMessage } from 'ai';
import { sanitizeToolErrorInputs, fixDoubleSerializedArguments } from '../sanitize-messages';

function makeAssistantMessage(parts: unknown[]): UIMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    parts: parts as UIMessage['parts'],
  } as UIMessage;
}

describe('sanitizeToolErrorInputs', () => {
  it('parses rawInput string into object for error-state tool parts', () => {
    const rawInput = JSON.stringify({ pageName: 'test-page' });
    const msg = makeAssistantMessage([
      { type: 'tool-read_wiki_page', toolCallId: 'call_1', state: 'output-error', rawInput, errorText: 'boom' },
    ]);

    const [result] = sanitizeToolErrorInputs([msg]);
    const part = result.parts[0] as Record<string, unknown>;
    expect(part.input).toEqual({ pageName: 'test-page' });
  });

  it('uses empty object when rawInput is not valid JSON', () => {
    const msg = makeAssistantMessage([
      { type: 'tool-save_wiki', toolCallId: 'call_2', state: 'output-error', rawInput: 'not json{', errorText: 'err' },
    ]);

    const [result] = sanitizeToolErrorInputs([msg]);
    const part = result.parts[0] as Record<string, unknown>;
    expect(part.input).toEqual({});
  });

  it('uses rawInput directly when it is already an object', () => {
    const input = { actions: [{ action: 'replace' }] };
    const msg = makeAssistantMessage([
      { type: 'tool-save_wiki', toolCallId: 'call_3', state: 'output-error', rawInput: input, errorText: 'err' },
    ]);

    const [result] = sanitizeToolErrorInputs([msg]);
    const part = result.parts[0] as Record<string, unknown>;
    expect(part.input).toBe(input);
  });

  it('parses string input to object for error-state tool parts', () => {
    const msg = makeAssistantMessage([
      { type: 'tool-web_fetch', toolCallId: 'call_4', state: 'output-error', input: '{"url":"https://x.com"}', errorText: 'err' },
    ]);

    const [result] = sanitizeToolErrorInputs([msg]);
    const part = result.parts[0] as Record<string, unknown>;
    expect(part.input).toEqual({ url: 'https://x.com' });
  });

  it('does not modify non-error tool parts', () => {
    const output = { found: true, content: 'hello' };
    const msg = makeAssistantMessage([
      { type: 'tool-read_wiki_page', toolCallId: 'call_5', state: 'output-available', input: { pageName: 'x' }, output },
    ]);

    const [result] = sanitizeToolErrorInputs([msg]);
    expect(result.parts[0]).toBe(msg.parts[0]);
  });

  it('does not modify non-assistant messages', () => {
    const userMsg: UIMessage = {
      id: 'u1',
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
    } as UIMessage;

    const [result] = sanitizeToolErrorInputs([userMsg]);
    expect(result).toBe(userMsg);
  });

  it('returns same reference when no changes are needed', () => {
    const msg = makeAssistantMessage([
      { type: 'text', text: 'hello' },
    ]);

    const [result] = sanitizeToolErrorInputs([msg]);
    expect(result).toBe(msg);
  });

  it('handles messages with no parts array', () => {
    const msg = { id: 'm1', role: 'assistant' } as unknown as UIMessage;
    const [result] = sanitizeToolErrorInputs([msg]);
    expect(result).toBe(msg);
  });
});

describe('fixDoubleSerializedArguments', () => {
  it('unwraps double-serialized arguments string', () => {
    const args = JSON.stringify(JSON.stringify({ action: 'create', name: 'test' }));
    const body = {
      model: 'test',
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'save_wiki', arguments: args } },
          ],
        },
      ],
    };

    const result = fixDoubleSerializedArguments(body);
    const tc = result.messages[1].tool_calls[0];
    expect(tc.function.arguments).toBe(JSON.stringify({ action: 'create', name: 'test' }));
  });

  it('does not modify normal (single-serialized) arguments', () => {
    const args = JSON.stringify({ action: 'create', name: 'test' });
    const body = {
      model: 'test',
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'save_wiki', arguments: args } },
          ],
        },
      ],
    };

    const result = fixDoubleSerializedArguments(body);
    expect(result).toBe(body); // same reference — no changes
  });

  it('handles multiple tool calls, some double-serialized some not', () => {
    const normalArgs = JSON.stringify({ a: 1 });
    const doubleArgs = JSON.stringify(JSON.stringify({ b: 2 }));
    const body = {
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'tool_a', arguments: normalArgs } },
            { id: 'call_2', type: 'function', function: { name: 'tool_b', arguments: doubleArgs } },
          ],
        },
      ],
    };

    const result = fixDoubleSerializedArguments(body);
    expect(result.messages[0].tool_calls[0].function.arguments).toBe(normalArgs);
    expect(result.messages[0].tool_calls[1].function.arguments).toBe(JSON.stringify({ b: 2 }));
  });

  it('leaves invalid JSON arguments untouched', () => {
    const body = {
      messages: [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'call_1', type: 'function', function: { name: 'tool_a', arguments: 'not json{' } },
          ],
        },
      ],
    };

    const result = fixDoubleSerializedArguments(body);
    expect(result).toBe(body); // same reference — no changes
  });

  it('handles body without messages array', () => {
    const body = { model: 'test' };
    const result = fixDoubleSerializedArguments(body);
    expect(result).toBe(body);
  });

  it('handles messages without tool_calls', () => {
    const body = {
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
    };
    const result = fixDoubleSerializedArguments(body);
    expect(result).toBe(body);
  });
});
