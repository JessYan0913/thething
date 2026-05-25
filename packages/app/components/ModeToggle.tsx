import { MoonIcon, SunIcon, MonitorIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function ModeToggle() {
  const { t } = useTranslation('settings')
  const { setTheme, theme } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 shrink-0">
          <SunIcon className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <MoonIcon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-0" />
          <span className="sr-only">{t('general.theme.toggle')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>
          <SunIcon className="mr-2 size-4" />
          <span>{t('general.theme.light')}</span>
          {theme === "light" && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          <MoonIcon className="mr-2 size-4" />
          <span>{t('general.theme.dark')}</span>
          {theme === "dark" && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          <MonitorIcon className="mr-2 size-4" />
          <span>{t('general.theme.system')}</span>
          {theme === "system" && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
