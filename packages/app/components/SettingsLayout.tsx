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
  ShieldIcon,
  DatabaseIcon,
  ArrowLeftIcon,
  PaletteIcon,
  CableIcon,
  CpuIcon,
  TimerIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslation } from "react-i18next"
import { ModeToggle } from "@/components/ModeToggle"

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation('settings')
  const pathname = usePathname()
  const activePath = pathname

  const generalItems = [
    { to: "/settings/models", icon: CpuIcon, label: t('sidebar.models') },
    { to: "/settings/general", icon: PaletteIcon, label: t('sidebar.generalSettings') },
  ]

  const resourceItems = [
    { to: "/settings/agents", icon: BotIcon, label: t('sidebar.agents') },
    { to: "/settings/skills", icon: WrenchIcon, label: t('sidebar.skills') },
    { to: "/settings/connectors", icon: CableIcon, label: t('sidebar.connectors') },
    { to: "/settings/mcp", icon: PlugIcon, label: t('sidebar.mcpServers') },
    { to: "/settings/wiki", icon: DatabaseIcon, label: t('sidebar.memory') },
    { to: "/settings/permissions", icon: ShieldIcon, label: t('sidebar.permissions') },
    { to: "/settings/automation", icon: TimerIcon, label: t('sidebar.automation') },
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
            <div className="px-2 pt-3 pb-1">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip={t('sidebar.backToChat')} className="group-data-[collapsible=icon]:justify-center [&_span]:no-underline">
                    <Link href="/chat" className="no-underline">
                      <ArrowLeftIcon />
                      <span className="group-data-[collapsible=icon]:hidden">{t('sidebar.backToChat')}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </div>

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
                      <Link href={item.to}>
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
                      <Link href={item.to}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>

          <SidebarRail />
        </Sidebar>

        {/* Settings Content */}
        <SidebarInset className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <div className="flex shrink-0 items-center gap-3 border-b bg-background/80 backdrop-blur-md px-4 h-12">
            <SidebarTrigger />
            <div className="h-4 w-px bg-border" />
            {activeItem && (
              <h1 className="text-sm font-semibold">{activeItem.label}</h1>
            )}
            <div className="ml-auto">
              <ModeToggle />
            </div>
          </div>
          {children}
        </SidebarInset>
      </div>
    </SidebarProvider>
  )
}
