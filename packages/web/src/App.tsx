import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ChatLayout from './routes/ChatLayout'
import ChatHome from './routes/ChatHome'
import ChatPage from './routes/ChatPage'
import McpSettings from './routes/McpSettings'
import ConnectorAdmin from './routes/ConnectorAdmin'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/chat" replace />} />
        <Route path="/chat" element={<ChatLayout />}>
          <Route index element={<ChatHome />} />
          <Route path=":id" element={<ChatPage />} />
          <Route path="settings/mcp" element={<McpSettings />} />
        </Route>
        <Route path="/connector-admin" element={<ConnectorAdmin />} />
      </Routes>
    </BrowserRouter>
  )
}