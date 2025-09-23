/**
 * 数据分析平台主应用
 */

class DataAnalysisPlatform {
    constructor() {
        // 启动时不自动恢复会话，始终开始新对话
        this.currentConversationId = null;
        // 清除旧的会话ID
        localStorage.removeItem('currentConversationId');
        // 先尝试从设置中加载视图模式，如果没有则默认为'user'
        this.currentViewMode = this.getStoredViewMode() || 'user';
        this.isProcessing = false;
        this.config = {};
        this.abortController = null;  // 用于中断请求
        this.activeEventSource = null;  // 当前SSE连接
        this.contextRounds = 3;  // 默认保留3轮历史
        this.historyManager = null;  // 历史记录管理器
        this.tipsManager = null;  // Tips提示管理器
        this._devViewEnabledCache = null; // 缓存开发者视图开关
        
        this.init();
    }
    
    /**
     * 获取存储的视图模式
     */
    getStoredViewMode() {
        // 首先尝试从基础设置中获取默认视图模式
        const basicSettings = JSON.parse(localStorage.getItem('basic_settings') || '{}');
        if (basicSettings.default_view_mode) {
            // 使用基础设置中的默认视图模式
            return basicSettings.default_view_mode;
        }
        
        // 其次尝试从view_mode中获取（这个已弃用，但保留兼容性）
        const savedMode = localStorage.getItem('view_mode');
        if (savedMode) {
            // 使用旧的视图模式设置
            return savedMode;
        }
        
        // 默认返回用户视图
        return 'user';
    }

    /**
     * 初始化应用
     */
    async init() {
        // 延迟初始化，确保DOM完全加载
        if (document.readyState !== 'complete') {
            await new Promise(resolve => {
                window.addEventListener('load', resolve);
            });
        }
        
        // 使用Promise.allSettled避免单个失败影响整体
        const initTasks = await Promise.allSettled([
            this.loadConfig(),
            this.loadModels(),
            this.loadSettings()
        ]);
        
        // 记录初始化失败的任务（仅用于调试）
        initTasks.forEach((result, index) => {
            if (result.status === 'rejected') {
                const taskNames = [window.i18nManager?.t('config.configuration') || '配置', window.i18nManager?.t('config.model') || '模型', window.i18nManager?.t('config.settings') || '设置'];
                console.warn(`${taskNames[index]}加载失败，使用默认值:`, result.reason?.message);
            }
        });
        
        // 从 localStorage 加载基础设置（包括 context_rounds）
        try {
            const basicSettings = JSON.parse(localStorage.getItem('basic_settings') || '{}');
            
            // 如果后端配置中没有 context_rounds，使用 localStorage 中的值
            if (this.config && this.config.context_rounds === undefined && basicSettings.context_rounds !== undefined) {
                this.contextRounds = basicSettings.context_rounds;
                console.log('从 localStorage 加载 context_rounds:', this.contextRounds);
            }
            
            // 更新默认视图模式
            if (basicSettings.default_view_mode) {
                this.currentViewMode = basicSettings.default_view_mode;
            }
        } catch (error) {
            console.warn('加载基础设置失败:', error);
        }
        
        // 设置事件监听器（不依赖后端）
        this.setupEventListeners();
        
        // 异步检查连接（不阻塞初始化）
        setTimeout(() => this.checkConnection(), 500);
        
        // 加载视图模式
        this.loadViewMode();
        
        // 初始化历史记录管理器
        if (window.HistoryManager) {
            this.historyManager = new HistoryManager();
            // 保存实例引用以供HTML中直接调用
            window.HistoryManager.instance = this.historyManager;
            this.setupHistoryEventListeners();
        }
        
        // 初始化Tips提示系统
        this.initTipsManager();
        
        // 启动时始终显示欢迎消息，不自动恢复历史对话
        this.showWelcomeMessage();
    }

    /**
     * 是否启用开发者视图（默认禁用）
     * 优先读取后端配置 features.developer_view.enabled，其次读取本地存储开关
     */
    isDeveloperViewEnabled() {
        try {
            if (this._devViewEnabledCache !== null) return this._devViewEnabledCache;
            const featureFlag = this.config?.features?.developer_view?.enabled;
            if (typeof featureFlag === 'boolean') {
                this._devViewEnabledCache = featureFlag;
                return featureFlag;
            }
            const stored = localStorage.getItem('enable_developer_view');
            if (stored === 'true') {
                this._devViewEnabledCache = true;
                return true;
            }
            if (stored === 'false') {
                this._devViewEnabledCache = false;
                return false;
            }
            // 默认启用开发者视图（用户可随时切换）
            this._devViewEnabledCache = true;
            return true;
        } catch (_) {
            return true;
        }
    }

