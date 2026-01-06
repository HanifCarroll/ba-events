import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useState, useMemo, useCallback } from 'react'
import { Ban, Plus, Search, Trash2 } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/dialog'
import { DataTable } from '@/shared/ui/data-table'
import { useBulkSelection } from '@/shared/hooks/useBulkSelection'
import { listBlocklistEntriesAction, useDeleteBlocklistEntry, useBulkDeleteBlocklistEntries } from '@/features/import'
import { getBlocklistColumns } from './-components/blocklist-columns'
import type { ImportBlocklistEntry } from '@/shared/lib/types'

export const Route = createFileRoute('/admin/blocklist/')({
  loader: async () => {
    return listBlocklistEntriesAction()
  },
  component: BlocklistPage,
})

function BlocklistPage() {
  const entries = Route.useLoaderData()
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<ImportBlocklistEntry | null>(null)

  const deleteMutation = useDeleteBlocklistEntry()
  const bulkDeleteMutation = useBulkDeleteBlocklistEntries()

  // Filter entries by search
  const filteredEntries = useMemo(() => {
    if (!search) return entries
    const lowerSearch = search.toLowerCase()
    return entries.filter(
      (entry) =>
        entry.pattern.toLowerCase().includes(lowerSearch) ||
        entry.reason?.toLowerCase().includes(lowerSearch)
    )
  }, [entries, search])

  // Bulk selection
  const bulk = useBulkSelection(filteredEntries)
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = useState(false)

  // Handle selection change from DataTable
  const handleSelectionChange = useCallback(
    (newIds: Set<string>) => {
      bulk.handleSelectionChange(newIds)
    },
    [bulk]
  )

  // Handle single delete
  async function handleDelete() {
    if (!deleteTarget) return
    await deleteMutation.mutateAsync(deleteTarget.id)
    setDeleteTarget(null)
    router.invalidate()
  }

  // Handle bulk delete
  async function handleBulkDelete() {
    const ids = Array.from(bulk.selectedIds)
    await bulkDeleteMutation.mutateAsync(ids)
    bulk.clearSelection()
    setShowBulkDeleteDialog(false)
    router.invalidate()
  }

  // Column definitions with delete handler
  const columns = useMemo(
    () => getBlocklistColumns({ onDelete: setDeleteTarget }),
    []
  )

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in-up">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-foreground flex items-center gap-2">
            <Ban className="h-6 w-6 text-primary" />
            Import Blocklist
          </h1>
          <p className="text-muted-foreground mt-1">
            {filteredEntries.length === entries.length
              ? `${entries.length} blocklist entries`
              : `Showing ${filteredEntries.length} of ${entries.length} entries`}
          </p>
        </div>
        <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
          <Link to="/admin/blocklist/new">
            <Plus className="h-4 w-4 mr-2" />
            Add Entry
          </Link>
        </Button>
      </div>

      <div className="deco-line w-24" />

      {/* Search and bulk actions */}
      {entries.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search patterns or reasons..."
              className="pl-9 bg-background/50 border-border/50"
            />
          </div>
          {bulk.selectedIds.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setShowBulkDeleteDialog(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete ({bulk.selectedIds.size})
            </Button>
          )}
        </div>
      )}

      {/* Content */}
      {entries.length === 0 ? (
        <div className="text-center py-12 bg-card/50 rounded-xl border border-border/50">
          <Ban className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium text-foreground mb-2">
            No blocklist entries
          </h3>
          <p className="text-muted-foreground mb-4">
            Add patterns to filter out advertisement events during import.
          </p>
          <Button asChild className="bg-primary text-primary-foreground">
            <Link to="/admin/blocklist/new">
              <Plus className="h-4 w-4 mr-2" />
              Add Entry
            </Link>
          </Button>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="text-center py-12 bg-card/50 rounded-xl border border-border/50">
          <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-display text-lg font-medium text-foreground mb-2">
            No matching entries
          </h3>
          <p className="text-muted-foreground mb-4">
            Try a different search term.
          </p>
          <Button variant="outline" onClick={() => setSearch('')}>
            Clear search
          </Button>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filteredEntries}
          tableId="admin-blocklist"
          enableRowSelection={true}
          selectedIds={bulk.selectedIds}
          onSelectionChange={handleSelectionChange}
          enableColumnResizing={true}
          enableMultiSort={true}
          enableVirtualization={false}
        />
      )}

      {/* Single delete dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Delete blocklist entry</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete the pattern "{deleteTarget?.pattern}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk delete dialog */}
      <Dialog open={showBulkDeleteDialog} onOpenChange={setShowBulkDeleteDialog}>
        <DialogContent className="bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="font-display text-foreground">Delete entries</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete {bulk.selectedIds.size} blocklist entries? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setShowBulkDeleteDialog(false)}
              className="text-muted-foreground"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
