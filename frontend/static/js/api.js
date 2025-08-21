/**
 * API 封装模块
 * 处理所有与后端的通信
 */

class API {
    constructor() {
        this.baseURL = '';
        this.headers = {
            'Content-Type': 'application/json'
        };
    }

    /**
     * 通用请求方法
     */
    async request(url, options = {}) {
        try {
            const response = await fetch(url, {
                ...options,
                headers: {
                    ...this.headers,
                    ...options.headers
                }
            });

            if (!response.ok) {
                // 对于配置端点的404，不要抛出错误
                if (url === '/api/config' && response.status === 404) {
                    return {};  // 返回空配置
                }
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await response.json();
            }
            
            return await response.text();
        } catch (error) {
            // 页面加载时的网络错误静默处理
            if (url === '/api/config' || url === '/api/models') {
                console.warn(`加载${url}失败，使用默认值:`, error.message);
                return url === '/api/config' ? {} : { models: [] };
            }
            console.error('API请求失败:', error);
            throw error;
        }
    }

    /**
     * 发送聊天消息
     */
    async sendMessage(message, conversationId = null, viewMode = 'user') {
        return this.request('/api/chat', {
            method: 'POST',
            body: JSON.stringify({
                message,
                conversation_id: conversationId,
                view_mode: viewMode
            })
        });
    }

    /**
     * 流式发送消息（支持实时响应）
     * 注意：当前后端不支持流式响应，改为普通请求
     */
    async sendMessageStream(message, conversationId = null, viewMode = 'user', onProgress = null) {
        try {
            // 显示思考状态
            if (onProgress) {
                onProgress({ type: 'thinking', content: '正在思考中...' });
            }
            
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: this.headers,
                body: JSON.stringify({
                    query: message,  // 注意字段名是query
                    model: localStorage.getItem('default_model') || 'gpt-4.1',
                    use_database: true,
                    conversation_id: conversationId,  // 传递会话ID
                    context_rounds: window.app?.contextRounds || 3  // 传递上下文轮数
                })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            
            // 处理响应
            if (data.success) {
                // 保存会话ID到响应中
                if (data.conversation_id) {
                    data.conversationId = data.conversation_id;
                }
                if (onProgress) {
                    onProgress({ 
                        type: 'result', 
                        content: data.result,
                        model: data.model,
                        conversationId: data.conversation_id 
                    });
                }
            } else if (data.interrupted) {
                // 查询被中断
                if (onProgress) {
                    onProgress({ 
                        type: 'interrupted', 
                        message: data.error || '查询已被用户中断',
                        partial_result: data.partial_result
                    });
                }
            } else {
                if (onProgress) {
                    onProgress({ 
                        type: 'error', 
                        message: data.error || '处理请求时出错' 
                    });
                }
            }
            
            return data;
        } catch (error) {
            console.error('发送消息失败:', error);
            if (onProgress) {
                onProgress({ 
                    type: 'error', 
                    message: error.message || '网络错误，请稍后重试' 
                });
            }
            throw error;
        }
    }

    /**
     * 获取可用模型列表
     */
    async getModels() {
        return this.request('/api/models');
    }

    /**
     * 获取数据库结构
     */
    async getSchema() {
        return this.request('/api/schema');
    }

    /**
     * 测试数据库连接
     */
    async testDatabase(config) {
        return this.request('/api/database/test', {
            method: 'POST',
            body: JSON.stringify(config)
        });
    }

    /**
     * 保存数据库配置
     */
    async saveDatabaseConfig(config) {
        return this.request('/api/database/config', {
            method: 'POST',
            body: JSON.stringify(config)
        });
    }


    /**
     * 获取配置
     */
    async getConfig() {
        return this.request('/api/config');
    }

    /**
     * 保存配置
     */
    async saveConfig(config) {
        return this.request('/api/config', {
            method: 'POST',
            body: JSON.stringify(config)
        });
    }

    /**
     * 测试模型连接
     */
    async testModel(config) {
        return this.request('/api/test_model', {
            method: 'POST',
            body: JSON.stringify(config)
        });
    }

    /**
     * 测试数据库连接
     */
    async testDatabase(config) {
        return this.request('/api/database/test', {
            method: 'POST',
            body: JSON.stringify(config)
        });
    }

    /**
     * 健康检查
     */
    async healthCheck() {
        return this.request('/api/health');
    }

    /**
     * 导出查询结果
     */
    async exportResult(conversationId, messageId, format = 'excel') {
        const response = await fetch(`/api/export/${conversationId}/${messageId}?format=${format}`);
        
        if (!response.ok) {
            throw new Error(`导出失败: ${response.status}`);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `export_${Date.now()}.${format === 'excel' ? 'xlsx' : format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }

    /**
     * 执行SQL查询（仅开发者模式）
     */
    async executeSQL(sql) {
        return this.request('/api/sql/execute', {
            method: 'POST',
            body: JSON.stringify({ sql })
        });
    }

    /**
     * 获取系统状态
     */
    async getSystemStatus() {
        return this.request('/api/status');
    }

    /**
     * 获取执行日志
     */
    async getExecutionLogs(conversationId, messageId) {
        return this.request(`/api/logs/${conversationId}/${messageId}`);
    }

    /**
     * 保存用户反馈
     */
    async saveFeedback(messageId, feedback) {
        return this.request('/api/feedback', {
            method: 'POST',
            body: JSON.stringify({
                message_id: messageId,
                feedback
            })
        });
    }

    /**
     * 保存模型列表
     */
    async saveModels(models) {
        return this.request('/api/models', {
            method: 'POST',
            body: JSON.stringify(models)
        });
    }

    /**
     * 保存设置
     */
    async saveSettings(settings) {
        return this.request('/api/config', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
    }

    /**
     * 保存系统设置
     */
    async saveSystemSettings(settings) {
        return this.request('/api/settings/system', {
            method: 'POST',
            body: JSON.stringify(settings)
        });
    }

    /**
     * 清空缓存
     */
    async clearCache() {
        return this.request('/api/cache/clear', {
            method: 'POST'
        });
    }
    
    // ============ 历史记录相关API ============
    
    /**
     * 创建新对话
     */
    async createConversation(title = null, model = null) {
        // 创建对话的逻辑已经集成在sendMessage中
        // 这里返回一个空的promise，让调用者继续
        return Promise.resolve({ success: true });
    }
    
    /**
     * 获取对话列表
     */
    async getConversations(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.request(`/api/history/conversations${queryString ? '?' + queryString : ''}`);
    }
    
    /**
     * 获取对话详情
     */
    async getConversationDetail(conversationId) {
        return this.request(`/api/history/conversation/${conversationId}`);
    }
    
    /**
     * 切换收藏状态
     */
    async toggleFavorite(conversationId) {
        return this.request(`/api/history/conversation/${conversationId}/favorite`, {
            method: 'POST'
        });
    }
    
    /**
     * 删除对话
     */
    async deleteConversation(conversationId) {
        return this.request(`/api/history/conversation/${conversationId}`, {
            method: 'DELETE'
        });
    }
    
    /**
     * 获取历史统计
     */
    async getHistoryStatistics() {
        return this.request('/api/history/statistics');
    }
    
    /**
     * 清理历史记录
     */
    async cleanupHistory(days = 90) {
        return this.request('/api/history/cleanup', {
            method: 'POST',
            body: JSON.stringify({ days })
        });
    }
    
    /**
     * 复现对话
     */
    async replayConversation(conversationId) {
        return this.request(`/api/history/replay/${conversationId}`, {
            method: 'POST'
        });
    }
}

// 创建全局API实例
window.api = new API();