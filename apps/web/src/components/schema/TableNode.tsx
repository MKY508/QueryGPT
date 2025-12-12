"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Table2, Key, Link } from "lucide-react";
import type { TableInfo, ColumnInfo } from "@/lib/types/schema";

interface TableNodeProps {
  data: {
    table: TableInfo;
  };
}

function TableNodeComponent({ data }: TableNodeProps) {
  const { table } = data;

  return (
    <div className="bg-background border border-border rounded-lg shadow-md min-w-[200px] overflow-hidden">
      {/* 表头 */}
      <div className="bg-primary/10 px-3 py-2 border-b border-border flex items-center gap-2">
        <Table2 size={14} className="text-primary" />
        <span className="font-medium text-sm text-foreground">{table.name}</span>
      </div>

      {/* 列列表 */}
      <div className="max-h-[300px] overflow-y-auto">
        {table.columns.map((column: ColumnInfo, index: number) => (
          <div
            key={column.name}
            className="relative px-3 py-1.5 text-xs border-b border-border/50 last:border-b-0 hover:bg-muted/50 flex items-center justify-between"
          >
            {/* 左侧 Handle - 作为源 */}
            <Handle
              type="source"
              position={Position.Left}
              id={`${column.name}-left`}
              className="!w-2 !h-2 !bg-primary !border-primary"
              style={{ top: "50%" }}
            />

            <div className="flex items-center gap-2 flex-1">
              {column.is_primary_key && (
                <Key size={10} className="text-amber-500" />
              )}
              {column.is_foreign_key && !column.is_primary_key && (
                <Link size={10} className="text-blue-500" />
              )}
              <span className="text-foreground">{column.name}</span>
            </div>

            <span className="text-muted-foreground ml-2">{column.data_type}</span>

            {/* 右侧 Handle - 作为目标 */}
            <Handle
              type="target"
              position={Position.Right}
              id={`${column.name}-right`}
              className="!w-2 !h-2 !bg-primary !border-primary"
              style={{ top: "50%" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export const TableNode = memo(TableNodeComponent);
