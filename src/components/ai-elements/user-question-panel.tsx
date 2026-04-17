'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MessageCircleQuestionIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';

interface QuestionItem {
  question: string;
  header: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

interface UserQuestionPanelProps {
  isOpen: boolean;
  questions: QuestionItem[];
  onComplete: (answers: Record<string, string | string[]>) => void;
  onCancel: () => void;
}

export function UserQuestionPanel({
  isOpen,
  questions,
  onComplete,
  onCancel,
}: UserQuestionPanelProps) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<number, string | string[]>>({});
  const [customInputs, setCustomInputs] = React.useState<Record<number, string>>({});
  const [showCustomInput, setShowCustomInput] = React.useState<Set<number>>(new Set());

  if (!isOpen || questions.length === 0) return null;

  const currentQuestion = questions[currentQuestionIndex];
  const totalQuestions = questions.length;
  const isFirstQuestion = currentQuestionIndex === 0;
  const isLastQuestion = currentQuestionIndex === totalQuestions - 1;

  const isCustomInputVisible = showCustomInput.has(currentQuestionIndex);
  const currentCustomInput = customInputs[currentQuestionIndex] || '';

  // 当前问题是否已回答
  const currentAnswered = answers[currentQuestionIndex] !== undefined || (isCustomInputVisible && currentCustomInput.trim());

  // 所有问题是否都已回答
  const allAnswered = questions.every((_, idx) =>
    answers[idx] !== undefined || answers[idx] === 'custom'
  );

  const handleOptionSelect = (optionLabel: string) => {
    if (currentQuestion.multiSelect) {
      const current = (answers[currentQuestionIndex] as string[] | undefined) || [];
      const newSelection = current.includes(optionLabel)
        ? current.filter(o => o !== optionLabel)
        : [...current, optionLabel];
      setAnswers({ ...answers, [currentQuestionIndex]: newSelection });
    } else {
      setAnswers({ ...answers, [currentQuestionIndex]: optionLabel });
      setShowCustomInput(prev => {
        const next = new Set(prev);
        next.delete(currentQuestionIndex);
        return next;
      });
      setCustomInputs(prev => {
        const next = { ...prev };
        delete next[currentQuestionIndex];
        return next;
      });
    }
  };

