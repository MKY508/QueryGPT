/**
 * 全局状态管理模块
 * 管理应用的全局状态变量
 */

class StateManager {
    constructor() {
        // 对话相关状态
        this.currentConversationId = null;
        this.isProcessing = false;
        this.stopInProgress = false;
        
        // 视图相关状态
        this.currentViewMode = this.getStoredViewMode() || 'user';
        
        // 请求相关状态
        this.abortController = null;
        this.activeEventSource = null;
        
        // UI 相关状态
        this.activeDbWarning = null;
        this.activeThinkingId = null;
        this.interruptNoticeActive = false;
        this.pendingUserMessage = null;
        this.pendingThinkingWrapper = null;
        this.lastUserMessage = '';
        
        // 配置相关状态
        this.config = {};
        this.contextRounds = 3;
        
        // 管理器实例
        this.historyManager = null;
        this.tipsManager = null;
        
        // 缓存
        this._devViewEnabledCache = null;
        this._historyModulePromise = null;
        this._historySupportReady = false;
        this._historyNeedsRefresh = false;
        this._historyStatsLoaded = false;
    }

    /**
     * 获取存储的视图模式
     */
    getStoredViewMode() {
        const basicSettings = JSON.parse(localStorage.getItem('basic_settings') || '{}');
        if (basicSettings.default_view_mode) {
            return basicSettings.default_view_mode;
        }
        const savedMode = localStorage.getItem('view_mode');
        return savedMode || 'user';
    }

    /**
     * 设置视图模式
     */
    setViewMode(mode) {
        this.currentViewMode = mode;
        localStorage.setItem('view_mode', mode);
    }

    /**
     * 重置处理状态
     */
    resetProcessingState() {
        this.isProcessing = false;
        this.stopInProgress = false;
        this.abortController = null;
        this.activeThinkingId = null;
        this.activeEventSource = null;
    }

    /**
     * 清理临时状态
     */
    clearPendingState() {
        this.pendingUserMessage = null;
        this.pendingThinkingWrapper = null;
        this.lastUserMessage = '';
    }
}

// 创建全局状态管理器实例
window.stateManager = new StateManager();

