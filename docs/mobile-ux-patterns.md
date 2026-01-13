# Mobile UX Patterns

This document describes the mobile UX patterns used in the admin interfaces for a native-feeling mobile experience.

## Overview

The admin pages use iOS-inspired interaction patterns on mobile:

1. **Swipe-to-reveal actions** - Replace visible buttons with swipe gestures
2. **Bottom sheet filters** - Hide filters behind a button, always show search
3. **Long-press selection mode** - Enter bulk selection like iOS Photos
4. **Horizontally scrollable tabs** - Allow swiping through tabs on narrow screens

## Components & Hooks

### SwipeableCard

iOS-style swipe-to-reveal actions component using direct DOM manipulation for 60fps performance.

**Location:** `src/shared/ui/SwipeableCard.tsx`

**Usage:**

```tsx
import { SwipeableCard } from '@/shared/ui/SwipeableCard'

<SwipeableCard
  leftActions={[
    {
      icon: <Pencil className="h-5 w-5" />,
      label: 'Edit',
      onClick: handleEdit,
      variant: 'primary',
    },
  ]}
  rightActions={[
    {
      icon: <Trash2 className="h-5 w-5" />,
      label: 'Delete',
      onClick: handleDelete,
      variant: 'destructive',
    },
  ]}
  onLongPress={handleLongPress}
  className="rounded-xl"
>
  <CardContent />
</SwipeableCard>
```

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `children` | ReactNode | Card content |
| `leftActions` | SwipeAction[] | Actions revealed on swipe right |
| `rightActions` | SwipeAction[] | Actions revealed on swipe left |
| `onLongPress` | () => void | Callback for long-press (500ms) |
| `className` | string | Additional CSS classes |

**SwipeAction interface:**

```typescript
interface SwipeAction {
  icon: ReactNode
  label: string
  onClick: () => void
  variant: 'primary' | 'destructive' | 'warning'
}
```

**Variants:**
- `primary` - Blue/primary color (Edit, Approve)
- `destructive` - Red color (Delete, Reject)
- `warning` - Orange color (Archive, Warn)

### MobileFilterSheet

Reusable bottom sheet for mobile filters with consistent styling.

**Location:** `src/shared/ui/MobileFilterSheet.tsx`

**Usage:**

```tsx
import { MobileFilterSheet } from '@/shared/ui/MobileFilterSheet'

<MobileFilterSheet
  hasActiveFilters={!!venueFilter || showTodayOnly}
  onClearFilters={clearFilters}
>
  {/* Filter controls */}
  <div className="space-y-2">
    <label className="text-sm font-medium">Venue</label>
    <Combobox ... />
  </div>

  <label className="flex items-center gap-3 p-3 bg-muted/30 rounded-lg">
    <Checkbox checked={showTodayOnly} onCheckedChange={setShowTodayOnly} />
    <span>Show today only</span>
  </label>
</MobileFilterSheet>
```

**Props:**

| Prop | Type | Description |
|------|------|-------------|
| `children` | ReactNode | Filter controls to render in the sheet |
| `hasActiveFilters` | boolean | Show badge indicator on trigger button |
| `onClearFilters` | () => void | Callback when "Clear filters" is clicked |
| `title` | string | Sheet title (default: "Filters") |

### useMobileSelectionMode

Hook for managing iOS Photos-style selection mode state.

**Location:** `src/shared/hooks/useMobileSelectionMode.ts`

**Usage:**

```tsx
import { useMobileSelectionMode } from '@/shared/hooks/useMobileSelectionMode'

function MyListPage() {
  const items = [...] // Your list items

  const {
    isSelectionMode,
    selectedIds,
    enterSelectionMode,
    exitSelectionMode,
    toggleSelect,
    toggleSelectAll,
    clearSelection,
  } = useMobileSelectionMode(items)

  return (
    <>
      {/* Selection mode header */}
      {isSelectionMode && (
        <SelectionModeHeader
          count={selectedIds.size}
          onExit={exitSelectionMode}
          onSelectAll={toggleSelectAll}
          isAllSelected={selectedIds.size === items.length}
        />
      )}

      {/* List items */}
      {items.map(item => (
        <SwipeableCard
          key={item.id}
          onLongPress={() => {
            enterSelectionMode()
            toggleSelect(item.id)
          }}
          // Disable swipe in selection mode
          leftActions={isSelectionMode ? [] : [...]}
          rightActions={isSelectionMode ? [] : [...]}
        >
          <ItemCard
            item={item}
            isSelected={selectedIds.has(item.id)}
            selectionMode={isSelectionMode}
            onToggleSelect={() => toggleSelect(item.id)}
          />
        </SwipeableCard>
      ))}
    </>
  )
}
```