  const handleNext = () => {
    if (currentAnswered && !isLastQuestion) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    }
  };

  const handlePrev = () => {
    if (!isFirstQuestion) {
      setCurrentQuestionIndex(currentQuestionIndex - 1);
    }
  };

  const handleComplete = () => {
    // 转换为以 header 为 key 的格式
    const finalAnswers: Record<string, string | string[]> = {};
    questions.forEach((q, idx) => {
      const header = q.header || `question_${idx}`;
      let answer = answers[idx] || '';
      if (typeof answer === 'string' && answer.startsWith('__custom__')) {
        answer = answer.replace(/^__custom__/, '');
      }
      finalAnswers[header] = answer;
    });
    onComplete(finalAnswers);
  };

  // 获取当前选中状态
  const isSelected = (optionLabel: string) => {
    if (currentQuestion.multiSelect) {
      return (answers[currentQuestionIndex] as string[] | undefined)?.includes(optionLabel);
    }
    const answer = answers[currentQuestionIndex];
    if (typeof answer === 'string' && answer.startsWith('__custom__')) return false;
    return answer === optionLabel;
  };

  return (
    <div className='shrink-0 border-b bg-background/95 backdrop-blur'>
      <div className='px-4 py-3'>
        {/* 标题行 */}
        <div className='flex items-center gap-2 mb-3'>
          <MessageCircleQuestionIcon className='size-4 text-blue-500' />
          <span className='text-sm font-medium'>信息收集</span>
          <div className='flex items-center gap-1 ml-2'>
            {questions.map((_, idx) => (
              <div
                key={idx}
                className={cn(
                  'size-1.5 rounded-full transition-colors',
                  idx === currentQuestionIndex
                    ? 'bg-blue-500'
                    : answers[idx] !== undefined
                      ? 'bg-green-500'
                      : 'bg-muted-foreground/30'
                )}
              />
            ))}
          </div>
          <span className='text-xs text-muted-foreground ml-1'>
            {currentQuestionIndex + 1}/{totalQuestions}
          </span>
          <button
            className='ml-auto h-6 px-2 text-muted-foreground hover:text-foreground transition-colors'
            onClick={onCancel}
          >
            <XIcon className='size-3' />
          </button>
        </div>

        {/* 当前问题 */}
        <div className='mb-3'>
          <p className='text-sm font-medium mb-3'>{currentQuestion.question}</p>

          {/* 选项列表 */}
          <div className='space-y-1.5'>
            {currentQuestion.options.map((opt, optIdx) => (
              <label
                key={optIdx}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-1.5 rounded-md cursor-pointer transition-colors',
                  isSelected(opt.label)
                    ? 'bg-accent/60'
                    : 'hover:bg-accent/30'
                )}
              >
                <Checkbox
                  className='shrink-0'
                  checked={isSelected(opt.label)}
                  onCheckedChange={() => handleOptionSelect(opt.label)}
                />
                <span className='text-sm font-medium'>{opt.label}</span>
              </label>
            ))}

            {/* 自定义输入 */}
            <label
              className={cn(
                'flex items-center gap-2.5 px-3 py-1.5 rounded-md cursor-pointer transition-colors',
                isCustomInputVisible || answers[currentQuestionIndex] === 'custom'
                  ? 'bg-accent/60'
                  : 'hover:bg-accent/30'
              )}
            >
              <Checkbox
                className='shrink-0'
                checked={isCustomInputVisible || answers[currentQuestionIndex] === 'custom'}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setShowCustomInput(prev => new Set(prev).add(currentQuestionIndex));
                    if (!currentQuestion.multiSelect) {
                      setAnswers({ ...answers, [currentQuestionIndex]: 'custom' });
                    }
                  } else {
                    setShowCustomInput(prev => {
                      const next = new Set(prev);
                      next.delete(currentQuestionIndex);
                      return next;
                    });
                    setCustomInputs(prev => {
                      const next = { ...prev };
                      delete next[currentQuestionIndex];
                      return next;
                    });
                    if (answers[currentQuestionIndex] === 'custom') {
                      const newAnswers = { ...answers };
                      delete newAnswers[currentQuestionIndex];
                      setAnswers(newAnswers);
                    }
                  }
                }}
              />
              {isCustomInputVisible ? (
                <Input
                  className='h-7 text-sm flex-1'
                  placeholder='输入自定义答案...'
                  value={currentCustomInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    setCustomInputs(prev => ({ ...prev, [currentQuestionIndex]: value }));
                    if (value.trim()) {
                      setAnswers({ ...answers, [currentQuestionIndex]: `__custom__${value}` });
                    } else {
                      const newAnswers = { ...answers };
                      delete newAnswers[currentQuestionIndex];
                      setAnswers(newAnswers);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !currentCustomInput.trim()) {
                      e.preventDefault();
                    }
                  }}
                  autoFocus
                />
              ) : (
                <span className='text-sm font-medium'>其他答案</span>
              )}
            </label>
          </div>
        </div>

        {/* 导航按钮 */}
        <div className='flex items-center justify-between gap-2'>
          <Button
            variant='ghost'
            size='sm'
            className='h-7'
            onClick={handlePrev}
            disabled={isFirstQuestion}
          >
            <ChevronLeftIcon className='size-4' />
            上一题
          </Button>

          <div className='flex items-center gap-2'>
            {!isLastQuestion ? (
              <Button
                size='sm'
                className='h-7'
                onClick={handleNext}
                disabled={!currentAnswered}
              >
                下一题
                <ChevronRightIcon className='size-4' />
              </Button>
            ) : (
              <Button
                size='sm'
                className='h-7'
                onClick={handleComplete}
                disabled={!allAnswered}
              >
                <CheckCircleIcon className='size-3 mr-1' />
                完成提交
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}