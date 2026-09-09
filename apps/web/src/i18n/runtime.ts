import { defaultLocale, type Locale } from "@/i18n/config";

const runtimeMessages = {
  en: {
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
