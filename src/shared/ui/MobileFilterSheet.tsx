import type { ReactNode } from 'react'
import { SlidersHorizontal, X } from 'lucide-react'
import * as m from '@/paraglide/messages'
import { Button } from '@/shared/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/shared/ui/sheet'

interface MobileFilterSheetProps {
  /** Filter controls to render inside the sheet */
  children: ReactNode
  /** Whether any filters are currently active (shows badge on trigger) */
  hasActiveFilters?: boolean
  /** Callback when clear filters button is clicked */
  onClearFilters?: () => void
  /** Sheet title (defaults to localized "Filters") */
  title?: string
  /** Custom trigger button (defaults to filter icon button) */
  trigger?: ReactNode
}

/**
 * Mobile-optimized filter bottom sheet.
 *
 * Shows a filter icon button that opens a bottom sheet with filter controls.
 * Use this in mobile filter bars alongside an always-visible search input.
 *
 * @example
 * ```tsx
 * <div className="flex items-center gap-2">
 *   <SearchInput />
 *   <div className="sm:hidden">
 *     <MobileFilterSheet
 *       hasActiveFilters={!!venueFilter}
 *       onClearFilters={clearFilters}
 *     >
 *       <FilterControl />
 *     </MobileFilterSheet>
 *   </div>
 *   <div className="hidden sm:flex">
 *     <DesktopFilters />
 *   </div>
 * </div>
 * ```
 */
export function MobileFilterSheet({
  children,
  hasActiveFilters = false,
  onClearFilters,
  title,
  trigger,
}: MobileFilterSheetProps) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        {trigger ?? (
          <Button
            variant="outline"
            size="icon"
            className="relative shrink-0 border-border/50"
          >
            <SlidersHorizontal className="h-4 w-4" />
            {hasActiveFilters && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-primary text-[10px] text-primary-foreground flex items-center justify-center font-bold">
                !
              </span>
            )}
          </Button>
        )}
      </SheetTrigger>
      <SheetContent side="bottom" className="h-auto max-h-[70vh] rounded-t-xl">
        <SheetHeader className="pb-4">
          <SheetTitle className="font-display">
            {title ?? m.common_filters()}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 pb-6">
          {children}

          {/* Clear filters button */}
          {hasActiveFilters && onClearFilters && (
            <Button
              variant="outline"
              className="w-full border-border/50"
              onClick={onClearFilters}
            >
              <X className="h-4 w-4 mr-2" />
              {m.common_clear_filters()}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
