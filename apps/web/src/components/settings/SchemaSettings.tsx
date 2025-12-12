"use client";

import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type NodeChange,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Loader2,
  RefreshCw,
  Lightbulb,
  Trash2,
  Database,
  Plus,
  Copy,
  ChevronDown,
  Search,
  Eye,
  EyeOff,
  X,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { TableNode } from "@/components/schema/TableNode";
import type {
  SchemaInfo,
  TableRelationship,
  TableRelationshipCreate,
  RelationshipSuggestion,
  SchemaLayout,
  SchemaLayoutListItem,
  SchemaLayoutCreate,
  SchemaLayoutUpdate,
} from "@/lib/types/schema";

interface SchemaSettingsProps {
  connectionId: string | null;
}

const nodeTypes: NodeTypes = {
  tableNode: TableNode,
};

// 内部组件，使用 ReactFlow hooks
function SchemaSettingsInner({ connectionId }: SchemaSettingsProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const queryClient = useQueryClient();
  const { getViewport, setViewport } = useReactFlow();

  // 布局相关状态
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const [showLayoutDropdown, setShowLayoutDropdown] = useState(false);
  const [newLayoutName, setNewLayoutName] = useState("");
  const [showNewLayoutInput, setShowNewLayoutInput] = useState(false);

  // 表筛选状态
  const [searchQuery, setSearchQuery] = useState("");
  const [hiddenTables, setHiddenTables] = useState<Set<string>>(new Set());
  const [showHiddenPanel, setShowHiddenPanel] = useState(false);

  // 自动保存相关
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef<string>("");

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

  // 获取布局列表
  const { data: layouts } = useQuery({
    queryKey: ["layouts", connectionId],
    queryFn: async () => {
      if (!connectionId) return [];
      const response = await api.get(`/api/v1/schema/${connectionId}/layouts`);
      return response.data.data as SchemaLayoutListItem[];
    },
    enabled: !!connectionId,
  });

  // 获取当前布局详情
  const { data: currentLayout } = useQuery({
    queryKey: ["layout", connectionId, selectedLayoutId],
    queryFn: async () => {
      if (!connectionId || !selectedLayoutId) return null;
      const response = await api.get(`/api/v1/schema/${connectionId}/layouts/${selectedLayoutId}`);
      return response.data.data as SchemaLayout;
    },
    enabled: !!connectionId && !!selectedLayoutId,
  });

  // 创建布局
  const createLayoutMutation = useMutation({
    mutationFn: async (data: SchemaLayoutCreate) => {
      const response = await api.post(`/api/v1/schema/${connectionId}/layouts`, data);
      return response.data.data as SchemaLayout;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["layouts", connectionId] });
      setSelectedLayoutId(data.id);
      setShowNewLayoutInput(false);
      setNewLayoutName("");
    },
  });

  // 更新布局
  const updateLayoutMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: SchemaLayoutUpdate }) => {
      const response = await api.put(`/api/v1/schema/${connectionId}/layouts/${id}`, data);
      return response.data.data as SchemaLayout;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["layout", connectionId, selectedLayoutId] });
    },
  });

  // 删除布局
  const deleteLayoutMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/api/v1/schema/${connectionId}/layouts/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["layouts", connectionId] });
      setSelectedLayoutId(null);
    },
  });

  // 复制布局
  const duplicateLayoutMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/api/v1/schema/${connectionId}/layouts/${id}/duplicate`);
      return response.data.data as SchemaLayout;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["layouts", connectionId] });
      setSelectedLayoutId(data.id);
    },
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

  // 清理 timeout 防止内存泄漏
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // 自动选择默认布局
  useEffect(() => {
    if (layouts && layouts.length > 0 && !selectedLayoutId) {
      const defaultLayout = layouts.find((l) => l.is_default);
      if (defaultLayout) {
        setSelectedLayoutId(defaultLayout.id);
      } else {
        setSelectedLayoutId(layouts[0].id);
      }
    }
  }, [layouts, selectedLayoutId]);

  // 应用布局数据
  useEffect(() => {
    if (currentLayout) {
      // 应用隐藏表
      if (currentLayout.visible_tables) {
        const allTables = schemaInfo?.tables.map((t) => t.name) || [];
        const hidden = new Set(allTables.filter((t) => !currentLayout.visible_tables!.includes(t)));
        setHiddenTables(hidden);
      }

      // 应用视口
      if (currentLayout.zoom && currentLayout.viewport_x !== undefined) {
        setViewport({
          x: currentLayout.viewport_x,
          y: currentLayout.viewport_y,
          zoom: currentLayout.zoom,
        });
      }
    }
  }, [currentLayout, schemaInfo, setViewport]);

  // 过滤后的表
  const visibleTables = useMemo(() => {
    if (!schemaInfo?.tables) return [];
    return schemaInfo.tables.filter((table) => {
      // 排除隐藏的表
      if (hiddenTables.has(table.name)) return false;
      // 搜索过滤
      if (searchQuery && !table.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [schemaInfo, hiddenTables, searchQuery]);

  // 构建节点和边
  useEffect(() => {
    if (!visibleTables || visibleTables.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    // 创建表节点
    const tableNodes: Node[] = visibleTables.map((table, index) => {
      // 使用布局数据中的位置，否则使用默认位置
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

    setNodes(tableNodes);

    // 创建关系边
    if (relationships) {
      const visibleTableNames = new Set(visibleTables.map((t) => t.name));
      const relationshipEdges: Edge[] = relationships
        .filter(
          (rel) => visibleTableNames.has(rel.source_table) && visibleTableNames.has(rel.target_table)
        )
        .map((rel) => ({
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
  }, [visibleTables, relationships, currentLayout, setNodes, setEdges]);

  // 自动保存布局（debounce）
  const saveLayout = useCallback(() => {
    if (!selectedLayoutId || !connectionId) return;

    const layoutData: Record<string, { x: number; y: number }> = {};
    nodes.forEach((node) => {
      layoutData[node.id] = { x: node.position.x, y: node.position.y };
    });

    const viewport = getViewport();
    const visibleTablesList = schemaInfo?.tables
      .filter((t) => !hiddenTables.has(t.name))
      .map((t) => t.name);

    const dataToSave = JSON.stringify({ layoutData, viewport, visibleTablesList });

    // 避免重复保存相同数据
    if (dataToSave === lastSavedRef.current) return;
    lastSavedRef.current = dataToSave;

    updateLayoutMutation.mutate({
      id: selectedLayoutId,
      data: {
        layout_data: layoutData,
        zoom: viewport.zoom,
        viewport_x: viewport.x,
        viewport_y: viewport.y,
        visible_tables: visibleTablesList,
      },
    });
  }, [selectedLayoutId, connectionId, nodes, getViewport, hiddenTables, schemaInfo, updateLayoutMutation]);

  // 节点变化时触发自动保存
  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      onNodesChange(changes);

      // 只在位置变化时保存
      const hasPositionChange = changes.some(
        (change) => change.type === "position" && change.dragging === false
      );

      if (hasPositionChange && selectedLayoutId) {
        // debounce 保存
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(saveLayout, 500);
      }
    },
    [onNodesChange, selectedLayoutId, saveLayout]
  );

  // 处理连线
  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

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

  // 隐藏表
  const hideTable = (tableName: string) => {
    setHiddenTables((prev) => new Set([...prev, tableName]));
    // 触发保存
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(saveLayout, 500);
  };

  // 显示表
  const showTable = (tableName: string) => {
    setHiddenTables((prev) => {
      const next = new Set(prev);
      next.delete(tableName);
      return next;
    });
    // 触发保存
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(saveLayout, 500);
  };

  // 创建新布局
  const handleCreateLayout = () => {
    if (!newLayoutName.trim()) return;
    createLayoutMutation.mutate({
      name: newLayoutName.trim(),
      is_default: layouts?.length === 0,
    });
  };

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
      {/* 标题栏 */}
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

      {/* 视图选择器和搜索栏 */}
      <div className="flex items-center gap-4 mb-4">
        {/* 视图下拉选择器 */}
        <div className="relative">
          <button
            onClick={() => setShowLayoutDropdown(!showLayoutDropdown)}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors min-w-[160px]"
          >
            <span className="flex-1 text-left truncate">
              {layouts?.find((l) => l.id === selectedLayoutId)?.name || "选择视图"}
            </span>
            <ChevronDown size={14} />
          </button>

          {showLayoutDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 bg-background border border-border rounded-lg shadow-lg z-50">
              <div className="p-2 border-b border-border">
                {showNewLayoutInput ? (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newLayoutName}
                      onChange={(e) => setNewLayoutName(e.target.value)}
                      placeholder="输入视图名称"
                      className="flex-1 px-2 py-1 text-sm border border-border rounded"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreateLayout();
                        if (e.key === "Escape") setShowNewLayoutInput(false);
                      }}
                    />
                    <button
                      onClick={handleCreateLayout}
                      disabled={!newLayoutName.trim() || createLayoutMutation.isPending}
                      className="px-2 py-1 text-sm bg-primary text-primary-foreground rounded disabled:opacity-50"
                    >
                      创建
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNewLayoutInput(true)}
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded"
                  >
                    <Plus size={14} />
                    新建视图
                  </button>
                )}
              </div>

              <div className="max-h-48 overflow-y-auto">
                {layouts?.map((layout) => (
                  <div
                    key={layout.id}
                    className={`flex items-center justify-between px-3 py-2 hover:bg-muted cursor-pointer ${
                      layout.id === selectedLayoutId ? "bg-primary/10" : ""
                    }`}
                    onClick={() => {
                      setSelectedLayoutId(layout.id);
                      setShowLayoutDropdown(false);
                    }}
                  >
                    <span className="text-sm truncate">
                      {layout.name}
                      {layout.is_default && (
                        <span className="ml-2 text-xs text-muted-foreground">(默认)</span>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          duplicateLayoutMutation.mutate(layout.id);
                        }}
                        className="p-1 hover:bg-background rounded"
                        title="复制"
                      >
                        <Copy size={12} />
                      </button>
                      {!layout.is_default && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm("确定要删除这个视图吗？")) {
                              deleteLayoutMutation.mutate(layout.id);
                            }
                          }}
                          className="p-1 hover:bg-background hover:text-destructive rounded"
                          title="删除"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {(!layouts || layouts.length === 0) && (
                  <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                    暂无视图，点击上方创建
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 搜索框 */}
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索表名..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* 表统计 */}
        <div className="text-sm text-muted-foreground">
          显示: {visibleTables.length}/{schemaInfo?.tables.length || 0} 表
        </div>

        {/* 隐藏表按钮 */}
        {hiddenTables.size > 0 && (
          <button
            onClick={() => setShowHiddenPanel(!showHiddenPanel)}
            className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
          >
            <EyeOff size={14} />
            隐藏的表 ({hiddenTables.size})
          </button>
        )}
      </div>

      {/* 隐藏表面板 */}
      {showHiddenPanel && hiddenTables.size > 0 && (
        <div className="mb-4 p-3 bg-muted/50 border border-border rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">隐藏的表</span>
            <button
              onClick={() => setShowHiddenPanel(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {Array.from(hiddenTables).map((tableName) => (
              <button
                key={tableName}
                onClick={() => showTable(tableName)}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-background border border-border rounded hover:border-primary transition-colors"
              >
                <Eye size={12} />
                {tableName}
              </button>
            ))}
          </div>
        </div>
      )}

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
              <button onClick={() => deleteMutation.mutate(rel.id)} className="hover:text-destructive">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* React Flow 画布 */}
      <div
        className="border border-border rounded-lg overflow-hidden bg-muted/20"
        style={{ width: "100%", height: "500px", minHeight: "500px" }}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgeClick={onEdgeClick}
          nodeTypes={nodeTypes}
          fitView
          snapToGrid
          snapGrid={[15, 15]}
          onNodeContextMenu={(e, node) => {
            e.preventDefault();
            if (confirm(`隐藏表 "${node.id}"？`)) {
              hideTable(node.id);
            }
          }}
        >
          <Background gap={15} size={1} />
          <Controls />
          <MiniMap nodeColor="hsl(var(--primary))" maskColor="hsl(var(--background) / 0.8)" />
        </ReactFlow>
      </div>

      {/* 保存状态提示 */}
      {updateLayoutMutation.isPending && (
        <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 size={12} className="animate-spin" />
          保存中...
        </div>
      )}
    </div>
  );
}

// 导出组件，包装 ReactFlowProvider
export function SchemaSettings({ connectionId }: SchemaSettingsProps) {
  return (
    <ReactFlowProvider>
      <SchemaSettingsInner connectionId={connectionId} />
    </ReactFlowProvider>
  );
}
