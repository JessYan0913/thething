import { StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './globals.css'
import './i18n' // Initialize i18n before render
import App from './App'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ThemeProvider } from 'next-themes'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <Suspense fallback={<div className="flex h-screen items-center justify-center">Loading...</div>}>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </Suspense>
    </ThemeProvider>
  </StrictMode>,
)