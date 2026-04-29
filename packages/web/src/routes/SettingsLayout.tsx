import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import {
  PlugIcon,
  WrenchIcon,
  BotIcon,
  LinkIcon,
  ShieldIcon,
  DatabaseIcon,
  ArrowLeftIcon,
  SettingsIcon,
} from "lucide-react"
import { Link, Outlet, useLocation } from "react-router-dom"

const menuItems = [
  { to: "/settings/mcp", icon: PlugIcon, label: "MCP 服务器" },
  { to: "/settings/skills", icon: WrenchIcon, label: "技能管理" },
  { to: "/settings/agents", icon: BotIcon, label: "代理管理" },
  { to: "/settings/connectors", icon: LinkIcon, label: "连接器" },
  { to: "/settings/permissions", icon: ShieldIcon, label: "权限管理" },
  { to: "/settings/memory", icon: DatabaseIcon, label: "记忆管理" },
]

export default function SettingsLayout() {
  const location = useLocation()
  const activePath = location.pathname

  return (
    <SidebarProvider style={{ height: "100dvh" }}>
      <div className="flex h-full w-full overflow-hidden">
        {/* Settings Sidebar */}
        <Sidebar collapsible="icon">
          <SidebarHeader>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="系统设置">
                  <SettingsIcon />
                  <span className="font-semibold">系统设置</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarHeader>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">
                资源管理
              </SidebarGroupLabel>
              <SidebarMenu>
                {menuItems.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton
                      asChild
                      isActive={activePath === item.to || (item.to !== "/settings" && activePath.startsWith(item.to))}
                      tooltip={item.label}
                    >
                      <Link to={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip="返回聊天">
                  <Link to="/chat">
                    <ArrowLeftIcon />
                    <span>返回聊天</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>

          <SidebarRail />
        </Sidebar>

        {/* Settings Content */}
        <SidebarInset className="flex flex-col flex-1 overflow-hidden">
          <div className="flex shrink-0 items-center border-b px-4 py-2">
            <SidebarTrigger />
          </div>
          <Outlet />
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
