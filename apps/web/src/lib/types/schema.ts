/**
 * Schema 和表关系类型定义
 */

export interface ColumnInfo {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  default_value?: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnInfo[];
  row_count?: number;
}

export interface RelationshipSuggestion {
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  confidence: number;
  reason: string;
}

export interface SchemaInfo {
  tables: TableInfo[];
  suggestions: RelationshipSuggestion[];
}

export interface TableRelationship {
  id: string;
  connection_id: string;
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  relationship_type: "1:1" | "1:N" | "N:1" | "N:M";
  join_type: "LEFT" | "INNER" | "RIGHT" | "FULL";
  description?: string;
  is_active: boolean;
}

export interface TableRelationshipCreate {
  source_table: string;
  source_column: string;
  target_table: string;
  target_column: string;
  relationship_type?: "1:1" | "1:N" | "N:1" | "N:M";
  join_type?: "LEFT" | "INNER" | "RIGHT" | "FULL";
  description?: string;
}
