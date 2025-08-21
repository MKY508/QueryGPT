/**
 * 历史记录管理器
 * 处理历史记录的加载、显示、搜索和虚拟滚动
 */

class HistoryManager {
    constructor() {
        this.conversations = [];
        this.currentConversation = null;
        this.isLoading = false;
        this.isDeleting = false;  // 标记是否正在删除
        this.searchQuery = '';
        this.viewMode = 'recent'; // recent, favorites, search
        this.virtualScroll = null;
        this.cache = new Map(); // 缓存对话详情
        this.needsRefresh = false;  // 标记是否需要刷新
        
        // 虚拟滚动配置
        this.itemHeight = 80; // 每个历史项的高度
        this.visibleCount = 10; // 可见项数量
        this.bufferSize = 5; // 缓冲区大小
        
        // 环境配置（从localStorage或环境变量）
        this.config = {
            enableVirtualScroll: this.getConfig('HISTORY_VIRTUALIZE', true),
            preloadPages: this.getConfig('HISTORY_PRELOAD_PAGES', 2),
            cacheTTL: this.getConfig('HISTORY_CACHE_TTL', 3600),
            enableSimilarity: this.getConfig('HISTORY_ENABLE_SIMILARITY', true),
            autoCleanupDays: this.getConfig('HISTORY_AUTO_CLEANUP_DAYS', 90)
        };
        
        this.initialized = false;  // 标记是否已初始化
        // 不再自动初始化，等待首次访问时初始化
    }
    
    /**
     * 获取配置值
     */
    getConfig(key, defaultValue) {
        // 先从localStorage查找
        const stored = localStorage.getItem(key);
        if (stored !== null) {
            return stored === 'true' || stored === true;
        }
        return defaultValue;
    }
    
    /**
     * 确保已初始化
     */
    async ensureInitialized() {
        if (!this.initialized) {
            await this.init();
        }
    }
    
    /**
     * 初始化历史记录管理器
     */
    async init() {
        if (this.initialized) return;  // 避免重复初始化
        
        this.initialized = true;
        this.setupEventListeners();
        this.setupVirtualScroll();
        this.setupIntersectionObserver();
        
        // 首次加载数据
        await this.loadRecentConversations();
        
        // 定期刷新历史记录（每30秒）
        this.startAutoRefresh();
    }
    
    /**
     * 启动自动刷新
     */
    startAutoRefresh() {
        // 清除旧的定时器
        if (this.autoRefreshTimer) {
            clearInterval(this.autoRefreshTimer);
        }
        
        // 每30秒自动刷新一次
        this.autoRefreshTimer = setInterval(() => {
            // 如果正在删除或加载中，不刷新
            if (!this.isLoading && !this.isDeleting && document.getElementById('history-tab').classList.contains('active')) {
                // 自动刷新历史记录（静默）
                this.loadRecentConversations(0, true);  // 静默刷新
            }
        }, 30000);
    }
    
    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 搜索框
        const searchInput = document.getElementById('history-search');
        if (searchInput) {
            searchInput.addEventListener('input', this.debounce((e) => {
                this.searchQuery = e.target.value;
                this.searchConversations();
            }, 300));
        }
        
