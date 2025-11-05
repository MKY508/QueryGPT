let listenersBound = false;
let boundApp = null;
let historyScriptPromise = null;

async function loadHistoryManagerScript() {
    if (window.HistoryManager) {
        return window.HistoryManager;
    }

    if (!historyScriptPromise) {
        historyScriptPromise = import('/static/js/history-manager.js')
            .then((module) => {
                const exported = module?.default ?? module?.HistoryManager;
                if (exported) {
                    return exported;
                }
                if (window.HistoryManager) {
                    return window.HistoryManager;
                }
                throw new Error('HistoryManager 未正确导出');
            })
            .catch((error) => {
                historyScriptPromise = null;
                throw error;
            });
    }

    return historyScriptPromise;
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
    const HistoryManagerCtor = await loadHistoryManagerScript();

    if (!app.historyManager) {
        if (typeof HistoryManagerCtor === 'function') {
            app.historyManager = new HistoryManagerCtor();
        } else if (window.HistoryManager) {
            app.historyManager = new window.HistoryManager();
        }

        if (window.HistoryManager) {
            window.HistoryManager.instance = app.historyManager;
        }
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

function renderAssistantMessage(app, content) {
    if (!content) {
        app.addMessage('bot', '');
        return;
    }

    if (content.type === 'dual_view' && content.data) {
        const dual = app.createDualViewContainer(content.data);
        app.addMessage('bot', dual);
        return;
    }

    if (content.type === 'raw_output' && content.data) {
        const wrapped = { content: content.data };
        const dual = app.createDualViewContainer(wrapped);
        app.addMessage('bot', dual);
        return;
    }

    if (content.content || Array.isArray(content)) {
        const wrapped = Array.isArray(content) ? { content } : content;
        const dual = app.createDualViewContainer(wrapped);
        app.addMessage('bot', dual);
        return;
    }

    app.addMessage('bot', typeof content === 'string' ? content : String(content));
}

export function loadHistoryConversation(app, conversation) {
    if (!app || !conversation) {
        return;
    }

    const conversationId = conversation.conversation_id;
    app.currentConversationId = conversationId;
    if (conversationId) {
        localStorage.setItem('currentConversationId', conversationId);
    }

    app.switchTab('chat');

    const messagesContainer = document.getElementById('chat-messages');
    if (messagesContainer) {
        messagesContainer.replaceChildren();
    }

    const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
    for (const msg of messages) {
        if (msg.type === 'user') {
            app.addMessage('user', msg.content);
            continue;
        }

        if (msg.type !== 'assistant') {
            continue;
        }

        try {
            let content = msg.content;
            if (typeof content === 'string') {
                try {
                    content = JSON.parse(content);
                } catch (_error) {
                    // 保留原始字符串
                }
            }

            if (content && typeof content === 'object') {
                renderAssistantMessage(app, content);
            } else {
                renderAssistantMessage(app, typeof content === 'string' ? content : String(content));
            }
        } catch (error) {
            console.error('解析历史消息失败:', error, msg);
            if (typeof msg.content === 'string') {
                app.addMessage('bot', msg.content);
            } else {
                renderAssistantMessage(app, msg.content ?? '');
            }
        }
    }

    const title = conversation?.metadata?.title || '未命名';
    if (typeof app.showNotification === 'function') {
        app.showNotification(`已加载历史对话: ${title}`, 'success');
    }

    if (messagesContainer) {
        requestAnimationFrame(() => {
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        });
    }
}

export async function loadHistoryStatistics(app) {
    try {
        const response = await fetch('/api/history/statistics', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        if (!data?.success || !data.statistics) {
            return;
        }

        const stats = data.statistics;
        const totalElement = document.getElementById('stat-total');
        const todayElement = document.getElementById('stat-today');

        if (totalElement) {
            totalElement.textContent = stats.total_conversations ?? 0;
        }

        if (todayElement) {
            todayElement.textContent = stats.today_conversations ?? 0;
        }

        if (stats.today_conversations > 0) {
            const badge = document.getElementById('history-badge');
            if (badge) {
                badge.style.display = 'inline-block';
            }
        }
    } catch (error) {
        console.error('加载历史统计失败:', error);
        if (app?.showNotification) {
            app.showNotification('历史统计加载失败，请稍后重试', 'warning');
        }
    }
}

