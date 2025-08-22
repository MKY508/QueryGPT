/**
 * View Helper Functions
 * Extracted utility functions to improve code maintainability
 */

class ViewHelpers {
    // Constants to eliminate magic numbers
    static CONSTANTS = {
        IFRAME_HEIGHT: 600,
        PREVIEW_LENGTH: 200,
        SQL_PREVIEW_LENGTH: 80,
        MIN_SUMMARY_LENGTH: 20,
        MAX_SQL_DISPLAY: 2,
        IFRAME_ID_LENGTH: 9
    };

    /**
     * Generate unique ID for elements
     */
    static generateUniqueId(prefix = 'element') {
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substr(2, this.CONSTANTS.IFRAME_ID_LENGTH);
        return `${prefix}-${timestamp}-${randomStr}`;
    }

    /**
     * Extract filename from path
     */
    static extractFilename(path) {
        if (!path) return '';
        return path.split('/').pop() || path;
    }

    /**
     * Check if content is likely a summary
     */
    static isLikelySummary(text) {
        if (!text || text.trim().length < this.CONSTANTS.MIN_SUMMARY_LENGTH) {
            return false;
        }
        
        const summaryKeywords = [
            '总结', '完成', '生成', '结果', '发现', 
            '任务', '关键', '成功', '分析', 'Summary',
            'Complete', 'Generated', 'Result', 'Found'
        ];
        
        return summaryKeywords.some(keyword => 
            text.toLowerCase().includes(keyword.toLowerCase())
        );
    }

    /**
     * Build iframe HTML for chart embedding
     */
    static buildChartIframe(filename) {
        const iframeId = this.generateUniqueId('chart-iframe');
        
        return {
            id: iframeId,
            html: `
                <div class="chart-embed-container">
                    <div class="chart-embed-header">
                        <span class="chart-filename">📊 ${filename}</span>
                        <div class="chart-actions">
                            <button class="btn-fullscreen" 
                                    onclick="app.toggleFullscreen('${iframeId}')" 
                                    title="全屏"
                                    aria-label="全屏显示图表">
                                <i class="fas fa-expand"></i>
                            </button>
                            <button class="btn-new-tab" 
                                    onclick="app.openChart('${filename}')" 
                                    title="新标签页打开"
                                    aria-label="在新标签页中打开图表">
                                <i class="fas fa-external-link-alt"></i>
                            </button>
                        </div>
                    </div>
                    <div class="chart-embed-loading" id="loading-${iframeId}">
                        <i class="fas fa-spinner fa-spin"></i> 
                        <span>加载图表中...</span>
                    </div>
                    <iframe 
                        id="${iframeId}"
                        src="/output/${filename}" 
                        class="chart-iframe"
                        frameborder="0"
                        width="100%"
                        height="${this.CONSTANTS.IFRAME_HEIGHT}"
                        loading="lazy"
                        onload="ViewHelpers.handleIframeLoad('${iframeId}')"
                        onerror="ViewHelpers.handleIframeError('${iframeId}')">
                    </iframe>
                </div>
            `
        };
    }

    /**
     * Handle iframe load success
     */
    static handleIframeLoad(iframeId) {
        const loadingEl = document.getElementById(`loading-${iframeId}`);
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }
    }

    /**
     * Handle iframe load error
     */
    static handleIframeError(iframeId) {
        const loadingEl = document.getElementById(`loading-${iframeId}`);
        if (loadingEl) {
            loadingEl.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i> 
                <span>图表加载失败</span>
            `;
        }
    }

    /**
     * Build chart link HTML
     */
    static buildChartLink(filename) {
        return `
            <div class="chart-link">
                <i class="fas fa-chart-bar"></i> 
                <a href="/output/${filename}" 
                   target="_blank" 
                   rel="noopener noreferrer"
                   class="html-file-link">
                    📊 点击查看: ${filename}
                </a>
            </div>
        `;
    }

    /**
     * Analyze query data and extract relevant information
     */
    static analyzeQueryData(data) {
        const result = {
            queryData: [],
            sqlCommands: [],
            chartPaths: [],
            errorMessages: [],
            finalSummary: null,
            hasValidContent: false
        };

        // Check for direct summary
        if (data.summary) {
            result.finalSummary = data.summary;
            result.hasValidContent = true;
        }

        // Handle string content
        if (typeof data.content === 'string' && data.content.trim()) {
            if (this.isLikelySummary(data.content)) {
                result.finalSummary = data.content;
            }
            result.hasValidContent = true;
            return result;
        }

        // Handle array content
        if (!Array.isArray(data.content)) {
            return result;
        }

        data.content.forEach(item => {
            if (!item || !item.type || !item.content) return;

            switch (item.type) {
                case 'code':
                    this.extractSQLCommands(item.content, result);
                    break;
                case 'console':
                    this.extractQueryResults(item.content, result);
                    this.extractChartPaths(item.content, result);
                    break;
                case 'error':
                    result.errorMessages.push(item.content);
                    break;
                case 'text':
                case 'message':
                case 'assistant':
                case 'system':
                    if (!result.finalSummary && this.isLikelySummary(item.content)) {
                        result.finalSummary = item.content;
                    }
                    break;
            }
        });

        result.hasValidContent = result.queryData.length > 0 || 
                                result.sqlCommands.length > 0 || 
                                result.chartPaths.length > 0 ||
                                result.finalSummary !== null;

        return result;
    }

    /**
     * Extract SQL commands from code content
     */
    static extractSQLCommands(content, result) {
        const sqlPattern = /(?:SELECT|SHOW|DESCRIBE|DESC|WITH|INSERT|UPDATE|DELETE)[^;]*/gi;
        const matches = content.match(sqlPattern);
        if (matches) {
            result.sqlCommands.push(...matches);
            result.hasValidContent = true;
        }
    }

    /**
     * Extract query results from console output
     */
    static extractQueryResults(content, result) {
        const hasTableData = content.includes('|') || 
                           content.includes('\t') ||
                           content.includes('行') || 
                           content.includes('rows');
        
        if (hasTableData) {
            const preview = content.substring(0, this.CONSTANTS.PREVIEW_LENGTH);
            result.queryData.push(preview);
            result.hasValidContent = true;
        }
    }

    /**
     * Extract chart file paths from console output
     */
    static extractChartPaths(content, result) {
        const htmlPattern = /[\w\u4e00-\u9fa5_\-]+\.html/g;
        const matches = content.match(htmlPattern);
        
        if (matches) {
            // Remove duplicates
            const uniquePaths = [...new Set(matches)];
            result.chartPaths.push(...uniquePaths);
            result.hasValidContent = true;
        }
    }

    /**
     * Format SQL preview with truncation
     */
    static formatSQLPreview(sql, maxLength = null) {
        const length = maxLength || this.CONSTANTS.SQL_PREVIEW_LENGTH;
        const truncated = sql.substring(0, length);
        return `<code>${truncated}${sql.length > length ? '...' : ''}</code>`;
    }

    /**
     * Build status message with appropriate styling
     */
    static buildStatusMessage(type, message, details = null) {
        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        let html = `<p class="${type}">${icons[type] || ''} ${message}</p>`;
        
        if (details) {
            html += `<div class="${type}-details">${details}</div>`;
        }
        
        return html;
    }
}

// Export for use in app.js
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ViewHelpers;
}