        // 筛选按钮
        document.querySelectorAll('.history-filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const filter = e.target.dataset.filter;
                this.switchViewMode(filter);
            });
        });
        
        // 清理按钮
        const cleanupBtn = document.getElementById('cleanup-history-btn');
        if (cleanupBtn) {
            cleanupBtn.addEventListener('click', () => this.cleanupOldHistory());
        }
    }
    
    /**
     * 设置虚拟滚动
     */
    setupVirtualScroll() {
        if (!this.config.enableVirtualScroll) return;
        
        const container = document.getElementById('history-list-container');
        if (!container) return;
        
        this.virtualScroll = {
            container,
            scrollTop: 0,
            startIndex: 0,
            endIndex: this.visibleCount + this.bufferSize,
            items: []
        };
        
        container.addEventListener('scroll', this.throttle(() => {
            this.handleVirtualScroll();
        }, 16)); // 60fps
    }
    
    /**
     * 处理虚拟滚动
     */
    handleVirtualScroll() {
        if (!this.virtualScroll) return;
        
        const { container } = this.virtualScroll;
        const scrollTop = container.scrollTop;
        
        // 计算可见区域
        const startIndex = Math.floor(scrollTop / this.itemHeight);
        const endIndex = Math.min(
            startIndex + this.visibleCount + this.bufferSize * 2,
            this.conversations.length
        );
        
        // 只在索引变化时重新渲染
        if (startIndex !== this.virtualScroll.startIndex || 
            endIndex !== this.virtualScroll.endIndex) {
            this.virtualScroll.startIndex = Math.max(0, startIndex - this.bufferSize);
            this.virtualScroll.endIndex = endIndex;
            this.renderVirtualList();
        }
        
        // 预加载
        if (this.config.preloadPages > 0) {
            this.preloadNearbyPages(startIndex);
        }
    }
    
    /**
     * 渲染虚拟列表
     */
    renderVirtualList() {
        const listElement = document.getElementById('history-list');
        if (!listElement) return;
        
        // 如果没有对话，显示空状态
        if (this.conversations.length === 0) {
            listElement.style.height = '';
            listElement.style.paddingTop = '';
            listElement.innerHTML = `
                <div class="history-empty">
                    <i class="fas fa-history"></i>
                    <p>暂无历史记录</p>
                </div>
            `;
            return;
        }
        
        // 确保虚拟滚动索引有效（修复判断逻辑）
        if (this.virtualScroll.startIndex === undefined || this.virtualScroll.endIndex === undefined) {
            this.virtualScroll.startIndex = 0;
            this.virtualScroll.endIndex = Math.min(this.visibleCount + this.bufferSize * 2, this.conversations.length);
        }
        
        const { startIndex, endIndex } = this.virtualScroll;
        const visibleConversations = this.conversations.slice(startIndex, endIndex);
        
        // 创建占位符
        const totalHeight = this.conversations.length * this.itemHeight;
        const offsetY = startIndex * this.itemHeight;
        
        listElement.style.height = `${totalHeight}px`;
        listElement.style.paddingTop = `${offsetY}px`;
        
        // 渲染可见项
        const fragment = document.createDocumentFragment();
        visibleConversations.forEach((conv, index) => {
            const item = this.createHistoryItem(conv, startIndex + index);
            fragment.appendChild(item);
        });
        
        // 清空并添加新内容
        const itemsContainer = listElement.querySelector('.virtual-items') || 
                              document.createElement('div');
        itemsContainer.className = 'virtual-items';
        itemsContainer.innerHTML = '';
        itemsContainer.appendChild(fragment);
        
        if (!listElement.querySelector('.virtual-items')) {
            listElement.appendChild(itemsContainer);
        }
    }
    
    /**
     * 创建历史记录项
     */
    createHistoryItem(conversation, index) {
        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.conversationId = conversation.id;
        item.dataset.index = index;
        
        // 格式化时间
        const time = this.formatTime(conversation.updated_at);
        
        // 构建HTML
        item.innerHTML = `
            <div class="history-item-header">
                <h4 class="history-item-title">${this.escapeHtml(conversation.title)}</h4>
                <div class="history-item-actions">
                    <button class="history-action-btn" data-action="replay" 
                            data-id="${conversation.id}" title="重新执行">
                        <i class="fas fa-play"></i>
                    </button>
                    <button class="history-action-btn" data-action="delete" 
                            data-id="${conversation.id}" title="删除">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="history-item-content">
                <p class="history-item-query">${this.escapeHtml(conversation.last_query || '')}</p>
                <div class="history-item-meta">
                    <span class="history-meta-time">
                        <i class="fas fa-clock"></i> ${time}
                    </span>
                    <span class="history-meta-count">
                        <i class="fas fa-comment"></i> ${conversation.message_count || 0}
                    </span>
                    ${conversation.model ? `
                        <span class="history-meta-model">
                            <i class="fas fa-brain"></i> ${conversation.model}
                        </span>
                    ` : ''}
                </div>
            </div>
        `;
        
        // 添加事件监听器
        this.attachItemEventListeners(item);
        
        return item;
    }
    
    /**
     * 附加项目事件监听器
     */
    attachItemEventListeners(item) {
        // 点击项目加载对话
        item.addEventListener('click', (e) => {
            if (!e.target.closest('.history-action-btn')) {
                const id = item.dataset.conversationId;
                this.loadConversation(id);
            }
        });
        
        // 操作按钮
        item.querySelectorAll('.history-action-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                e.preventDefault();
                const action = btn.dataset.action;
                const id = btn.dataset.id;
                
                // 点击操作按钮: action=${action}, id=${id}
                
                switch(action) {
                    case 'replay':
                        await this.replayConversation(id);
                        break;
                    case 'delete':
                        await this.deleteConversation(id);
                        break;
                    default:
                        console.warn('未知操作:', action);
                }
            });
        });
    }
    
    /**
     * 设置Intersection Observer用于懒加载
     */
    setupIntersectionObserver() {
        const options = {
            root: document.getElementById('history-list-container'),
            rootMargin: '100px',
            threshold: 0.01
        };
        
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const item = entry.target;
                    const id = item.dataset.conversationId;
                    
                    // 预加载对话详情
                    if (!this.cache.has(id)) {
                        this.preloadConversationDetail(id);
                    }
                }
            });
        }, options);
    }
    
    /**
     * 重置状态并重新加载
     */
    async resetAndReload() {
        // 确保已初始化
        await this.ensureInitialized();
        
        // 重置虚拟滚动状态
        if (this.virtualScroll) {
            this.virtualScroll.startIndex = 0;
            this.virtualScroll.endIndex = this.visibleCount + this.bufferSize * 2;
        }
        
        // 保存旧数据用于判断
        const hadData = this.conversations.length > 0;
        
        // 清空缓存但暂时保留conversations（避免闪烁）
        this.cache.clear();
        
        // 如果之前有数据，静默刷新；否则显示加载
        this.loadRecentConversations(0, hadData);
    }
    
    /**
     * 加载最近的对话
     */
    async loadRecentConversations(retryCount = 0, silent = false) {
        this.isLoading = true;
        
        // 只在非静默模式且没有数据时显示加载状态
        if (!silent && this.conversations.length === 0) {
            this.showLoading();
        }
        
        try {
            const response = await fetch('/api/history/conversations?limit=50');
            const data = await response.json();
            
            if (data.success) {
                this.conversations = data.conversations || [];
                
                // 加载了历史记录
                
                // 如果没有数据且有重试次数，等待后重试
                if (this.conversations.length === 0 && retryCount < 3) {
                    // 历史记录为空，重试中...
                    setTimeout(() => {
                        this.loadRecentConversations(retryCount + 1);
                    }, 1000); // 等待1秒后重试
                    return;
                }
                
                // 无论是否有数据都要渲染（清除旧的"暂无历史记录"消息）
                this.renderConversations();
            }
        } catch (error) {
            console.error('加载历史记录失败:', error);
            this.showError('加载历史记录失败');
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }
    
    /**
     * 搜索对话
     */
    async searchConversations() {
        if (!this.searchQuery) {
            return this.loadRecentConversations(0, true);  // 静默加载
        }
        
        this.isLoading = true;
        // 搜索时不显示加载状态，直接更新结果
        
        try {
            const response = await fetch(
                `/api/history/conversations?q=${encodeURIComponent(this.searchQuery)}`
            );
            const data = await response.json();
            
            if (data.success) {
                this.conversations = data.conversations;
                this.renderConversations();
            }
        } catch (error) {
            console.error('搜索失败:', error);
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }
    
    /**
     * 加载对话详情
     */
    async loadConversation(conversationId) {
        // 检查缓存
        if (this.cache.has(conversationId)) {
            const cached = this.cache.get(conversationId);
            if (Date.now() - cached.timestamp < this.config.cacheTTL * 1000) {
                this.displayConversation(cached.data);
                return;
            }
        }
        
        this.showLoading();
        
        try {
            const response = await fetch(`/api/history/conversation/${conversationId}`);
            const data = await response.json();
            
            if (data.success) {
                // 缓存结果
                this.cache.set(conversationId, {
                    data: data.conversation,
                    timestamp: Date.now()
                });
                
                this.displayConversation(data.conversation);
            }
        } catch (error) {
            console.error('加载对话失败:', error);
            this.showError('加载对话失败');
        } finally {
            this.hideLoading();
        }
    }
    
    /**
     * 显示对话内容
     */
    displayConversation(conversation) {
        this.currentConversation = conversation;
        
        // 触发事件，让主应用加载对话
        const event = new CustomEvent('historyConversationLoaded', {
            detail: conversation
        });
        window.dispatchEvent(event);
        
        // 关闭历史面板（如果在弹出模式）
        this.closeHistoryPanel();
    }
    
    
    /**
     * 重放对话
     */
    async replayConversation(conversationId) {
        try {
            const response = await fetch(
                `/api/history/replay/${conversationId}`,
                { method: 'POST' }
            );
            const data = await response.json();
            
            if (data.success) {
                this.displayConversation(data.conversation);
            }
        } catch (error) {
            console.error('重放对话失败:', error);
        }
    }
    
    /**
     * 删除对话
     */
    async deleteConversation(conversationId) {
        // 准备删除对话
        this.pendingDeleteId = conversationId;
        this.showDeleteModal();
    }
    
    /**
     * 显示删除确认弹窗
     */
    showDeleteModal() {
        // 显示删除弹窗
        const modal = document.getElementById('delete-modal');
        if (modal) {
            modal.classList.add('show');
            
            // 移除旧的事件监听器并添加新的
            const confirmBtn = document.getElementById('confirm-delete-btn');
            if (confirmBtn) {
                // 使用新的按钮克隆来移除所有旧的事件监听器
                const newBtn = confirmBtn.cloneNode(true);
                confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
                
                // 使用箭头函数确保this绑定正确
                newBtn.onclick = (e) => {
                    e.preventDefault();
                    // 确认按钮被点击
                    this.confirmDelete();
                };
                
                // 删除确认按钮事件已绑定
            } else {
                this.showError('找不到确认删除按钮');
            }
        } else {
            this.showError('找不到删除弹窗');
        }
    }
    
    /**
     * 关闭删除确认弹窗
     */
    closeDeleteModal() {
        const modal = document.getElementById('delete-modal');
        if (modal) {
            modal.classList.remove('show');
        }
        // 不要立即清除pendingDeleteId，等删除完成后再清
    }
    
    /**
     * 确认删除
     */
    confirmDelete = async () => {
        console.log('confirmDelete被调用, pendingDeleteId:', this.pendingDeleteId);
        
        if (!this.pendingDeleteId) {
            console.error('没有待删除的对话ID');
            return;
        }
        
        const conversationId = this.pendingDeleteId;
        console.log('正在删除对话:', conversationId);
        
        // 设置删除标志，防止自动刷新干扰
        this.isDeleting = true;
        
        // 关闭弹窗
        const modal = document.getElementById('delete-modal');
        if (modal) {
            modal.classList.remove('show');
        }
        
        try {
            const response = await fetch(
                `/api/history/conversation/${conversationId}`,
                { 
                    method: 'DELETE',
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            const data = await response.json();
            
            // 检查响应状态和成功标志
            if (!response.ok || !data.success) {
                throw new Error(data.error || `删除失败: ${response.status} ${response.statusText}`);
            }
            
            if (data.success) {
                // 清除缓存
                this.cache.delete(conversationId);
                
                // 如果删除的是当前对话，清除currentConversationId
                const app = window.app;
                if (app && app.currentConversationId === conversationId) {
                    app.currentConversationId = null;
                    localStorage.removeItem('currentConversationId');
                }
                
                // 从本地数组中移除
                const beforeCount = this.conversations.length;
                this.conversations = this.conversations.filter(c => c.id !== conversationId);
                const afterCount = this.conversations.length;
                
                console.log(`删除前: ${beforeCount} 条, 删除后: ${afterCount} 条`);
                console.log('当前数组:', this.conversations);
                
                // 直接操作DOM - 最简单直接的方法
                const listElement = document.getElementById('history-list');
                console.log('找到列表元素:', listElement);
                
                if (listElement) {
                    // 方法1: 完全清空并重建
                    listElement.innerHTML = '';
                    
                    if (this.conversations.length === 0) {
                        // 没有数据时显示空状态
                        listElement.innerHTML = `
                            <div class="history-empty">
                                <i class="fas fa-history"></i>
                                <p>暂无历史记录</p>
                            </div>
                        `;
                    } else {
                        // 有数据时重新创建所有项目
                        this.conversations.forEach((conv, index) => {
                            const item = this.createHistoryItem(conv, index);
                            listElement.appendChild(item);
                        });
                    }
                    
                    console.log('DOM已更新，当前子元素数:', listElement.children.length);
                    
                    // 强制浏览器重排以确保更新显示
                    listElement.style.display = 'none';
                    void listElement.offsetHeight; // 触发重排
                    listElement.style.display = '';
                } else {
                    console.error('找不到history-list元素！');
                }
                
                // 更新统计
                this.updateStatistics();
                
                this.showSuccess('对话已删除');
                console.log('对话已删除并重新渲染');
            } else {
                throw new Error(data.error || '删除失败');
            }
        } catch (error) {
            console.error('删除对话失败:', error);
            this.showError(`删除失败: ${error.message}`);
        } finally {
            // 清理状态
            this.pendingDeleteId = null;
            this.isDeleting = false;  // 清除删除标志
        }
    }
    
    /**
     * 清理旧历史
     */
    async cleanupOldHistory() {
        const days = this.config.autoCleanupDays;
        if (!confirm(`确定要清理${days}天前的历史记录吗？`)) {
            return;
        }
        
        try {
            const response = await fetch('/api/history/cleanup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ days })
            });
            const data = await response.json();
            
            if (data.success) {
                this.showSuccess(data.message);
                await this.loadRecentConversations();
            }
        } catch (error) {
            console.error('清理失败:', error);
        }
    }
    
    /**
     * 切换视图模式
     */
    switchViewMode(mode) {
        this.viewMode = mode;
        
        // 更新按钮状态
        document.querySelectorAll('.history-filter-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.filter === mode);
        });
        
        // 加载相应的数据
        switch(mode) {
            case 'recent':
                this.loadRecentConversations();
                break;
            case 'today':
                this.loadTodayConversations();
                break;
            case 'week':
                this.loadWeekConversations();
                break;
            case 'search':
                // 搜索模式由搜索框触发
                break;
        }
    }
    
    /**
     * 加载今天的对话
     */
    async loadTodayConversations() {
        this.isLoading = true;
        // 只在没有数据时显示加载状态
        if (this.conversations.length === 0) {
            this.showLoading();
        }
        
        try {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const response = await fetch(`/api/history/conversations?start_date=${today.toISOString()}`);
            const data = await response.json();
            
            if (data.success) {
                this.conversations = data.conversations;
                this.renderConversations();
            }
        } catch (error) {
            console.error('加载今日对话失败:', error);
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }
    
    /**
     * 加载本周的对话
     */
    async loadWeekConversations() {
        this.isLoading = true;
        // 只在没有数据时显示加载状态
        if (this.conversations.length === 0) {
            this.showLoading();
        }
        
        try {
            const today = new Date();
            const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
            const response = await fetch(`/api/history/conversations?start_date=${weekAgo.toISOString()}`);
            const data = await response.json();
            
            if (data.success) {
                this.conversations = data.conversations;
                this.renderConversations();
            }
        } catch (error) {
            console.error('加载本周对话失败:', error);
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }
    
    /**
     * 渲染对话列表
     */
    renderConversations() {
        // 确保虚拟滚动索引有效
        if (this.virtualScroll && this.conversations.length > 0) {
            // 确保索引不超出范围
            if (this.virtualScroll.startIndex >= this.conversations.length) {
                this.virtualScroll.startIndex = Math.max(0, this.conversations.length - this.visibleCount);
            }
            if (this.virtualScroll.endIndex > this.conversations.length) {
                this.virtualScroll.endIndex = this.conversations.length;
            }
        }
        
        if (this.config.enableVirtualScroll && this.virtualScroll) {
            this.renderVirtualList();
        } else {
            this.renderNormalList();
        }
    }
    
    /**
     * 渲染普通列表（非虚拟滚动）
     */
    renderNormalList() {
        const listElement = document.getElementById('history-list');
        if (!listElement) return;
        
        if (this.conversations.length === 0) {
            listElement.innerHTML = `
                <div class="history-empty">
                    <i class="fas fa-history"></i>
                    <p>暂无历史记录</p>
                </div>
            `;
            return;
        }
        
        const fragment = document.createDocumentFragment();
        this.conversations.forEach((conv, index) => {
            const item = this.createHistoryItem(conv, index);
            fragment.appendChild(item);
            
            // 添加到观察器
            if (this.observer) {
                this.observer.observe(item);
            }
        });
        
        listElement.innerHTML = '';
        listElement.appendChild(fragment);
    }
    
    /**
     * 预加载对话详情
     */
    async preloadConversationDetail(conversationId) {
        if (this.cache.has(conversationId)) return;
        
        try {
            const response = await fetch(`/api/history/conversation/${conversationId}`);
            const data = await response.json();
            
            if (data.success) {
                this.cache.set(conversationId, {
                    data: data.conversation,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            console.error('预加载失败:', error);
        }
    }
    
    /**
     * 预加载附近页面
     */
    preloadNearbyPages(currentIndex) {
        const pageSize = this.visibleCount;
        const startPage = Math.floor(currentIndex / pageSize);
        
        for (let i = 1; i <= this.config.preloadPages; i++) {
            const nextPageStart = (startPage + i) * pageSize;
            const nextPageEnd = Math.min(nextPageStart + pageSize, this.conversations.length);
            
            for (let j = nextPageStart; j < nextPageEnd; j++) {
                const conv = this.conversations[j];
                if (conv && !this.cache.has(conv.id)) {
                    this.preloadConversationDetail(conv.id);
                }
            }
        }
    }
    
    /**
     * 格式化时间
     */
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        if (diff < 60000) {
            return '刚刚';
        } else if (diff < 3600000) {
            return `${Math.floor(diff / 60000)}分钟前`;
        } else if (diff < 86400000) {
            return `${Math.floor(diff / 3600000)}小时前`;
        } else if (diff < 604800000) {
            return `${Math.floor(diff / 86400000)}天前`;
        } else {
            return date.toLocaleDateString('zh-CN');
        }
    }
    
    /**
     * HTML转义
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * 显示加载状态
     */
    showLoading() {
        const loader = document.getElementById('history-loading');
        if (loader) loader.style.display = 'block';
    }
    
    /**
     * 隐藏加载状态
     */
    hideLoading() {
        const loader = document.getElementById('history-loading');
        if (loader) loader.style.display = 'none';
    }
    
    /**
     * 显示错误信息
     */
    showError(message) {
        console.error(message);
        // 可以添加UI提示
    }
    
    /**
     * 显示成功信息
     */
    showSuccess(message) {
        console.log(message);
        // 可以添加UI提示
    }
    
    /**
     * 关闭历史面板
     */
    closeHistoryPanel() {
        const panel = document.getElementById('history-panel');
        if (panel && panel.classList.contains('modal')) {
            panel.classList.remove('show');
        }
    }
    
    /**
     * 防抖函数
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
    
    /**
     * 节流函数
     */
    throttle(func, limit) {
        let inThrottle;
        return function(...args) {
            if (!inThrottle) {
                func.apply(this, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
}

// 导出到全局
window.HistoryManager = HistoryManager;
// 存储实例引用以供HTML直接调用
window.HistoryManager.instance = null;