**Returns:**

| Property | Type | Description |
|----------|------|-------------|
| `isSelectionMode` | boolean | Whether selection mode is active |
| `selectedIds` | Set<string> | Set of selected item IDs |
| `enterSelectionMode` | () => void | Enter selection mode |
| `exitSelectionMode` | () => void | Exit and clear selection |
| `toggleSelect` | (id: string) => void | Toggle selection for an item |
| `toggleSelectAll` | () => void | Select all or deselect all |
| `clearSelection` | () => void | Clear selection without exiting mode |

## Layout Patterns

### Mobile Filter Bar

Always show search, hide other filters behind a sheet button:

```tsx
<div className="flex items-center gap-2">
  {/* Search - always visible */}
  <div className="relative flex-1">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4" />
    <Input placeholder="Search..." className="pl-9" />
  </div>

  {/* Filter sheet - mobile only */}
  <div className="sm:hidden">
    <MobileFilterSheet hasActiveFilters={hasFilters} onClearFilters={clear}>
      {/* Filter controls */}
    </MobileFilterSheet>
  </div>

  {/* Desktop filters - hidden on mobile */}
  <div className="hidden sm:flex sm:items-center sm:gap-3">
    {/* Inline filter controls */}
  </div>
</div>
```

### Horizontally Scrollable Tabs

Allow tabs to scroll on narrow screens:

```tsx
<Tabs>
  <div className="overflow-x-auto -mx-6 px-6 sm:mx-0 sm:px-0">
    <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
      <TabsTrigger value="tab1">Tab 1</TabsTrigger>
      <TabsTrigger value="tab2">Tab 2</TabsTrigger>
      <TabsTrigger value="tab3">Tab 3</TabsTrigger>
    </TabsList>
  </div>
  {/* Tab content */}
</Tabs>
```

### Selection Mode Header

Show when selection mode is active:

```tsx
{isSelectionMode && (
  <div className="sm:hidden flex items-center justify-between p-3 mb-2 bg-primary/10 border border-primary/20 rounded-xl">
    <Button variant="ghost" size="icon" onClick={exitSelectionMode}>
      <X className="h-4 w-4" />
    </Button>
    <span className="text-sm font-medium">{selectedIds.size} selected</span>
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={toggleSelectAll}>
        {isAllSelected ? 'Deselect all' : 'Select all'}
      </Button>
      {selectedIds.size > 0 && (
        <Button variant="destructive" size="sm" onClick={onBulkDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  </div>
)}
```

## Best Practices

### 1. Disable swipe in selection mode

When selection mode is active, disable swipe actions and show checkboxes instead:

```tsx
if (selectionMode) {
  return <CardWithCheckbox />
}

return (
  <SwipeableCard leftActions={...} rightActions={...}>
    <CardContent />
  </SwipeableCard>
)
```

### 2. Auto-select on long-press

When entering selection mode via long-press, auto-select the pressed item:

```tsx
const handleLongPress = () => {
  enterSelectionMode()
  if (!selectedIds.has(item.id)) {
    toggleSelect(item.id)
  }
}
```

### 3. Use consistent action positions

- **Swipe right (left actions)**: Positive actions (Edit, Approve, Save)
- **Swipe left (right actions)**: Destructive actions (Delete, Reject, Archive)

### 4. Show visual feedback

- Selected cards should have a highlighted border/background
- Active filters should show a badge on the filter button
- Tabs should show counts for items needing attention

### 5. Responsive breakpoints

- Use `sm:hidden` to hide mobile-only elements on desktop
- Use `hidden sm:flex` to show desktop-only elements
- The `sm` breakpoint (640px) is the mobile/desktop boundary
