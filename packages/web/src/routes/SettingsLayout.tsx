import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
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
  PaletteIcon,
} from "lucide-react"
import { Link, Outlet, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { ModeToggle } from "@/components/ModeToggle"

export default function SettingsLayout() {
  const { t } = useTranslation('settings')
  const location = useLocation()
  const activePath = location.pathname

  const generalItems = [
    { to: "/settings/general", icon: PaletteIcon, label: t('sidebar.generalSettings') },
  ]

  const resourceItems = [
    { to: "/settings/mcp", icon: PlugIcon, label: t('sidebar.mcpServers') },
    { to: "/settings/skills", icon: WrenchIcon, label: t('sidebar.skills') },
    { to: "/settings/agents", icon: BotIcon, label: t('sidebar.agents') },
    { to: "/settings/connectors", icon: LinkIcon, label: t('sidebar.connectors') },
    { to: "/settings/permissions", icon: ShieldIcon, label: t('sidebar.permissions') },
    { to: "/settings/memory", icon: DatabaseIcon, label: t('sidebar.memory') },
  ]

  const allItems = [...generalItems, ...resourceItems]
  const activeItem = allItems.find(
    (item) => activePath === item.to || (item.to !== "/settings" && activePath.startsWith(item.to))
  )

  return (
    <SidebarProvider style={{ height: "100dvh" }}>
      <div className="flex h-full w-full overflow-hidden">
        {/* Settings Sidebar */}
        <Sidebar collapsible="icon">
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">
                {t('sidebar.general')}
              </SidebarGroupLabel>
              <SidebarMenu>
                {generalItems.map((item) => (
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

            <SidebarGroup>
              <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">
                {t('sidebar.resourceManagement')}
              </SidebarGroupLabel>
              <SidebarMenu>
                {resourceItems.map((item) => (
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
                <SidebarMenuButton asChild tooltip={t('sidebar.backToChat')}>
                  <Link to="/chat">
                    <ArrowLeftIcon />
                    <span>{t('sidebar.backToChat')}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>

          <SidebarRail />
        </Sidebar>

        {/* Settings Content */}
        <SidebarInset className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <div className="flex shrink-0 items-center gap-3 border-b px-4 py-3">
            <SidebarTrigger />
            <div className="h-4 w-px bg-border" />
            {activeItem && (
              <h1 className="text-base font-semibold">{activeItem.label}</h1>
            )}
            <div className="ml-auto">
              <ModeToggle />
            </div>
          </div>
          <Outlet />
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
