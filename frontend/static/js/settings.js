/**
 * 设置页面管理模块
 */

class SettingsManager {
    constructor() {
        this.models = [];
        this.currentEditingModel = null;
        this.config = null;  // 存储配置
        this.hasTestedModels = false;  // 标记是否已经测试过模型
        this.modelTypePresets = {
            openai: {
                label: 'OpenAI',
                provider: 'openai',
                defaultBase: 'https://api.openai.com/v1',
                requiresApiKey: true,
                requiresApiBase: true,
                defaultModel: 'gpt-4o',
                defaultLitellm: 'gpt-4o'
            },
            qwen: {
                label: 'Qwen (DashScope)',
                provider: 'dashscope',
                defaultBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                requiresApiKey: true,
                requiresApiBase: true,
                defaultModel: 'qwen-plus'
            },
            dashscope: {
                label: 'Qwen (DashScope)',
                provider: 'dashscope',
                defaultBase: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                requiresApiKey: true,
                requiresApiBase: true,
                defaultModel: 'qwen-plus'
            },
            deepseek: {
                label: 'DeepSeek',
                provider: 'deepseek',
                defaultBase: 'https://api.deepseek.com/v1',
                requiresApiKey: true,
                requiresApiBase: true,
                defaultModel: 'deepseek-chat'
            },
            anthropic: {
                label: 'Anthropic Claude',
                provider: 'anthropic',
                defaultBase: 'https://api.anthropic.com/v1',
                requiresApiKey: true,
                requiresApiBase: true,
                defaultModel: 'claude-3-5-sonnet-20240620'
            },
            groq: {
                label: 'Groq',
                provider: 'groq',
                defaultBase: 'https://api.groq.com/openai/v1',
                requiresApiKey: true,
                requiresApiBase: true,
                defaultModel: 'llama3-70b-8192'
            },
            azure: {
                label: 'Azure OpenAI',
                provider: 'azure',
                defaultBase: '',
                requiresApiKey: true,
                requiresApiBase: true
            },
            moonshot: {
                label: 'Moonshot (Kimi)',
                provider: 'moonshot',
                defaultBase: 'https://api.moonshot.cn/v1',
                requiresApiKey: true,
                requiresApiBase: true,
                defaultModel: 'moonshot-v1-8k'
            },
            gemini: {
                label: 'Google Gemini',
                provider: 'google',
                defaultBase: 'https://generativelanguage.googleapis.com/v1beta',
                requiresApiKey: true,
                requiresApiBase: true,
                defaultModel: 'gemini-1.5-pro-latest'
            },
            google: {
                label: 'Google Gemini',
                provider: 'google',
                defaultBase: 'https://generativelanguage.googleapis.com/v1beta',
                requiresApiKey: true,
                requiresApiBase: true,
                defaultModel: 'gemini-1.5-pro-latest'
            },
            mistral: {
                label: 'Mistral AI',
                provider: 'mistral',
                defaultBase: 'https://api.mistral.ai/v1',
                requiresApiKey: true,
                requiresApiBase: true,
                defaultModel: 'mistral-large-latest'
            },
            fireworks: {
                label: 'Fireworks AI',
                provider: 'fireworks',
                defaultBase: 'https://api.fireworks.ai/inference/v1',
                requiresApiKey: true,
                requiresApiBase: true
            },
            cohere: {
                label: 'Cohere',
                provider: 'cohere',
                defaultBase: 'https://api.cohere.ai/v1',
                requiresApiKey: true,
                requiresApiBase: true,
                defaultModel: 'command-r-plus'
            },
            openrouter: {
                label: 'OpenRouter',
                provider: 'openrouter',
                defaultBase: 'https://openrouter.ai/api/v1',
                requiresApiKey: true,
                requiresApiBase: true,
                defaultModel: 'openrouter/auto',
                defaultLitellm: 'openrouter/auto'
            },
            perplexity: {
                label: 'Perplexity',
                provider: 'perplexity',
                defaultBase: 'https://api.perplexity.ai',
                requiresApiKey: true,
                requiresApiBase: true,
                defaultModel: 'llama-3.1-sonar-small-128k-chat'
            },
            bedrock: {
                label: 'AWS Bedrock',
                provider: 'bedrock',
                defaultBase: '',
                requiresApiKey: true,
                requiresApiBase: false,
                defaultModel: 'anthropic.claude-3-sonnet-20240229-v1:0'
            },
            ollama: {
                label: 'Ollama (本地)',
                provider: 'ollama',
                defaultBase: 'http://localhost:11434',
                requiresApiKey: false,
                requiresApiBase: true,
                defaultModel: 'llama3:latest',
                defaultLitellm: 'ollama/llama3:latest'
            },
            custom: {
                label: '自定义 / OpenAI兼容',
                provider: 'custom',
                defaultBase: '',
                requiresApiKey: false,
                requiresApiBase: false
            }
        };
        // 不在构造函数中初始化，等待DOM准备好
    }

    /**
     * 初始化设置管理器
     */
    async init() {
        console.log('SettingsManager 初始化开始');
        
        // 确保模态框初始状态为关闭
        this.ensureModalClosed();
        
        // 先加载配置
        await this.loadConfig();
        this.setupSettingsTabEvents();
        this.setupModelManagementEvents();
        this.setupDatabaseEvents();
        this.setupSystemEvents();
        this.loadModels();
        console.log('SettingsManager 初始化完成');
    }
    
