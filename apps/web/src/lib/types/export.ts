/**
 * 配置导出/导入相关类型定义
 */

// 导出的连接信息（不含敏感数据）
export interface ExportConnectionInfo {
  name: string;
  driver: "mysql" | "postgresql" | "sqlite";
  host?: string;
  port?: number;
  database?: string;
  username?: string;
}

// 导出的表关系
export interface ExportRelationship {
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  relationship_type: "1:1" | "1:N" | "N:1" | "N:M";
  join_type: "LEFT" | "INNER" | "RIGHT" | "FULL";
  description?: string;
}

// 导出的语义术语
export interface ExportSemanticTerm {
  term: string;
  expression: string;
  term_type: "metric" | "dimension" | "filter" | "alias";
  description?: string;
  examples: string[];
}

// 导出的布局配置
export interface ExportLayout {
  name: string;
  is_default: boolean;
  layout_data: Record<string, { x: number; y: number }>;
  visible_tables?: string[];
  zoom: number;
  viewport_x: number;
  viewport_y: number;
}

// 完整导出数据
export interface ConfigExport {
  version: string;
  exported_at: string;
  connection: ExportConnectionInfo;
  relationships: ExportRelationship[];
  semantic_terms: ExportSemanticTerm[];
  layouts: ExportLayout[];
}

// 导入模式
export type ImportMode = "merge" | "replace";

// 冲突处理策略
export type ConflictResolution = "skip" | "rename" | "overwrite";

// 导入请求
export interface ImportRequest {
  config: ConfigExport;
  mode: ImportMode;
  conflict_resolution: ConflictResolution;
}

// 单项导入结果
export interface ImportResultItem {
  type: "relationship" | "semantic_term" | "layout";
  name: string;
  status: "created" | "updated" | "skipped" | "failed";
  message?: string;
}

// 导入结果汇总
export interface ImportResult {
  success: boolean;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  details: ImportResultItem[];
}
