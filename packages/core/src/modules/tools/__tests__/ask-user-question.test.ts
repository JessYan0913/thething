import { describe, expect, it } from 'vitest';
import { repairAskUserQuestionRawInput } from '../ask-user-question';

describe('repairAskUserQuestionRawInput', () => {
  it('parses a JSON-stringified questions array into an actual array', () => {
    // 复现真实场景：模型把 questions 序列化成字符串字面量
    const rawInput = JSON.stringify({
      questions:
        '[{"header":"功能类型","multiSelect":false,"options":["神经网络","AI","其他"],"question":"您是想问哪种功能？"}]',
    });

    const repaired = repairAskUserQuestionRawInput(rawInput);

    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!) as { questions: Array<{ header: string }> };
    expect(Array.isArray(parsed.questions)).toBe(true);
    expect(parsed.questions).toHaveLength(1);
    expect(parsed.questions[0].header).toBe('功能类型');
  });

  it('repairs a truncated stringified array (missing closing bracket)', () => {
    // 真实 DB 观测样本：字符串末尾缺 "]"
    const truncated =
      '[{"header": "神恶魔", "multiSelect": false, "options": ["图片", "视频", "文章", "其他"], "question": "您想让我处理神恶魔相关的什么内容？"}';
    const rawInput = JSON.stringify({ questions: truncated });

    const repaired = repairAskUserQuestionRawInput(rawInput);

    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!) as { questions: Array<{ header: string }> };
    expect(Array.isArray(parsed.questions)).toBe(true);
    expect(parsed.questions[0].header).toBe('神恶魔');
  });

  it('returns null when questions is already an array (no repair needed)', () => {
    const rawInput = JSON.stringify({
      questions: [
        { header: 'X', multiSelect: false, options: ['a', 'b'], question: 'q?' },
      ],
    });
    expect(repairAskUserQuestionRawInput(rawInput)).toBeNull();
  });

  it('returns null for an unrecoverable non-JSON questions string', () => {
    const rawInput = JSON.stringify({ questions: 'not json' });
    expect(repairAskUserQuestionRawInput(rawInput)).toBeNull();
  });

  it('returns null when the raw input itself is not valid JSON', () => {
    expect(repairAskUserQuestionRawInput('{invalid')).toBeNull();
  });

  it('returns null when questions parses to a non-array', () => {
    const rawInput = JSON.stringify({ questions: '{"header":"X"}' });
    expect(repairAskUserQuestionRawInput(rawInput)).toBeNull();
  });
});
