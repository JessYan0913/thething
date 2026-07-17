'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
  HelpCircleIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface QuestionItem {
  question: string;
  header: string;
  options: string[];
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
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<number, string | string[]>>({});
  const [customText, setCustomText] = React.useState<Record<number, string>>({});
  const [showCancelDialog, setShowCancelDialog] = React.useState(false);

  if (!isOpen || questions.length === 0) return null;

  const current = questions[currentIndex];
  const total = questions.length;
  const isFirst = currentIndex === 0;
  const isLast = currentIndex === total - 1;

  const isMulti = current.multiSelect === true;

  const currentAnswer = answers[currentIndex];
  const currentCustom = customText[currentIndex] || '';
  const hasCustomAnswer = currentAnswer === '__custom__' || (typeof currentAnswer === 'string' && currentAnswer.startsWith('__custom__'));

  const isAnswered = isMulti
    ? Array.isArray(currentAnswer) && currentAnswer.length > 0
    : currentAnswer !== undefined &&
      (currentAnswer !== '__custom__' || currentCustom.trim().length > 0);

  const allAnswered = questions.every((_, i) => {
    const a = answers[i];
    if (Array.isArray(a)) return a.length > 0;
    if (a === '__custom__') return (customText[i] || '').trim().length > 0;
    if (typeof a === 'string' && a.startsWith('__custom__')) return a.replace('__custom__', '').trim().length > 0;
    return a !== undefined;
  });

  /** 对于单选用 isSelectedCircle，多选用 isCheckedBox */
  const isOptionSelected = (optIdx: number) => {
    if (isMulti) {
      return Array.isArray(currentAnswer) && currentAnswer.includes(current.options[optIdx]);
    }
    return currentAnswer === current.options[optIdx];
  };

  const toggleOption = (optIdx: number) => {
    const label = current.options[optIdx];
    if (isMulti) {
      const currentSel = (Array.isArray(currentAnswer) ? currentAnswer : []) as string[];
      const next = currentSel.includes(label)
        ? currentSel.filter(o => o !== label)
        : [...currentSel, label];
      setAnswers({ ...answers, [currentIndex]: next });
    } else {
      // Single select: select this option, deselect custom
      setAnswers({ ...answers, [currentIndex]: label });
      // Clear custom if it was selected
      if (hasCustomAnswer) {
        const newCustom = { ...customText };
        delete newCustom[currentIndex];
        setCustomText(newCustom);
      }
    }
  };

  const selectCustom = () => {
    if (isMulti) return; // Custom not supported for multi-select
    setAnswers({ ...answers, [currentIndex]: '__custom__' });
  };

  const deselectCustom = () => {
    if (hasCustomAnswer) {
      const newAnswers = { ...answers };
      delete newAnswers[currentIndex];
      setAnswers(newAnswers);
      const newCustom = { ...customText };
      delete newCustom[currentIndex];
      setCustomText(newCustom);
    }
  };

  const handleCustomInput = (value: string) => {
    setCustomText({ ...customText, [currentIndex]: value });
    if (value.trim()) {
      setAnswers({ ...answers, [currentIndex]: `__custom__${value}` });
    } else {
      // If empty, revert to custom state (input still shows)
      setAnswers({ ...answers, [currentIndex]: '__custom__' });
    }
  };

  const goNext = () => {
    if (isAnswered && !isLast) setCurrentIndex(currentIndex + 1);
  };

  const goPrev = () => {
    if (!isFirst) setCurrentIndex(currentIndex - 1);
  };

  const handleComplete = () => {
    const final: Record<string, string | string[]> = {};
    questions.forEach((q, i) => {
      const key = q.header || `question_${i}`;
      let val = answers[i];
      if (typeof val === 'string' && val.startsWith('__custom__')) {
        val = val.replace(/^__custom__/, '');
      }
      final[key] = val || '';
    });
    onComplete(final);
  };

  return (
    <>
      <div className="shrink-0 bg-background/95 backdrop-blur">
        <div className="px-4 py-3 space-y-3">
          {/* Header row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex size-6 items-center justify-center rounded-md bg-blue-100 dark:bg-blue-900/30 shrink-0">
                <HelpCircleIcon className="size-3.5 text-blue-600 dark:text-blue-400" />
              </div>
              <span className="text-sm font-semibold truncate">问题 {currentIndex + 1}/{total}</span>
            </div>
            <button
              className="size-6 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-accent shrink-0"
              onClick={() => setShowCancelDialog(true)}
              title="取消"
            >
              <XIcon className="size-3.5" />
            </button>
          </div>

          {/* Step indicators */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              {questions.map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    'h-2 rounded-full transition-all duration-200',
                    i === currentIndex
                      ? 'w-5 bg-blue-500'
                      : answers[i] !== undefined || (answers[i] === '__custom__' && (customText[i] || '').trim())
                        ? 'w-2 bg-green-400'
                        : 'w-2 bg-muted-foreground/25',
                  )}
                />
              ))}
            </div>
            <span className="text-[11px] text-muted-foreground/60 ml-auto tabular-nums">
              {currentIndex + 1}/{total}
            </span>
          </div>

          {/* Question */}
          <p className="text-sm font-medium leading-relaxed">{current.question}</p>

          {/* Options */}
          <div className="space-y-1">
            {current.options.map((opt, optIdx) => (
              <label
                key={optIdx}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors',
                  isOptionSelected(optIdx)
                    ? isMulti
                      ? 'bg-accent/70 ring-1 ring-accent'
                      : 'bg-primary/5 ring-1 ring-primary/20'
                    : 'hover:bg-accent/30',
                )}
              >
                {/* Radio (single) or Checkbox (multi) indicator */}
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded-[2px] border transition-colors',
                    isOptionSelected(optIdx)
                      ? isMulti
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-primary bg-primary'
                      : 'border-muted-foreground/30',
                    !isMulti && 'rounded-full', // Radio = circle
                  )}
                >
                  {isOptionSelected(optIdx) && (
                    isMulti ? (
                      <CheckCircleIcon className="size-3" />
                    ) : (
                      <span className="size-1.5 rounded-full bg-primary-foreground" />
                    )
                  )}
                </span>
                <span className="text-sm">{opt}</span>
              </label>
            ))}

            {/* Custom answer (single-select only) */}
            {!isMulti && (
              <div className="space-y-1">
                <label
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors',
                    hasCustomAnswer
                      ? 'bg-primary/5 ring-1 ring-primary/20'
                      : 'hover:bg-accent/30',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                      hasCustomAnswer
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground/30',
                    )}
                    onClick={hasCustomAnswer ? deselectCustom : selectCustom}
                  >
                    {hasCustomAnswer && <span className="size-1.5 rounded-full bg-primary-foreground" />}
                  </span>
                  <span className="text-sm">其他</span>
                </label>
                {hasCustomAnswer && (
                  <div className="pl-10 pr-3 pb-1">
                    <Input
                      className="h-8 text-sm"
                      placeholder="输入自定义答案..."
                      value={currentCustom}
                      onChange={(e) => handleCustomInput(e.target.value)}
                      autoFocus
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={goPrev}
              disabled={isFirst}
            >
              <ChevronLeftIcon className="size-3.5 mr-1" />
              上一题
            </Button>

            {!isLast ? (
              <Button
                variant="default"
                size="sm"
                className="h-8 text-xs"
                onClick={goNext}
                disabled={!isAnswered}
              >
                下一题
                <ChevronRightIcon className="size-3.5 ml-1" />
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                className="h-8 text-xs"
                onClick={handleComplete}
                disabled={!allAnswered}
              >
                <CheckCircleIcon className="size-3.5 mr-1" />
                完成提交
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Cancel confirmation dialog */}
      <Dialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>确认取消？</DialogTitle>
            <DialogDescription>
              当前问题的回答将不会被提交，Agent 将收到拒绝回应。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowCancelDialog(false)}
            >
              继续回答
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                setShowCancelDialog(false);
                onCancel();
              }}
            >
              确认取消
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
