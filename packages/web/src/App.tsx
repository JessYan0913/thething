import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import ChatLayout from './routes/ChatLayout'
import ChatHome from './routes/ChatHome'
import ChatPage from './routes/ChatPage'
import SettingsLayout from './routes/SettingsLayout'
import SettingsIndex from './routes/SettingsIndex'
import GeneralSettings from './routes/GeneralSettings'
import McpSettings from './routes/McpSettings'
import SkillsSettings from './routes/SkillsSettings'
import AgentsSettings from './routes/AgentsSettings'
import PermissionsSettings from './routes/PermissionsSettings'
import MemorySettings from './routes/MemorySettings'
import ConnectorsSettings from './routes/ConnectorsSettings'
import SkillWorkbench from './routes/SkillWorkbench'
import AgentWorkbench from './routes/AgentWorkbench'

export default function App() {
  const { i18n } = useTranslation()

  // Update HTML lang attribute when language changes
  useEffect(() => {
    document.documentElement.lang = i18n.language
  }, [i18n.language])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/skill-workbench" element={<SkillWorkbench />} />
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
    </BrowserRouter>
  )
}