let listenersBound = false;
let boundApp = null;
let historyScriptPromise = null;

async function loadHistoryManagerScript() {
    if (window.HistoryManager) {
        return;
    }

    if (!historyScriptPromise) {
        historyScriptPromise = import('/static/js/history-manager.js')
            .catch(error => {
                historyScriptPromise = null;
                throw error;
            });
    }

    await historyScriptPromise;
}

function registerHistoryEvents(app) {
    boundApp = app;

    if (listenersBound) {
        return;
    }

    window.addEventListener('historyConversationLoaded', (event) => {
        if (!boundApp || !event?.detail) {
            return;
        }
        loadHistoryConversation(boundApp, event.detail);
    });

    listenersBound = true;
}

export function attachHistorySupport(app) {
    registerHistoryEvents(app);
}

export async function ensureHistoryManager(app, options = {}) {
    await loadHistoryManagerScript();

    if (!app.historyManager && window.HistoryManager) {
        app.historyManager = new window.HistoryManager();
        window.HistoryManager.instance = app.historyManager;
    }

    const manager = app.historyManager;
    if (!manager) {
        return null;
    }

    if (options.forceInit && typeof manager.ensureInitialized === 'function') {
        await manager.ensureInitialized();
    }

    if (app._historyNeedsRefresh) {
        manager.needsRefresh = true;
    }

    return manager;
}

export function loadHistoryConversation(app, conversation) {
    if (!app || !conversation) {
        return;
    }

    app.currentConversationId = conversation.conversation_id;
    if (conversation.conversation_id) {
        localStorage.setItem('currentConversationId', conversation.conversation_id);
    }

    app.switchTab('chat');

    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
        messagesContainer.innerHTML = '';
    }

    if (Array.isArray(conversation.messages)) {
        conversation.messages.forEach(msg => {
            if (msg.type === 'user') {
                app.addMessage('user', msg.content);
                return;
            }

            if (msg.type !== 'assistant') {
                return;
            }

            try {
                let content = msg.content;

                if (typeof content === 'string') {
                    try {
                        content = JSON.parse(content);
                    } catch (_) {
                        // 保持原始字符串
                    }
                }

                if (content && typeof content === 'object') {
                    if (content.type === 'dual_view' && content.data) {
                        const dualViewContainer = app.createDualViewContainer(content.data);
                        app.addMessage('bot', dualViewContainer);
                    } else if (content.type === 'raw_output' && content.data) {
                        const wrapped = { content: content.data };
                        const dualViewContainer = app.createDualViewContainer(wrapped);
                        app.addMessage('bot', dualViewContainer);
                    } else if (content.content) {
                        const dualViewContainer = app.createDualViewContainer(content);
                        app.addMessage('bot', dualViewContainer);
                    } else if (Array.isArray(content)) {
                        const wrapped = { content };
                        const dualViewContainer = app.createDualViewContainer(wrapped);
                        app.addMessage('bot', dualViewContainer);
                    } else {
                        const dualViewContainer = app.createDualViewContainer(content);
                        app.addMessage('bot', dualViewContainer);
                    }
                } else if (typeof content === 'string') {
                    app.addMessage('bot', content);
                } else {
                    app.addMessage('bot', String(content));
                }
            } catch (error) {
                console.error('解析历史消息失败:', error, msg);
                if (typeof msg.content === 'string') {
                    app.addMessage('bot', msg.content);
                } else {
                    const dualViewContainer = app.createDualViewContainer(msg.content);
                    app.addMessage('bot', dualViewContainer);
                }
            }
        });
    }

    const title = conversation?.metadata?.title || '未命名';
    app.showNotification(`已加载历史对话: ${title}`, 'success');

    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

export async function loadHistoryStatistics(app) {
    try {
        const response = await fetch('/api/history/statistics');
        const data = await response.json();

        if (!data.success || !data.statistics) {
            return;
        }

        const stats = data.statistics;
        const totalElement = document.getElementById('stat-total');
        const todayElement = document.getElementById('stat-today');

        if (totalElement) {
            totalElement.textContent = stats.total_conversations || 0;
        }
        if (todayElement) {
            todayElement.textContent = stats.today_conversations || 0;
        }

        if (stats.today_conversations > 0) {
            const badge = document.getElementById('history-badge');
            if (badge) {
                badge.style.display = 'inline-block';
            }
        }
    } catch (error) {
        console.error('加载历史统计失败:', error);
    }
}

