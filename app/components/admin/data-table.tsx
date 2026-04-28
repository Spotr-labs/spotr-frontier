"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
} from "@tanstack/react-table";
import { useEffect, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cn } from "../../lib/utils";

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  rowKey: (row: TData) => string;
  onRowClick?: (row: TData) => void;
  empty?: React.ReactNode;
  isLoading?: boolean;
  loadMore?: () => void;
  hasMore?: boolean;
  virtualize?: boolean;
  className?: string;
  estimatedRowHeight?: number;
  highlightRow?: (row: TData) => boolean;
};

export function DataTable<TData, TValue>({
  columns,
  data,
  rowKey,
  onRowClick,
  empty,
  isLoading,
  loadMore,
  hasMore,
  virtualize = false,
  className,
  estimatedRowHeight = 48,
  highlightRow,
}: DataTableProps<TData, TValue>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });
  const containerRef = useRef<HTMLDivElement | null>(null);

  const rows = table.getRowModel().rows as Row<TData>[];
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: 12,
    enabled: virtualize,
  });

  useEffect(() => {
    if (!loadMore || !hasMore || virtualize) return;
    const node = containerRef.current;
    if (!node) return;
    const handler = () => {
      const remaining =
        node.scrollHeight - node.scrollTop - node.clientHeight;
      if (remaining < 320) {
        loadMore();
      }
    };
    node.addEventListener("scroll", handler);
    return () => node.removeEventListener("scroll", handler);
  }, [hasMore, loadMore, virtualize]);

  const showEmpty = !isLoading && rows.length === 0;
  const virtualItems = virtualize ? virtualizer.getVirtualItems() : [];
  const totalSize = virtualize ? virtualizer.getTotalSize() : 0;

  const rowsToRender = useMemo(() => {
    if (!virtualize) return rows;
    return virtualItems.map((vi) => rows[vi.index]);
  }, [rows, virtualize, virtualItems]);

  return (
    <div
      className={cn(
        "rounded-[1.1rem] border border-white/12 bg-black/22",
        className
      )}
    >
      <div
        ref={containerRef}
        className={cn(
          "max-h-[640px] overflow-auto",
          virtualize && "relative"
        )}
        style={virtualize ? { contain: "strict" } : undefined}
      >
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 z-10 bg-[#0a1023] text-left text-[10px] uppercase tracking-[0.22em] text-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <th
                    key={header.id}
                    className="border-b border-white/10 px-3 py-2 font-semibold"
                    style={{
                      width: header.getSize ? header.getSize() : undefined,
                    }}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody
            className="text-foreground"
            style={
              virtualize
                ? {
                    display: "block",
                    position: "relative",
                    height: totalSize,
                  }
                : undefined
            }
          >
            {!virtualize &&
              rowsToRender.map((row) => (
                <tr
                  key={rowKey(row.original)}
                  className={cn(
                    "border-b border-white/5 transition hover:bg-white/4",
                    onRowClick && "cursor-pointer",
                    highlightRow?.(row.original) && "bg-primary/8"
                  )}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-2 align-middle">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            {virtualize &&
              virtualItems.map((vi) => {
                const row = rows[vi.index];
                return (
                  <tr
                    key={rowKey(row.original)}
                    className={cn(
                      "border-b border-white/5 transition hover:bg-white/4",
                      onRowClick && "cursor-pointer",
                      highlightRow?.(row.original) && "bg-primary/8"
                    )}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vi.start}px)`,
                      height: vi.size,
                      display: "flex",
                    }}
                    onClick={
                      onRowClick ? () => onRowClick(row.original) : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="flex-1 px-3 py-2 align-middle"
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            {showEmpty ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-sm text-muted"
                >
                  {empty ?? "No rows yet."}
                </td>
              </tr>
            ) : null}
            {isLoading && rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-12 text-center text-sm text-muted"
                >
                  Loading…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {hasMore && loadMore ? (
        <div className="flex items-center justify-center border-t border-white/10 px-4 py-3">
          <button
            type="button"
            onClick={loadMore}
            className="text-xs font-semibold uppercase tracking-[0.2em] text-primary hover:underline"
          >
            Load more
          </button>
        </div>
      ) : null}
    </div>
  );
}
