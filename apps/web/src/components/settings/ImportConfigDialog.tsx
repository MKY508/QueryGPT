"use client";

import { useState, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  X,
  Upload,
  FileJson,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  SkipForward,
} from "lucide-react";
import { api } from "@/lib/api/client";
import type {
  ConfigExport,
  ImportMode,
  ConflictResolution,
  ImportResult,
} from "@/lib/types/export";

interface ImportConfigDialogProps {
  connectionId: string;
  connectionName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ImportConfigDialog({
  connectionId,
  connectionName,
  isOpen,
  onClose,
}: ImportConfigDialogProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [configData, setConfigData] = useState<ConfigExport | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [parseError, setParseError] = useState<string>("");
  const [importMode, setImportMode] = useState<ImportMode>("merge");
  const [conflictResolution, setConflictResolution] =
    useState<ConflictResolution>("skip");
  const [previewResult, setPreviewResult] = useState<ImportResult | null>(null);
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");

  // 预览导入
  const previewMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(
        `/api/v1/config/connections/${connectionId}/import/preview`,
        {
          config: configData,
          mode: importMode,
          conflict_resolution: conflictResolution,
        }
      );
      return response.data.data as ImportResult;
    },
    onSuccess: (data) => {
      setPreviewResult(data);
      setStep("preview");
    },
  });

  // 执行导入
  const importMutation = useMutation({
    mutationFn: async () => {
      const response = await api.post(
        `/api/v1/config/connections/${connectionId}/import`,
        {
          config: configData,
          mode: importMode,
          conflict_resolution: conflictResolution,
        }
      );
      return response.data.data as ImportResult;
    },
    onSuccess: (data) => {
      setPreviewResult(data);
      setStep("result");
      // 刷新相关数据
      queryClient.invalidateQueries({ queryKey: ["relationships", connectionId] });
      queryClient.invalidateQueries({ queryKey: ["layouts", connectionId] });
      queryClient.invalidateQueries({ queryKey: ["semantic-terms"] });
    },
  });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setParseError("");

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);

        // 验证基本结构
        if (!json.version || !json.connection) {
          throw new Error("无效的配置文件格式");
        }

        setConfigData(json as ConfigExport);
      } catch (err) {
        setParseError(err instanceof Error ? err.message : "解析文件失败");
        setConfigData(null);
      }
    };
    reader.onerror = () => {
      setParseError("读取文件失败");
      setConfigData(null);
    };
    reader.readAsText(file);
  };

  const handleClose = () => {
    setConfigData(null);
    setFileName("");
    setParseError("");
    setPreviewResult(null);
    setStep("upload");
    setImportMode("merge");
    setConflictResolution("skip");
    onClose();
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "created":
        return <CheckCircle size={14} className="text-green-500" />;
      case "updated":
        return <CheckCircle size={14} className="text-blue-500" />;
      case "skipped":
        return <SkipForward size={14} className="text-yellow-500" />;
      case "failed":
        return <XCircle size={14} className="text-red-500" />;
      default:
        return null;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case "created":
        return "新建";
      case "updated":
        return "更新";
      case "skipped":
        return "跳过";
      case "failed":
        return "失败";
      default:
        return status;
    }
  };

  const getTypeText = (type: string) => {
    switch (type) {
      case "relationship":
        return "表关系";
      case "semantic_term":
        return "语义术语";
      case "layout":
        return "布局";
      default:
        return type;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="font-semibold text-foreground">
            导入配置到「{connectionName}」
          </h3>
          <button
            onClick={handleClose}
            className="p-1 text-muted-foreground hover:text-foreground rounded"
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容区域 */}
        <div className="flex-1 overflow-y-auto p-4">
          {step === "upload" && (
            <div className="space-y-4">
              {/* 文件上传区域 */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/50 transition-colors"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {configData ? (
                  <div className="space-y-2">
                    <FileJson size={40} className="mx-auto text-primary" />
                    <p className="text-sm font-medium text-foreground">
                      {fileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      版本: {configData.version} | 导出时间:{" "}
                      {new Date(configData.exported_at).toLocaleString()}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload size={40} className="mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      点击或拖拽上传配置文件 (.json)
                    </p>
                  </div>
                )}
              </div>

              {parseError && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle size={14} />
                  {parseError}
                </div>
              )}

              {/* 配置预览 */}
              {configData && (
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    <p>
                      来源连接: <span className="text-foreground">{configData.connection.name}</span>
                    </p>
                    <p>
                      包含: {configData.relationships.length} 个表关系,{" "}
                      {configData.semantic_terms.length} 个语义术语,{" "}
                      {configData.layouts.length} 个布局
                    </p>
                  </div>

                  {/* 导入模式 */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-foreground">
                      导入模式
                    </label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="importMode"
                          value="merge"
                          checked={importMode === "merge"}
                          onChange={() => setImportMode("merge")}
                          className="accent-primary"
                        />
                        <span className="text-sm">合并</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="importMode"
                          value="replace"
                          checked={importMode === "replace"}
                          onChange={() => setImportMode("replace")}
                          className="accent-primary"
                        />
                        <span className="text-sm">替换</span>
                      </label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {importMode === "merge"
                        ? "保留现有配置，添加新配置"
                        : "删除现有配置，使用导入的配置"}
                    </p>
                  </div>

                  {/* 冲突处理 */}
                  {importMode === "merge" && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-foreground">
                        冲突处理
                      </label>
                      <div className="flex gap-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="conflictResolution"
                            value="skip"
                            checked={conflictResolution === "skip"}
                            onChange={() => setConflictResolution("skip")}
                            className="accent-primary"
                          />
                          <span className="text-sm">跳过</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="conflictResolution"
                            value="overwrite"
                            checked={conflictResolution === "overwrite"}
                            onChange={() => setConflictResolution("overwrite")}
                            className="accent-primary"
                          />
                          <span className="text-sm">覆盖</span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="conflictResolution"
                            value="rename"
                            checked={conflictResolution === "rename"}
                            onChange={() => setConflictResolution("rename")}
                            className="accent-primary"
                          />
                          <span className="text-sm">重命名</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {step === "preview" && previewResult && (
            <div className="space-y-4">
              {/* 预览统计 */}
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="p-2 bg-green-500/10 rounded">
                  <p className="text-lg font-semibold text-green-600">
                    {previewResult.created}
                  </p>
                  <p className="text-xs text-muted-foreground">新建</p>
                </div>
                <div className="p-2 bg-blue-500/10 rounded">
                  <p className="text-lg font-semibold text-blue-600">
                    {previewResult.updated}
                  </p>
                  <p className="text-xs text-muted-foreground">更新</p>
                </div>
                <div className="p-2 bg-yellow-500/10 rounded">
                  <p className="text-lg font-semibold text-yellow-600">
                    {previewResult.skipped}
                  </p>
                  <p className="text-xs text-muted-foreground">跳过</p>
                </div>
                <div className="p-2 bg-red-500/10 rounded">
                  <p className="text-lg font-semibold text-red-600">
                    {previewResult.failed}
                  </p>
                  <p className="text-xs text-muted-foreground">失败</p>
                </div>
              </div>

              {/* 详细列表 */}
              <div className="border border-border rounded-lg overflow-hidden">
                <div className="max-h-60 overflow-y-auto">
                  {previewResult.details.map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 px-3 py-2 border-b border-border/50 last:border-b-0 text-sm"
                    >
                      {getStatusIcon(item.status)}
                      <span className="text-muted-foreground">
                        [{getTypeText(item.type)}]
                      </span>
                      <span className="flex-1 truncate">{item.name}</span>
                      <span
                        className={`text-xs ${
                          item.status === "failed"
                            ? "text-red-500"
                            : "text-muted-foreground"
                        }`}
                      >
                        {getStatusText(item.status)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === "result" && previewResult && (
            <div className="space-y-4 text-center">
              {previewResult.success ? (
                <>
                  <CheckCircle size={48} className="mx-auto text-green-500" />
                  <p className="text-lg font-medium text-foreground">
                    导入成功
                  </p>
                </>
              ) : (
                <>
                  <AlertCircle size={48} className="mx-auto text-yellow-500" />
                  <p className="text-lg font-medium text-foreground">
                    导入完成（部分失败）
                  </p>
                </>
              )}
              <p className="text-sm text-muted-foreground">
                新建 {previewResult.created} 项，更新 {previewResult.updated} 项，
                跳过 {previewResult.skipped} 项，失败 {previewResult.failed} 项
              </p>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          {step === "upload" && (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                取消
              </button>
              <button
                onClick={() => previewMutation.mutate()}
                disabled={!configData || previewMutation.isPending}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {previewMutation.isPending && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                预览
              </button>
            </>
          )}

          {step === "preview" && (
            <>
              <button
                onClick={() => setStep("upload")}
                className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground"
              >
                返回
              </button>
              <button
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending}
                className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {importMutation.isPending && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                确认导入
              </button>
            </>
          )}

          {step === "result" && (
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            >
              完成
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
