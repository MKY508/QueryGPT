import { defaultLocale, type Locale } from "@/i18n/config";

const runtimeMessages = {
  en: {
    fileUploadEmpty: "This file is empty. Choose a file with data.",
    fileUploadTooLarge: "This file is too large. Split it into smaller files before uploading.",
    fileUploadUnsupported: "Choose a CSV, Excel, Parquet, JSON, JSONL, or NDJSON file.",
    fileUploadNoSpace: "There is not enough free space to save this file.",
    fileUploadWriteFailed: "This file could not be saved. Please retry later.",
    fileUploadOutcomeUnknown: "The upload could not be confirmed. Check the source list before uploading it again.",
    fileUploadNotConfirmed: "No completed import was found yet. You can check again or retry this upload safely.",
    fileUploadRecoveredNotConfirmed: "No completed import was found yet. Keep this record and check again later; the previous upload may still finish.",
    fileUploadReselectAvailable: "No completed import was found yet. Select the original file to continue, or check again later.",
    fileUploadReselectMismatch: "This file differs from the original. Select the unchanged original file.",
    fileUploadReadFailed: "This file could not be read or checked. Please try again later.",
    fileUploadRecoveryUnavailable: "The upload record could not be saved. Please retry before uploading.",
    fileUploadRecoveryLimit: "There are too many pending import records. Check or clear earlier records before uploading more files.",
    fileUploadRecoveryChanged: "This upload record was changed or cleared in another window. No file was sent.",
    fileUploadRecoveryCleanupFailed: "The import record could not be cleared. Imported files are unchanged; try clearing the record again.",
    fileUploadCheckFailed: "The result could not be checked. Please try checking again later.",
    fileUploadSourceRemoved: "This file was imported and later removed from the project.",
    fileUploadRequestChanged: "This upload request refers to a different file. Please check the source list.",
    fileUploadInvalid: "This upload was incomplete or invalid. Choose the file and try again.",
    fileUploadTimeout: "The file took too long to upload. Please try again.",
    fileUploadBusy: "Other files are still being added. Please try again shortly.",
    fileUploadQueuePending: "Continue or cancel the waiting files before adding more.",
    fileUploadQueueLimit: "Keep up to 100 files in this list. Clear finished records or select fewer files.",
    fileUploadListRefreshFailed: "The source list could not be refreshed. Please try again later.",
    requestFailedHttp: "The request could not be completed. Please retry.",
    unrecognizedAnalysisEvent: "The investigation was interrupted. Please retry.",
    missingResponseBody: "The investigation was interrupted. Please retry.",
    executionFailed: "The investigation could not be completed.",
    analysisAlreadyRunning:
      "An investigation is already running. Finish or stop it before starting another.",
    analysisConnectionInterrupted:
      "The analysis connection ended unexpectedly without a completion event. Please retry.",
    analysisAlreadyRunningForCheck:
      "An investigation is already running. Finish or stop it before checking changes.",
    confirmationSavedElsewhere:
      "The confirmation was saved, but you switched investigations. Return to the original investigation to continue.",
    invalidConversationRecord:
      "This investigation cannot be opened right now. Please retry.",
    conversationProjectMismatch:
      "This investigation record belongs to another project and could not be restored.",
    conversationOpenFailed:
      "This investigation record cannot be opened right now. Please retry later.",
    savingInvestigationResult: "Saving investigation results",
    investigationStopped: "This investigation was stopped.",
    investigationStoppedSaved: "This investigation was stopped.",
    dataPreparationFailed: "Data preparation failed. Please retry later.",
    noProjectToView: "There is no project available to view.",
    recipeHistoryLoadFailed: "Recipe history could not be loaded. Please retry.",
    noProjectToUpdate: "There is no project available to update.",
    recipeHistoryNotReady: "Recipe history is not ready yet. Refresh and retry.",
    recipeChangedBeforeRestore:
      "The recipe changed just now. Refresh before choosing a version to restore.",
    recipeRevisionUnavailable:
      "That recipe version is no longer available. Refresh and choose another version.",
    recipeRestoreFailed: "The recipe was not restored. Please retry later.",
    noProjectToClean: "There is no project available for data preparation.",
    previewRecipeFirst: "Preview what this recipe will change first.",
    cleaningPreviewFailed: "The prepared-data preview is unavailable. Please retry.",
    cleaningInProgress: "Please wait for the current data preparation to finish.",
    previewCleaningFirst: "Preview the prepared-data changes first.",
    sourceChangedBeforeApply:
      "The data changed after the preview. Preview it again before applying.",
    cleaningApplyFailed: "The preparation changes could not be applied. Please retry.",
    revisionHistoryLoadFailed: "Revision history could not be loaded. Please retry.",
    understandingRevisionNotReady:
      "This project definition is still preparing its revision history. Refresh before restoring.",
    understandingChangedRefreshThenRestore:
      "This definition changed just now. The latest revision is loaded; review it before restoring.",
    understandingChangedBeforeRestore:
      "This definition changed just now. Refresh before trying to restore it.",
    understandingRevisionUnavailableRefreshed:
      "That revision is no longer available. The history was refreshed; choose another revision.",
    understandingRevisionUnavailable:
      "That revision is no longer available. Refresh and choose another revision.",
    understandingRestoreFailed: "The revision could not be restored. Please retry later.",
    noProjectToProcess: "There is no project available for this action.",
    sourceVersionAccepted:
      "This data version is now in use; the previous trusted version remains in history.",
    noCleaningActionToUndo: "There is no preparation action from this run to undo.",
    unknownError: "Something went wrong. Please retry.",
    statusDisconnected: "Not connected",
    statusReconnect: "Reconnect required",
    statusAvailable: "Available",
    statusTemporarilyUnavailable: "Temporarily unavailable",
    statusNeedsAttention: "Needs attention",
    statusUnchecked: "Not checked"
  },
  zh: {
    fileUploadEmpty: "这份文件是空的，请选择有内容的文件。",
    fileUploadTooLarge: "这份文件过大，请拆分后再上传。",
    fileUploadUnsupported: "请选择 CSV、Excel、Parquet、JSON、JSONL 或 NDJSON 文件。",
    fileUploadNoSpace: "可用空间不足，暂时无法保存这份文件。",
    fileUploadWriteFailed: "这份文件暂时无法保存，请稍后重试。",
    fileUploadOutcomeUnknown: "暂时无法确认文件是否已加入，请先查看来源列表，避免重复上传。",
    fileUploadNotConfirmed: "暂未查到已完成的导入，可以再次检查或安全重试本次上传。",
    fileUploadRecoveredNotConfirmed: "暂未查到已完成的导入。请保留记录并稍后再检查，之前的上传仍可能完成。",
    fileUploadReselectAvailable: "暂未查到已完成的导入，可以选择原文件继续，或稍后再检查。",
    fileUploadReselectMismatch: "这份文件与原文件不同，请选择未经修改的原文件。",
    fileUploadReadFailed: "暂时无法读取或核对这份文件，请稍后重试。",
    fileUploadRecoveryUnavailable: "暂时无法保存上传记录，本次未发送文件，请稍后重试。",
    fileUploadRecoveryLimit: "待确认的导入记录较多，请先检查或清除旧记录，再加入文件。",
    fileUploadRecoveryChanged: "这条上传记录已在其他窗口修改或清除，本次未发送文件。",
    fileUploadRecoveryCleanupFailed: "导入记录暂时无法清除，已加入的文件不受影响，请稍后再清除记录。",
    fileUploadCheckFailed: "暂时无法检查结果，请稍后再次检查。",
    fileUploadSourceRemoved: "这份文件曾成功加入，后来已从项目移除。",
    fileUploadRequestChanged: "本次上传与此前的文件不一致，请查看来源列表。",
    fileUploadInvalid: "这次上传不完整或格式不正确，请重新选择文件上传。",
    fileUploadTimeout: "这次上传用时过长，请重新上传。",
    fileUploadBusy: "还有文件正在加入，请稍后再上传。",
    fileUploadQueuePending: "请先继续或取消等待中的文件，再加入其他文件。",
    fileUploadQueueLimit: "列表最多保留 100 份文件，请清除已结束的记录或减少本次选择。",
    fileUploadListRefreshFailed: "来源列表暂时无法刷新，请稍后再试。",
    requestFailedHttp: "请求未能完成，请重试。",
    unrecognizedAnalysisEvent: "这次调查中断，请重试。",
    missingResponseBody: "这次调查中断，请重试。",
    executionFailed: "这次调查未能完成。",
    analysisAlreadyRunning: "已有一项调查正在进行，请完成或停止后再开始新的调查。",
    analysisConnectionInterrupted: "分析连接意外中断，未收到完成状态，请重试。",
    analysisAlreadyRunningForCheck: "已有一项调查正在进行，请完成或停止后再检查变化。",
    confirmationSavedElsewhere: "确认已经保存；你已切换到其他调查，请回到原调查后继续。",
    invalidConversationRecord: "这份调查暂时无法打开，请重试。",
    conversationProjectMismatch: "这份调查记录不属于当前项目，已停止恢复。",
    conversationOpenFailed: "这份调查记录暂时无法打开，请稍后重试。",
    savingInvestigationResult: "正在保存调查结果",
    investigationStopped: "这次调查已停止。",
    investigationStoppedSaved: "这次调查已停止。",
    dataPreparationFailed: "数据准备失败，请稍后重试。",
    noProjectToView: "当前没有可查看的项目。",
    recipeHistoryLoadFailed: "整理方法的修改记录暂时无法加载，请重试。",
    noProjectToUpdate: "当前没有可更新的项目。",
    recipeHistoryNotReady: "这套整理方法的修改记录还没有准备好，请刷新后重试。",
    recipeChangedBeforeRestore: "整理方法刚刚有了新修改，刷新后再选择要恢复的版本。",
    recipeRevisionUnavailable: "这个历史版本已经不可用，请刷新后重新选择。",
    recipeRestoreFailed: "这次恢复没有完成，请稍后重试。",
    noProjectToClean: "当前没有可整理的项目。",
    previewRecipeFirst: "请先查看这套整理方法会带来什么变化。",
    cleaningPreviewFailed: "暂时无法预览整理结果，请重试。",
    cleaningInProgress: "请等待当前整理完成。",
    previewCleaningFirst: "请先预览整理后的变化。",
    sourceChangedBeforeApply: "数据刚刚发生了变化，请重新预览后再应用。",
    cleaningApplyFailed: "暂时无法应用这次整理，请重试。",
    revisionHistoryLoadFailed: "修改记录暂时无法加载，请重试。",
    understandingRevisionNotReady: "这条理解仍在准备修改记录，请刷新后再恢复。",
    understandingChangedRefreshThenRestore: "这条理解刚刚有了新修改，已刷新最新版本；请确认后再恢复。",
    understandingChangedBeforeRestore: "这条理解刚刚有了新修改，请刷新后再尝试恢复。",
    understandingRevisionUnavailableRefreshed: "这个历史版本已不可用，已刷新修改记录，请重新选择。",
    understandingRevisionUnavailable: "这个历史版本已不可用，请刷新后重新选择。",
    understandingRestoreFailed: "历史版本暂时无法恢复，请稍后重试。",
    noProjectToProcess: "当前没有可处理的项目。",
    sourceVersionAccepted: "这版数据已确认启用，上个可信版本保留在历史中。",
    noCleaningActionToUndo: "没有可撤销的本次整理记录。",
    unknownError: "暂时无法完成，请重试。",
    statusDisconnected: "尚未连接",
    statusReconnect: "需要重新连接",
    statusAvailable: "可用",
    statusTemporarilyUnavailable: "暂时不可用",
    statusNeedsAttention: "需要处理",
    statusUnchecked: "未检查"
  }
} as const satisfies Record<Locale, Record<string, string>>;

export type RuntimeMessageKey = keyof (typeof runtimeMessages)["en"];

function currentLocale(): Locale {
  if (typeof document === "undefined") return defaultLocale;
  return document.documentElement.lang.toLowerCase().startsWith("en") ? "en" : "zh";
}

export function runtimeMessage(
  key: RuntimeMessageKey,
  values: Record<string, string | number> = {}
): string {
  const template = runtimeMessages[currentLocale()][key];
  return template.replace(/\{(\w+)\}/g, (match, token: string) =>
    Object.prototype.hasOwnProperty.call(values, token) ? String(values[token]) : match
  );
}
