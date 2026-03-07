import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type {
  SchemaLayout,
  SchemaLayoutUpdate,
  TableInfo,
  TableRelationship,
} from "@/lib/types/schema";

export function deriveHiddenTables(
  currentLayout: SchemaLayout | null | undefined,
  allTables: string[]
): Set<string> {
  if (!currentLayout?.visible_tables) {
    return new Set();
  }
  return new Set(allTables.filter((tableName) => !currentLayout.visible_tables?.includes(tableName)));
}

export function filterVisibleTables(
  tables: TableInfo[] | undefined,
  hiddenTables: Set<string>,
  searchQuery: string
): TableInfo[] {
  if (!tables) return [];
  const normalizedQuery = searchQuery.trim().toLowerCase();
  return tables.filter((table) => {
    if (hiddenTables.has(table.name)) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return table.name.toLowerCase().includes(normalizedQuery);
  });
}

export function buildSchemaNodes(
  visibleTables: TableInfo[],
  currentLayout: SchemaLayout | null | undefined
): Node[] {
  return visibleTables.map((table, index) => {
    const layoutPosition = currentLayout?.layout_data?.[table.name];
    return {
      id: table.name,
      type: "tableNode",
      position: layoutPosition
        ? { x: layoutPosition.x, y: layoutPosition.y }
        : {
            x: (index % 3) * 280 + 50,
            y: Math.floor(index / 3) * 350 + 50,
          },
      data: { table },
    };
  });
}

export function buildRelationshipEdges(
  visibleTables: TableInfo[],
  relationships: TableRelationship[] | undefined
): Edge[] {
  if (!relationships?.length) {
    return [];
  }

  const visibleTableNames = new Set(visibleTables.map((table) => table.name));
  return relationships
    .filter(
      (relationship) =>
        visibleTableNames.has(relationship.source_table) &&
        visibleTableNames.has(relationship.target_table)
    )
    .map((relationship) => ({
      id: relationship.id,
      source: relationship.source_table,
      sourceHandle: `${relationship.source_column}-left`,
      target: relationship.target_table,
      targetHandle: `${relationship.target_column}-right`,
      label: `${relationship.relationship_type} (${relationship.join_type})`,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
      labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
      labelBgStyle: { fill: "hsl(var(--background))" },
    }));
}

export function buildLayoutSnapshot(
  nodes: Node[],
  viewport: { x: number; y: number; zoom: number },
  tables: TableInfo[] | undefined,
  hiddenTables: Set<string>
): { signature: string; payload: SchemaLayoutUpdate } {
  const layoutData: Record<string, { x: number; y: number }> = {};
  for (const node of nodes) {
    layoutData[node.id] = {
      x: node.position.x,
      y: node.position.y,
    };
  }

  const visibleTables = (tables || [])
    .filter((table) => !hiddenTables.has(table.name))
    .map((table) => table.name);

  const payload: SchemaLayoutUpdate = {
    layout_data: layoutData,
    zoom: viewport.zoom,
    viewport_x: viewport.x,
    viewport_y: viewport.y,
    visible_tables: visibleTables,
  };

  return {
    signature: JSON.stringify({ layoutData, viewport, visibleTables }),
    payload,
  };
}
