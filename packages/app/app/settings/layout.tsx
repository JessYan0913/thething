'use client';

import { ReactNode } from 'react';
import SettingsLayout from '@/components/SettingsLayout';

export default function SettingsPageLayout({ children }: { children: ReactNode }) {
  return <SettingsLayout>{children}</SettingsLayout>;
}
