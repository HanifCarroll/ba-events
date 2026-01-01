import { useState, useCallback, useEffect, useRef } from 'react'
import type { ColumnSizingState, VisibilityState } from '@tanstack/react-table'

export interface ColumnPreferences {
  sizing: ColumnSizingState
  order: string[]
  visibility: VisibilityState
}

const DEFAULT_PREFERENCES: ColumnPreferences = {
  sizing: {},
  order: [],
  visibility: {},
}

function getStorageKey(tableId: string): string {
  return `ba-events-table-prefs-${tableId}`
}

function loadPreferences(tableId: string): ColumnPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES

  try {
    const stored = localStorage.getItem(getStorageKey(tableId))
    if (!stored) return DEFAULT_PREFERENCES

    const parsed = JSON.parse(stored)
    return {
      sizing: parsed.sizing || {},
      order: parsed.order || [],
      visibility: parsed.visibility || {},
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function savePreferences(tableId: string, prefs: ColumnPreferences): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(getStorageKey(tableId), JSON.stringify(prefs))
  } catch {
    // Storage quota exceeded or other error
  }
}

export function useColumnPreferences(tableId: string) {
  const [preferences, setPreferences] = useState<ColumnPreferences>(() =>
    loadPreferences(tableId)
  )

  // Debounce timer ref
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced save to localStorage
  const debouncedSave = useCallback(
    (prefs: ColumnPreferences) => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
      saveTimerRef.current = setTimeout(() => {
        savePreferences(tableId, prefs)
      }, 500)
    },
    [tableId]
  )

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [])

  const setSizing = useCallback(
    (sizing: ColumnSizingState) => {
      setPreferences((prev) => {
        const next = { ...prev, sizing }
        debouncedSave(next)
        return next
      })
    },
    [debouncedSave]
  )

  const setOrder = useCallback(
    (order: string[]) => {
      setPreferences((prev) => {
        const next = { ...prev, order }
        debouncedSave(next)
        return next
      })
    },
    [debouncedSave]
  )

  const setVisibility = useCallback(
    (visibility: VisibilityState) => {
      setPreferences((prev) => {
        const next = { ...prev, visibility }
        debouncedSave(next)
        return next
      })
    },
    [debouncedSave]
  )

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES)
    savePreferences(tableId, DEFAULT_PREFERENCES)
  }, [tableId])

  return {
    sizing: preferences.sizing,
    order: preferences.order,
    visibility: preferences.visibility,
    setSizing,
    setOrder,
    setVisibility,
    resetPreferences,
  }
}
