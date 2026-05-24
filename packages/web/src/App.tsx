import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ChatLayout from './routes/ChatLayout'
import ChatHome from './routes/ChatHome'
import { Spinner } from './components/ui/spinner'

const ChatPage = lazy(() => import('./routes/ChatPage'))
const SettingsLayout = lazy(() => import('./routes/SettingsLayout'))
const SettingsIndex = lazy(() => import('./routes/SettingsIndex'))
const GeneralSettings = lazy(() => import('./routes/GeneralSettings'))
const McpSettings = lazy(() => import('./routes/McpSettings'))
const SkillsSettings = lazy(() => import('./routes/SkillsSettings'))
const AgentsSettings = lazy(() => import('./routes/AgentsSettings'))
const PermissionsSettings = lazy(() => import('./routes/PermissionsSettings'))
const MemorySettings = lazy(() => import('./routes/MemorySettings'))
const ConnectorsSettings = lazy(() => import('./routes/ConnectorsSettings'))
const SkillWorkbench = lazy(() => import('./routes/SkillWorkbench'))
const AgentWorkbench = lazy(() => import('./routes/AgentWorkbench'))

function RouteFallback() {
  return (
    <div className="flex flex-1 items-center justify-center text-muted-foreground">
      <Spinner className="size-5" />
    </div>
  )
}

export default function App() {
  const { i18n } = useTranslation()

  // Update HTML lang attribute when language changes
  useEffect(() => {
    document.documentElement.lang = i18n.language
  }, [i18n.language])

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/skill-workbench" element={<SkillWorkbench />} />
          <Route path="/skill-workbench/:skillName" element={<SkillWorkbench />} />
          <Route path="/agent-workbench" element={<AgentWorkbench />} />
          <Route path="/agent-workbench/:agentType" element={<AgentWorkbench />} />
          <Route path="/chat" element={<ChatLayout />}>
            <Route index element={<ChatHome />} />
            <Route path=":id" element={<ChatPage />} />
          </Route>
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<SettingsIndex />} />
            <Route path="general" element={<GeneralSettings />} />
            <Route path="mcp" element={<McpSettings />} />
            <Route path="skills" element={<SkillsSettings />} />
            <Route path="agents" element={<AgentsSettings />} />
            <Route path="connectors" element={<ConnectorsSettings />} />
            <Route path="permissions" element={<PermissionsSettings />} />
            <Route path="memory" element={<MemorySettings />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
