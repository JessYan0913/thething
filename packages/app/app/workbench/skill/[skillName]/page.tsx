'use client';

import { useParams } from 'next/navigation';
import SkillWorkbench from '@/components/SkillWorkbench';

export default function SkillWorkbenchPage() {
  const params = useParams();
  const skillName = params.skillName as string;
  
  return <SkillWorkbench skillName={skillName} />;
}
