"use client";

import { useCallback, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Loader2, RefreshCw, Lightbulb, Trash2, Database } from "lucide-react";
import { api } from "@/lib/api/client";
import { TableNode } from "@/components/schema/TableNode";
import type {
  SchemaInfo,
  TableRelationship,
  TableRelationshipCreate,
  RelationshipSuggestion,
} from "@/lib/types/schema";

interface SchemaSettingsProps {
  connectionId: string | null;
}

const nodeTypes: NodeTypes = {
  tableNode: TableNode,
};

export function SchemaSettings({ connectionId }: SchemaSettingsProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const queryClient = useQueryClient();

  // 获取 Schema 信息
  const { data: schemaInfo, isLoading: schemaLoading } = useQuery({
    queryKey: ["schema", connectionId],
    queryFn: async () => {
      if (!connectionId) return null;
      const response = await api.get(`/api/v1/schema/${connectionId}`);
      return response.data.data as SchemaInfo;
    },
    enabled: !!connectionId,
  });

  // 获取已保存的关系
  const { data: relationships, isLoading: relLoading } = useQuery({
    queryKey: ["relationships", connectionId],
    queryFn: async () => {
      if (!connectionId) return [];
      const response = await api.get(`/api/v1/schema/${connectionId}/relationships`);
      return response.data.data as TableRelationship[];
    },
    enabled: !!connectionId,
  });

  // 创建关系
  const createMutation = useMutation({
    mutationFn: async (data: TableRelationshipCreate) => {
      const response = await api.post(`/api/v1/schema/${connectionId}/relationships`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["relationships", connectionId] });
    },
  });

  // 删除关系
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/v1/schema/relationships/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["relationships", connectionId] });
    },
  });

  // 应用建议
  const applySuggestion = (suggestion: RelationshipSuggestion) => {
    createMutation.mutate({
      source_table: suggestion.source_table,
      source_column: suggestion.source_column,
      target_table: suggestion.target_table,
      target_column: suggestion.target_column,
      relationship_type: "1:N",
      join_type: "LEFT",
    });
  };

  // 构建节点和边
  useEffect(() => {
    if (!schemaInfo?.tables || schemaInfo.tables.length === 0) return;

    // 创建表节点
    const tableNodes: Node[] = schemaInfo.tables.map((table, index) => ({
      id: table.name,
      type: "tableNode",
      position: {
        x: (index % 3) * 280 + 50,
        y: Math.floor(index / 3) * 350 + 50,
      },
      data: { table },
    }));

    setNodes(tableNodes);

    // 创建关系边
    if (relationships) {
      const relationshipEdges: Edge[] = relationships.map((rel) => ({
        id: rel.id,
        source: rel.source_table,
        sourceHandle: `${rel.source_column}-left`,
        target: rel.target_table,
        targetHandle: `${rel.target_column}-right`,
        label: `${rel.relationship_type} (${rel.join_type})`,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: { stroke: "hsl(var(--primary))", strokeWidth: 2 },
        labelStyle: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
        labelBgStyle: { fill: "hsl(var(--background))" },
      }));

      setEdges(relationshipEdges);
    }
  }, [schemaInfo, relationships, setNodes, setEdges]);

  // 处理连线
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      // 解析列名
      const sourceColumn = connection.sourceHandle?.replace("-left", "") || "";
      const targetColumn = connection.targetHandle?.replace("-right", "") || "";

      createMutation.mutate({
        source_table: connection.source,
        source_column: sourceColumn,
        target_table: connection.target,
        target_column: targetColumn,
        relationship_type: "1:N",
        join_type: "LEFT",
      });
    },
    [createMutation]
  );

  // 删除边
  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      if (confirm("确定要删除这个关系吗？")) {
        deleteMutation.mutate(edge.id);
      }
    },
    [deleteMutation]
  );

  if (!connectionId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <Database size={48} className="mb-4 opacity-50" />
        <p>请先在「数据库连接」中选择一个连接</p>
      </div>
    );
  }

  if (schemaLoading || relLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  return (
    <div className="min-h-[600px] flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">表关系配置</h2>
          <p className="text-sm text-muted-foreground mt-1">
            拖拽连线建立表之间的 JOIN 关系，AI 查询时会自动使用
          </p>
        </div>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ["schema", connectionId] })}
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
        >
          <RefreshCw size={14} />
          刷新
        </button>
      </div>

      {/* 建议列表 */}
      {schemaInfo?.suggestions && schemaInfo.suggestions.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 text-sm font-medium mb-2">
            <Lightbulb size={14} />
            检测到可能的关系
          </div>
          <div className="flex flex-wrap gap-2">
            {schemaInfo.suggestions.slice(0, 5).map((suggestion, index) => (
              <button
                key={index}
                onClick={() => applySuggestion(suggestion)}
                disabled={createMutation.isPending}
                className="px-2 py-1 text-xs bg-background border border-border rounded hover:border-primary transition-colors"
              >
                {suggestion.source_table}.{suggestion.source_column} → {suggestion.target_table}.
                {suggestion.target_column}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 已保存的关系列表 */}
      {relationships && relationships.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {relationships.map((rel) => (
            <div
              key={rel.id}
              className="flex items-center gap-2 px-2 py-1 text-xs bg-primary/10 text-primary rounded"
            >
              <span>
                {rel.source_table}.{rel.source_column} → {rel.target_table}.{rel.target_column}
              </span>
              <button
                onClick={() => deleteMutation.mutate(rel.id)}
                className="hover:text-destructive"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* React Flow 画布 */}
      <div className="flex-1 min-h-[400px] border border-border rounded-lg overflow-hidden bg-muted/20">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[15, 15]}
        >
          <Background gap={15} size={1} />
          <Controls />
          <MiniMap
            nodeColor="hsl(var(--primary))"
            maskColor="hsl(var(--background) / 0.8)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
