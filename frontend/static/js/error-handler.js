/**
 * 统一错误处理模块
 * 提供全局错误捕获、日志记录和错误提示
 */

class ErrorHandler {
    constructor() {
        this.errorLog = [];
        this.maxLogSize = 100;
        this.setupGlobalHandlers();
    }
    
    /**
     * 设置全局错误处理器
     */
    setupGlobalHandlers() {
        // 捕获未处理的Promise错误
        window.addEventListener('unhandledrejection', (event) => {
            this.handleError({
                type: 'unhandledRejection',
                error: event.reason,
                promise: event.promise
            });
            event.preventDefault();
        });
        
        // 捕获全局错误
        window.addEventListener('error', (event) => {
            this.handleError({
                type: 'globalError',
                error: event.error || event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno
            });
        });
    }
    
    /**
     * 处理错误
     */
    handleError(errorInfo) {
        // 记录错误
        this.logError(errorInfo);
        
        // 根据错误类型显示不同提示
        const errorType = this.classifyError(errorInfo);
        this.showUserNotification(errorType, errorInfo);
        
        // 开发环境输出详细信息
        if (this.isDevelopment()) {
            console.error('Error details:', errorInfo);
        }
    }
    
    /**
     * 错误分类
     */
    classifyError(errorInfo) {
        const error = errorInfo.error;
        const errorString = error?.toString() || '';
        
        // 网络错误
        if (errorString.includes('fetch') || errorString.includes('network')) {
            return 'network';
        }
        
        // API错误
        if (errorString.includes('api') || errorString.includes('404') || errorString.includes('500')) {
            return 'api';
        }
        
        // 权限错误
        if (errorString.includes('permission') || errorString.includes('forbidden')) {
            return 'permission';
        }
        
        // 验证错误
        if (errorString.includes('validation') || errorString.includes('invalid')) {
            return 'validation';
        }
        
        return 'general';
    }
    
    /**
     * 显示用户友好的错误提示
     */
    showUserNotification(errorType, errorInfo) {
        let message = '';
        let icon = 'fas fa-exclamation-triangle';
        
        switch (errorType) {
            case 'network':
                message = '网络连接问题，检查网络设置';
                icon = 'fas fa-wifi';
                break;
            case 'api':
                message = '服务器响应异常，稍后重试';
                icon = 'fas fa-server';
                break;
            case 'permission':
                message = '无权限执行此操作';
                icon = 'fas fa-lock';
                break;
            case 'validation':
                message = '数据格式错误，检查后重试';
                icon = 'fas fa-check-circle';
                break;
            default:
                message = '发生错误，刷新页面重试';
                icon = 'fas fa-exclamation-circle';
        }
        
        this.showNotification(message, 'error', icon);
    }
    
    /**
     * 显示通知
     */
    showNotification(message, type = 'error', icon = '') {
        // 如果存在app的通知方法，使用它
        if (window.app && typeof window.app.showNotification === 'function') {
            window.app.showNotification(message, type);
            return;
        }
        
        // 否则创建自定义通知
        const notification = document.createElement('div');
        notification.className = `error-notification ${type}`;
        notification.innerHTML = `
            <i class="${icon}"></i>
            <span>${message}</span>
            <button class="close-btn">&times;</button>
        `;
        
        // 添加样式
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            background: ${type === 'error' ? '#ff4444' : '#4CAF50'};
            color: white;
            border-radius: 5px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.2);
            z-index: 10000;
            display: flex;
            align-items: center;
            gap: 10px;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(notification);
        
        // 关闭按钮
        notification.querySelector('.close-btn').onclick = () => {
            notification.remove();
        };
        
        // 自动移除
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    }
    
    /**
     * 记录错误到日志
     */
    logError(errorInfo) {
        const logEntry = {
            ...errorInfo,
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent,
            url: window.location.href
        };
        
        this.errorLog.push(logEntry);
        
        // 限制日志大小
        if (this.errorLog.length > this.maxLogSize) {
            this.errorLog.shift();
        }
        
        // 存储到localStorage（可选）
        try {
            localStorage.setItem('errorLog', JSON.stringify(this.errorLog));
        } catch (e) {
            // localStorage可能已满
        }
    }
    
    /**
     * 获取错误日志
     */
    getErrorLog() {
        return this.errorLog;
    }
    
    /**
     * 清空错误日志
     */
    clearErrorLog() {
        this.errorLog = [];
        localStorage.removeItem('errorLog');
    }
    
    /**
     * 发送错误报告（可选）
     */
    async sendErrorReport(errorInfo) {
        if (!this.shouldReportError(errorInfo)) {
            return;
        }
        
        try {
            await fetch('/api/error-report', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: errorInfo,
                    context: {
                        url: window.location.href,
                        timestamp: new Date().toISOString(),
                        userAgent: navigator.userAgent
                    }
                })
            });
        } catch (e) {
            // 静默失败，避免循环错误
        }
    }
    
    /**
     * 判断是否应该报告错误
     */
    shouldReportError(errorInfo) {
        // 开发环境不报告
        if (this.isDevelopment()) {
            return false;
        }
        
        // 忽略某些已知的、无害的错误
        const ignoredErrors = [
            'ResizeObserver loop limit exceeded',
            'Non-Error promise rejection captured'
        ];
        
        const errorString = errorInfo.error?.toString() || '';
        return !ignoredErrors.some(ignored => errorString.includes(ignored));
    }
    
    /**
     * 检查是否为开发环境
     */
    isDevelopment() {
        return window.location.hostname === 'localhost' || 
               window.location.hostname === '127.0.0.1';
    }
    
    /**
     * 包装异步函数，自动处理错误
     */
    wrapAsync(fn) {
        return async (...args) => {
            try {
                return await fn(...args);
            } catch (error) {
                this.handleError({
                    type: 'asyncError',
                    error,
                    function: fn.name
                });
                throw error;
            }
        };
    }
}

// 创建全局错误处理器实例
window.errorHandler = new ErrorHandler();

// 添加CSS动画
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }
    
    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);