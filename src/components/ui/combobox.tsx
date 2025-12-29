import * as React from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export interface ComboboxOption {
  value: string
  label: string
  sublabel?: string
}

interface ComboboxProps {
  options: ComboboxOption[]
  value?: string
  onValueChange: (value: string | undefined) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select...',
  emptyText = 'No results found.',
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const selectedOption = options.find((option) => option.value === value)

  // Filter options based on search
  const filteredOptions = React.useMemo(() => {
    if (!search) return options
    const searchLower = search.toLowerCase()
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(searchLower) ||
        option.sublabel?.toLowerCase().includes(searchLower)
    )
  }, [options, search])

  // Handle click outside to close dropdown
  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Handle keyboard navigation
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setOpen(false)
      setSearch('')
      inputRef.current?.blur()
    }
  }

  function handleSelect(option: ComboboxOption) {
    onValueChange(option.value === value ? undefined : option.value)
    setOpen(false)
    setSearch('')
    inputRef.current?.blur()
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation()
    onValueChange(undefined)
    setSearch('')
  }

  // Display value: show search when typing, otherwise show selected label
  const displayValue = open && search ? search : (selectedOption?.label || '')

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div className="relative">
        <Input
          ref={inputRef}
          value={displayValue}
          onChange={(e) => {
            setSearch(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={cn(
            'pr-16 bg-background/50 border-border/50',
            !value && !search && 'text-muted-foreground'
          )}
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground pointer-events-none" />
        </div>
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border/50 bg-popover shadow-md animate-in fade-in-0 zoom-in-95">
          <div className="max-h-60 overflow-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {emptyText}
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleSelect(option)}
                  className={cn(
                    'relative flex w-full cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors',
                    'hover:bg-accent hover:text-accent-foreground',
                    value === option.value && 'bg-accent/50'
                  )}
                >
                  <span className="flex-1 truncate text-left">
                    {option.label}
                    {option.sublabel && (
                      <span className="text-muted-foreground ml-1">
                        ({option.sublabel})
                      </span>
                    )}
                  </span>
                  <Check
                    className={cn(
                      'ml-2 h-4 w-4 shrink-0',
                      value === option.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
