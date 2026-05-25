import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/chat');
}
export const dynamic = 'force-dynamic';
