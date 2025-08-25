/**
 * 设置页面管理模块
 */

class SettingsManager {
    constructor() {
        this.models = [];
        this.currentEditingModel = null;
        this.config = null;  // 存储配置
        this.hasTestedModels = false;  // 标记是否已经测试过模型
        // 不在构造函数中初始化，等待DOM准备好
    }

    /**
     * 初始化设置管理器
     */
    async init() {
        console.log('SettingsManager 初始化开始');
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
        
        // 如果切换到模型管理页面，执行首次批量测试
        if (tabName === 'models' && !this.hasTestedModels) {
            this.testAllModelsOnFirstVisit();
        }
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

        // 保存模型按钮 - 使用事件委托确保按钮可用
        document.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'save-model-btn') {
                this.saveModel();
            }
        });

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
            this.models = response.models || [];
            this.renderModelsList();
        } catch (error) {
            console.error('加载模型列表失败:', error);
            // 使用默认模型列表
            this.models = [
                {
                    id: 'gpt-4.1',
                    name: 'GPT-4.1',
                    type: 'OpenAI',
                    api_base: 'http://localhost:11434/v1',
                    status: 'active'
                },
                {
                    id: 'claude-sonnet-4',
                    name: 'Claude Sonnet 4',
                    type: 'Anthropic',
                    api_base: 'http://localhost:11434/v1',
                    status: 'active'
                },
                {
                    id: 'deepseek-r1',
                    name: 'DeepSeek R1',
                    type: 'DeepSeek',
                    api_base: 'http://localhost:11434/v1',
                    status: 'active'
                },
                {
                    id: 'qwen-flagship',
                    name: 'Qwen 旗舰模型',
                    type: 'Qwen',
                    api_base: 'http://localhost:11434/v1',
                    status: 'active'
                }
            ];
            this.renderModelsList();
        }
    }

    /**
     * 渲染模型列表
     */
    renderModelsList() {
        const tbody = document.getElementById('models-list');
        if (!tbody) return;

        let html = '';
        this.models.forEach(model => {
            const statusClass = model.status === 'active' ? 'active' : 
                               model.status === 'testing' ? 'testing' : 'inactive';
            const statusText = model.status === 'active' ? '可用' : 
                              model.status === 'testing' ? '测试中' : '不可用';

            html += `
                <tr>
                    <td>${model.name || '未命名'}</td>
                    <td>${model.type || 'Unknown'}</td>
                    <td>${model.api_base || 'N/A'}</td>
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    <td>
                        <button class="btn-icon" title="编辑" onclick="window.settingsManager.editModel('${model.id}')">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-icon" title="测试" onclick="window.settingsManager.testModel('${model.id}')">
                            <i class="fas fa-plug"></i>
                        </button>
                        <button class="btn-icon danger" title="删除" onclick="window.settingsManager.deleteModel('${model.id}')">
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
        const title = document.getElementById('model-modal-title');
        
        // 获取默认配置
        const defaultApiKey = this.config?.api_key || '';
        const defaultApiBase = this.config?.api_base || 'http://localhost:11434/v1';
        
        if (modelId) {
            // 编辑模式
            const model = this.models.find(m => m.id === modelId);
            if (model) {
                title.textContent = '编辑模型';
                document.getElementById('model-name').value = model.name;
                document.getElementById('model-id').value = model.id;
                document.getElementById('model-type').value = model.type.toLowerCase();
                document.getElementById('model-api-base').value = model.api_base || defaultApiBase;
                // 使用模型的API密钥，如果没有则使用默认的
                document.getElementById('model-api-key').value = model.api_key || defaultApiKey;
                document.getElementById('model-max-tokens').value = model.max_tokens || 4096;
                document.getElementById('model-temperature').value = model.temperature || 0.7;
                this.currentEditingModel = modelId;
            }
        } else {
            // 添加模式 - 使用默认值
            title.textContent = '添加模型';
            document.getElementById('model-name').value = '';
            document.getElementById('model-id').value = '';
            document.getElementById('model-type').value = 'openai';
            document.getElementById('model-api-base').value = defaultApiBase;
            document.getElementById('model-api-key').value = defaultApiKey;
            document.getElementById('model-max-tokens').value = '4096';
            document.getElementById('model-temperature').value = '0.7';
            this.currentEditingModel = null;
        }
        
        modal.style.display = 'flex';
    }

    /**
     * 关闭模型配置弹窗
     */
    closeModelModal() {
        const modal = document.getElementById('model-modal');
        modal.style.display = 'none';
        this.currentEditingModel = null;
    }

    /**
     * 保存模型
     */
    async saveModel() {
        const modelData = {
            name: document.getElementById('model-name').value.trim(),
            id: document.getElementById('model-id').value.trim(),
            type: document.getElementById('model-type').value,
            api_base: document.getElementById('model-api-base').value.trim(),
            api_key: document.getElementById('model-api-key').value.trim(),
            max_tokens: parseInt(document.getElementById('model-max-tokens').value),
            temperature: parseFloat(document.getElementById('model-temperature').value)
        };

        // 验证必填字段
        if (!modelData.name || !modelData.id || !modelData.api_base || !modelData.api_key) {
            app.showNotification('请填写所有必填字段', 'error');
            return;
        }

        try {
            if (this.currentEditingModel) {
                // 更新现有模型
                const index = this.models.findIndex(m => m.id === this.currentEditingModel);
                if (index !== -1) {
                    this.models[index] = { ...this.models[index], ...modelData };
                }
            } else {
                // 添加新模型，不设置状态
                this.models.push(modelData);
            }

            // 保存到后端
            await api.saveModels(this.models);
            
            // 如果是当前选中的模型，更新全局API配置
            const currentModel = document.getElementById('current-model')?.value;
            if (modelData.id === currentModel || this.models.length === 1) {
                // 保存API配置到.env文件
                await api.saveConfig({
                    api_key: modelData.api_key,
                    api_base: modelData.api_base,
                    default_model: modelData.id
                });
            }
            
            this.renderModelsList();
            this.closeModelModal();
            app.showNotification('模型保存成功', 'success');
            
            // 更新模型选择器（包含通知主应用）
            await this.updateModelSelectors();
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
    async testModel(modelId) {
        const model = this.models.find(m => m.id === modelId);
        if (!model) return;

        app.showNotification(window.i18nManager.t('common.testingModel'), 'info');
        
        // 更新状态为测试中
        model.status = 'testing';
        this.renderModelsList();

        try {
            const result = await api.testModel({
                model: model.id,
                api_key: model.api_key,
                api_base: model.api_base
            });

            if (result.success) {
                model.status = 'active';
                app.showNotification(`模型 ${model.name} 连接成功！`, 'success');
            } else {
                model.status = 'inactive';
                app.showNotification(`模型 ${model.name} 连接失败: ${result.message}`, 'error');
            }
        } catch (error) {
            model.status = 'inactive';
            app.showNotification(`模型 ${model.name} 连接失败`, 'error');
        }

        this.renderModelsList();
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
        
        const settings = {
            default_model: document.getElementById('default-model').value,
            default_view_mode: document.getElementById('default-view-mode').value,
            context_rounds: parseInt(document.getElementById('context-rounds').value) || 3
        };
        
        console.log('要保存的设置:', settings);

        try {
            // 保存到后端API
            await api.saveSettings(settings);
            
            // 保存到本地存储
            localStorage.setItem('basic_settings', JSON.stringify(settings));
            
            // 更新应用的上下文轮数设置
            if (window.app) {
                window.app.contextRounds = settings.context_rounds;
                // 更新默认视图模式
                window.app.currentViewMode = settings.default_view_mode;
                localStorage.setItem('view_mode', settings.default_view_mode);
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

        try {
            await api.saveDatabaseConfig(config);
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
            // 加载基础设置
            const basicSettings = JSON.parse(localStorage.getItem('basic_settings') || '{}');
            if (basicSettings.default_model) {
                document.getElementById('default-model').value = basicSettings.default_model;
            }
            if (basicSettings.default_view_mode) {
                document.getElementById('default-view-mode').value = basicSettings.default_view_mode;
            }
            if (basicSettings.context_rounds !== undefined) {
                document.getElementById('context-rounds').value = basicSettings.context_rounds;
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
            routing: `你是一个查询路由分类器。分析用户查询，选择最适合的执行路径。

用户查询：{query}

数据库信息：
- 类型：{db_type}
- 可用表：{available_tables}

请从以下选项中选择最合适的路由：

1. DIRECT_SQL - 简单查询，可以直接转换为SQL执行
   适用：查看数据、统计数量、简单筛选、排序
   示例：显示所有订单、统计用户数量、查看最新记录

2. SIMPLE_ANALYSIS - 需要SQL查询+简单数据处理
   适用：分组统计、简单计算、数据汇总
   示例：按月统计销售额、计算平均值、对比不同类别

3. COMPLEX_ANALYSIS - 需要复杂分析或多步处理
   适用：趋势分析、预测、复杂计算、需要编程逻辑
   示例：分析销售趋势、预测未来销量、相关性分析

4. VISUALIZATION - 需要生成图表或可视化
   适用：任何明确要求图表、图形、可视化的查询
   示例：生成销售图表、绘制趋势图、创建饼图

输出格式（JSON）：
{
  "route": "选择的路由类型",
  "confidence": 0.95,
  "reason": "选择此路由的原因",
  "suggested_sql": "如果是DIRECT_SQL，提供建议的SQL语句"
}

重要：
- 只要用户提到"图"、"图表"、"可视化"、"绘制"等词，必须选择 VISUALIZATION
- 如果查询包含"为什么"、"原因"、"预测"等需要推理的词，选择 COMPLEX_ANALYSIS
- 尽可能选择简单的路由以提高性能`,
            
            directSql: `对于简单的数据查询，直接生成SQL语句执行：
- 优先使用SELECT语句查询数据
- 检查表名和字段名的正确性
- 添加必要的WHERE条件和排序`,
            
            simpleAnalysis: `执行SQL查询并进行简单数据处理：
- 使用GROUP BY进行分组统计
- 计算平均值、总和等聚合函数
- 进行简单的数据比较和排序`,
            
            complexAnalysis: `你是一个数据分析专家，请完成以下任务：
1. 理解用户的业务需求
2. 探索相关数据表和字段
3. 编写并执行必要的代码
4. 提供详细的分析结果
5. 如果需要，生成可视化图表
这是智能路由关闭时使用的默认提示词`,
            
            visualization: `生成数据可视化图表：
- 使用plotly创建交互式图表
- 选择合适的图表类型（柱状图、折线图、饼图等）
- 设置清晰的标题和标签
- 将图表保存为HTML文件到output目录`,
            
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
        };
    }
    
    /**
     * 保存Prompt设置
     */
    async savePromptSettings() {
        const defaults = this.getDefaultPromptSettings();
        const promptSettings = {
            routing: document.getElementById('prompt-routing')?.value || defaults.routing,
            directSql: document.getElementById('prompt-direct-sql')?.value || defaults.directSql,
            simpleAnalysis: document.getElementById('prompt-simple-analysis')?.value || defaults.simpleAnalysis,
            complexAnalysis: document.getElementById('prompt-complex-analysis')?.value || defaults.complexAnalysis,
            visualization: document.getElementById('prompt-visualization')?.value || defaults.visualization,
            exploration: document.getElementById('prompt-exploration').value,
            tableSelection: document.getElementById('prompt-table-selection').value,
            fieldMapping: document.getElementById('prompt-field-mapping').value,
            dataProcessing: document.getElementById('prompt-data-processing').value,
            outputRequirements: document.getElementById('prompt-output-requirements').value
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
                // 保存到本地存储
                localStorage.setItem('prompt_settings', JSON.stringify(promptSettings));
                app.showNotification('Prompt设置已保存', 'success');
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
                localStorage.setItem('prompt_settings', JSON.stringify(defaultSettings));
                app.showNotification('已恢复默认Prompt设置', 'success');
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
        const promptSettings = {
            routing: document.getElementById('prompt-routing')?.value || this.getDefaultPromptSettings().routing,
            exploration: document.getElementById('prompt-exploration').value,
            tableSelection: document.getElementById('prompt-table-selection').value,
            fieldMapping: document.getElementById('prompt-field-mapping').value,
            dataProcessing: document.getElementById('prompt-data-processing').value,
            outputRequirements: document.getElementById('prompt-output-requirements').value,
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
                if (settings.routing !== undefined && document.getElementById('prompt-routing')) {
                    document.getElementById('prompt-routing').value = settings.routing;
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
                if (document.getElementById('prompt-direct-sql')) {
                    document.getElementById('prompt-direct-sql').value = settings.directSql || defaults.directSql;
                }
                if (document.getElementById('prompt-simple-analysis')) {
                    document.getElementById('prompt-simple-analysis').value = settings.simpleAnalysis || defaults.simpleAnalysis;
                }
                if (document.getElementById('prompt-complex-analysis')) {
                    document.getElementById('prompt-complex-analysis').value = settings.complexAnalysis || defaults.complexAnalysis;
                }
                if (document.getElementById('prompt-visualization')) {
                    document.getElementById('prompt-visualization').value = settings.visualization || defaults.visualization;
                }
                
                // 数据库相关prompt
                document.getElementById('prompt-exploration').value = settings.exploration || defaults.exploration;
                document.getElementById('prompt-table-selection').value = settings.tableSelection || defaults.tableSelection;
                document.getElementById('prompt-field-mapping').value = settings.fieldMapping || defaults.fieldMapping;
                document.getElementById('prompt-data-processing').value = settings.dataProcessing || defaults.dataProcessing;
                document.getElementById('prompt-output-requirements').value = settings.outputRequirements || defaults.outputRequirements;
            }
        } catch (error) {
            console.error('加载Prompt设置失败:', error);
            // 使用默认设置
            const defaultSettings = this.getDefaultPromptSettings();
            if (document.getElementById('prompt-exploration')) {
                if (document.getElementById('prompt-routing')) {
                    document.getElementById('prompt-routing').value = defaultSettings.routing;
                }
                document.getElementById('prompt-exploration').value = defaultSettings.exploration;
                document.getElementById('prompt-table-selection').value = defaultSettings.tableSelection;
                document.getElementById('prompt-field-mapping').value = defaultSettings.fieldMapping;
                document.getElementById('prompt-data-processing').value = defaultSettings.dataProcessing;
                document.getElementById('prompt-output-requirements').value = defaultSettings.outputRequirements;
            }
        }
    }
}

// 创建全局设置管理器实例
window.settingsManager = new SettingsManager();

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM加载完成，初始化SettingsManager');
    await settingsManager.init();  // 先初始化，设置事件监听器
    settingsManager.loadSettings();  // 然后加载设置
    console.log('SettingsManager 完全初始化完成');
});