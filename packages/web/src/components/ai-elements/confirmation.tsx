'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { createContext, useContext, useMemo } from 'react';

export type ApprovalState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-denied'
  | 'output-available'
  | 'output-error';

export type ApprovalInfo =
  | { id: string; approved?: never; reason?: never }
  | { id: string; approved: boolean; reason?: string };

type ContextValue = {
  approval: ApprovalInfo | undefined;
  state: ApprovalState;
  toolName: string;
  toolInput: Record<string, unknown>;
};

const Context = createContext<ContextValue | null>(null);

export const useConfirmation = () => {
  const ctx = useContext(Context);
  if (!ctx) throw new Error('Must be used within Confirmation');
  return ctx;
};

type ConfirmationProps = ComponentPropsWithoutRef<typeof Alert> & {
  approval?: ApprovalInfo;
  state: ApprovalState;
  toolName: string;
  toolInput: Record<string, unknown>;
};

export const Confirmation = ({ className, approval, state, toolName, toolInput, ...props }: ConfirmationProps) => {
  const ctx = useMemo(() => ({ approval, state, toolName, toolInput }), [approval, state, toolName, toolInput]);

  if (!approval || state === 'input-streaming' || state === 'input-available') return null;

  return (
    <Context.Provider value={ctx}>
      <Alert className={cn('flex flex-col gap-2', className)} {...props} />
    </Context.Provider>
  );
};

export const ConfirmationTitle = ({ className, ...props }: ComponentPropsWithoutRef<typeof AlertDescription>) =>
  <AlertDescription className={cn('inline', className)} {...props} />;

const isTerminalState = (state: ApprovalState) =>
  state === 'approval-responded' || state === 'output-denied' || state === 'output-available';

export const ConfirmationRequest = ({ children }: { children?: ReactNode }) => {
  const { state } = useConfirmation();
  return state === 'approval-requested' ? children : null;
};

export const ConfirmationAccepted = ({ children }: { children?: ReactNode }) => {
  const { approval, state } = useConfirmation();
  return approval?.approved && isTerminalState(state) ? children : null;
};

export const ConfirmationRejected = ({ children }: { children?: ReactNode }) => {
  const { approval, state } = useConfirmation();
  return approval?.approved === false && isTerminalState(state) ? children : null;
};

export const ConfirmationActions = ({ className, ...props }: ComponentPropsWithoutRef<'div'>) => {
  const { state } = useConfirmation();
  return state === 'approval-requested'
    ? <div className={cn('flex items-center justify-end gap-2 self-end', className)} {...props} />
    : null;
};

export const ConfirmationAction = (props: ComponentPropsWithoutRef<typeof Button>) =>
  <Button className='h-8 px-3 text-sm' type='button' {...props} />;