    /**
     * 确保模态框处于关闭状态
     */
    ensureModalClosed() {
        const modal = document.getElementById('model-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.currentEditingModel = null;
    }
    
    /**
     * 加载配置
     */
    async loadConfig() {
        try {
            const response = await fetch('/api/config');
            if (!response.ok) {
                // 如果响应不成功，静默处理，不显示错误
                console.warn('API配置端点不可用，使用默认配置');
                this.config = {};
                return;
            }
            this.config = await response.json();
            console.log('SettingsManager加载配置:', this.config);
        } catch (error) {
            // 静默处理错误，避免页面加载时弹出错误
            console.warn('无法连接到后端API，使用默认配置:', error.message);
            this.config = {};
            // 不显示错误通知，避免打扰用户
        }
    }

    /**
     * 设置标签页切换事件
     */
    setupSettingsTabEvents() {
        // 设置标签页切换
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchSettingsTab(tab.dataset.settingsTab);
            });
        });

        // 侧边栏设置菜单点击
        document.querySelectorAll('.nav-link[data-tab="settings"]').forEach(link => {
            link.addEventListener('click', (e) => {
                const settingsTab = link.dataset.settingsTab;
                if (settingsTab) {
                    // 延迟切换到指定的设置标签页
                    setTimeout(() => {
                        this.switchSettingsTab(settingsTab);
                    }, 100);
                }
            });
        });
        
        // 设置Prompt相关事件
        this.setupPromptEvents();
        
        // 设置智能路由开关事件
        this.setupSmartRoutingToggle();
    }

    /**
     * 切换设置标签页
     */
    switchSettingsTab(tabName) {
        // 更新标签按钮状态
        document.querySelectorAll('.settings-tab').forEach(tab => {
            tab.classList.remove('active');
        });
        document.querySelector(`[data-settings-tab="${tabName}"]`).classList.add('active');

        // 更新面板显示
        document.querySelectorAll('.settings-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        document.getElementById(`${tabName}-settings`).classList.add('active');
        
        // 移除首次进入自动批量测试，避免错误修改状态
        // if (tabName === 'models' && !this.hasTestedModels) {
        //     this.testAllModelsOnFirstVisit();
        // }
    }

    /**
     * 设置模型管理事件
     */
    setupModelManagementEvents() {
        console.log('设置模型管理事件');
        
        // 添加模型按钮
        const addModelBtn = document.getElementById('add-model-btn');
        if (addModelBtn) {
            addModelBtn.addEventListener('click', () => {
                this.openModelModal();
            });
        }

        const testAllBtn = document.getElementById('test-all-models-btn');
        if (testAllBtn) {
            testAllBtn.addEventListener('click', () => {
                this.testAllModels();
            });
        }

        // 保存模型按钮 - 使用事件委托确保按钮可用
        document.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'save-model-btn') {
                this.saveModel();
            }
        });

        const modelTypeSelect = document.getElementById('model-type');
        if (modelTypeSelect) {
            modelTypeSelect.addEventListener('change', (event) => {
                this.applyModelTypeHints(event.target.value);
            });
        }

        // 设置模态框关闭事件
        this.setupModalCloseEvents();

        // 自动保存基础设置 - 当设置改变时立即保存
        const defaultViewModel = document.getElementById('default-view-mode');
        const contextRounds = document.getElementById('context-rounds');
        
        if (defaultViewModel) {
            defaultViewModel.addEventListener('change', () => {
                console.log('默认视图模式改变，自动保存');
                this.saveBasicSettings();
            });
        }
        
        if (contextRounds) {
            contextRounds.addEventListener('change', () => {
                console.log('上下文轮数改变，自动保存');
                this.saveBasicSettings();
            });
        }
    }
    
    /**
     * 设置模态框关闭事件（ESC键和点击背景）
     */
    setupModalCloseEvents() {
        const modal = document.getElementById('model-modal');
        if (!modal) return;
        
        // ESC键关闭模态框
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal.style.display === 'flex') {
                this.closeModelModal();
            }
        });
        
        // 点击背景关闭模态框
        modal.addEventListener('click', (e) => {
            // 如果点击的是模态框背景（而不是内容区域）
            if (e.target === modal) {
                this.closeModelModal();
            }
        });
    }

    /**
     * 设置数据库事件
     */
    setupDatabaseEvents() {
        // 测试数据库连接
        document.getElementById('test-db')?.addEventListener('click', async () => {
            await this.testDatabaseConnection();
        });

        // 保存数据库配置
        document.getElementById('save-db-config')?.addEventListener('click', async () => {
            await this.saveDatabaseConfig();
        });

    }

    /**
     * 设置系统参数事件
     */
    setupSystemEvents() {
        // 保存系统设置
        document.getElementById('save-system-settings')?.addEventListener('click', () => {
            this.saveSystemSettings();
        });

        // 清空缓存
        document.getElementById('clear-cache')?.addEventListener('click', async () => {
            if (confirm('确定要清空所有缓存吗？')) {
                await this.clearCache();
            }
        });
        
        // 智能路由开关
        this.setupSmartRoutingToggle();
    }
    
    /**
     * 设置智能路由开关
     */
    setupSmartRoutingToggle() {
        const toggle = document.getElementById('smart-routing-toggle');
        const statsBtn = document.getElementById('view-routing-stats');
        
        if (toggle) {
            // 从配置加载当前状态
            const smartRouting = this.config?.features?.smart_routing;
            if (smartRouting) {
                toggle.checked = smartRouting.enabled;
                // 如果是Beta功能，添加标识
                if (smartRouting.beta) {
                    const label = toggle.parentElement?.querySelector('label');
                    if (label && !label.querySelector('.beta-badge')) {
                        const betaBadge = document.createElement('span');
                        betaBadge.className = 'beta-badge';
                        betaBadge.textContent = 'BETA';
                        betaBadge.style.cssText = 'margin-left: 8px; padding: 2px 6px; background: #ff6b6b; color: white; border-radius: 4px; font-size: 10px; vertical-align: middle;';
                        label.appendChild(betaBadge);
                    }
                }
            }
            
            // 监听开关变化
            toggle.addEventListener('change', async (e) => {
                await this.toggleSmartRouting(e.target.checked);
            });
        }
        
        // 查看统计按钮
        if (statsBtn) {
            statsBtn.addEventListener('click', async () => {
                await this.showRoutingStats();
            });
        }
    }
    
    /**
     * 切换智能路由
     */
    async toggleSmartRouting(enabled) {
        try {
            // 更新配置
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    features: {
                        smart_routing: {
                            enabled: enabled
                        }
                    }
                })
            });
            
            if (!response.ok) throw new Error('Failed to update configuration');
            
            // 显示提示
            const message = enabled ? 
                window.i18nManager?.t('settings.smartRoutingEnabled') || '智能路由已启用' :
                window.i18nManager?.t('settings.smartRoutingDisabled') || '智能路由已禁用';
                
            window.showNotification?.(message, 'success') || alert(message);
            
            // 重新加载配置
            await this.loadConfig();
            
        } catch (error) {
            console.error('Failed to toggle smart routing:', error);
            window.showNotification?.('切换失败，请重试', 'error') || alert('切换失败');
            // 恢复开关状态
            const toggle = document.getElementById('smart-routing-toggle');
            if (toggle) toggle.checked = !enabled;
        }
    }
    
    /**
     * 显示路由统计
     */
    async showRoutingStats() {
        try {
            const response = await fetch('/api/routing-stats');
            const data = await response.json();
            
            if (!data.success) throw new Error(data.message || 'Failed to get stats');
            
            const stats = data.stats;
            const enabled = data.enabled;
            
            // 构建统计信息HTML
            const statsHtml = `
                <div class="routing-stats">
                    <h4>${window.i18nManager?.t('settings.routingStats') || '智能路由统计'}</h4>
                    <div class="stats-status">
                        <span>状态：</span>
                        <span class="${enabled ? 'text-success' : 'text-muted'}">
                            ${enabled ? '已启用' : '未启用'}
                        </span>
                    </div>
                    ${enabled ? `
                        <div class="stats-grid">
                            <div class="stat-item">
                                <div class="stat-label">总查询数</div>
                                <div class="stat-value">${stats.total_queries || 0}</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">简单查询</div>
                                <div class="stat-value">${stats.simple_queries || 0}</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">AI查询</div>
                                <div class="stat-value">${stats.ai_queries || 0}</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">路由效率</div>
                                <div class="stat-value">${((stats.simple_queries / (stats.total_queries || 1)) * 100).toFixed(1)}%</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">节省时间</div>
                                <div class="stat-value">${(stats.total_time_saved || 0).toFixed(1)}秒</div>
                            </div>
                            <div class="stat-item">
                                <div class="stat-label">平均节省</div>
                                <div class="stat-value">${(stats.avg_time_saved_per_query || 0).toFixed(2)}秒</div>
                            </div>
                        </div>
                    ` : '<p>智能路由未启用</p>'}
                </div>
            `;
            
            // 显示统计模态框
            this.showStatsModal(statsHtml);
            
        } catch (error) {
            console.error('Failed to get routing stats:', error);
            window.showNotification?.('获取统计失败', 'error');
        }
    }
    
    /**
     * 显示统计模态框
     */
    showStatsModal(content) {
        // 创建模态框
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 10000;';
        
        const modalContent = document.createElement('div');
        modalContent.className = 'modal-content';
        modalContent.style.cssText = 'background: white; padding: 20px; border-radius: 8px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;';
        modalContent.innerHTML = content + '<button class="btn btn-primary mt-3" onclick="this.closest(\'.modal\').remove()">关闭</button>';
        
        modal.appendChild(modalContent);
        document.body.appendChild(modal);
        
        // 点击背景关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    /**
     * 加载模型列表
     */
    async loadModels() {
        try {
            // 从后端获取模型列表
            const response = await api.getModels();
            this.models = (response.models || []).map(model => this.prepareModelRecord(model));
            this.renderModelsList();
        } catch (error) {
            console.error('加载模型列表失败:', error);
            // 使用默认模型列表
            this.models = [
                this.prepareModelRecord({
                    id: 'gpt-4o',
                    name: 'ChatGPT 4o',
                    type: 'openai',
                    api_base: 'https://api.openai.com/v1',
                    model_name: 'gpt-4o',
                    status: 'active',
                    last_test_status: 'success',
                    last_tested_at: new Date().toISOString()
                }),
                this.prepareModelRecord({
                    id: 'qwen-plus',
                    name: 'Qwen Plus',
                    type: 'qwen',
                    api_base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
                    model_name: 'qwen-plus',
                    status: 'pending'
                }),
                this.prepareModelRecord({
                    id: 'ollama-llama3',
                    name: 'Ollama Llama3',
                    type: 'ollama',
                    api_base: 'http://localhost:11434',
                    model_name: 'llama3:latest',
                    litellm_model: 'ollama/llama3:latest',
                    status: 'pending'
                })
            ];
            this.renderModelsList();
        }
    }

    getModelPreset(type) {
        const key = (type || 'custom').toLowerCase();
        return this.modelTypePresets[key] || this.modelTypePresets.custom;
    }

    buildLitellmModelId(model) {
        const provider = (model.provider || model.type || '').toLowerCase();
        const name = model.model_name || model.id || '';
        if (!name) return '';
        if (!provider || provider === 'openai' || provider === 'custom') {
            return name;
        }
        if (name.includes('/')) {
            return name;
        }
        return `${provider}/${name}`;
    }

    prepareModelRecord(raw) {
        const record = { ...(raw || {}) };
        record.id = record.id || record.model || record.name || '';
        record.name = record.name || record.id;
        const typeKey = (record.type || record.provider || 'custom').toLowerCase();
        const preset = this.getModelPreset(typeKey);
        record.type = typeKey;
        record.provider = record.provider || preset.provider;
        record.api_base = record.api_base || record.base_url || preset.defaultBase || '';
        record.base_url = record.api_base;
        if (!record.api_key) {
            record.api_key = preset.requiresApiKey === false ? 'not-needed' : '';
        }
        record.status = record.status || 'pending';
        if (!record.model_name) {
            record.model_name = preset.defaultModel || record.model || record.id;
        }
        if (!record.litellm_model) {
            const litellmSource = { ...record };
            record.litellm_model = preset.defaultLitellm || this.buildLitellmModelId(litellmSource);
        }
        record.requires_api_key = record.requires_api_key ?? preset.requiresApiKey ?? true;
        record.requires_api_base = record.requires_api_base ?? preset.requiresApiBase ?? true;
        record.last_tested_at = record.last_tested_at || raw?.last_tested_at || raw?.lastTestedAt || null;
        record.last_test_status = record.last_test_status || raw?.last_test_status || raw?.lastTestStatus || (record.status === 'active' ? 'success' : '');
        record.last_test_error = record.last_test_error || raw?.last_test_error || raw?.lastTestError || '';
        if (record.status === 'inactive' && !record.last_tested_at && !record.last_test_status) {
            record.status = 'pending';
        }
        return record;
    }

    applyModelTypeHints(type) {
        const preset = this.getModelPreset(type);
        const idInput = document.getElementById('model-id');
        const nameInput = document.getElementById('model-name');
        const apiBaseInput = document.getElementById('model-api-base');
        const apiBaseHint = document.getElementById('model-api-base-hint');
        const apiKeyInput = document.getElementById('model-api-key');
        const apiKeyHint = document.getElementById('model-api-key-hint');
        if (idInput) {
            idInput.placeholder = preset.defaultModel ? `例如: ${preset.defaultModel}` : '例如: my-model-id';
        }
        if (nameInput) {
            nameInput.placeholder = preset.label ? `例如: ${preset.label}` : '请输入模型名称';
        }
        if (apiBaseInput) {
            apiBaseInput.placeholder = preset.defaultBase || 'https://your-endpoint/v1';
            if (!apiBaseInput.value && preset.defaultBase) {
                apiBaseInput.value = preset.defaultBase;
            }
        }
        if (apiBaseHint) {
            if (preset.requiresApiBase === false) {
                apiBaseHint.textContent = '可选字段；留空将沿用默认兼容地址。';
            } else if (preset.defaultBase) {
                apiBaseHint.textContent = `建议基础地址：${preset.defaultBase}`;
            } else {
                apiBaseHint.textContent = '必填字段，请填写模型的API基础地址。';
            }
        }
        if (apiKeyInput) {
            apiKeyInput.placeholder = preset.requiresApiKey ? '输入API密钥' : '无需密钥';
        }
        if (apiKeyHint) {
            const baseText = preset.requiresApiKey ? '必填字段，用于请求鉴权。' : '可选字段，支持免鉴权模型。';
            apiKeyHint.textContent = preset.defaultModel ? `${baseText} 默认模型：${preset.defaultModel}` : baseText;
        }
    }

    formatModelType(rawType) {
        if (!rawType) return 'Unknown';
        const preset = this.getModelPreset(rawType);
        return preset.label || rawType;
    }

    /**
     * 渲染模型列表
     */
    renderModelsList() {
        const tbody = document.getElementById('models-list');
        if (!tbody) return;

        const escapeHtml = (value) => {
            if (value === null || value === undefined) return '';
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };
        const escapeAttr = (value) => {
            if (value === null || value === undefined) return '';
            return String(value).replace(/'/g, "\\'");
        };

        if (!this.models || this.models.length === 0) {
            tbody.innerHTML = `
                <tr class="models-empty-row">
                    <td colspan="5" class="models-empty-message">
                        暂未配置模型，点击右上角“新建模型”按钮开始。
                    </td>
                </tr>
            `;
            return;
        }

        let html = '';
        this.models.forEach(model => {
            const hasTestHistory = Boolean(model.last_tested_at || model.last_test_status);
            let statusClass = 'inactive';
            let statusText = '不可用';

            if (model.status === 'active') {
                statusClass = 'active';
                statusText = '可用';
            } else if (model.status === 'testing') {
                statusClass = 'testing';
                statusText = '测试中';
            } else if (model.status === 'pending' || (!hasTestHistory && model.status !== 'active')) {
                statusClass = 'testing';
                statusText = '未测试';
            } else if (model.status === 'error') {
                statusClass = 'inactive';
                statusText = '配置错误';
            } else if (model.status === 'inactive' && hasTestHistory) {
                statusClass = 'inactive';
                statusText = '连接失败';
            } else if (!hasTestHistory) {
                statusClass = 'testing';
                statusText = '未测试';
            }

            let statusNote = '';
            if (model.last_tested_at) {
                try {
                    const testDate = new Date(model.last_tested_at);
                    if (!Number.isNaN(testDate.getTime())) {
                        statusNote = `上次测试：${testDate.toLocaleString()}`;
                    }
                } catch (_) {
                    // 忽略无法解析的时间
                }
            } else if (statusText === '未测试') {
                statusNote = '尚未执行连通性测试';
            } else if (model.last_test_error && statusText === '连接失败') {
                statusNote = model.last_test_error;
            }

            const typeLabel = this.formatModelType(model.type);
            const apiBase = model.api_base || model.base_url || '未设置';
            const safeId = escapeAttr(model.id);
            const safeName = escapeHtml(model.name || '未命名');
            const safeType = escapeHtml(typeLabel);
            const safeApiBase = escapeHtml(apiBase);
            const statusNoteHtml = statusNote ? `<div class="status-note">${escapeHtml(statusNote)}</div>` : '';

            html += `
                <tr>
                    <td>${safeName}</td>
                    <td>${safeType}</td>
                    <td>${safeApiBase}</td>
                    <td>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                        ${statusNoteHtml}
                    </td>
                    <td>
                        <button class="btn-icon" title="编辑" onclick="window.settingsManager.editModel('${safeId}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-icon" title="测试" onclick="window.settingsManager.testModel('${safeId}')">
                            <i class="fas fa-plug"></i>
                        </button>
                        <button class="btn-icon danger" title="删除" onclick="window.settingsManager.deleteModel('${safeId}')">
                            <i class="fas fa-trash"></i>
                        </button>
                    </td>
                </tr>
            `;
        });

        tbody.innerHTML = html;
    }

    /**
     * 打开模型配置弹窗
     */
    openModelModal(modelId = null) {
        const modal = document.getElementById('model-modal');
        if (!modal) {
            console.warn('模型模态框元素不存在');
            return;
        }
        
        const title = document.getElementById('model-modal-title');
        if (!title) {
            console.warn('模型模态框标题元素不存在');
            return;
        }
        
        // 获取默认配置
        const defaultApiKey = this.config?.api_key || '';
        const defaultApiBase = this.config?.api_base || 'https://api.openai.com/v1';
        
        const typeSelect = document.getElementById('model-type');
        const apiBaseInput = document.getElementById('model-api-base');
        const apiKeyInput = document.getElementById('model-api-key');
        const nameInput = document.getElementById('model-name');
        const idInput = document.getElementById('model-id');

        if (modelId) {
            // 编辑模式 - 确保模型存在
            const model = this.models.find(m => m.id === modelId);
            if (!model) {
                console.warn(`未找到ID为 ${modelId} 的模型`);
                app.showNotification(`未找到ID为 ${modelId} 的模型`, 'error');
                return; // 如果找不到模型，不打开模态框
            }
            
            // 找到了模型，填充表单
            title.textContent = '编辑模型';
            if (nameInput) nameInput.value = model.name || '';
            if (idInput) idInput.value = model.id || '';
            const modelType = (model.type || model.provider || 'openai').toLowerCase();
            if (typeSelect) {
                typeSelect.disabled = false;
                typeSelect.value = modelType;
            }
            if (apiBaseInput) {
                apiBaseInput.value = model.api_base || model.base_url || defaultApiBase;
            }
            if (apiKeyInput) {
                apiKeyInput.value = model.api_key === 'not-needed' ? '' : (model.api_key || defaultApiKey);
            }
            this.currentEditingModel = modelId;
            this.applyModelTypeHints(modelType);
        } else {
            // 添加模式 - 使用默认值
            title.textContent = '添加模型';
            if (nameInput) nameInput.value = '';
            if (idInput) idInput.value = '';
            if (typeSelect) {
                typeSelect.disabled = false;
                typeSelect.value = 'openai';
            }
            if (apiBaseInput) {
                apiBaseInput.value = defaultApiBase;
            }
            if (apiKeyInput) {
                apiKeyInput.value = defaultApiKey;
            }
            this.currentEditingModel = null;
            this.applyModelTypeHints('openai');
        }
        
        modal.style.display = 'flex';
    }

    /**
     * 关闭模型配置弹窗
     */
    closeModelModal() {
        const modal = document.getElementById('model-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        this.currentEditingModel = null;
        
        // 清空表单（可选，但更安全）
        const nameInput = document.getElementById('model-name');
        const idInput = document.getElementById('model-id');
        const apiBaseInput = document.getElementById('model-api-base');
        const apiKeyInput = document.getElementById('model-api-key');
        if (nameInput) nameInput.value = '';
        if (idInput) idInput.value = '';
        if (apiBaseInput) apiBaseInput.value = '';
        if (apiKeyInput) apiKeyInput.value = '';
    }

    /**
     * 保存模型
     */
    async saveModel() {
        const name = document.getElementById('model-name').value.trim();
        const id = document.getElementById('model-id').value.trim();
        const typeValue = document.getElementById('model-type').value.trim().toLowerCase();
        const apiBaseInput = document.getElementById('model-api-base').value.trim();
        const apiKeyInput = document.getElementById('model-api-key').value.trim();
        const preset = this.getModelPreset(typeValue);

        if (!name || !id) {
            app.showNotification('请填写模型名称和ID', 'error');
            return;
        }

        let apiBase = apiBaseInput || '';
        if (!apiBase && preset.defaultBase) {
            apiBase = preset.defaultBase;
        }
        if (preset.requiresApiBase !== false && !apiBase) {
            app.showNotification('请填写模型的API地址', 'error');
            return;
        }

        let apiKey = apiKeyInput || '';
        if (preset.requiresApiKey && !apiKey) {
            app.showNotification('请填写API密钥', 'error');
            return;
        }
        if (!preset.requiresApiKey && !apiKey) {
            apiKey = 'not-needed';
        }

        const editingId = this.currentEditingModel;
        const existingModel = editingId ? this.models.find(m => m.id === editingId) : null;
        const providerChanged = existingModel && existingModel.provider && existingModel.provider !== preset.provider;
        let modelName = preset.defaultModel || id;
        if (!providerChanged && existingModel?.model_name) {
            modelName = existingModel.model_name;
        }
        const modelData = {
            name,
            id,
            type: typeValue,
            provider: preset.provider,
            api_base: apiBase,
            base_url: apiBase,
            api_key: apiKey,
            model_name: modelName,
            requires_api_key: preset.requiresApiKey ?? true,
            requires_api_base: preset.requiresApiBase ?? true
        };
        if (editingId && existingModel) {
            modelData.last_tested_at = existingModel.last_tested_at || null;
            modelData.last_test_status = existingModel.last_test_status || '';
            modelData.last_test_error = existingModel.last_test_error || '';
        } else {
            modelData.last_tested_at = null;
            modelData.last_test_status = '';
            modelData.last_test_error = '';
        }
        const defaultLitellm = (!providerChanged && existingModel?.litellm_model) ? existingModel.litellm_model : (preset.defaultLitellm || '');
        modelData.litellm_model = defaultLitellm || this.buildLitellmModelId(modelData);

        try {
            if (editingId) {
                // 更新现有模型
                const index = this.models.findIndex(m => m.id === editingId);
                if (index !== -1) {
                    modelData.status = this.models[index].status || 'pending';
                    this.models[index] = this.prepareModelRecord({ ...this.models[index], ...modelData });
                }
            } else {
                // 添加新模型，标记待测试状态
                modelData.status = 'pending';
                this.models.push(this.prepareModelRecord(modelData));
            }

            // 保存到后端
            await api.saveModels(this.models);
            
            // 如果是当前选中的模型，更新全局API配置
            const currentModel = document.getElementById('current-model')?.value;
            if (modelData.id === currentModel || this.models.length === 1) {
                await api.saveConfig({
                    api_key: modelData.api_key === 'not-needed' ? '' : modelData.api_key,
                    api_base: modelData.api_base,
                    default_model: modelData.id
                });
            }
            
            this.renderModelsList();
            this.closeModelModal();
            app.showNotification('模型保存成功', 'success');
            
            // 更新模型选择器（包含通知主应用）
            await this.updateModelSelectors();

            this.testModel(modelData.id);
        } catch (error) {
            app.showNotification('保存模型失败', 'error');
        }
    }

    /**
     * 显示添加模型对话框
     */
    showAddModelDialog() {
        this.openModelModal();
    }

    /**
     * 编辑模型
     */
    editModel(modelId) {
        this.openModelModal(modelId);
    }

    /**
     * 测试模型
     */
    async testModel(modelId, options = {}) {
        const model = this.models.find(m => m.id === modelId);
        if (!model) {
            return { success: false, message: '模型不存在' };
        }

        const { silent = false } = options;
        const preset = this.getModelPreset(model.type);
        const placeholderKeys = new Set([
            '',
            'not-needed',
            'not_needed',
            'notneeded',
            'your-openai-api-key-here',
            'your-api-key-here',
            'sk-your-********here'
        ].map(key => key.toLowerCase()));
        const errors = [];
        if (preset.requiresApiBase !== false) {
            const apiBase = model.api_base || model.base_url;
            if (!apiBase || apiBase.trim().length === 0) {
                errors.push('未配置API地址');
            }
        }
        if (preset.requiresApiKey !== false) {
            const key = (model.api_key || '').trim();
            if (!key || placeholderKeys.has(key.toLowerCase())) {
                errors.push('未配置有效的API密钥');
            }
        }
        if (errors.length > 0) {
            model.status = 'pending';
            model.last_test_status = 'failed';
            model.last_test_error = errors.join('；');
            this.renderModelsList();
            if (!silent) {
                app.showNotification(`模型 ${model.name} 测试失败：${model.last_test_error}`, 'error');
            }
            try {
                await api.saveModels(this.models);
            } catch (saveError) {
                console.warn('保存模型测试结果失败:', saveError);
            }
            return { success: false, message: model.last_test_error };
        }

        if (!silent) {
            app.showNotification(window.i18nManager.t('common.testingModel'), 'info');
        }
        
        // 更新状态为测试中
        model.status = 'testing';
        model.last_test_status = 'testing';
        model.last_test_error = '';
        this.renderModelsList();

        let result;
        try {
            result = await api.testModel({
                model: model.id,
                id: model.id,
                api_key: model.api_key === 'not-needed' ? '' : model.api_key,
                api_base: model.api_base || model.base_url,
                provider: model.provider || model.type,
                type: model.type,
                model_name: model.model_name || model.id,
                litellm_model: model.litellm_model
            });

            if (result.success) {
                model.status = 'active';
                model.last_test_status = 'success';
                model.last_test_error = '';
            } else {
                model.status = 'inactive';
                model.last_test_status = 'failed';
                model.last_test_error = result.message || '';
            }
        } catch (error) {
            result = {
                success: false,
                message: error?.message || '连接失败'
            };
            model.status = 'inactive';
            model.last_test_status = 'failed';
            model.last_test_error = result.message;
        }

        model.last_tested_at = new Date().toISOString();
        try {
            await api.saveModels(this.models);
        } catch (saveError) {
            console.warn('保存模型测试结果失败:', saveError);
        }

        this.renderModelsList();

        if (!silent) {
            if (result?.success) {
                app.showNotification(`模型 ${model.name} 连接成功！`, 'success');
            } else {
                app.showNotification(`模型 ${model.name} 连接失败: ${model.last_test_error || '未知错误'}`, 'error');
            }
        }

        return result || { success: model.status === 'active', message: model.last_test_error };
    }

    async testAllModels() {
        if (!this.models || this.models.length === 0) {
            app.showNotification('没有可测试的模型', 'info');
            return;
        }

        const button = document.getElementById('test-all-models-btn');
        if (button) {
            button.disabled = true;
            button.classList.add('is-loading');
        }

        const results = [];
        try {
            for (const model of this.models) {
                try {
                    const result = await this.testModel(model.id, { silent: true });
                    results.push({ id: model.id, name: model.name, success: !!result?.success, message: result?.message || model.last_test_error });
                } catch (error) {
                    results.push({ id: model.id, name: model.name, success: false, message: error?.message || '未知错误' });
                }
            }
        } finally {
            if (button) {
                button.disabled = false;
                button.classList.remove('is-loading');
            }
        }

        const failed = results.filter(item => !item.success);
        if (failed.length === 0) {
            app.showNotification(`已完成 ${results.length} 个模型的连通性测试`, 'success');
        } else {
            const names = failed.map(item => item.name || item.id).join('、');
            app.showNotification(`测试完成，${failed.length}/${results.length} 个模型失败：${names}`, 'warning');
        }
    }

    /**
     * 删除模型
     */
    async deleteModel(modelId) {
        if (!confirm('确定要删除这个模型吗？')) return;

        const index = this.models.findIndex(m => m.id === modelId);
        if (index !== -1) {
            this.models.splice(index, 1);
            
            try {
                await api.saveModels(this.models);
                this.renderModelsList();
                app.showNotification('模型已删除', 'success');
                
                // 更新模型选择器（包含通知主应用）
                await this.updateModelSelectors();
            } catch (error) {
                app.showNotification('删除模型失败', 'error');
            }
        }
    }

    /**
     * 更新模型选择器
     */
    async updateModelSelectors() {
        try {
            // 重新从后端加载模型列表，确保数据同步
            await this.loadModels();
            
            // 先通知主应用重新加载模型列表
            if (window.app && typeof window.app.loadModels === 'function') {
                await window.app.loadModels();
            }
            
            // 更新设置页面的选择器
            const selectors = ['default-model'];
            selectors.forEach(selectorId => {
                const selector = document.getElementById(selectorId);
                if (selector) {
                    const currentValue = selector.value;
                    selector.innerHTML = '';
                    
                    this.models.forEach(model => {
                        if (model.status === 'active' || model.status === undefined) {
                            const option = document.createElement('option');
                            option.value = model.id;
                            option.textContent = model.name;
                            selector.appendChild(option);
                        }
                    });
                    
                    // 恢复之前的选择
                    if (currentValue && selector.querySelector(`option[value="${currentValue}"]`)) {
                        selector.value = currentValue;
                    }
                }
            });
            
            console.log('模型选择器已更新，当前模型列表:', this.models);
        } catch (error) {
            console.error('更新模型选择器失败:', error);
        }
    }

    /**
     * 保存基础设置
     */
    async saveBasicSettings() {
        console.log('saveBasicSettings 被调用');
        
        // 添加空值检查，避免元素不存在导致的错误
        const defaultModelElement = document.getElementById('default-model');
        const defaultViewModeElement = document.getElementById('default-view-mode');
        const contextRoundsElement = document.getElementById('context-rounds');
        
        // 从现有配置或默认值获取
        const settings = {
            default_model: defaultModelElement?.value || this.config?.default_model || 'gpt-5',
            default_view_mode: defaultViewModeElement?.value || this.config?.default_view_mode || 'dual',
            context_rounds: parseInt(contextRoundsElement?.value) || this.config?.context_rounds || 3
        };
        
        console.log('要保存的设置:', settings);

        try {
            // 先获取最新的后端配置，确保不丢失关键字段
            let currentConfig = {};
            try {
                const configResponse = await fetch('/api/config');
                if (configResponse.ok) {
                    currentConfig = await configResponse.json();
                }
            } catch (e) {
                console.warn('获取当前配置失败，使用本地配置:', e);
                currentConfig = this.config || {};
            }
            
            // 构建完整的配置对象，保留所有必要字段
            const configToSave = {
                ...currentConfig,  // 保留现有的所有配置（包括 api_key, api_base 等）
                ...settings        // 覆盖基础设置字段
            };
            
            console.log('准备保存的完整配置:', configToSave);
            
            // 保存到后端API
            const response = await fetch('/api/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(configToSave)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('后端返回错误:', errorText);
                throw new Error(`保存配置失败: ${response.status}`);
            }
            
            // 更新本地配置副本
            if (!this.config) {
                this.config = {};
            }
            Object.assign(this.config, settings);
            
            // 保存到本地存储作为备份
            localStorage.setItem('basic_settings', JSON.stringify(settings));
            // 也单独保存 default_model 以便 API 调用时使用
            localStorage.setItem('default_model', settings.default_model);
            
            // 更新应用的上下文轮数设置
            if (window.app) {
                window.app.contextRounds = settings.context_rounds;
                // 更新默认视图模式
                window.app.currentViewMode = settings.default_view_mode;
                localStorage.setItem('view_mode', settings.default_view_mode);
                // 更新应用配置中的默认模型
                if (window.app.config) {
                    window.app.config.default_model = settings.default_model;
                }
            }
            
            // 显示成功通知
            app.showNotification('基础设置已保存', 'success');
        } catch (error) {
            console.error('保存设置失败:', error);
            app.showNotification('保存设置失败', 'error');
        }
    }

    /**
     * 测试数据库连接
     */
    async testDatabaseConnection() {
        const config = {
            host: document.getElementById('db-host').value,
            port: document.getElementById('db-port').value,
            user: document.getElementById('db-user').value,
            password: document.getElementById('db-password').value,
            database: document.getElementById('db-name').value
        };

        config.host = (config.host || '').trim();
        if (!config.host) {
            config.host = '127.0.0.1';
        }
        if (config.host.toLowerCase() === 'localhost') {
            config.host = '127.0.0.1';
        }
        config.port = parseInt(config.port, 10) || 3306;

        document.getElementById('db-host').value = config.host;
        document.getElementById('db-port').value = String(config.port);

        app.showNotification(window.i18nManager.t('common.testingDatabase'), 'info');

        try {
            const result = await api.testDatabase(config);
            const statusBox = document.getElementById('db-connection-status');
            
            if (result.success) {
                statusBox.className = 'connection-status-box';
                statusBox.querySelector('.status-icon').innerHTML = '<i class="fas fa-check-circle"></i>';
                statusBox.querySelector('h4').textContent = '连接成功';
                statusBox.querySelector('p').innerHTML = `数据库连接正常，共发现 <span id="table-count">${result.table_count || 0}</span> 个表`;
                statusBox.style.display = 'flex';
                
                app.showNotification('数据库连接成功！', 'success');
            } else {
                statusBox.className = 'connection-status-box error';
                statusBox.querySelector('.status-icon').innerHTML = '<i class="fas fa-times-circle"></i>';
                statusBox.querySelector('h4').textContent = '连接失败';
                statusBox.querySelector('p').textContent = result.message || '无法连接到数据库';
                statusBox.style.display = 'flex';
                
                app.showNotification(`连接失败: ${result.message}`, 'error');
            }
        } catch (error) {
            app.showNotification('连接测试失败', 'error');
        }
    }

    /**
     * 保存数据库配置
     */
    async saveDatabaseConfig() {
        const config = {
            host: document.getElementById('db-host').value,
            port: document.getElementById('db-port').value,
            user: document.getElementById('db-user').value,
            password: document.getElementById('db-password').value,
            database: document.getElementById('db-name').value
        };

        config.host = (config.host || '').trim();
        if (!config.host) {
            config.host = '127.0.0.1';
        }
        if (config.host.toLowerCase() === 'localhost') {
            config.host = '127.0.0.1';
        }
        config.port = parseInt(config.port, 10) || 3306;

        document.getElementById('db-host').value = config.host;
        document.getElementById('db-port').value = String(config.port);

        try {
            await api.saveDatabaseConfig(config);
            this.config = this.config || {};
            this.config.database = {
                ...config,
                configured: true
            };
            if (window.app) {
                window.app.config = window.app.config || {};
                window.app.config.database = this.config.database;
            }
            app.showNotification('数据库配置已保存', 'success');
        } catch (error) {
            app.showNotification('保存配置失败', 'error');
        }
    }


    /**
     * 保存系统设置
     */
    async saveSystemSettings() {
        const settings = {
            query_timeout: parseInt(document.getElementById('query-timeout').value),
            api_timeout: parseInt(document.getElementById('api-timeout').value),
            enable_cache: document.getElementById('enable-cache').checked,
            cache_ttl: parseInt(document.getElementById('cache-ttl').value),
            log_level: document.getElementById('log-level').value,
            save_logs: document.getElementById('save-logs').checked
        };

        try {
            await api.saveSystemSettings(settings);
            localStorage.setItem('system_settings', JSON.stringify(settings));
            app.showNotification('系统参数已保存', 'success');
        } catch (error) {
            app.showNotification('保存失败', 'error');
        }
    }

    /**
     * 清空缓存
     */
    async clearCache() {
        try {
            await api.clearCache();
            app.showNotification('缓存已清空', 'success');
        } catch (error) {
            app.showNotification('清空缓存失败', 'error');
        }
    }


    /**
     * 加载设置
     */
    async loadSettings() {
        try {
            // 优先从后端配置加载设置
            if (this.config) {
                // 加载后端配置中的基础设置
                if (this.config.default_model) {
                    const defaultModelSelect = document.getElementById('default-model');
                    if (defaultModelSelect) {
                        defaultModelSelect.value = this.config.default_model;
                    }
                }
                if (this.config.default_view_mode) {
                    const defaultViewModeSelect = document.getElementById('default-view-mode');
                    if (defaultViewModeSelect) {
                        defaultViewModeSelect.value = this.config.default_view_mode;
                    }
                }
                if (this.config.context_rounds !== undefined) {
                    const contextRoundsSelect = document.getElementById('context-rounds');
                    if (contextRoundsSelect) {
                        contextRoundsSelect.value = this.config.context_rounds;
                        console.log('从后端配置加载 context_rounds:', this.config.context_rounds);
                    }
                    // 同时更新应用的 contextRounds
                    if (window.app) {
                        window.app.contextRounds = this.config.context_rounds;
                        console.log('更新 app.contextRounds 为:', this.config.context_rounds);
                    }
                }

                if (this.config.database) {
                    const dbConfig = this.config.database;
                    const applyValue = (id, value, fallback = '') => {
                        const input = document.getElementById(id);
                        if (!input) return;
                        const finalValue = value !== undefined && value !== null && value !== ''
                            ? value
                            : fallback;
                        if (finalValue !== undefined && finalValue !== null) {
                            input.value = String(finalValue);
                        }
                    };
                    const normalizedHost = dbConfig.host === 'localhost' ? '127.0.0.1' : (dbConfig.host || '127.0.0.1');
                    const normalizedDbName = dbConfig.configured === false ? '' : (dbConfig.database || '');
                    applyValue('db-host', normalizedHost, '127.0.0.1');
                    applyValue('db-port', dbConfig.port, '3306');
                    applyValue('db-user', dbConfig.user, '');
                    applyValue('db-password', dbConfig.password, '');
                    applyValue('db-name', normalizedDbName, '');

                    if (window.app) {
                        window.app.config = window.app.config || {};
                        window.app.config.database = {
                            ...dbConfig,
                            host: normalizedHost,
                            database: normalizedDbName,
                            configured: dbConfig.configured !== undefined ? dbConfig.configured : true
                        };
                    }
                }
            }
            
            // 如果后端配置中没有，再从localStorage加载
            const basicSettings = JSON.parse(localStorage.getItem('basic_settings') || '{}');
            if (!this.config || this.config.default_model === undefined) {
                if (basicSettings.default_model) {
                    const defaultModelSelect = document.getElementById('default-model');
                    if (defaultModelSelect) {
                        defaultModelSelect.value = basicSettings.default_model;
                    }
                }
            }
            if (!this.config || this.config.default_view_mode === undefined) {
                if (basicSettings.default_view_mode) {
                    const defaultViewModeSelect = document.getElementById('default-view-mode');
                    if (defaultViewModeSelect) {
                        defaultViewModeSelect.value = basicSettings.default_view_mode;
                    }
                }
            }
            if (!this.config || this.config.context_rounds === undefined) {
                if (basicSettings.context_rounds !== undefined) {
                    const contextRoundsSelect = document.getElementById('context-rounds');
                    if (contextRoundsSelect) {
                        contextRoundsSelect.value = basicSettings.context_rounds;
                        console.log('从localStorage加载 context_rounds:', basicSettings.context_rounds);
                    }
                    // 同时更新应用的 contextRounds
                    if (window.app) {
                        window.app.contextRounds = basicSettings.context_rounds;
                        console.log('更新 app.contextRounds 为:', basicSettings.context_rounds);
                    }
                }
            }

            // 加载系统设置
            const systemSettings = JSON.parse(localStorage.getItem('system_settings') || '{}');
            if (systemSettings.query_timeout) {
                document.getElementById('query-timeout').value = systemSettings.query_timeout;
            }
            if (systemSettings.api_timeout) {
                document.getElementById('api-timeout').value = systemSettings.api_timeout;
            }
            if (systemSettings.enable_cache !== undefined) {
                document.getElementById('enable-cache').checked = systemSettings.enable_cache;
            }
            if (systemSettings.cache_ttl) {
                document.getElementById('cache-ttl').value = systemSettings.cache_ttl;
            }
            if (systemSettings.log_level) {
                document.getElementById('log-level').value = systemSettings.log_level;
            }
            if (systemSettings.save_logs !== undefined) {
                document.getElementById('save-logs').checked = systemSettings.save_logs;
            }
        } catch (error) {
            console.error('加载设置失败:', error);
        }
    }

    /**
     * 首次访问时批量测试所有模型
     */
    async testAllModelsOnFirstVisit() {
        this.hasTestedModels = true;  // 标记已测试，避免重复测试
        
        if (!this.models || this.models.length === 0) {
            return;
        }
        
        console.log('首次进入模型管理页面，开始批量测试所有模型...');
        
        // 先将所有模型设置为测试中状态
        this.models.forEach(model => {
            model.status = 'testing';
        });
        this.renderModelsList();
        
        // 并行测试所有模型，不显示通知避免干扰
        const testPromises = this.models.map(async (model) => {
            try {
                const result = await api.testModel({
                    model: model.id,
                    api_key: model.api_key || 'not_needed',
                    api_base: model.api_base
                });
                
                // 更新模型状态
                if (result.success) {
                    model.status = 'active';
                    console.log(`模型 ${model.name} 测试成功`);
                } else {
                    model.status = 'inactive';
                    console.log(`模型 ${model.name} 测试失败: ${result.message}`);
                }
            } catch (error) {
                model.status = 'inactive';
                console.log(`模型 ${model.name} 测试出错:`, error);
            }
            
            // 每个模型测试完立即更新界面
            this.renderModelsList();
        });
        
        // 等待所有测试完成
        await Promise.allSettled(testPromises);
        
        // 保存状态到后端
        try {
            await api.saveModels(this.models);
        } catch (error) {
            console.error('保存模型状态失败:', error);
        }
        
        console.log('批量测试完成');
    }
    
    /**
     * 设置智能路由开关
     */
    setupSmartRoutingToggle() {
        const toggle = document.getElementById('smart-routing-toggle');
        const routingGroup = document.querySelector('.smart-routing-group');
        const statusText = document.querySelector('.status-text');
        const statusIcon = document.querySelector('.status-icon');
        
        if (toggle) {
            // 加载保存的状态
            const savedState = localStorage.getItem('smart_routing_enabled');
            if (savedState !== null) {
                toggle.checked = savedState === 'true';
                this.updateRoutingUI(toggle.checked);
            }
            
            // 设置折叠功能
            this.setupCollapsibleSections();
            
            // 更新状态
            this.updateSmartRoutingState(toggle.checked);
            
            // 监听开关变化
            toggle.addEventListener('change', async () => {
                const enabled = toggle.checked;
                
                // 更新UI状态
                this.updateSmartRoutingState(enabled);
                this.updateRoutingUI(enabled);
                
                // 保存到后端
                try {
                    const response = await fetch('/api/config', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            features: {
                                smart_routing: {
                                    enabled: enabled
                                }
                            }
                        })
                    });
                    
                    if (response.ok) {
                        localStorage.setItem('smart_routing_enabled', enabled.toString());
                        app.showNotification(
                            enabled ? '智能路由已启用' : '智能路由已关闭',
                            'success'
                        );
                    }
                } catch (error) {
                    console.error('更新智能路由状态失败:', error);
                    toggle.checked = !enabled; // 恢复原状态
                    this.updateSmartRoutingState(!enabled);
                    this.updateRoutingUI(!enabled);
                    app.showNotification('更新失败，请重试', 'error');
                }
            });
        }
    }
    
    /**
     * 更新路由UI状态
     */
    updateRoutingUI(enabled) {
        const statusText = document.getElementById('routing-status-text');
        
        if (statusText) {
            statusText.textContent = enabled ? '已启用' : '已禁用';
            statusText.setAttribute('data-i18n', enabled ? 'settings.smartRoutingEnabled' : 'settings.smartRoutingDisabled');
            statusText.style.color = enabled ? '#4CAF50' : '#dc3545';
        }
    }
    
    /**
     * 设置折叠部分的功能
     */
    setupCollapsibleSections() {
        // 为所有可折叠的标题添加点击事件
        document.querySelectorAll('.collapsible-header').forEach(header => {
            const content = header.nextElementSibling;
            if (content && content.classList.contains('collapsible-content')) {
                // 默认展开状态
                header.classList.remove('collapsed');
                content.classList.remove('collapsed');
                
                // 添加点击事件
                header.addEventListener('click', (e) => {
                    e.preventDefault();
                    header.classList.toggle('collapsed');
                    content.classList.toggle('collapsed');
                    
                    // 保存折叠状态到localStorage
                    const sectionId = header.closest('.prompt-section')?.id;
                    if (sectionId) {
                        const isCollapsed = header.classList.contains('collapsed');
                        localStorage.setItem(`collapsed_${sectionId}`, isCollapsed);
                    }
                });
                
                // 恢复保存的折叠状态
                const sectionId = header.closest('.prompt-section')?.id;
                if (sectionId) {
                    const savedState = localStorage.getItem(`collapsed_${sectionId}`);
                    if (savedState === 'true') {
                        header.classList.add('collapsed');
                        content.classList.add('collapsed');
                    }
                }
            }
        });
    }
    
    /**
     * 更新智能路由相关UI状态
     */
    updateSmartRoutingState(enabled) {
        const toggleLabel = document.querySelector('.toggle-label');
        const routingPrompts = document.querySelectorAll('.routing-prompt');
        
        // 更新标签文本
        if (toggleLabel) {
            toggleLabel.textContent = enabled ? '已启用' : '已关闭';
            toggleLabel.style.color = enabled ? '#4CAF50' : '#999';
        }
        
        // 更新prompt编辑权限
        routingPrompts.forEach(textarea => {
            textarea.disabled = !enabled;
            if (!enabled) {
                textarea.classList.add('readonly-notice');
                textarea.title = '智能路由已关闭，提示词为只读状态';
            } else {
                textarea.classList.remove('readonly-notice');
                textarea.title = '';
            }
        });
    }
    
    /**
     * 设置Prompt相关事件
     */
    setupPromptEvents() {
        // 保存Prompt设置
        const savePromptsBtn = document.getElementById('save-prompts');
        if (savePromptsBtn) {
            savePromptsBtn.addEventListener('click', () => this.savePromptSettings());
        }
        
        // 恢复默认Prompt
        const resetPromptsBtn = document.getElementById('reset-prompts');
        if (resetPromptsBtn) {
            resetPromptsBtn.addEventListener('click', () => this.resetPromptSettings());
        }
        
        // 导出Prompt配置
        const exportPromptsBtn = document.getElementById('export-prompts');
        if (exportPromptsBtn) {
            exportPromptsBtn.addEventListener('click', () => this.exportPromptSettings());
        }
        
        // 导入Prompt配置
        const importPromptsBtn = document.getElementById('import-prompts');
        if (importPromptsBtn) {
            importPromptsBtn.addEventListener('click', () => this.importPromptSettings());
        }
        
        // 加载保存的Prompt设置
        this.loadPromptSettings();
        
        // 初始化折叠功能（在Prompt设置加载后）
        setTimeout(() => {
            this.setupCollapsibleSections();
        }, 100);
    }
    
    /**
     * 获取默认Prompt设置
     */
    getDefaultPromptSettings() {
        return {
            routing: `你是一个查询路由分类器。分析用户查询，选择最适合的执行路径，并仅输出规范 JSON。

用户查询：{query}

数据库信息：
- 类型：{db_type}
- 可用表：{available_tables}

请从以下路由中选择其一：

1. QA
   - 适用：闲聊、与数据库无关的问题
   - 输出：礼貌拒绝并引导用户提供数据库需求
   - 不执行 SQL 或代码

2. SQL_ONLY
   - 适用：明确的取数需求、基础聚合、筛选或排序
   - 要求：生成 SQL、执行前后给出步骤说明；允许必要的库表探索
   - 不绘图、不安装额外库

3. ANALYSIS
   - 适用：复杂分析、可视化、趋势研判或需要多步脚本的任务
   - 允许：执行 Python、生成图表，安装库需先征得用户同意

如判断输入与数据库无关，应选择 QA。
如请求不完整但可能涉及数据查询，可倾向 SQL_ONLY，并在 reason 中说明缺失信息。

输出 JSON（仅此内容）：
{
  "route": "QA | SQL_ONLY | ANALYSIS",
  "confidence": 0.0-1.0,
  "reason": "简要说明判断依据",
  "suggested_plan": ["步骤1", "步骤2"],
  "suggested_sql": "如为 SQL_ONLY，可提供建议 SQL"
}

若无法判定，请将 route 设置为 "ANALYSIS" 并说明原因。`,

            qaPrompt: `你是一个数据库助手。当用户提问与数据库或分析无关时，请礼貌拒绝并引导用户提供需要查询的表、指标或时间范围。`,

            sqlOnlyPrompt: `你是一个SQL快速核查助手：
1. 仅执行只读SQL，禁止生成图表或保存文件
2. 每个操作前输出“步骤说明”，确认所用库表与字段
3. 执行后报告记录数与耗时，对空结果或异常值给出提示
4. 如信息不足，请先向用户澄清`,

            analysisPrompt: `你是一个数据分析助手：
1. 在每个动作前输出“步骤说明”
2. 使用pandas处理数据，必要时用plotly绘图并保存到output目录
3. 保证操作安全：数据库只读；安装依赖需获得用户许可
4. 分析结束后总结发现、局限与建议`,

            // 兼容旧字段
            directSql: '',
            aiAnalysis: '',
            
            exploration: `先理解用户需求中的业务语义：
* "销量"通常指实际销售数量（sale_num/sale_qty/quantity）
* "七折销量"：销量字段 * 0.7
* "订单金额"指实际成交金额（knead_pay_amount/pay_amount）

数据库选择优先级：
* 优先探索数据仓库：center_dws > dws > dwh > dw
* 其次考虑：ods（原始数据）> ads（汇总数据）`,
            
            tableSelection: `优先选择包含：trd/trade/order/sale + detail/day 的表（交易明细表）
避免：production/forecast/plan/budget（计划类表）
检查表数据量和日期范围，确保包含所需时间段`,
            
            fieldMapping: `月份字段：v_month > month > year_month > year_of_month
销量字段：sale_num > sale_qty > quantity > qty
金额字段：pay_amount > order_amount > total_amount`,
            
            dataProcessing: `Decimal类型需转换为float进行计算
日期格式统一处理（如 '2025-01' 格式）
如果发现负销量或异常值，在SQL中用WHERE条件过滤`,
            
            outputRequirements: `使用 plotly 生成可视化图表
将 HTML 文件保存到 output 目录
提供简洁的总结，包括完成的任务和关键发现`
            ,
            // 高级Prompt默认
            summarization: '基于分析结果，用2–4句中文业务语言总结关键发现、趋势或异常，避免技术细节。',
            errorHandling: '当出现错误时，先识别错误类型（连接/权限/语法/超时），用中文简洁解释并给出下一步建议，避免输出堆栈与敏感信息。',
            visualization: '根据数据特征选择合适的可视化类型（柱/线/饼/散点等），使用中文标题与轴标签，保存为HTML至output目录。',
            dataAnalysis: '进行数据清洗、聚合、对比、趋势与异常分析，确保结果可解释与复现，必要时输出方法与局限说明（中文）。',
            sqlGeneration: '从自然语言与schema生成只读SQL，遵循只读限制（SELECT/SHOW/DESCRIBE/EXPLAIN），避免危险语句与全表扫描。',
            codeReview: '对将要执行的代码进行安全与必要性检查，避免长时/不必要操作，给出简洁优化建议（中文）。',
            progressPlanner: '将当前执行阶段总结为不超过10字的中文短语，面向非技术用户，如“连接数据库”“查询数据”“生成图表”。'
        };
    }
    
    /**
     * 保存Prompt设置
     */
    async savePromptSettings() {
        const defaults = this.getDefaultPromptSettings();
        const promptSettings = {
            routing: document.getElementById('prompt-routing')?.value || defaults.routing,
            qaPrompt: document.getElementById('prompt-qa')?.value || defaults.qaPrompt,
            sqlOnlyPrompt: document.getElementById('prompt-sql-only')?.value || defaults.sqlOnlyPrompt,
            analysisPrompt: document.getElementById('prompt-analysis')?.value || defaults.analysisPrompt,
            // 兼容旧版本字段
            directSql: document.getElementById('prompt-sql-only')?.value || defaults.sqlOnlyPrompt,
            aiAnalysis: document.getElementById('prompt-analysis')?.value || defaults.analysisPrompt,
            exploration: document.getElementById('prompt-exploration').value,
            tableSelection: document.getElementById('prompt-table-selection').value,
            fieldMapping: document.getElementById('prompt-field-mapping').value,
            dataProcessing: document.getElementById('prompt-data-processing').value,
            outputRequirements: document.getElementById('prompt-output-requirements').value,
            summarization: document.getElementById('prompt-summarization')?.value || defaults.summarization,
            errorHandling: document.getElementById('prompt-error-handling')?.value || defaults.errorHandling,
            visualization: document.getElementById('prompt-visualization')?.value || defaults.visualization,
            dataAnalysis: document.getElementById('prompt-data-analysis')?.value || defaults.dataAnalysis,
            sqlGeneration: document.getElementById('prompt-sql-generation')?.value || defaults.sqlGeneration,
            codeReview: document.getElementById('prompt-code-review')?.value || defaults.codeReview,
            progressPlanner: document.getElementById('prompt-progress-planner')?.value || defaults.progressPlanner
        };
        
        try {
            // 保存到后端
            const response = await fetch('/api/prompts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(promptSettings)
            });
            
            if (response.ok) {
                const resp = await response.json();
                const saved = resp.prompts || promptSettings;
                // 保存到本地存储
                localStorage.setItem('prompt_settings', JSON.stringify(saved));
                // 立即刷新界面，确保与后端一致
                await this.loadPromptSettings();
                app.showNotification(resp.message || 'Prompt设置已保存', 'success');
            } else {
                throw new Error('保存失败');
            }
        } catch (error) {
            console.error('保存Prompt设置失败:', error);
            // 即使后端保存失败，也保存到本地
            localStorage.setItem('prompt_settings', JSON.stringify(promptSettings));
            app.showNotification('Prompt设置已保存到本地', 'info');
        }
    }
    
    /**
     * 恢复默认Prompt设置
     */
    async resetPromptSettings() {
        if (!confirm('确定要恢复默认的Prompt设置吗？当前的修改将会丢失。')) {
            return;
        }
        
        const defaultSettings = this.getDefaultPromptSettings();
        
        // 更新界面
        if (document.getElementById('prompt-routing')) {
            document.getElementById('prompt-routing').value = defaultSettings.routing;
        }
        const qaEl = document.getElementById('prompt-qa'); if (qaEl) qaEl.value = defaultSettings.qaPrompt;
        const sqlEl = document.getElementById('prompt-sql-only'); if (sqlEl) sqlEl.value = defaultSettings.sqlOnlyPrompt;
        const analysisEl = document.getElementById('prompt-analysis'); if (analysisEl) analysisEl.value = defaultSettings.analysisPrompt;
        document.getElementById('prompt-exploration').value = defaultSettings.exploration;
        document.getElementById('prompt-table-selection').value = defaultSettings.tableSelection;
        document.getElementById('prompt-field-mapping').value = defaultSettings.fieldMapping;
        document.getElementById('prompt-data-processing').value = defaultSettings.dataProcessing;
        document.getElementById('prompt-output-requirements').value = defaultSettings.outputRequirements;
        
        // 保存默认设置
        try {
            const response = await fetch('/api/prompts/reset', {
                method: 'POST'
            });
            
            if (response.ok) {
                const resp = await response.json();
                const saved = resp.prompts || defaultSettings;
                localStorage.setItem('prompt_settings', JSON.stringify(saved));
                // 刷新界面
                await this.loadPromptSettings();
                app.showNotification(resp.message || '已恢复默认Prompt设置', 'success');
            }
        } catch (error) {
            console.error('恢复默认设置失败:', error);
            localStorage.setItem('prompt_settings', JSON.stringify(defaultSettings));
            app.showNotification('已恢复默认Prompt设置（本地）', 'info');
        }
    }
    
    /**
     * 导出Prompt设置
     */
    exportPromptSettings() {
        const d = this.getDefaultPromptSettings();
        const promptSettings = {
            routing: document.getElementById('prompt-routing')?.value || d.routing,
            qaPrompt: document.getElementById('prompt-qa')?.value || d.qaPrompt,
            sqlOnlyPrompt: document.getElementById('prompt-sql-only')?.value || d.sqlOnlyPrompt,
            analysisPrompt: document.getElementById('prompt-analysis')?.value || d.analysisPrompt,
            directSql: document.getElementById('prompt-sql-only')?.value || d.sqlOnlyPrompt,
            aiAnalysis: document.getElementById('prompt-analysis')?.value || d.analysisPrompt,
            exploration: document.getElementById('prompt-exploration').value,
            tableSelection: document.getElementById('prompt-table-selection').value,
            fieldMapping: document.getElementById('prompt-field-mapping').value,
            dataProcessing: document.getElementById('prompt-data-processing').value,
            outputRequirements: document.getElementById('prompt-output-requirements').value,
            summarization: document.getElementById('prompt-summarization')?.value || d.summarization,
            errorHandling: document.getElementById('prompt-error-handling')?.value || d.errorHandling,
            visualization: document.getElementById('prompt-visualization')?.value || d.visualization,
            dataAnalysis: document.getElementById('prompt-data-analysis')?.value || d.dataAnalysis,
            sqlGeneration: document.getElementById('prompt-sql-generation')?.value || d.sqlGeneration,
            codeReview: document.getElementById('prompt-code-review')?.value || d.codeReview,
            progressPlanner: document.getElementById('prompt-progress-planner')?.value || d.progressPlanner,
            exportTime: new Date().toISOString()
        };
        
        // 创建下载链接
        const dataStr = JSON.stringify(promptSettings, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `prompt_settings_${new Date().getTime()}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
        
        app.showNotification('Prompt配置已导出', 'success');
    }
    
    /**
     * 导入Prompt设置
     */
    importPromptSettings() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            
            try {
                const text = await file.text();
                const settings = JSON.parse(text);
                
                // 验证导入的数据
                if (settings.routing !== undefined) {
                    const el = document.getElementById('prompt-routing'); if (el) el.value = settings.routing;
                }
                if (settings.qaPrompt !== undefined) {
                    const el = document.getElementById('prompt-qa'); if (el) el.value = settings.qaPrompt;
                }
                if (settings.sqlOnlyPrompt !== undefined) {
                    const el = document.getElementById('prompt-sql-only'); if (el) el.value = settings.sqlOnlyPrompt;
                } else if (settings.directSql !== undefined) {
                    const el = document.getElementById('prompt-sql-only'); if (el) el.value = settings.directSql;
                }
                if (settings.analysisPrompt !== undefined) {
                    const el = document.getElementById('prompt-analysis'); if (el) el.value = settings.analysisPrompt;
                } else if (settings.aiAnalysis !== undefined) {
                    const el = document.getElementById('prompt-analysis'); if (el) el.value = settings.aiAnalysis;
                }
                if (settings.exploration !== undefined) {
                    document.getElementById('prompt-exploration').value = settings.exploration;
                }
                if (settings.tableSelection !== undefined) {
                    document.getElementById('prompt-table-selection').value = settings.tableSelection;
                }
                if (settings.fieldMapping !== undefined) {
                    document.getElementById('prompt-field-mapping').value = settings.fieldMapping;
                }
                if (settings.dataProcessing !== undefined) {
                    document.getElementById('prompt-data-processing').value = settings.dataProcessing;
                }
                if (settings.outputRequirements !== undefined) {
                    document.getElementById('prompt-output-requirements').value = settings.outputRequirements;
                }
                if (settings.summarization !== undefined) {
                    const el = document.getElementById('prompt-summarization'); if (el) el.value = settings.summarization;
                }
                if (settings.errorHandling !== undefined) {
                    const el = document.getElementById('prompt-error-handling'); if (el) el.value = settings.errorHandling;
                }
                if (settings.visualization !== undefined) {
                    const el = document.getElementById('prompt-visualization'); if (el) el.value = settings.visualization;
                }
                if (settings.dataAnalysis !== undefined) {
                    const el = document.getElementById('prompt-data-analysis'); if (el) el.value = settings.dataAnalysis;
                }
                if (settings.sqlGeneration !== undefined) {
                    const el = document.getElementById('prompt-sql-generation'); if (el) el.value = settings.sqlGeneration;
                }
                if (settings.codeReview !== undefined) {
                    const el = document.getElementById('prompt-code-review'); if (el) el.value = settings.codeReview;
                }
                if (settings.progressPlanner !== undefined) {
                    const el = document.getElementById('prompt-progress-planner'); if (el) el.value = settings.progressPlanner;
                }
                
                app.showNotification('Prompt配置已导入', 'success');
                
                // 自动保存导入的设置
                this.savePromptSettings();
            } catch (error) {
                console.error('导入失败:', error);
                app.showNotification('导入配置失败，请检查文件格式', 'error');
            }
        };
        
        input.click();
    }
    
    /**
     * 加载Prompt设置
     */
    async loadPromptSettings() {
        try {
            // 尝试从后端加载
            const response = await fetch('/api/prompts');
            let settings;
            
            if (response.ok) {
                settings = await response.json();
            } else {
                // 从本地存储加载
                const savedSettings = localStorage.getItem('prompt_settings');
                settings = savedSettings ? JSON.parse(savedSettings) : this.getDefaultPromptSettings();
            }
            
            // 更新界面
            if (document.getElementById('prompt-exploration')) {
                const defaults = this.getDefaultPromptSettings();
                
                // 路由相关prompt
                if (document.getElementById('prompt-routing')) {
                    document.getElementById('prompt-routing').value = settings.routing || defaults.routing;
                }
                if (document.getElementById('prompt-qa')) {
                    document.getElementById('prompt-qa').value = settings.qaPrompt || defaults.qaPrompt;
                }
                if (document.getElementById('prompt-sql-only')) {
                    const sqlPrompt = settings.sqlOnlyPrompt || settings.directSql || defaults.sqlOnlyPrompt;
                    document.getElementById('prompt-sql-only').value = sqlPrompt;
                }
                if (document.getElementById('prompt-analysis')) {
                    const analysisPrompt = settings.analysisPrompt || settings.aiAnalysis || defaults.analysisPrompt;
                    document.getElementById('prompt-analysis').value = analysisPrompt;
                }
                
                // 数据库相关prompt
                document.getElementById('prompt-exploration').value = settings.exploration || defaults.exploration;
                document.getElementById('prompt-table-selection').value = settings.tableSelection || defaults.tableSelection;
                document.getElementById('prompt-field-mapping').value = settings.fieldMapping || defaults.fieldMapping;
                document.getElementById('prompt-data-processing').value = settings.dataProcessing || defaults.dataProcessing;
                document.getElementById('prompt-output-requirements').value = settings.outputRequirements || defaults.outputRequirements;

                // 高级Prompt
                if (document.getElementById('prompt-summarization')) {
                    document.getElementById('prompt-summarization').value = settings.summarization || defaults.summarization;
                }
                if (document.getElementById('prompt-error-handling')) {
                    document.getElementById('prompt-error-handling').value = settings.errorHandling || defaults.errorHandling;
                }
                if (document.getElementById('prompt-visualization')) {
                    document.getElementById('prompt-visualization').value = settings.visualization || defaults.visualization;
                }
                if (document.getElementById('prompt-data-analysis')) {
                    document.getElementById('prompt-data-analysis').value = settings.dataAnalysis || defaults.dataAnalysis;
                }
                if (document.getElementById('prompt-sql-generation')) {
                    document.getElementById('prompt-sql-generation').value = settings.sqlGeneration || defaults.sqlGeneration;
                }
                if (document.getElementById('prompt-code-review')) {
                    document.getElementById('prompt-code-review').value = settings.codeReview || defaults.codeReview;
                }
                if (document.getElementById('prompt-progress-planner')) {
                    document.getElementById('prompt-progress-planner').value = settings.progressPlanner || defaults.progressPlanner;
                }
            }
        } catch (error) {
            console.error('加载Prompt设置失败:', error);
            // 使用默认设置
            const defaultSettings = this.getDefaultPromptSettings();
            if (document.getElementById('prompt-exploration')) {
                if (document.getElementById('prompt-routing')) {
                    document.getElementById('prompt-routing').value = defaultSettings.routing;
                }
                const qaEl = document.getElementById('prompt-qa'); if (qaEl) qaEl.value = defaultSettings.qaPrompt;
                const sqlEl = document.getElementById('prompt-sql-only'); if (sqlEl) sqlEl.value = defaultSettings.sqlOnlyPrompt;
                const analysisEl = document.getElementById('prompt-analysis'); if (analysisEl) analysisEl.value = defaultSettings.analysisPrompt;
                document.getElementById('prompt-exploration').value = defaultSettings.exploration;
                document.getElementById('prompt-table-selection').value = defaultSettings.tableSelection;
                document.getElementById('prompt-field-mapping').value = defaultSettings.fieldMapping;
                document.getElementById('prompt-data-processing').value = defaultSettings.dataProcessing;
                document.getElementById('prompt-output-requirements').value = defaultSettings.outputRequirements;
                // 高级Prompt
                const map = [
                    ['prompt-summarization', defaultSettings.summarization],
                    ['prompt-error-handling', defaultSettings.errorHandling],
                    ['prompt-visualization', defaultSettings.visualization],
                    ['prompt-data-analysis', defaultSettings.dataAnalysis],
                    ['prompt-sql-generation', defaultSettings.sqlGeneration],
                    ['prompt-code-review', defaultSettings.codeReview],
                    ['prompt-progress-planner', defaultSettings.progressPlanner]
                ];
                map.forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.value = val; });
            }
        }
    }
}

// 创建全局设置管理器实例
window.settingsManager = new SettingsManager();

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM加载完成，初始化SettingsManager');
    const manager = window.settingsManager;
    await manager.init();  // 先初始化，设置事件监听器
    await manager.loadSettings();  // 然后加载设置
    console.log('SettingsManager 完全初始化完成');
});
