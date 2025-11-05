/**
 * UI 操作模块
 * 处理所有纯粹的 DOM 操作和 UI 渲染
 */

class UIManager {
    /**
     * 显示通知
     */
    showNotification(message, type = 'info', options = {}) {
        const notification = document.getElementById('notification');
        if (!notification) return;

        const duration = options.duration || 3000;
        const icon = notification.querySelector('.notification-icon');
        const text = notification.querySelector('.notification-text');

        // 设置图标和文本
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        };

        icon.className = `notification-icon ${icons[type] || icons.info}`;
        text.textContent = message;

        // 显示通知
        notification.classList.add('show', type);

        // 自动隐藏
        if (duration > 0) {
            setTimeout(() => {
                notification.classList.remove('show');
            }, duration);
        }
    }

    /**
     * 添加消息到聊天容器
     */
    addMessageToChat(message, sender = 'user') {
        const messagesContainer = document.getElementById('chat-messages');
        if (!messagesContainer) return null;

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;
        
        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = sender === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-robot"></i>';
        
        const content = document.createElement('div');
        content.className = 'message-content';
        content.textContent = message;

        messageDiv.appendChild(avatar);
        messageDiv.appendChild(content);
        messagesContainer.appendChild(messageDiv);

        // 滚动到底部
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        return messageDiv;
    }

    /**
     * 创建思考气泡
     */
    createThinkingBubble(thinkingId) {
        const messagesContainer = document.getElementById('chat-messages');
        if (!messagesContainer) return null;

        const wrapper = document.createElement('div');
        wrapper.className = 'message bot-message thinking-message';
        wrapper.setAttribute('data-thinking-id', thinkingId);

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = '<i class="fas fa-robot"></i>';

        const content = document.createElement('div');
        content.className = 'message-content thinking-process';
        content.innerHTML = '<div class="thinking-dots"><span></span><span></span><span></span></div>';

        wrapper.appendChild(avatar);
        wrapper.appendChild(content);
        messagesContainer.appendChild(wrapper);

        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        return wrapper;
    }

    /**
     * 更新按钮可见性
     */
    updateButtonVisibility(sendBtn, stopBtn, isProcessing) {
        if (sendBtn) {
            if (isProcessing) {
                sendBtn.classList.add('button-hidden');
                sendBtn.classList.remove('button-visible');
            } else {
                sendBtn.classList.add('button-visible');
                sendBtn.classList.remove('button-hidden');
            }
        }

        if (stopBtn) {
            if (isProcessing) {
                stopBtn.classList.add('button-visible');
                stopBtn.classList.remove('button-hidden');
                stopBtn.removeAttribute('hidden');
            } else {
                stopBtn.classList.add('button-hidden');
                stopBtn.classList.remove('button-visible');
                stopBtn.setAttribute('hidden', 'hidden');
            }
        }
    }

    /**
     * 滚动到底部
     */
    scrollToBottom(elementId = 'chat-messages') {
        const element = document.getElementById(elementId);
        if (element) {
            element.scrollTop = element.scrollHeight;
        }
    }
}

// 创建全局 UI 管理器实例
window.uiManager = new UIManager();

