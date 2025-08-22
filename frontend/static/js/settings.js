/**
 * 设置页面管理模块
 */

class SettingsManager {
    constructor() {
        this.models = [];
        this.currentEditingModel = null;
        this.config = null;  // 存储配置
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
                // 添加新模型
                modelData.status = 'inactive';
                this.models.push(modelData);
            }

            // 保存到后端
            await api.saveModels(this.models);
            
            // 如果是当前选中的模型，更新全局API配置
            const currentModel = document.getElementById('current-model').value;
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

        app.showNotification('正在测试模型连接...', 'info');
        
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

        app.showNotification('正在测试数据库连接...', 'info');

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