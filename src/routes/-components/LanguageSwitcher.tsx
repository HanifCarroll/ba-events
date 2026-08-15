import { getLocale, setLocale, locales } from '@/paraglide/runtime'
import { Globe } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { useAuthContext } from '@/features/auth/hooks/useAuthContext'
import { updateLocalePreference } from '@/features/auth/api/server'
import type { Locale } from '@/shared/lib/types'

const LOCALE_CONFIG: Record<string, { label: string }> = {
  en: { label: 'English' },
  es: { label: 'Español' },
}

interface LanguageSwitcherProps {
  collapsed?: boolean
}

export function LanguageSwitcher({ collapsed = false }: LanguageSwitcherProps) {
  const { user } = useAuthContext()
  const currentLocale = getLocale()
  const currentConfig = LOCALE_CONFIG[currentLocale] || LOCALE_CONFIG.en

  const handleLocaleChange = (locale: string) => {
    // Save to database if user is logged in (fire and forget)
    if (user) {
      updateLocalePreference({ data: locale as Locale }).catch(console.error)
    }
    // Set locale (updates cookie and reloads page)
    setLocale(locale as (typeof locales)[number])
  }

  const trigger = (
    <Button
      variant="ghost"
      className={`
        w-full text-muted-foreground hover:text-foreground hover:bg-muted/50 items-center
        ${collapsed ? 'p-3 justify-center' : 'justify-start gap-3 px-4'}
      `}
    >
      <Globe className="h-5 w-5 shrink-0" />
      {!collapsed && (
        <span className="text-sm leading-none">{currentConfig.label}</span>
      )}
    </Button>
  )

  const dropdown = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent side={collapsed ? 'right' : 'top'} align="start" className="w-40">
        {locales.map((locale) => {
          const config = LOCALE_CONFIG[locale] || { label: locale }
          const isActive = locale === currentLocale

          return (
            <DropdownMenuItem
              key={locale}
              onClick={() => handleLocaleChange(locale)}
              className={`flex items-center gap-2 cursor-pointer focus:bg-primary/10 focus:text-primary ${isActive ? 'bg-primary/10 text-primary' : ''}`}
            >
              <span>{config.label}</span>
              {isActive && <span className="ml-auto text-primary">✓</span>}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>
          <div>{dropdown}</div>
        </TooltipTrigger>
        <TooltipContent side="right" className="font-medium">
          {currentConfig.label}
        </TooltipContent>
      </Tooltip>
    )
  }

  return dropdown
}
