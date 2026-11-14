"use client";
// Data table in the pattern of Origin UI's "complex table made with TanStack Table":
// sorting, global search, faceted filter, column visibility, row selection, pagination.
// Built on @tanstack/react-table v8 + shadcn table. Owner: D.
import * as React from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";

export type { ColumnDef } from "@tanstack/react-table";
/** A column over rows of TData. Cell values are heterogeneous across columns, which is why TanStack types them as any. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DataColumn<TData> = ColumnDef<TData, any>;

export interface DataTableProps<TData> {
  columns: DataColumn<TData>[];
  data: TData[];
  /** Placeholder for the global search box. Omit to hide search. */
  searchPlaceholder?: string;
  /** Column id to offer as a faceted filter (e.g. "quadrant", "sourceType"). */
  facet?: { columnId: string; label: string; format?: (value: string) => string };
  /** Adds a selection checkbox column. */
  selectable?: boolean;
  onSelectionChange?: (rows: TData[]) => void;
  onRowClick?: (row: TData) => void;
  pageSize?: number;
  initialSorting?: SortingState;
  /** Shown when there are no rows. */
  empty?: React.ReactNode;
  /** Right side of the toolbar. */
  toolbar?: React.ReactNode;
  className?: string;
  dense?: boolean;
}

export function DataTable<TData>({
  columns,
  data,
  searchPlaceholder,
  facet,
  selectable,
  onSelectionChange,
  onRowClick,
  pageSize = 10,
  initialSorting = [],
  empty = "No results.",
  toolbar,
  className,
  dense,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [showColumns, setShowColumns] = React.useState(false);

  const allColumns = React.useMemo<DataColumn<TData>[]>(() => {
    if (!selectable) return columns;
    return [
      {
        id: "_select",
        size: 32,
        enableSorting: false,
        enableHiding: false,
        header: ({ table }) => (
          <Checkbox
            aria-label="Select all"
            checked={table.getIsAllPageRowsSelected()}
            indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            aria-label="Select row"
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      },
      ...columns,
    ];
  }, [columns, selectable]);

  // TanStack's table instance can't be memoized by the React Compiler (known, harmless here).
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, columnFilters, columnVisibility, rowSelection, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    enableRowSelection: !!selectable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    initialState: { pagination: { pageSize } },
  });

  React.useEffect(() => {
    onSelectionChange?.(table.getSelectedRowModel().rows.map((r) => r.original));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection]);

  const facetColumn = facet ? table.getColumn(facet.columnId) : undefined;
  const facetValues = facetColumn ? [...facetColumn.getFacetedUniqueValues().keys()].map(String).sort() : [];
  const facetSelected = (facetColumn?.getFilterValue() as string[] | undefined) ?? [];
  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize: size } = table.getState().pagination;

  return (
    <div className={cn("space-y-3", className)}>
      {(searchPlaceholder || facet || toolbar) && (
        <div className="flex flex-wrap items-center gap-2">
          {searchPlaceholder && (
            <label className="relative">
              <span className="sr-only">{searchPlaceholder}</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 w-60 rounded-md border border-input bg-background pl-8 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          )}
          {facetColumn && facetValues.length > 0 && (
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label={facet!.label}>
              <span className="mr-1 text-xs text-muted-foreground">{facet!.label}</span>
              {facetValues.map((v) => {
                const on = facetSelected.includes(v);
                return (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      const next = on ? facetSelected.filter((x) => x !== v) : [...facetSelected, v];
                      facetColumn.setFilterValue(next.length ? next : undefined);
                    }}
                    className={cn(
                      "h-7 rounded-full border px-2.5 text-xs transition-colors",
                      on ? "border-primary bg-primary/10 text-primary" : "border-border text-foreground hover:bg-muted",
                    )}
                  >
                    {facet!.format ? facet!.format(v) : v}
                    <span className="num ml-1 text-muted-foreground">{facetColumn.getFacetedUniqueValues().get(v)}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {toolbar}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowColumns((s) => !s)}
                aria-expanded={showColumns}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs hover:bg-muted"
              >
                <Columns3 className="size-3.5" /> Columns
              </button>
              {showColumns && (
                <div className="absolute right-0 z-20 mt-1 min-w-44 rounded-md border border-border bg-popover p-1.5 shadow-pop">
                  {table
                    .getAllLeafColumns()
                    .filter((c) => c.getCanHide())
                    .map((c) => (
                      <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted">
                        <Checkbox checked={c.getIsVisible()} onCheckedChange={(v) => c.toggleVisibility(!!v)} />
                        {typeof c.columnDef.header === "string" ? c.columnDef.header : c.id}
                      </label>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border">
        <Table>
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => {
                  const sortable = h.column.getCanSort();
                  const dir = h.column.getIsSorted();
                  return (
                    <TableHead
                      key={h.id}
                      style={{ width: h.getSize() !== 150 ? h.getSize() : undefined }}
                      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                      className={cn("h-9 text-xs font-medium text-muted-foreground", dense && "h-8")}
                    >
                      {h.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={h.column.getToggleSortingHandler()}
                          className="-ml-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground"
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {dir === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : dir === "desc" ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length ? (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(onRowClick && "cursor-pointer")}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cn(dense ? "py-1.5" : "py-2.5")}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={table.getVisibleLeafColumns().length} className="h-24 text-center text-sm text-muted-foreground">
                  {empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {total > size && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="num">
            {pageIndex * size + 1}-{Math.min((pageIndex + 1) * size, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Previous page"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
              className="inline-flex size-7 items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Next page"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
              className="inline-flex size-7 items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-40"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Filter fn for faceted columns: value must be one of the selected strings. */
export const inFacet = (row: { getValue: (id: string) => unknown }, id: string, value: string[]) =>
  !value?.length || value.includes(String(row.getValue(id)));