    /**
     * 设置事件监听器
     */
    setupEventListeners() {
        // 侧边栏控制逻辑
        this.setupSidebarControls();
        
        // 菜单展开/收起
        document.querySelectorAll('.menu-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.preventDefault();
                const menuItem = header.parentElement;
                const submenu = menuItem.querySelector('.submenu');
                
                // 检查是否有data-tab属性（用于直接导航的菜单项，如"关于"）
                const tabName = header.dataset.tab;
                if (tabName && !submenu) {
                    // 直接切换到对应标签页
                    if (window.app && window.app.switchTab) {
                        window.app.switchTab(tabName);
                    }
                    return;
                }
                
                if (submenu) {
                    const isExpanded = menuItem.classList.contains('expanded');
                    
                    // 收起其他菜单
                    document.querySelectorAll('.menu-item.expanded').forEach(item => {
                        if (item !== menuItem) {
                            item.classList.remove('expanded');
                            const otherSubmenu = item.querySelector('.submenu');
                            if (otherSubmenu) {
                                otherSubmenu.style.display = 'none';
                            }
                        }
                    });
                    
                    // 切换当前菜单
                    if (isExpanded) {
                        menuItem.classList.remove('expanded');
                        submenu.style.display = 'none';
                    } else {
                        menuItem.classList.add('expanded');
                        submenu.style.display = 'block';
                    }
                }
            });
        });

        // 标签页切换
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const tabName = link.dataset.tab;
                const settingsTab = link.dataset.settingsTab;
                
                if (window.app && window.app.switchTab) {
                    window.app.switchTab(tabName, settingsTab);
                }
                
                // 如果是设置页面，切换到对应的设置标签
                if (tabName === 'settings' && settingsTab && window.settingsManager) {
                    setTimeout(() => {
                        window.settingsManager.switchSettingsTab(settingsTab);
                    }, 100);
                }
            });
        });

        // 发送消息
        const sendButton = document.getElementById('send-button');
        const stopButton = document.getElementById('stop-button');
        const messageInput = document.getElementById('message-input');
        
        // 检查元素是否存在
        if (!sendButton || !stopButton) {
            console.error('按钮元素未找到:', { sendButton: !!sendButton, stopButton: !!stopButton });
        }
        
        if (sendButton) {
            sendButton.addEventListener('click', () => this.sendMessage());
        }
        
        // 停止按钮事件
        if (stopButton) {
            console.log('绑定停止按钮事件');
            // 移除旧的事件监听器
            stopButton.replaceWith(stopButton.cloneNode(true));
            const newStopButton = document.getElementById('stop-button');
            newStopButton.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('停止按钮被点击, 当前状态:', {
                    isProcessing: this.isProcessing,
                    conversationId: this.currentConversationId,
                    display: newStopButton.style.display
                });
                if (this.isProcessing) {
                    this.stopQuery();
                } else {
                    console.warn('当前没有正在执行的查询');
                }
            });
        }
        
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // 示例按钮
        document.querySelectorAll('.example-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const example = btn.dataset.example;
                document.getElementById('message-input').value = example;
                this.sendMessage();
            });
        });

        // 新对话按钮
        document.getElementById('new-conversation').addEventListener('click', () => {
            this.createNewConversation();
        });

        // 模型选择
        document.getElementById('current-model').addEventListener('change', async (e) => {
            this.config.current_model = e.target.value;
            
            // 查找选中模型的配置
            if (window.settingsManager && window.settingsManager.models) {
                const selectedModel = window.settingsManager.models.find(m => m.id === e.target.value);
                if (selectedModel) {
                    const apiBase = selectedModel.api_base || selectedModel.base_url || '';
                    const apiKey = selectedModel.api_key === 'not-needed' ? '' : (selectedModel.api_key || '');
                    if (apiBase) {
                        // 更新API配置到.env
                        await api.saveConfig({
                            api_key: apiKey,
                            api_base: apiBase,
                            default_model: selectedModel.id
                        });
                    }
                }
            }
            
            this.saveConfig();
        });

        // 设置页面事件
        this.setupSettingsEvents();

        // 新手引导按钮（只绑定一次，且避免与引导过程互相干扰）
        const onboardingBtn = document.getElementById('help-onboarding-btn');
        if (onboardingBtn) {
            onboardingBtn.addEventListener('click', (e) => {
                e.preventDefault();
                try {
                    // 如果引导已在进行（有遮罩），则不重复启动
                    if (document.querySelector('.onboarding-overlay')) return;
                    if (window.OnboardingGuide && typeof window.OnboardingGuide.start === 'function') {
                        window.OnboardingGuide.start();
                    }
                } catch (err) {
                    console.warn('启动新手引导失败:', err);
                }
            }, { passive: true });
        }

    }

    /**
     * 设置设置页面事件
     */
    setupSettingsEvents() {
        // 语言切换事件 - 设置页面的下拉框
        const languageSelect = document.getElementById('language-select');
        if (languageSelect) {
            // 设置当前语言
            languageSelect.value = window.i18nManager.getCurrentLanguage();
            
            // 监听语言切换
            languageSelect.addEventListener('change', (e) => {
                const newLang = e.target.value;
                this.changeLanguage(newLang);
            });
        }
        
        // 测试API连接
        document.getElementById('test-api')?.addEventListener('click', async () => {
            const config = {
                model: document.getElementById('default-model').value,
                api_key: document.getElementById('api-key').value,
                api_base: document.getElementById('api-base').value
            };
            
            this.showNotification(window.i18nManager.t('common.testingConnection'), 'info');
            
            try {
                const result = await api.testModel(config);
                if (result.success) {
                    this.showNotification(window.i18nManager?.t('notifications.apiConnected') || 'API连接成功！', 'success');
                } else {
                    this.showNotification(`连接失败: ${result.message}`, 'error');
                }
            } catch (error) {
                this.showNotification(`连接失败: ${error.message}`, 'error');
            }
        });

        // 保存模型配置
        document.getElementById('save-model-config')?.addEventListener('click', async () => {
            const config = {
                model: document.getElementById('default-model').value,
                api_key: document.getElementById('api-key').value,
                api_base: document.getElementById('api-base').value
            };
            
            try {
                await api.saveConfig(config);
                this.showNotification(window.i18nManager?.t('notifications.modelSaved') || '模型配置已保存', 'success');
                this.config = { ...this.config, ...config };
            } catch (error) {
                this.showNotification(window.i18nManager?.t('notifications.saveFailed') || '保存失败', 'error');
            }
        });

        // 测试数据库连接
        document.getElementById('test-db')?.addEventListener('click', async () => {
            const config = {
                host: document.getElementById('db-host').value,
                port: document.getElementById('db-port').value,
                user: document.getElementById('db-user').value,
                password: document.getElementById('db-password').value,
                database: document.getElementById('db-name').value
            };
            
            this.showNotification(window.i18nManager.t('common.testingDatabase'), 'info');
            
            try {
                const result = await api.testDatabase(config);
                if (result.success) {
                    this.showNotification(window.i18nManager?.t('notifications.dbConnected') || '数据库连接成功！', 'success');
                } else {
                    this.showNotification(`连接失败: ${result.message}`, 'error');
                }
            } catch (error) {
                this.showNotification(`连接失败: ${error.message}`, 'error');
            }
        });

        // 保存数据库配置
        document.getElementById('save-db-config')?.addEventListener('click', async () => {
            const config = {
                host: document.getElementById('db-host').value,
                port: document.getElementById('db-port').value,
                user: document.getElementById('db-user').value,
                password: document.getElementById('db-password').value,
                database: document.getElementById('db-name').value
            };
            
            try {
                await api.saveDatabaseConfig(config);
                this.showNotification(window.i18nManager?.t('notifications.dbConfigSaved') || '数据库配置已保存', 'success');
            } catch (error) {
                this.showNotification(window.i18nManager?.t('notifications.saveFailed') || '保存失败', 'error');
            }
        });


        // 保存界面设置
        document.getElementById('save-ui-config')?.addEventListener('click', () => {
            const config = {
                default_view_mode: document.getElementById('default-view-mode').value
            };
            
            localStorage.setItem('ui_config', JSON.stringify(config));
            this.showNotification(window.i18nManager?.t('notifications.uiSettingsSaved') || '界面设置已保存', 'success');
        });
    }

    /**
     * 切换标签页
     */
    switchTab(tabName, settingsTab = null) {
        // 更新导航
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        
        // 找到并激活对应的导航链接
        // 如果是设置页面且指定了子标签，则激活对应的子标签链接
        let activeLink;
        if (tabName === 'settings' && settingsTab) {
            activeLink = document.querySelector(`[data-tab="${tabName}"][data-settings-tab="${settingsTab}"]`);
        } else {
            activeLink = document.querySelector(`[data-tab="${tabName}"]:not([data-settings-tab])`);
        }
        
        if (activeLink) {
            activeLink.classList.add('active');
        }
        
        // 如果切换到历史记录页面，按需加载历史记录
        if (tabName === 'history' && this.historyManager) {
            // 如果有标记需要刷新，强制刷新
            const forceReload = this.historyManager.needsRefresh;
            if (forceReload) {
                this.historyManager.needsRefresh = false;
            }
            // 延迟加载，避免切换动画时的卡顿
            setTimeout(() => {
                this.historyManager.loadRecentConversationsIfNeeded(forceReload);
            }, 200);
        }

        // 更新内容
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        
        const targetTab = document.getElementById(`${tabName}-tab`);
        if (targetTab) {
            targetTab.classList.add('active');
        }

        // 特定标签页的初始化
        if (tabName === 'settings') {
            this.loadSettings();
            // 如果设置管理器存在，加载设置
            if (window.settingsManager) {
                window.settingsManager.loadSettings();
                // 如果指定了子标签，切换到对应的子标签
                if (settingsTab) {
                    setTimeout(() => {
                        window.settingsManager.switchSettingsTab(settingsTab);
                    }, 100);
                }
            }
        } else if (tabName === 'history') {
            // 切换到历史记录页面时，确保已初始化
            if (window.HistoryManager && window.HistoryManager.instance) {
                const manager = window.HistoryManager.instance;
                
                // 确保已初始化
                manager.ensureInitialized().then(() => {
                    // 如果标记了需要刷新
                    if (manager.needsRefresh) {
                        console.log('历史记录需要刷新');
                        manager.needsRefresh = false;
                        manager.loadRecentConversations(0, true);  // 静默刷新
                    }
                });
            }
        }
    }

    /**
     * 发送消息
     */
    async sendMessage() {
        if (this.isProcessing) {
            this.showNotification(window.i18nManager.t('common.processingRequest'), 'info');
            return;
        }

        const messageInput = document.getElementById('message-input');
        const message = messageInput.value.trim();
        
        if (!message) {
            const i18n = window.i18nManager || { t: (key) => key };
            this.showNotification(i18n.t('errors.enterQuery'), 'error');
            return;
        }

        this.isProcessing = true;
        messageInput.disabled = true;
        document.getElementById('send-button').disabled = true;
        
        // 显示停止按钮，隐藏发送按钮
        const sendBtn = document.getElementById('send-button');
        const stopBtn = document.getElementById('stop-button');
        if (sendBtn) {
            sendBtn.style.display = 'none';
            sendBtn.style.visibility = 'hidden';
        }
        if (stopBtn) {
            stopBtn.style.display = 'flex';
            stopBtn.style.visibility = 'visible';
            stopBtn.style.opacity = '1';
            stopBtn.removeAttribute('hidden');
            console.log('停止按钮已显示', stopBtn.style.display, stopBtn.style.visibility);
        }

        // 添加用户消息到界面
        this.addMessage('user', message);
        messageInput.value = '';

        // 显示思考过程
        const thinkingId = this.showThinkingProcess();

        let usedSSE = false;
        try {
            if (window.EventSource) {
                try {
                    if (this.activeEventSource) {
                        this.activeEventSource.close();
                        this.activeEventSource = null;
                    }
                    const eventSource = api.sendMessageSSE(
                        message,
                        this.currentConversationId,
                        this.currentViewMode,
                        (evt) => {
                            if (evt.type === 'progress_plan') {
                                const labels = evt.data?.labels || [];
                                this.renderProgressPlan(thinkingId, labels);
                            } else if (evt.type === 'progress') {
                                const tip = evt.data?.message || window.i18nManager?.t('common.processing') || '处理中...';
                                this.updateProgressStage(thinkingId, tip);
                            } else if (evt.type === 'result') {
                                const payload = evt.data;
                                if (payload?.conversation_id) {
                                    this.currentConversationId = payload.conversation_id;
                                    localStorage.setItem('currentConversationId', payload.conversation_id);
                                }
                                if (window.HistoryManager && window.HistoryManager.instance) {
                                    const manager = window.HistoryManager.instance;
                                    if (typeof manager.markNeedsRefresh === 'function') {
                                        manager.markNeedsRefresh();
                                    } else {
                                        manager.needsRefresh = true;
                                    }
                                }
                                if (payload.success) {
                                    this.handleStreamResponse({ type: 'result', content: payload.result, conversationId: this.currentConversationId }, thinkingId);
                                } else {
                                    this.handleStreamResponse({ type: 'error', message: payload.result || '执行失败' }, thinkingId);
                                }
                            } else if (evt.type === 'error') {
                                this.handleStreamResponse({ type: 'error', message: evt.data?.error || '执行失败' }, thinkingId);
                                if (this.activeEventSource) {
                                    this.activeEventSource.close();
                                    this.activeEventSource = null;
                                }
                                this.finishProcessing();
                            } else if (evt.type === 'done') {
                                if (this.activeEventSource) {
                                    this.activeEventSource.close();
                                    this.activeEventSource = null;
                                }
                                this.finishProcessing();
                            }
                        }
                    );
                    this.activeEventSource = eventSource;
                    usedSSE = true;
                } catch (e) {
                    console.warn('SSE 初始化失败，回退至普通请求:', e);
                    if (this.activeEventSource) {
                        try { this.activeEventSource.close(); } catch (_) {}
                        this.activeEventSource = null;
                    }
                    usedSSE = false;
                }
            }

            if (!usedSSE) {
                // 回退到原有的非SSE方式
                this.abortController = new AbortController();
                const currentModelElement = document.getElementById('current-model');
                const selectedModel = currentModelElement?.value || this.config?.default_model || 'gpt-5-high';
                const response = await api.sendMessageStream(
                    message,
                    this.currentConversationId,
                    this.currentViewMode,
                    (data) => {
                        if (data.conversationId) {
                            this.currentConversationId = data.conversationId;
                            localStorage.setItem('currentConversationId', data.conversationId);
                            if (window.HistoryManager && window.HistoryManager.instance) {
                                window.HistoryManager.instance.needsRefresh = true;
                            }
                        }
                        this.handleStreamResponse(data, thinkingId);
                    },
                    selectedModel,
                    this.abortController?.signal
                );
                if (response && response.conversation_id) {
                    this.currentConversationId = response.conversation_id;
                    localStorage.setItem('currentConversationId', response.conversation_id);
                    if (window.HistoryManager && window.HistoryManager.instance) {
                        window.HistoryManager.instance.needsRefresh = true;
                    }
                }
            }
        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('查询已取消');
                this.showNotification(window.i18nManager.t('common.stopped'), 'info');
                this.hideThinkingProcess(thinkingId);
            } else {
                console.error('发送消息失败:', error);
                this.showNotification(window.i18nManager?.t('notifications.sendFailed') || '发送失败，请重试', 'error');
                this.hideThinkingProcess(thinkingId);
                this.addMessage('bot', window.i18nManager?.t('notifications.requestFailed') || '处理请求失败。检查网络连接或稍后重试。');
            }
            usedSSE = false;
        } finally {
            if (!usedSSE) {
                this.finishProcessing();
            }
        }
    }

    finishProcessing() {
        const messageInput = document.getElementById('message-input');
        if (messageInput) {
            messageInput.disabled = false;
            messageInput.focus();
        }
        const sendBtn = document.getElementById('send-button');
        if (sendBtn) {
            sendBtn.disabled = false;
            sendBtn.style.display = 'flex';
            sendBtn.style.visibility = 'visible';
            sendBtn.style.opacity = '1';
        }
        const stopBtn = document.getElementById('stop-button');
        if (stopBtn) {
            stopBtn.style.display = 'none';
            stopBtn.style.visibility = 'hidden';
            stopBtn.style.opacity = '0';
        }
        this.isProcessing = false;
        this.abortController = null;
    }

    /**
     * 停止查询
     */
    async stopQuery() {
        console.log('开始停止查询, conversationId:', this.currentConversationId);
        this.showNotification(window.i18nManager.t('common.stopping') || '正在停止...', 'info');
        
        // 发送停止请求到后端
        if (this.currentConversationId) {
            try {
                const response = await fetch('/api/stop_query', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        conversation_id: this.currentConversationId
                    })
                });
                
                const data = await response.json();
                console.log('停止请求响应:', data);
                if (data.success) {
                    console.log('停止请求成功');
                    this.showNotification('查询已停止', 'success');
                } else {
                    console.warn('停止请求失败:', data.error);
                }
            } catch (error) {
                console.error('发送停止请求失败:', error);
            }
        }
        
        // 前端也中断请求
        if (this.activeEventSource) {
            try {
                this.activeEventSource.close();
            } catch (err) {
                console.debug('关闭EventSource失败:', err);
            }
            this.activeEventSource = null;
        }
        if (this.abortController) {
            this.abortController.abort();
        }
        
        // 立即隐藏所有思考动画
        document.querySelectorAll('.thinking-message').forEach(el => {
            el.style.transition = 'none';
            el.remove();
        });
        
        // 停止所有动画
        document.querySelectorAll('.thinking-stage').forEach(el => {
            el.classList.remove('active');
        });
        
        // 添加中断消息，保留已生成的部分内容
        const lastBotMessage = Array.from(document.querySelectorAll('.message.bot')).pop();
        const interruptedText = window.i18nManager.t('common.interrupted');
        if (!lastBotMessage || !lastBotMessage.textContent.includes(interruptedText)) {
            this.addMessage('bot', window.i18nManager.t('common.interruptedMessage'));
        }

        this.finishProcessing();
    }
    
    /**
     * 从历史记录恢复会话（用户主动选择时）
     */
    async restoreConversationFromHistory(conversationId) {
        if (conversationId) {
            this.currentConversationId = conversationId;
            localStorage.setItem('currentConversationId', conversationId);
            await this.restoreConversation();
        }
    }
    
    /**
     * 恢复会话
     */
    async restoreConversation() {
        try {
            const response = await fetch(`/api/history/conversation/${this.currentConversationId}`);
            const data = await response.json();
            
            if (data.success && data.conversation) {
                // 恢复对话历史
                this.loadHistoryConversation(data.conversation);
            } else {
                // 如果会话不存在，清除并显示欢迎消息
                this.currentConversationId = null;
                localStorage.removeItem('currentConversationId');
                this.showWelcomeMessage();
            }
        } catch (error) {
            console.error('恢复会话失败:', error);
            this.currentConversationId = null;
            localStorage.removeItem('currentConversationId');
            this.showWelcomeMessage();
        }
    }
    
    /**
     * 创建新对话
     */
    createNewConversation() {
        // 清除当前会话ID，下次查询时会自动创建新会话
        this.currentConversationId = null;
        localStorage.removeItem('currentConversationId');
        
        // 清空聊天界面
        const chatMessages = document.getElementById('chat-messages');
        if (chatMessages) {
            chatMessages.innerHTML = '';
        }
        
        // 标记历史记录需要刷新
        if (this.historyManager) {
            this.historyManager.markNeedsRefresh();
        }
        
        // 显示欢迎消息
        this.showWelcomeMessage();
        
        // 如果有历史管理器，刷新历史列表
        if (window.HistoryManager && window.HistoryManager.instance) {
            window.HistoryManager.instance.loadRecentConversations();
        }
        
        const i18n = window.i18nManager || { t: (key) => key };
        this.showNotification(i18n.t('errors.newConversationStarted'), 'success');
    }
    
    /**
     * 处理流式响应
     */
    handleStreamResponse(data, thinkingId) {
        if (data.type === 'thinking') {
            this.updateThinkingProcess(thinkingId, data.content);
        } else if (data.type === 'result') {
            // 将思考对话框转换为结果对话框，而不是删除它
            this.transformThinkingToResult(thinkingId, data);
        } else if (data.type === 'interrupted') {
            // 查询被中断，立即隐藏思考动画
            this.hideThinkingProcess(thinkingId);
            // 如果有部分结果，显示它们
            if (data.partial_result) {
                this.processAssistantResponse(data.partial_result, data.model);
            }
            // stopQuery会添加中断消息
        } else if (data.type === 'error') {
            this.hideThinkingProcess(thinkingId);
            this.addMessage('bot', `错误: ${data.message}`);
        } else if (data.type === 'status') {
            this.updateExecutionStatus(data.status);
        }
    }

    /**
     * 添加消息到聊天界面
     */
    addMessage(type, content, options = {}) {
        const messagesContainer = document.getElementById('chat-messages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message`;
        
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = type === 'user' ? 
            '<i class="fas fa-user"></i>' : 
            '<i class="fas fa-robot"></i>';
        
        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';
        
        if (typeof content === 'string') {
            contentDiv.innerHTML = this.renderMarkdown(content);
        } else {
            contentDiv.appendChild(content);
        }
        
        messageDiv.appendChild(avatar);
        messageDiv.appendChild(contentDiv);
        
        // 移除欢迎消息
        const welcomeMessage = messagesContainer.querySelector('.welcome-message');
        if (welcomeMessage) {
            welcomeMessage.remove();
        }
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
        
        return messageDiv;
    }

    /**
     * 添加机器人响应（支持双视图）
     */
    addBotResponse(data) {
        // 创建双视图容器
        const dualViewContainer = this.createDualViewContainer(data);
        
        // 添加到消息列表
        this.addMessage('bot', dualViewContainer);
    }
    
    /**
     * 创建用户视图总结 - 改进版
     */
    createUserSummary(data) {
        const summaryDiv = document.createElement('div');
        
        // 分析用户视图数据
        
        // 分析执行结果
        let queryData = [];
        let sqlCommands = [];
        let htmlGenerated = false;
        let chartPaths = [];
        let errorMessages = [];
        let finalSummary = null;
        
        // 首先检查是否有直接的总结内容
        if (data.summary) {
            finalSummary = data.summary;
        }
        
        // 如果 data.content 是字符串，直接使用它作为总结
        if (typeof data.content === 'string' && data.content.trim().length > 0) {
            finalSummary = data.content;
            console.log('使用字符串内容作为总结');
        }
        
        // 额外从 artifacts / files 收集可能的HTML图表文件
        const collectArtifactPaths = (arr) => {
            if (!Array.isArray(arr)) return;
            arr.forEach(x => {
                if (typeof x === 'string' && /\.html?$/i.test(x)) {
                    const fname = x.split(/[\\/]/).pop();
                    if (fname) chartPaths.push(fname);
                }
                if (x && typeof x === 'object' && x.path && /\.html?$/i.test(x.path)) {
                    const fname = String(x.path).split(/[\\/]/).pop();
                    if (fname) chartPaths.push(fname);
                }
            });
        };
        if (Array.isArray(data?.artifacts)) collectArtifactPaths(data.artifacts);
        if (Array.isArray(data?.files)) collectArtifactPaths(data.files);

        if (data.content && Array.isArray(data.content)) {
            console.log('data.content 是数组，长度:', data.content.length);
            
            // 反向遍历，找到最后一个有意义的文本总结
            for (let i = data.content.length - 1; i >= 0; i--) {
                const item = data.content[i];
                
                // 调试每个项目
                if (i >= data.content.length - 3) {
                    console.log(`项目[${i}]:`, item.type, item.content?.substring(0, 100));
                }
                
                // 检查所有可能的消息类型
                if ((item.type === 'text' || item.type === 'message' || item.type === 'assistant' || item.type === 'system') && 
                    item.content && item.content.trim().length > 20) {
                    // 优先选择包含"总结"、"关键"、"生成文件"等关键词的内容
                    if (item.content.includes('总结') || 
                        item.content.includes('关键') || 
                        item.content.includes('生成文件') ||
                        item.content.includes('发现') ||
                        item.content.includes('任务') ||
                        item.content.includes('完成')) {
                        finalSummary = item.content;
                        // 找到包含关键词的总结
                        break;
                    }
                    // 如果没有找到带关键词的，保存最后一个有实质内容的文本
                    if (!finalSummary) {
                        finalSummary = item.content;
                        console.log('保存作为候选总结');
                    }
                }
            }
            
            data.content.forEach(item => {
                
                if (item.type === 'code' && item.content) {
                    // 提取SQL命令
                    const sqlMatches = item.content.match(/(?:SELECT|SHOW|DESCRIBE|DESC)[^;]*/gi);
                    if (sqlMatches) {
                        sqlCommands.push(...sqlMatches);
                    }
                }
                if (item.type === 'console' && item.content) {
                    // 检查数据查询结果
                    if (item.content.includes('行') || item.content.includes('rows') || 
                        item.content.includes('数据') || item.content.includes('结果')) {
                        queryData.push(item.content.substring(0, 200));
                    }
                    // 检查HTML生成 - 改进路径匹配，支持 WSL 和多种格式
                    const patterns = [
                        // WSL 路径格式: /mnt/c/Users/.../output/xxx.html
                        /\/mnt\/[a-z]\/.*?\/([^\s\/\\]+\.html)/gi,
                        // Windows 路径格式: C:\Users\...\output\xxx.html
                        /[a-zA-Z]:\\.*?\\([^\s\/\\]+\.html)/gi,
                        // Unix 路径格式: /path/to/output/xxx.html
                        /(?:output\/|\/output\/|\.\/output\/)?([^\s\/\\]+\.html)/gi,
                        // 带中文关键词的格式
                        /保存[为到][：:\s]*(?:.*[\/\\])?([^\s\/\\]+\.html)/gi,
                        /生成了?[：:\s]*(?:.*[\/\\])?([^\s\/\\]+\.html)/gi,
                        /文件[：:\s]*(?:.*[\/\\])?([^\s\/\\]+\.html)/gi,
                        // 简单文件名格式
                        /([\w\u4e00-\u9fa5_\-]+\.html)/g
                    ];
                    
                    let foundPaths = new Set();
                    for (const pattern of patterns) {
                        const matches = item.content.matchAll(pattern);
                        for (const match of matches) {
                            // 提取纯文件名（移除所有路径部分）
                            let filename = match[1] || match[0];
                            // 处理 Windows 和 Unix 路径分隔符
                            filename = filename.split(/[\/\\]/).pop();
                            if (filename && filename.endsWith('.html') && !filename.includes(' ')) {
                                foundPaths.add(filename);
                                console.log('检测到HTML文件:', filename);
                            }
                        }
                    }
                    
                    if (foundPaths.size > 0) {
                        htmlGenerated = true;
                        chartPaths.push(...Array.from(foundPaths));
                    }
                }
                if (item.type === 'error') {
                    errorMessages.push(item.content);
                }
            });
        }
        
        // 构建总结
        let summaryHtml = '';
        
        // 如果有 OpenInterpreter 的总结，优先显示
        if (finalSummary) {
            summaryHtml = `
                <div class="user-summary-content">
                    <div class="summary-header">
                        <i class="fas fa-check-circle"></i> ${window.i18nManager.t('chat.analysisComplete')}
                    </div>
                    
                    <div class="ai-summary">
                        ${this.renderMarkdown(finalSummary)}
                    </div>
                    
                    ${chartPaths.length > 0 ? `
                        <div class="chart-section">
                            <h4><i class="fas fa-chart-bar"></i> 生成的图表：</h4>
                            ${this.currentViewMode === 'user' ? 
                                // 用户视图：同时显示iframe嵌入和下载链接
                                chartPaths.map(path => {
                                    const filename = path.split('/').pop();
                                    const iframeId = 'chart-iframe-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                                    return `
                                    <div class="chart-embed-container">
                                        <div class="chart-embed-header">
                                            <span class="chart-filename">📊 ${filename}</span>
                                            <div class="chart-actions">
                                                <button class="btn-fullscreen" onclick="app.toggleFullscreen('${iframeId}')" title="全屏">
                                                    <i class="fas fa-expand"></i>
                                                </button>
                                                <button class="btn-new-tab" onclick="app.openChart('${filename}')" title="新标签页打开">
                                                    <i class="fas fa-external-link-alt"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <div class="chart-embed-loading" id="loading-${iframeId}">
                                            <i class="fas fa-spinner fa-spin"></i> 加载图表中...
                                        </div>
                                        <iframe 
                                            id="${iframeId}"
                                            src="/output/${filename}" 
                                            class="chart-iframe"
                                            frameborder="0"
                                            width="100%"
                                            height="600"
                                            onload="document.getElementById('loading-${iframeId}').style.display='none';"
                                            onerror="document.getElementById('loading-${iframeId}').innerHTML='<i class=\"fas fa-exclamation-triangle\"></i> 图表加载失败';">
                                        </iframe>
                                        <div class="chart-download-link" style="margin-top: 10px; padding: 10px; background: #f5f5f5; border-radius: 4px;">
                                            <i class="fas fa-download"></i> 
                                            <a href="/output/${filename}" download="${filename}" class="html-file-link">
                                                📊 下载图表: ${filename}
                                            </a>
                                            <span style="margin-left: 10px;">|</span>
                                            <a href="/output/${filename}" target="_blank" class="html-file-link" style="margin-left: 10px;">
                                                <i class="fas fa-external-link-alt"></i> 在新标签页打开
                                            </a>
                                        </div>
                                    </div>
                                `;
                                }).join('') :
                                // 开发者视图：显示链接
                                `<div class="chart-links">
                                    ${chartPaths.map(path => {
                                        const filename = path.split('/').pop();
                                        return `
                                        <div class="chart-link">
                                            <i class="fas fa-chart-bar"></i> 
                                            <a href="/output/${filename}" target="_blank" class="html-file-link" 
                                               onclick="window.app.openHtmlFile('${filename}'); return false;">
                                                📊 点击查看: ${filename}
                                            </a>
                                        </div>
                                    `;
                                    }).join('')}
                                </div>`
                            }
                        </div>
                    ` : ''}
                </div>
            `;
        } else {
            // 如果没有找到总结，尝试显示原始内容
            let contentText = '';
            
            // 收集所有文本内容
            if (data.content && Array.isArray(data.content)) {
                const textContents = [];
                data.content.forEach(item => {
                    if (item.type === 'text' || item.type === 'message' || item.type === 'assistant') {
                        if (item.content && item.content.trim()) {
                            textContents.push(item.content);
                        }
                    }
                });
                
                if (textContents.length > 0) {
                    contentText = textContents.join('\n\n');
                }
            }
            
            // 如果还是没有内容，使用原始数据
            if (!contentText && data.content) {
                if (typeof data.content === 'string') {
                    contentText = data.content;
                } else if (typeof data.content === 'object') {
                    contentText = JSON.stringify(data.content, null, 2);
                }
            }
            
            // 如果有任何内容，显示它
            if (contentText) {
                summaryHtml = `
                    <div class="user-summary-content">
                        <div class="ai-summary">
                            ${this.renderMarkdown(contentText)}
                        </div>
                        
                        ${chartPaths.length > 0 ? `
                            <div class="chart-section">
                                <h4><i class="fas fa-chart-bar"></i> 生成的图表：</h4>
                                ${chartPaths.map(path => {
                                    const filename = path.split('/').pop();
                                    const iframeId = 'chart-iframe-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
                                    return `
                                    <div class="chart-embed-container">
                                        <div class="chart-embed-header">
                                            <span class="chart-filename">📊 ${filename}</span>
                                            <div class="chart-actions">
                                                <button class="btn-fullscreen" onclick="app.toggleFullscreen('${iframeId}')" title="全屏">
                                                    <i class="fas fa-expand"></i>
                                                </button>
                                                <button class="btn-new-tab" onclick="app.openChart('${filename}')" title="新标签页打开">
                                                    <i class="fas fa-external-link-alt"></i>
                                                </button>
                                            </div>
                                        </div>
                                        <iframe 
                                            id="${iframeId}"
                                            src="/output/${filename}" 
                                            class="chart-iframe"
                                            frameborder="0"
                                            width="100%"
                                            height="600"
                                            loading="lazy">
                                        </iframe>
                                    </div>
                                    `;
                                }).join('')}
                            </div>
                        ` : ''}
                    </div>
                `;
            } else {
                // 真的没有任何内容时的后备显示
                summaryHtml = `
                    <div class="user-summary-content">
                        <div class="ai-summary">
                            <p>查询已执行，但未返回可显示的内容。</p>
                        </div>
                    </div>
                `;
            }
        }
        
        // 在总结末尾添加优化提示
        // 根据查询结果动态选择提示内容
        let tipMessage = '不满意？尝试补充细节重新反馈给AI';
        let tipIcon = 'fa-lightbulb';
        
        // 如果有错误，提供更针对性的建议
        if (errorMessages && errorMessages.length > 0) {
            tipMessage = '遇到错误？尝试简化查询条件或检查表名是否正确';
            tipIcon = 'fa-exclamation-circle';
        } else if (!htmlGenerated) {
            tipMessage = window.i18nManager.t('chat.needChart');
            tipIcon = 'fa-chart-line';
        } else if (sqlCommands.length === 0) {
            tipMessage = '查询不够精准？尝试指定具体的时间范围或数据维度';
            tipIcon = 'fa-search';
        }
        
        summaryHtml += `
            <div class="query-optimization-tip">
                <span>${tipMessage}</span>
            </div>
        `;
        
        summaryDiv.innerHTML = summaryHtml;
        
        // 不再自动打开图表，避免干扰用户
        
        return summaryDiv;
    }
    
    /**
     * 创建开发者视图详情
     */
    createDeveloperDetails(data) {
        const detailsDiv = document.createElement('div');
        
        let detailsHtml = '<div class="developer-details">';
        
        // 查找最终总结（与用户视图共享逻辑）
        let finalSummary = null;
        if (data.content && Array.isArray(data.content)) {
            console.log('data.content 是数组，长度:', data.content.length);
            
            // 反向遍历，找到最后一个有意义的文本总结
            for (let i = data.content.length - 1; i >= 0; i--) {
                const item = data.content[i];
                
                // 调试每个项目
                if (i >= data.content.length - 3) {
                    console.log(`项目[${i}]:`, item.type, item.content?.substring(0, 100));
                }
                
                // 检查所有可能的消息类型
                if ((item.type === 'text' || item.type === 'message' || item.type === 'assistant' || item.type === 'system') && 
                    item.content && item.content.trim().length > 20) {
                    // 优先选择包含"总结"、"关键"、"生成文件"等关键词的内容
                    if (item.content.includes('总结') || 
                        item.content.includes('关键') || 
                        item.content.includes('生成文件') ||
                        item.content.includes('发现') ||
                        item.content.includes('任务') ||
                        item.content.includes('完成')) {
                        finalSummary = item.content;
                        // 找到包含关键词的总结
                        break;
                    }
                    // 如果没有找到带关键词的，保存最后一个有实质内容的文本
                    if (!finalSummary) {
                        finalSummary = item.content;
                        console.log('保存作为候选总结');
                    }
                }
            }
        }
        
        if (data.content && Array.isArray(data.content)) {
            data.content.forEach((item, index) => {
                if (item.type === 'code') {
                    detailsHtml += `
                        <div class="dev-step">
                            <div class="step-header">
                                <span class="step-number">${window.i18nManager.t('common.step')} ${index + 1}</span>
                                <span class="step-type">${window.i18nManager.t('common.codeExecution')}</span>
                            </div>
                            <pre class="code-block"><code>${this.escapeHtml(item.content)}</code></pre>
                        </div>
                    `;
                } else if (item.type === 'console') {
                    detailsHtml += `
                        <div class="dev-step">
                            <div class="step-header">
                                <span class="step-number">${window.i18nManager.t('common.output')}</span>
                                <span class="step-type">${window.i18nManager.t('common.console')}</span>
                            </div>
                            <pre class="console-output">${this.escapeHtml(item.content)}</pre>
                        </div>
                    `;
                } else if (item.type === 'error') {
                    detailsHtml += `
                        <div class="dev-step error">
                            <div class="step-header">
                                <span class="step-number">${window.i18nManager.t('common.error')}</span>
                                <span class="step-type">${window.i18nManager.t('common.exception')}</span>
                            </div>
                            <pre class="error-output">${this.escapeHtml(item.content)}</pre>
                        </div>
                    `;
                } else if (item.type === 'message') {
                    detailsHtml += `
                        <div class="dev-step">
                            <div class="step-header">
                                <span class="step-number">${window.i18nManager.t('common.message')}</span>
                                <span class="step-type">${window.i18nManager.t('common.system')}</span>
                            </div>
                            <div class="message-content">${item.content}</div>
                        </div>
                    `;
                }
            });
        } else if (data.content) {
            // 尝试显示原始内容作为后备方案
            detailsHtml += `<div class="dev-step">
                <div class="step-header">
                    <span class="step-number">原始数据</span>
                </div>
                <pre class="console-output">${this.escapeHtml(JSON.stringify(data.content, null, 2))}</pre>
            </div>`;
        } else {
            detailsHtml += `<p>${window.i18nManager.t('common.noDetailedSteps')}</p>`;
        }
        
        // 在开发者视图末尾添加总结部分
        if (finalSummary) {
            detailsHtml += `
                <div class="dev-step summary">
                    <div class="step-header">
                        <span class="step-number">${window.i18nManager.t('common.summary')}</span>
                        <span class="step-type">${window.i18nManager.t('chat.finalOutput')}</span>
                    </div>
                    <div class="summary-content">
                        ${this.renderMarkdown(finalSummary)}
                    </div>
                </div>
            `;
        }
        
        detailsHtml += '</div>';
        detailsDiv.innerHTML = detailsHtml;
        
        return detailsDiv;
    }

    /**
     * 创建视图控制器
     */
    createViewControls() {
        const controls = document.createElement('div');
        controls.className = 'view-controls';
        
        controls.innerHTML = `
            <div class="view-tabs">
                <button class="view-tab ${this.currentViewMode === 'user' ? 'active' : ''}" 
                        data-view="user">
                    <i class="fas fa-user"></i> ${window.i18nManager.t('chat.userView')}
                </button>
                <button class="view-tab ${this.currentViewMode === 'developer' ? 'active' : ''}" 
                        data-view="developer">
                    <i class="fas fa-code"></i> ${window.i18nManager.t('chat.developerView')}
                </button>
            </div>
            <div class="execution-status success">
                <i class="fas fa-check-circle"></i> ${window.i18nManager.t('chat.executionComplete')}
            </div>
        `;
        
        // 添加切换事件
        controls.querySelectorAll('.view-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                controls.querySelectorAll('.view-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                const container = tab.closest('.dual-view-message');
                container.querySelectorAll('.view-content').forEach(v => v.classList.remove('active'));
                container.querySelector(`.${tab.dataset.view}-view`).classList.add('active');
            });
        });
        
        return controls;
    }

    /**
     * 打开生成的图表
     */
    openChart(path) {
        // 提取文件名（移除所有路径前缀）
        const filename = path.split('/').pop();
        
        // 直接使用/output/路由
        const url = `/output/${filename}`;
        
        // 方案1：尝试使用window.open打开新标签页
        const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
        
        if (newWindow) {
            // 成功打开新窗口
            this.showNotification(`✅ 图表已在新标签页打开: ${filename}`, 'success');
            // 确保新窗口获得焦点（某些浏览器可能会在后台打开）
            newWindow.focus();
        } else {
            // 方案2：如果window.open被拦截，创建一个临时链接并模拟点击
            this.showNotification(`浏览器拦截了弹窗，尝试其他方式打开...`, 'warning');
            
            // 创建一个隐藏的<a>标签
            const link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.style.display = 'none';
            
            // 添加到DOM并触发点击
            document.body.appendChild(link);
            link.click();
            
            // 清理DOM
            setTimeout(() => {
                document.body.removeChild(link);
            }, 100);
            
            // 方案3：如果还是不行，提供手动打开的选项
            setTimeout(() => {
                if (!document.hidden) {  // 检查页面是否仍然可见
                    const userConfirm = confirm(
                        `无法自动打开新标签页。\n\n` +
                        `是否手动打开图表？\n` +
                        `文件: ${filename}`
                    );
                    
                    if (userConfirm) {
                        // 最后的备选：创建一个可点击的通知
                        const notification = document.createElement('div');
                        notification.innerHTML = `
                            <div style="position: fixed; top: 20px; right: 20px; 
                                     background: #1e40af; color: white; 
                                     padding: 15px; border-radius: 8px; 
                                     box-shadow: 0 4px 6px rgba(0,0,0,0.1);
                                     z-index: 10000; cursor: pointer;">
                                <p style="margin: 0 0 10px 0;">点击这里打开图表:</p>
                                <a href="${url}" target="_blank" 
                                   style="color: #60a5fa; text-decoration: underline;">
                                   ${filename}
                                </a>
                            </div>
                        `;
                        document.body.appendChild(notification);
                        
                        // 自动移除通知
                        setTimeout(() => {
                            notification.remove();
                        }, 10000);
                        
                        // 点击后移除
                        notification.addEventListener('click', () => {
                            notification.remove();
                        });
                    }
                }
            }, 500);
        }
    }
    
    /**
     * 切换iframe全屏显示
     */
    toggleFullscreen(iframeId) {
        const iframe = document.getElementById(iframeId);
        if (!iframe) return;
        
        const container = iframe.closest('.chart-embed-container');
        if (!container) return;
        
        if (!document.fullscreenElement) {
            // 进入全屏
            if (container.requestFullscreen) {
                container.requestFullscreen();
            } else if (container.webkitRequestFullscreen) { // Safari
                container.webkitRequestFullscreen();
            } else if (container.msRequestFullscreen) { // IE11
                container.msRequestFullscreen();
            }
            
            // 添加全屏样式类
            container.classList.add('fullscreen-mode');
            
            // 更新按钮图标
            const btn = container.querySelector('.btn-fullscreen i');
            if (btn) {
                btn.classList.remove('fa-expand');
                btn.classList.add('fa-compress');
            }
        } else {
            // 退出全屏
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.webkitExitFullscreen) { // Safari
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) { // IE11
                document.msExitFullscreen();
            }
            
            // 移除全屏样式类
            container.classList.remove('fullscreen-mode');
            
            // 更新按钮图标
            const btn = container.querySelector('.btn-fullscreen i');
            if (btn) {
                btn.classList.remove('fa-compress');
                btn.classList.add('fa-expand');
            }
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
     * 创建用户视图
     */
    createUserView(data) {
        const view = document.createElement('div');
        view.className = 'view-content user-view';
        
        let html = '<div class="result-section">';
        
        if (data.summary) {
            html += `
                <div class="result-title">
                    <i class="fas fa-check-circle"></i> 分析结果
                </div>
                <div class="result-content">
                    ${this.renderMarkdown(data.summary)}
                </div>
            `;
        }
        
        if (data.chart) {
            html += `
                <div class="result-title">
                    <i class="fas fa-chart-bar"></i> 数据可视化
                </div>
                <div class="chart-container" id="chart-${Date.now()}"></div>
            `;
        }
        
        if (data.table) {
            html += `
                <div class="result-title">
                    <i class="fas fa-table"></i> 数据表格
                </div>
                <div class="result-content">
                    ${this.renderTable(data.table)}
                </div>
            `;
        }
        
        html += '</div>';
        view.innerHTML = html;
        
        // 渲染图表
        if (data.chart) {
            setTimeout(() => {
                const chartContainer = view.querySelector('.chart-container');
                if (chartContainer && data.chart) {
                    Plotly.newPlot(chartContainer.id, data.chart.data, data.chart.layout);
                }
            }, 100);
        }
        
        return view;
    }

    /**
     * 创建开发者视图
     */
    createDeveloperView(data) {
        const view = document.createElement('div');
        view.className = 'view-content developer-view';
        
        let html = '<div class="code-section">';
        
        if (data.sql) {
            html += `
                <div class="code-title">
                    <i class="fas fa-database"></i> SQL查询
                </div>
                <div class="sql-display">
                    ${this.highlightSQL(data.sql)}
                    <button class="copy-button" onclick="app.copyToClipboard(\`${data.sql}\`)">
                        <i class="fas fa-copy"></i> 复制
                    </button>
                </div>
            `;
        }
        
        if (data.code) {
            html += `
                <div class="code-title">
                    <i class="fas fa-code"></i> 生成的代码
                </div>
                <div class="code-block">
                    ${this.highlightCode(data.code)}
                </div>
            `;
        }
        
        if (data.logs) {
            html += `
                <div class="code-title">
                    <i class="fas fa-terminal"></i> 执行日志
                </div>
                <div class="code-block">
                    ${data.logs}
                </div>
            `;
        }
        
        html += '</div>';
        view.innerHTML = html;
        
        return view;
    }

    /**
     * 显示思考过程
     */
    showThinkingProcess() {
        const thinkingId = `thinking-${Date.now()}`;
        const thinking = document.createElement('div');
        thinking.id = thinkingId;
        thinking.className = 'thinking-process';
        
        // 获取随机提示或深夜关怀
        const tip = this.getContextualTip();
        
        // 获取随机的Loading文案
        const loadingTexts = [
            window.i18nManager.t('common.analyzingRequirements'),
            window.i18nManager.t('common.dataMining'),
            window.i18nManager.t('common.understandingRequest'), 
            window.i18nManager.t('common.connectingDatabase'),
            window.i18nManager.t('common.generatingQuery'),
            window.i18nManager.t('common.processingData'),
            window.i18nManager.t('common.optimizingQuery'),
            window.i18nManager.t('common.parsingDataStructure')
        ];
        const randomLoadingText = loadingTexts[Math.floor(Math.random() * loadingTexts.length)];
        
        thinking.innerHTML = `
            <div class="thinking-header">
                <i class="fas fa-brain thinking-icon"></i>
                <span class="thinking-title">${window.i18nManager.t('common.thinkingTitle')}</span>
            </div>
            <div class="thinking-stages">
                <div class="thinking-stage active">
                    <div class="stage-icon">
                        <i class="fas fa-spinner fa-spin"></i>
                    </div>
                    <span class="stage-text">${randomLoadingText}</span>
                </div>
            </div>
            ${tip ? `<div class="thinking-tip"><span class="thinking-tip-text">${tip}</span></div>` : ''}
        `;
        
        this.addMessage('bot', thinking);
        return thinkingId;
    }

    // 渲染AI规划的进度标签（不超过10字），创建一组预置的圆圈进度
    renderProgressPlan(thinkingId, labels = []) {
        const thinking = document.getElementById(thinkingId);
        if (!thinking) return;
        const stages = thinking.querySelector('.thinking-stages');
        if (!stages) return;
        stages.innerHTML = '';
        (labels || []).forEach((label, idx) => {
            const el = document.createElement('div');
            el.className = `thinking-stage ${idx === 0 ? 'active' : ''}`;
            el.innerHTML = `
                <div class="stage-icon">${idx === 0 ? '<i class=\"fas fa-spinner fa-spin\"></i>' : '<i class=\"far fa-circle\"></i>'}</div>
                <span class="stage-text">${String(label).slice(0, 10)}</span>
            `;
            stages.appendChild(el);
        });
    }

    // 依据SSE进度推进一个阶段；如果没有预置，则回退到追加模式
    updateProgressStage(thinkingId, tipText) {
        const thinking = document.getElementById(thinkingId);
        if (!thinking) return this.updateThinkingProcess(thinkingId, tipText);
        const stages = thinking.querySelector('.thinking-stages');
        if (!stages) return this.updateThinkingProcess(thinkingId, tipText);
        const active = stages.querySelector('.thinking-stage.active');
        if (active) {
            active.classList.remove('active');
            active.classList.add('completed');
            const icon = active.querySelector('.stage-icon');
            if (icon) icon.innerHTML = '<i class=\"fas fa-check\"></i>';
        }
        const next = stages.querySelector('.thinking-stage:not(.completed):not(.active)');
        if (next) {
            next.classList.add('active');
            const icon = next.querySelector('.stage-icon');
            if (icon) icon.innerHTML = '<i class=\"fas fa-spinner fa-spin\"></i>';
            const text = next.querySelector('.stage-text');
            if (text && tipText) text.textContent = String(tipText).slice(0, 10);
        } else {
            this.updateThinkingProcess(thinkingId, tipText);
        }
    }

    /**
     * 更新思考过程
     */
    updateThinkingProcess(thinkingId, stage) {
        const thinking = document.getElementById(thinkingId);
        if (!thinking) return;
        
        const stages = thinking.querySelector('.thinking-stages');
        const currentActive = stages.querySelector('.active');
        
        if (currentActive) {
            currentActive.classList.remove('active');
            currentActive.classList.add('completed');
            currentActive.querySelector('.stage-icon').innerHTML = '<i class="fas fa-check"></i>';
        }
        
        const newStage = document.createElement('div');
        newStage.className = 'thinking-stage active';
        newStage.innerHTML = `
            <div class="stage-icon">
                <i class="fas fa-spinner fa-spin"></i>
            </div>
            <span class="stage-text">${stage}</span>
        `;
        
        stages.appendChild(newStage);
    }

    /**
     * 隐藏思考过程
     */
    hideThinkingProcess(thinkingId) {
        const thinking = document.getElementById(thinkingId);
        if (thinking) {
            const stages = thinking.querySelector('.thinking-stages');
            const currentActive = stages.querySelector('.active');
            
            if (currentActive) {
                currentActive.classList.remove('active');
                currentActive.classList.add('completed');
                currentActive.querySelector('.stage-icon').innerHTML = '<i class="fas fa-check"></i>';
            }
            
            thinking.querySelector('.thinking-title').textContent = window.i18nManager.t('chat.analysisComplete');
            
            // 渐隐后移除
            setTimeout(() => {
                thinking.style.opacity = '0';
                setTimeout(() => thinking.remove(), 300);
            }, 1000);
        }
    }

    /**
     * 将思考对话框转换为结果对话框
     */
    transformThinkingToResult(thinkingId, data) {
        const thinking = document.getElementById(thinkingId);
        if (!thinking) {
            // 如果找不到思考对话框，创建新的
            this.addBotResponse(data);
            return;
        }

        // 完成所有思考阶段的动画
        const stages = thinking.querySelector('.thinking-stages');
        const allStages = stages.querySelectorAll('.thinking-stage');
        
        // 快速完成所有阶段
        allStages.forEach((stage, index) => {
            setTimeout(() => {
                stage.classList.remove('active');
                stage.classList.add('completed');
                stage.querySelector('.stage-icon').innerHTML = '<i class="fas fa-check"></i>';
            }, index * 100);
        });

        // 更新标题显示"思考完成"
        setTimeout(() => {
            thinking.querySelector('.thinking-title').textContent = `✨ ${window.i18nManager.t('chat.analysisComplete')}`;
            thinking.querySelector('.thinking-icon').className = 'fas fa-check-circle thinking-icon';
            
            // 添加完成动画效果
            thinking.classList.add('thinking-complete');
            
            // 等待动画完成后，替换内容
            setTimeout(() => {
                // 创建结果内容
                const dualViewContainer = this.createDualViewContainer(data);
                
                // 找到消息内容容器
                const messageContent = thinking.closest('.message')?.querySelector('.message-content');
                if (messageContent) {
                    // 淡出思考内容
                    thinking.style.transition = 'opacity 0.3s ease';
                    thinking.style.opacity = '0';
                    
                    setTimeout(() => {
                        // 替换为结果内容
                        messageContent.innerHTML = '';
                        messageContent.appendChild(dualViewContainer);
                        
                        // 淡入结果内容
                        dualViewContainer.style.opacity = '0';
                        setTimeout(() => {
                            dualViewContainer.style.transition = 'opacity 0.3s ease';
                            dualViewContainer.style.opacity = '1';
                        }, 50);
                    }, 300);
                } else {
                    // 后备方案：如果找不到合适的容器，创建新消息
                    this.addBotResponse(data);
                    thinking.remove();
                }
            }, 800); // 等待所有阶段完成动画
        }, allStages.length * 100);
    }

    /**
     * 创建双视图容器
     */
    createDualViewContainer(data) {
        const dualViewContainer = document.createElement('div');
        dualViewContainer.className = 'dual-view-container';
        
        // 存储原始数据供两个视图使用
        this.lastQueryData = data;
        
        // 统一默认使用用户视图（可切换到开发者视图），避免历史对话落到开发者视图
        this.currentViewMode = 'user';
        // 使用当前视图模式创建容器
        
        const devEnabled = this.isDeveloperViewEnabled();
        let viewSwitcher = null;
        if (devEnabled) {
            // 创建视图切换按钮（仅当启用开发者视图时）
            viewSwitcher = document.createElement('div');
            viewSwitcher.className = 'view-switcher';
        viewSwitcher.innerHTML = `
            <button class="view-btn ${this.currentViewMode === 'user' ? 'active' : ''}" data-view="user">
                <i class="fas fa-user"></i> ${window.i18nManager.t('chat.userView')}
            </button>
            <button class="view-btn ${this.currentViewMode === 'developer' ? 'active' : ''}" data-view="developer">
                <i class="fas fa-code"></i> ${window.i18nManager.t('chat.developerView')}
            </button>
        `;
        } else {
            dualViewContainer.classList.add('user-only');
        }
        
        // 创建用户视图内容
        const userViewContent = this.createUserSummary(data);
        userViewContent.className = `view-content user-view ${this.currentViewMode === 'user' ? 'active' : ''}`;
        
        // 创建开发者视图内容（仅当启用时）
        let devViewContent = null;
        if (devEnabled) {
            devViewContent = this.createDeveloperDetails(data);
            devViewContent.className = `view-content developer-view ${this.currentViewMode === 'developer' ? 'active' : ''}`;
        }
        
        // 组装容器
        if (viewSwitcher) dualViewContainer.appendChild(viewSwitcher);
        dualViewContainer.appendChild(userViewContent);
        if (devViewContent) dualViewContainer.appendChild(devViewContent);
        
        // 添加视图切换事件
        if (viewSwitcher) {
            viewSwitcher.querySelectorAll('.view-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const view = e.currentTarget.dataset.view;
                    this.switchView(view, dualViewContainer);
                });
            });
        }
        
        return dualViewContainer;
    }


    /**
     * 切换视图
     */
    switchView(viewType, container) {
        // 若未启用开发者视图，强制使用 user 视图
        if (!this.isDeveloperViewEnabled()) {
            this.currentViewMode = 'user';
            viewType = 'user';
        } else {
            // 更新当前视图模式
            this.currentViewMode = viewType;
        }
        // 切换到指定视图
        
        // 不保存临时的视图切换，只使用用户在设置中配置的默认值
        // localStorage.setItem('view_mode', viewType);  // 注释掉，避免覆盖默认设置
        
        // 如果提供了容器，更新该容器中的视图
        if (container) {
            // 更新按钮状态
            container.querySelectorAll('.view-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === viewType);
            });
            
            // 切换视图内容
            container.querySelector('.user-view')?.classList.toggle('active', viewType === 'user');
            container.querySelector('.developer-view')?.classList.toggle('active', viewType === 'developer');
        }
        
        // 更新所有现有的双视图容器
        document.querySelectorAll('.dual-view-container').forEach(dualView => {
            dualView.querySelectorAll('.view-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.view === viewType);
            });
            dualView.querySelector('.user-view')?.classList.toggle('active', viewType === 'user');
            dualView.querySelector('.developer-view')?.classList.toggle('active', viewType === 'developer');
        });
    }

    /**
     * 切换视图模式（用于全局切换）
     */
    toggleViewMode() {
        const newMode = this.currentViewMode === 'user' ? 'developer' : 'user';
        this.switchView(newMode);
    }
    
    /**
     * 打开HTML文件
     */
    openHtmlFile(filename) {
        // 在新窗口中打开HTML文件
        const url = `/output/${filename}`;
        window.open(url, '_blank');
        this.showNotification(window.i18nManager.t('common.openingVisualization'), 'info');
        console.log('打开HTML文件:', url);
    }

    /**
     * 加载视图模式
     */
    loadViewMode() {
        // 视图模式已经在构造函数中通过 getStoredViewMode 加载
        // 这里只需要确保 localStorage 的一致性
        
        // 同步保存到 view_mode 以保持兼容性
        localStorage.setItem('view_mode', this.currentViewMode);
        
        console.log('当前视图模式:', this.currentViewMode);
    }


    /**
     * 加载对话
     */
    async loadConversation(conversationId) {
        try {
            const conversation = await api.getConversation(conversationId);
            this.currentConversationId = conversationId;
            
            // 切换到聊天标签
            this.switchTab('chat');
            
            // 清空并重新加载消息
            const messagesContainer = document.getElementById('chat-messages');
            messagesContainer.innerHTML = '';
            
            conversation.messages.forEach(msg => {
                if (msg.role === 'user') {
                    this.addMessage('user', msg.content);
                } else if (msg.role === 'assistant') {
                    // 直接添加助手消息，因为历史消息只有文本内容
                    this.addMessage('bot', msg.content);
                }
            });
            
            this.showNotification('已加载历史对话', 'success');
        } catch (error) {
            console.error('加载对话失败:', error);
            this.showNotification('加载对话失败', 'error');
        }
    }

    /**
     * 加载配置
     */
    async loadConfig() {
        try {
            // 设置超时时间，避免长时间等待
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('配置加载超时')), 3000)
            );
            
            this.config = await Promise.race([
                api.getConfig(),
                timeoutPromise
            ]);
            
            // 更新UI
            if (this.config.current_model) {
                const modelSelect = document.getElementById('current-model');
                if (modelSelect) {
                    modelSelect.value = this.config.current_model;
                }
            }
            
            // 加载上下文轮数设置
            if (this.config.context_rounds !== undefined) {
                this.contextRounds = this.config.context_rounds;
                console.log('从配置加载 context_rounds:', this.contextRounds);
            }
        } catch (error) {
            // 静默处理错误，使用默认配置
            console.warn('配置加载失败，使用默认值:', error.message);
            this.config = {
                current_model: 'gpt-4.1',
                api_base: 'http://localhost:11434/v1'
            };
        }
    }

    /**
     * 加载模型列表并更新选择器
     */
    async loadModels() {
        try {
            const response = await api.getModels();
            const models = response.models || [];
            
            console.log('从API获取的模型列表:', models);
            
            // 更新查询页面的模型选择器
            const currentModelSelector = document.getElementById('current-model');
            console.log('当前模型选择器元素:', currentModelSelector);
            
            if (currentModelSelector) {
                const currentValue = currentModelSelector.value || this.config.current_model || 'gpt-4.1';
                console.log('当前选中的模型值:', currentValue);
                
                // 清空并重新构建选项
                currentModelSelector.innerHTML = '';
                
                models.forEach(model => {
                    const option = document.createElement('option');
                    option.value = model.id;
                    option.textContent = model.name || model.id;
                    currentModelSelector.appendChild(option);
                });
                
                console.log('添加了', models.length, '个模型到选择器');
                
                // 恢复之前的选择
                if (currentValue && currentModelSelector.querySelector(`option[value="${currentValue}"]`)) {
                    currentModelSelector.value = currentValue;
                } else if (currentModelSelector.options.length > 0) {
                    currentModelSelector.value = currentModelSelector.options[0].value;
                }
                
                // 确保选择器可见
                if (currentModelSelector.parentElement) {
                    currentModelSelector.parentElement.style.display = 'block';
                }
            }
            
            // 更新其他可能的模型选择器（如设置页面）
            const defaultModelSelector = document.getElementById('default-model');
            if (defaultModelSelector) {
                const currentDefaultValue = defaultModelSelector.value;
                defaultModelSelector.innerHTML = '';
                
                models.forEach(model => {
                    if (model.status === 'active' || model.status === undefined) {
                        const option = document.createElement('option');
                        option.value = model.id;
                        option.textContent = model.name || model.id;
                        defaultModelSelector.appendChild(option);
                    }
                });
                
                if (currentDefaultValue && defaultModelSelector.querySelector(`option[value="${currentDefaultValue}"]`)) {
                    defaultModelSelector.value = currentDefaultValue;
                }
            }
            
            console.log('模型列表更新完成，当前激活模型数量:', models.filter(m => m.status === 'active' || m.status === undefined).length);
        } catch (error) {
            console.error('加载模型列表失败:', error);
        }
    }

    /**
     * 保存配置
     */
    async saveConfig() {
        try {
            await api.saveConfig(this.config);
        } catch (error) {
            console.error('保存配置失败:', error);
        }
    }

    /**
     * 加载设置
     */
    async loadSettings() {
        try {
            const config = await api.getConfig();
            console.log('加载配置:', config);
            
            // 填充模型API表单 - 注意ID是model-api-key和model-api-base
            const apiKeyInput = document.getElementById('model-api-key');
            const apiBaseInput = document.getElementById('model-api-base');
            
            if (apiKeyInput && config.api_key) {
                apiKeyInput.value = config.api_key;
            }
            if (apiBaseInput && config.api_base) {
                apiBaseInput.value = config.api_base;
            }
            
            // 默认模型
            if (config.default_model) {
                const defaultModelSelect = document.getElementById('default-model');
                if (defaultModelSelect) {
                    defaultModelSelect.value = config.default_model;
                }
            }
            
            // 数据库配置
            if (config.database) {
                const dbHost = document.getElementById('db-host');
                const dbPort = document.getElementById('db-port');
                const dbUser = document.getElementById('db-user');
                const dbPassword = document.getElementById('db-password');
                const dbName = document.getElementById('db-name');
                
                if (dbHost) dbHost.value = config.database.host || '';
                if (dbPort) dbPort.value = config.database.port || '3306';
                if (dbUser) dbUser.value = config.database.user || '';
                if (dbPassword) dbPassword.value = config.database.password || '';
                if (dbName) dbName.value = config.database.database || '';
            }
            
            // UI配置
            const uiConfig = JSON.parse(localStorage.getItem('ui_config') || '{}');
            if (uiConfig.default_view_mode) {
                document.getElementById('default-view-mode').value = uiConfig.default_view_mode;
            }
        } catch (error) {
            console.error('加载设置失败:', error);
        }
    }

    /**
     * 检查连接状态
     */
    async checkConnection() {
        try {
            const result = await api.healthCheck();
            this.updateConnectionStatus(result.status === 'healthy');
        } catch (error) {
            this.updateConnectionStatus(false);
        }
    }

    /**
     * 更新连接状态
     */
    updateConnectionStatus(connected) {
        const statusDot = document.getElementById('connection-status');
        const statusText = document.getElementById('connection-text');
        
        if (connected) {
            statusDot.classList.add('connected');
            statusText.textContent = '已连接';
            statusText.style.color = '#27ae60';
        } else {
            statusDot.classList.remove('connected');
            statusText.textContent = '未连接';
            statusText.style.color = '#e74c3c';
        }
    }

    /**
     * 显示欢迎消息
     */
    showWelcomeMessage() {
        const messagesContainer = document.getElementById('chat-messages');
        if (!messagesContainer) return;
        
        // 移除现有的欢迎消息（为了支持语言切换重新生成）
        const existingWelcome = messagesContainer.querySelector('.welcome-message');
        if (existingWelcome) {
            existingWelcome.remove();
        }
        
        // 获取翻译
        const i18n = window.i18nManager || { 
            t: (key) => {
                const fallbacks = {
                    'chat.welcome': '欢迎使用 QueryGPT 智能数据分析系统',
                    'chat.welcomeDesc': '我可以帮助您：',
                    'chat.feature1': '使用自然语言查询数据库',
                    'chat.feature2': '自动生成数据可视化图表',
                    'chat.feature3': '智能分析数据并提供洞察',
                    'chat.tryExample': '试试这些示例：',
                    'chat.example1': '显示最近一个月的销售数据',
                    'chat.example2': '分析产品类别的销售占比',
                    'chat.example3': '查找销售额最高的前10个客户',
                    'chat.example4': '生成用户增长趋势图',
                    'chat.exampleBtn1': '查看数据库',
                    'chat.exampleBtn2': '销售分析',
                    'chat.exampleBtn3': '产品占比',
                    'chat.exampleBtn4': '用户趋势',
                    'chat.hint': '提示：直接输入自然语言查询，系统会自动转换为SQL并生成图表'
                };
                return fallbacks[key] || key;
            }
        };
        
        // 创建欢迎消息
        const welcomeDiv = document.createElement('div');
        welcomeDiv.className = 'welcome-message';
        welcomeDiv.innerHTML = `
            <div class="welcome-content">
                <div class="welcome-header">
                    <i class="fas fa-chart-bar welcome-icon"></i>
                    <h2>${i18n.t('chat.welcome')}</h2>
                </div>
                <p class="welcome-subtitle">${i18n.t('chat.welcomeDesc')}</p>
                
                <div class="welcome-features">
                    <div class="feature-item">
                        <i class="fas fa-database"></i>
                        <span>${i18n.t('chat.feature1')}</span>
                    </div>
                    <div class="feature-item">
                        <i class="fas fa-chart-pie"></i>
                        <span>${i18n.t('chat.feature2')}</span>
                    </div>
                    <div class="feature-item">
                        <i class="fas fa-file-export"></i>
                        <span>${i18n.t('chat.feature3')}</span>
                    </div>
                </div>
                
                <div class="example-section">
                    <p class="section-title">${i18n.t('chat.tryExample')}</p>
                    <div class="example-queries">
                        <button class="example-btn" data-example="${i18n.t('chat.example1')}">
                            <i class="fas fa-database"></i>
                            <span>${i18n.t('chat.exampleBtn1')}</span>
                        </button>
                        <button class="example-btn" data-example="${i18n.t('chat.example2')}">
                            <i class="fas fa-chart-line"></i>
                            <span>${i18n.t('chat.exampleBtn2')}</span>
                        </button>
                        <button class="example-btn" data-example="${i18n.t('chat.example3')}">
                            <i class="fas fa-chart-pie"></i>
                            <span>${i18n.t('chat.exampleBtn3')}</span>
                        </button>
                        <button class="example-btn" data-example="${i18n.t('chat.example4')}">
                            <i class="fas fa-users"></i>
                            <span>${i18n.t('chat.exampleBtn4')}</span>
                        </button>
                    </div>
                </div>
                
                <p class="welcome-hint">
                    <i class="fas fa-lightbulb"></i>
                    ${i18n.t('chat.hint')}
                </p>
            </div>
        `;
        
        messagesContainer.innerHTML = '';
        messagesContainer.appendChild(welcomeDiv);
        
        // 重新绑定示例按钮事件
        welcomeDiv.querySelectorAll('.example-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const example = btn.dataset.example;
                document.getElementById('message-input').value = example;
                // 可选：自动发送
                // this.sendMessage();
            });
        });
    }

    /**
     * 显示通知 - 渐入渐出效果
     */
    showNotification(text, type = 'info') {
        const notification = document.getElementById('notification');
        const iconMap = {
            'success': 'fa-check-circle',
            'error': 'fa-times-circle',
            'warning': 'fa-exclamation-triangle',
            'info': 'fa-info-circle'
        };
        
        // 重置动画状态
        notification.classList.remove('show', 'hide');
        void notification.offsetWidth; // 强制重排，确保动画重新触发
        
        // 设置通知类型和内容
        notification.className = `notification ${type}`;
        notification.querySelector('.notification-icon').className = `fas ${iconMap[type]} notification-icon`;
        notification.querySelector('.notification-text').textContent = text;
        
        // 显示通知
        notification.classList.add('show');
        
        // 清除之前的定时器
        if (this.notificationTimeout) {
            clearTimeout(this.notificationTimeout);
        }
        
        // 设置自动隐藏
        this.notificationTimeout = setTimeout(() => {
            notification.classList.remove('show');
            notification.classList.add('hide');
            
            // 动画结束后清理
            setTimeout(() => {
                notification.classList.remove('hide');
            }, 400);
        }, 3500);
    }

    /**
     * 渲染Markdown
     */
    renderMarkdown(text) {
        // 使用marked库渲染Markdown
        if (window.marked) {
            return marked.parse(text);
        }
        // 简单的换行处理
        return text.replace(/\n/g, '<br>');
    }

    /**
     * 渲染表格
     */
    renderTable(data) {
        if (!data || !data.length) return '<p>无数据</p>';
        
        const headers = Object.keys(data[0]);
        let html = '<table class="data-table"><thead><tr>';
        
        headers.forEach(header => {
            html += `<th>${header}</th>`;
        });
        
        html += '</tr></thead><tbody>';
        
        data.forEach(row => {
            html += '<tr>';
            headers.forEach(header => {
                html += `<td>${row[header] || ''}</td>`;
            });
            html += '</tr>';
        });
        
        html += '</tbody></table>';
        return html;
    }

    /**
     * 高亮SQL
     */
    highlightSQL(sql) {
        // 简单的SQL高亮
        const keywords = ['SELECT', 'FROM', 'WHERE', 'JOIN', 'ON', 'GROUP BY', 'ORDER BY', 'LIMIT', 'AS', 'AND', 'OR', 'IN', 'LIKE'];
        let highlighted = sql;
        
        keywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            highlighted = highlighted.replace(regex, `<span class="keyword">${keyword}</span>`);
        });
        
        // 高亮字符串
        highlighted = highlighted.replace(/'([^']*)'/g, '<span class="string">\'$1\'</span>');
        
        // 高亮数字
        highlighted = highlighted.replace(/\b(\d+)\b/g, '<span class="number">$1</span>');
        
        return highlighted;
    }

    /**
     * 高亮代码
     */
    highlightCode(code) {
        // 使用highlight.js高亮代码
        if (window.hljs) {
            return hljs.highlightAuto(code).value;
        }
        return code;
    }

    /**
     * 复制到剪贴板
     */
    copyToClipboard(text) {
        const i18n = window.i18nManager || { t: (key) => key };
        navigator.clipboard.writeText(text).then(() => {
            this.showNotification(i18n.t('errors.copiedToClipboard'), 'success');
        }).catch(() => {
            this.showNotification(i18n.t('errors.copyFailed'), 'error');
        });
    }

    /**
     * 格式化时间
     */
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        const isZh = window.i18nManager && window.i18nManager.getCurrentLanguage() === 'zh';
        
        if (diff < 60000) {
            return isZh ? '刚刚' : 'Just now';
        } else if (diff < 3600000) {
            const minutes = Math.floor(diff / 60000);
            return isZh ? `${minutes}分钟前` : `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        } else if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000);
            return isZh ? `${hours}小时前` : `${hours} hour${hours > 1 ? 's' : ''} ago`;
        } else if (diff < 604800000) {
            const days = Math.floor(diff / 86400000);
            return isZh ? `${days}天前` : `${days} day${days > 1 ? 's' : ''} ago`;
        } else {
            return date.toLocaleDateString(isZh ? 'zh-CN' : 'en-US');
        }
    }

    /**
     * 模型管理相关方法（供全局调用）
     */
    editModel(modelId) {
        if (window.settingsManager) {
            window.settingsManager.editModel(modelId);
        }
    }

    testModel(modelId) {
        if (window.settingsManager) {
            window.settingsManager.testModel(modelId);
        }
    }

    deleteModel(modelId) {
        if (window.settingsManager) {
            window.settingsManager.deleteModel(modelId);
        }
    }

    closeModelModal() {
        if (window.settingsManager) {
            window.settingsManager.closeModelModal();
        }
    }

    /**
     * 切换语言
     */
    changeLanguage(newLang) {
        window.i18nManager.setLanguage(newLang);
        
        // 重新初始化Tips以使用新语言
        this.initTipsManager();
        
        // 同步更新两个语言切换控件
        const languageSelect = document.getElementById('language-select');
        if (languageSelect) {
            languageSelect.value = newLang;
        }
        
        
        // 刷新欢迎消息（如果当前没有对话）
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer && messagesContainer.querySelector('.welcome-message')) {
            this.showWelcomeMessage();
        }
        
        // 显示通知
        const i18n = window.i18nManager || { t: (key) => key };
        this.showNotification(
            newLang === 'zh' ? i18n.t('errors.languageSwitchedZh') : i18n.t('errors.languageSwitchedEn'), 
            'success'
        );
    }
    
    
    /**
     * 更新执行状态
     */
    updateExecutionStatus(status) {
        const statusElements = document.querySelectorAll('.execution-status');
        statusElements.forEach(element => {
            element.className = `execution-status ${status}`;
            
            const statusMap = {
                'running': '<i class="fas fa-spinner fa-spin"></i> 执行中',
                'success': '<i class="fas fa-check-circle"></i> 执行完成',
                'error': '<i class="fas fa-exclamation-circle"></i> 执行失败'
            };
            
            element.innerHTML = statusMap[status] || status;
        });
    }

    /**
     * 设置侧边栏控制逻辑
     */
    setupSidebarControls() {
        const sidebar = document.querySelector('.sidebar');
        const menuBtn = document.getElementById('menu-toggle-btn');
        const overlay = document.getElementById('sidebar-overlay');
        const mainContent = document.querySelector('.main-content');
        
        if (!sidebar || !menuBtn) return;
        
        // 检测屏幕尺寸
        const getScreenSize = () => {
            const width = window.innerWidth;
            if (width > 1200) return 'large';
            if (width > 768) return 'medium';
            return 'small';
        };
        
        // 切换侧边栏状态
        const toggleSidebar = () => {
            const screenSize = getScreenSize();
            const isOpen = sidebar.classList.contains('show');
            
            if (isOpen) {
                // 关闭侧边栏
                sidebar.classList.remove('show');
                menuBtn.classList.remove('active');
                
                if (overlay) {
                    overlay.classList.remove('show');
                }
                
                if (screenSize === 'medium' && mainContent) {
                    mainContent.classList.remove('sidebar-open');
                }
            } else {
                // 打开侧边栏
                sidebar.classList.add('show');
                menuBtn.classList.add('active');
                
                if (screenSize === 'small' && overlay) {
                    overlay.classList.add('show');
                }
                
                if (screenSize === 'medium' && mainContent) {
                    mainContent.classList.add('sidebar-open');
                }
            }
        };
        
        // 菜单按钮点击事件
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSidebar();
        });
        
        // 遮罩层点击事件（小屏幕）
        if (overlay) {
            overlay.addEventListener('click', () => {
                const screenSize = getScreenSize();
                if (screenSize === 'small') {
                    toggleSidebar();
                }
            });
        }
        
        // 侧边栏内链接点击事件（小屏幕自动关闭）
        sidebar.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', () => {
                const screenSize = getScreenSize();
                if (screenSize === 'small' || screenSize === 'medium') {
                    setTimeout(() => {
                        sidebar.classList.remove('show');
                        menuBtn.classList.remove('active');
                        if (overlay) overlay.classList.remove('show');
                        if (mainContent) mainContent.classList.remove('sidebar-open');
                    }, 300);
                }
            });
        });
        
        // 窗口大小改变时的处理
        let resizeTimeout;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                const screenSize = getScreenSize();
                
                // 大屏幕时自动显示侧边栏
                if (screenSize === 'large') {
                    sidebar.classList.remove('show');
                    menuBtn.classList.remove('active');
                    if (overlay) overlay.classList.remove('show');
                    if (mainContent) mainContent.classList.remove('sidebar-open');
                }
                
                // 调整按钮显示
                if (screenSize === 'large') {
                    menuBtn.style.display = 'none';
                } else {
                    menuBtn.style.display = 'block';
                }
            }, 250);
        });
        
        // 初始化时根据屏幕大小设置
        const initialSize = getScreenSize();
        if (initialSize === 'large') {
            menuBtn.style.display = 'none';
        } else {
            menuBtn.style.display = 'block';
            // 中小屏幕默认隐藏侧边栏
            sidebar.classList.remove('show');
        }
        
        // ESC键关闭侧边栏（非大屏幕）
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const screenSize = getScreenSize();
                if (screenSize !== 'large' && sidebar.classList.contains('show')) {
                    toggleSidebar();
                }
            }
        });
    }
    
    /**
     * 设置历史记录事件监听器
     */
    setupHistoryEventListeners() {
        // 监听历史对话加载事件
        window.addEventListener('historyConversationLoaded', (event) => {
            this.loadHistoryConversation(event.detail);
        });
        
        // 监听快捷键
        document.addEventListener('keydown', (e) => {
            // Ctrl+H 打开历史记录
            if (e.ctrlKey && e.key === 'h') {
                e.preventDefault();
                this.switchTab('history');
            }
        });
        
        // 加载历史统计
        this.loadHistoryStatistics();
    }
    
    /**
     * 加载历史对话
     */
    loadHistoryConversation(conversation) {
        if (!conversation) return;
        
        // 设置当前对话ID并持久化
        this.currentConversationId = conversation.conversation_id;
        localStorage.setItem('currentConversationId', conversation.conversation_id);
        
        // 切换到聊天标签
        this.switchTab('chat');
        
        // 清空当前消息
        const messagesContainer = document.getElementById('chat-messages');
        if (messagesContainer) {
            messagesContainer.innerHTML = '';
        }
        
        // 加载历史消息
        if (conversation.messages) {
            conversation.messages.forEach(msg => {
                if (msg.type === 'user') {
                    this.addMessage('user', msg.content);
                } else if (msg.type === 'assistant') {
                    // 解析助手消息
                    try {
                        // 尝试解析JSON格式的内容
                        let content = msg.content;
                        if (typeof content === 'string') {
                            try {
                                content = JSON.parse(content);
                            } catch (e) {
                                // 如果不是JSON，作为普通文本处理
                            }
                        }
                        
                        // 检查内容类型
                        if (content && typeof content === 'object') {
                            if (content.type === 'dual_view' && content.data) {
                                // 这是双视图格式
                                const dualViewContainer = this.createDualViewContainer(content.data);
                                this.addMessage('bot', dualViewContainer);
                            } else if (content.type === 'raw_output' && content.data) {
                                // 这是原始的OpenInterpreter输出
                                // 需要包装成双视图格式
                                const wrappedContent = {
                                    content: content.data
                                };
                                const dualViewContainer = this.createDualViewContainer(wrappedContent);
                                this.addMessage('bot', dualViewContainer);
                            } else if (content.content) {
                                // 旧格式的双视图数据
                                const dualViewContainer = this.createDualViewContainer(content);
                                this.addMessage('bot', dualViewContainer);
                            } else if (Array.isArray(content)) {
                                // 直接是数组格式（OpenInterpreter输出）
                                const wrappedContent = {
                                    content: content
                                };
                                const dualViewContainer = this.createDualViewContainer(wrappedContent);
                                this.addMessage('bot', dualViewContainer);
                            } else {
                                // 其他对象格式 - 也通过双视图容器处理
                                const dualViewContainer = this.createDualViewContainer(content);
                                this.addMessage('bot', dualViewContainer);
                            }
                        } else if (typeof content === 'string') {
                            // 纯文本消息
                            this.addMessage('bot', content);
                        } else {
                            // 其他格式
                            this.addMessage('bot', String(content));
                        }
                    } catch (error) {
                        console.error('解析历史消息失败:', error, msg);
                        // 降级处理：也通过双视图容器处理
                        if (typeof msg.content === 'string') {
                            this.addMessage('bot', msg.content);
                        } else {
                            const dualViewContainer = this.createDualViewContainer(msg.content);
                            this.addMessage('bot', dualViewContainer);
                        }
                    }
                }
            });
        }
        
        // 显示提示
        this.showNotification(`已加载历史对话: ${conversation.metadata?.title || '未命名'}`, 'success');
        
        // 滚动到底部
        if (messagesContainer) {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }
    }
    
    /**
     * 加载历史统计信息
     */
    async loadHistoryStatistics() {
        try {
            const response = await fetch('/api/history/statistics');
            const data = await response.json();
            
            if (data.success && data.statistics) {
                const stats = data.statistics;
                
                // 更新统计显示
                const totalElement = document.getElementById('stat-total');
                const todayElement = document.getElementById('stat-today');
                const favoritesElement = document.getElementById('stat-favorites');
                
                if (totalElement) totalElement.textContent = stats.total_conversations || 0;
                if (todayElement) todayElement.textContent = stats.today_conversations || 0;
                
                // 更新徽章（如果有新的历史记录）
                if (stats.today_conversations > 0) {
                    const badge = document.getElementById('history-badge');
                    if (badge) {
                        badge.style.display = 'inline-block';
                    }
                }
            }
        } catch (error) {
            console.error('加载历史统计失败:', error);
        }
    }
    
    /**
     * 初始化Tips提示系统
     */
    initTipsManager() {
        // 定义所有提示语 - 简洁版本
        this.queryTips = [
            'Tips: ' + window.i18nManager.t('common.tips.detailed'),
            'Tips: ' + window.i18nManager.t('common.tips.naturalLanguage'),
            'Tips: ' + window.i18nManager.t('common.tips.flexibleTime'),
            'Tips: ' + window.i18nManager.t('common.tips.autoChart'),
            'Tips: ' + window.i18nManager.t('common.tips.continuous'),
            'Tips: ' + window.i18nManager.t('common.tips.comparison'),
            'Tips: ' + window.i18nManager.t('common.tips.examples'),
            'Tips: ' + window.i18nManager.t('common.tips.ranking'),
            'Tips: ' + window.i18nManager.t('common.tips.trend'),
            'Tips: ' + window.i18nManager.t('common.tips.followUp'),
            'Tips: ' + window.i18nManager.t('common.tips.filter'),
            'Tips: ' + window.i18nManager.t('common.tips.doubleClick'),
            'Tips: ' + window.i18nManager.t('common.tips.tabKey'),
            'Tips: ' + window.i18nManager.t('common.tips.help')
        ];
    }
    
    /**
     * 获取随机提示
     */
    getRandomTip() {
        if (!this.queryTips || this.queryTips.length === 0) return null;
        return this.queryTips[Math.floor(Math.random() * this.queryTips.length)];
    }
    
    /**
     * 获取上下文相关的提示（包括深夜关怀）
     */
    getContextualTip() {
        const hour = new Date().getHours();
        
        // 深夜关怀提醒
        if (hour >= 23 || hour < 5) {
            const lateNightTips = [
                'Tips: ' + window.i18nManager.t('common.tips.lateNight1'),
                'Tips: ' + window.i18nManager.t('common.tips.lateNight2'),
                'Tips: ' + window.i18nManager.t('common.tips.lateNight3'),
                'Tips: ' + window.i18nManager.t('common.tips.lateNight4'),
                'Tips: ' + window.i18nManager.t('common.tips.lateNight5')
            ];
            
            // 根据具体时间选择不同的关怀语
            if (hour >= 23 && hour < 24) {
                return 'Tips: ' + window.i18nManager.t('common.tips.lateNight1');
            } else if (hour >= 0 && hour < 1) {
                return 'Tips: ' + window.i18nManager.t('common.tips.midnight');
            } else if (hour >= 1 && hour < 3) {
                return 'Tips: ' + window.i18nManager.t('common.tips.earlyMorning');
            } else if (hour >= 3 && hour < 5) {
                return 'Tips: ' + window.i18nManager.t('common.tips.lateNight4');
            }
        }
        
        // 早起关怀
        if (hour >= 5 && hour < 7) {
            return 'Tips: 早起的鸟儿有虫吃，早安！新的一天从数据开始';
        }
        
        // 正常时间返回普通提示
        return this.getRandomTip();
    }
    
    /**
     * 刷新提示语（保留但不使用）
     */
    refreshTip() {
        // 极简版本不需要刷新功能
    }
}

// 初始化应用 - 使用多重检查确保完全加载
function initializeApp() {
    // 检查依赖是否都已加载
    if (typeof API === 'undefined' || 
        typeof LanguageManager === 'undefined' || 
        typeof ErrorHandler === 'undefined') {
        // 如果依赖未加载，延迟重试
        setTimeout(initializeApp, 100);
        return;
    }
    
    // 创建应用实例
    window.app = new DataAnalysisPlatform();
}

// 使用多重事件确保页面完全加载
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // 如果DOMContentLoaded已经触发，延迟执行确保其他脚本已加载
    setTimeout(initializeApp, 100);
}
