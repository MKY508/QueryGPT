/**
 * Safe Inspired UI JavaScript
 * 参考Perplexity交互理念但完全原创的实现
 * 遵循MIT许可证，避免版权问题
 */

class SafeInspiredUI {
    constructor() {
        this.initializeElements();
        this.bindEvents();
        this.setupAnimations();
    }

    initializeElements() {
        this.queryInput = document.getElementById('queryInput');
        this.sendButton = document.getElementById('sendQuery');
        this.thinkingProcess = document.getElementById('thinkingProcess');
        this.thinkingSteps = document.getElementById('thinkingSteps');
        this.resultCard = document.getElementById('resultCard');
        this.sqlCode = document.getElementById('sqlCode');
        this.chartContainer = document.getElementById('chartContainer');
        this.dataTable = document.getElementById('dataTable');
    }

    bindEvents() {
        // 发送查询事件
        this.sendButton.addEventListener('click', () => this.handleQuery());
        this.queryInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.ctrlKey) {
                this.handleQuery();
            }
        });

        // 快捷查询按钮
        document.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.queryInput.value = e.target.textContent;
                this.handleQuery();
            });
        });

        // 输入框自适应高度
        this.queryInput.addEventListener('input', () => {
            this.autoResizeTextarea();
        });
    }

    setupAnimations() {
        // 页面加载动画
        this.animatePageLoad();

        // 滚动动画
        this.setupScrollAnimations();
    }

    // 处理用户查询
    async handleQuery() {
        const query = this.queryInput.value.trim();
        if (!query) return;

        // 禁用输入和按钮
        this.setLoadingState(true);

        try {
            // 显示思考过程
            this.showThinkingProcess();

            // 模拟AI思考步骤
            await this.simulateThinking(query);

            // 发送实际请求
            const response = await this.sendQueryToAPI(query);

            // 显示结果
            this.displayResults(response);

        } catch (error) {
            this.showError(error.message);
        } finally {
            this.setLoadingState(false);
        }
    }

    // 显示思考过程（原创动画效果）
    showThinkingProcess() {
        this.thinkingProcess.classList.remove('hidden');
        this.resultCard.classList.add('hidden');
        this.thinkingSteps.innerHTML = '';

        // 滚动到思考区域
        this.thinkingProcess.scrollIntoView({
            behavior: 'smooth',
            block: 'center'
        });
    }

    // 模拟AI思考步骤
    async simulateThinking(query) {
        const steps = [
            { text: '🔍 正在分析您的查询意图...', delay: 800 },
            { text: '🧠 理解数据需求和业务逻辑...', delay: 1200 },
            { text: '💾 构建SQL查询语句...', delay: 1000 },
            { text: '⚡ 执行数据库查询...', delay: 800 },
            { text: '📊 生成数据可视化...', delay: 600 }
        ];

        for (const step of steps) {
            await this.addThinkingStep(step.text);
            await this.delay(step.delay);
        }
    }

    // 添加思考步骤
    async addThinkingStep(text) {
        const stepElement = document.createElement('div');
        stepElement.className = 'thinking-step flex items-center space-x-2 p-2 rounded-lg bg-blue-50';
        stepElement.innerHTML = `
            <div class="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            <span>${text}</span>
        `;

        this.thinkingSteps.appendChild(stepElement);

        // 滚动到最新步骤
        stepElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        return this.delay(100);
    }

    // 发送API请求
    async sendQueryToAPI(query) {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: query,
                mode: 'analysis',
                stream: false
            })
        });

        if (!response.ok) {
            throw new Error(`请求失败: ${response.status}`);
        }

        return await response.json();
    }

    // 显示查询结果
    displayResults(data) {
        // 隐藏思考过程，显示结果
        this.thinkingProcess.classList.add('hidden');
        this.resultCard.classList.remove('hidden');

        // 显示SQL代码
        if (data.sql) {
            this.displaySQL(data.sql);
        }

        // 显示数据表格
        if (data.data) {
            this.displayDataTable(data.data);
        }

        // 显示图表
        if (data.visualization) {
            this.displayChart(data.visualization);
        }

        // 添加结果显示动画
        this.animateResultCard();

        // 滚动到结果区域
        this.resultCard.scrollIntoView({
            behavior: 'smooth',
            block: 'start'
        });
    }

    // 显示SQL代码（带高亮）
    displaySQL(sql) {
        // 简单的SQL语法高亮
        const highlightedSQL = this.highlightSQL(sql);
        this.sqlCode.innerHTML = highlightedSQL;

        // 添加复制功能
        this.addCopyButton(this.sqlCode.parentElement);
    }

    // SQL语法高亮
    highlightSQL(sql) {
        const keywords = ['SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN'];
        let highlighted = sql;

        keywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            highlighted = highlighted.replace(regex, `<span class="text-blue-600 font-semibold">${keyword}</span>`);
        });

        return highlighted;
    }

    // 显示数据表格
    displayDataTable(data) {
        if (!data || data.length === 0) {
            this.dataTable.innerHTML = '<p class="text-gray-500 text-center py-8">暂无数据</p>';
            return;
        }

        const headers = Object.keys(data[0]);

        let tableHTML = `
            <table class="data-table w-full">
                <thead>
                    <tr>
                        ${headers.map(header => `<th>${header}</th>`).join('')}
                    </tr>
                </thead>
                <tbody>
                    ${data.map(row => `
                        <tr>
                            ${headers.map(header => `<td>${row[header] || '-'}</td>`).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;

        this.dataTable.innerHTML = tableHTML;
    }

    // 显示图表（使用Chart.js或类似库）
    displayChart(chartData) {
        // 这里可以集成Chart.js, D3.js等图表库
        this.chartContainer.innerHTML = `
            <div class="text-center py-8">
                <div class="inline-block p-4 bg-blue-100 rounded-full mb-4">
                    <i class="fas fa-chart-line text-2xl text-blue-600"></i>
                </div>
                <h4 class="text-lg font-semibold text-gray-800 mb-2">数据可视化</h4>
                <p class="text-gray-600">图表功能正在开发中...</p>
            </div>
        `;
    }

    // 添加复制按钮
    addCopyButton(container) {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'absolute top-2 right-2 px-3 py-1 bg-gray-600 text-white text-sm rounded hover:bg-gray-700 transition-colors';
        copyBtn.innerHTML = '<i class="fas fa-copy mr-1"></i>复制';
        copyBtn.style.position = 'absolute';

        container.style.position = 'relative';
        container.appendChild(copyBtn);

        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(this.sqlCode.textContent);
            copyBtn.innerHTML = '<i class="fas fa-check mr-1"></i>已复制';
            setTimeout(() => {
                copyBtn.innerHTML = '<i class="fas fa-copy mr-1"></i>复制';
            }, 2000);
        });
    }

    // 结果卡片动画
    animateResultCard() {
        this.resultCard.style.opacity = '0';
        this.resultCard.style.transform = 'translateY(20px)';

        setTimeout(() => {
            this.resultCard.style.transition = 'all 0.6s ease-out';
            this.resultCard.style.opacity = '1';
            this.resultCard.style.transform = 'translateY(0)';
        }, 100);
    }

    // 页面加载动画
    animatePageLoad() {
        const elements = document.querySelectorAll('.animate-on-load');
        elements.forEach((el, index) => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(30px)';

            setTimeout(() => {
                el.style.transition = 'all 0.6s ease-out';
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            }, index * 200);
        });
    }

    // 滚动动画设置
    setupScrollAnimations() {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('animate-in');
                }
            });
        }, { threshold: 0.1 });

        document.querySelectorAll('.animate-on-scroll').forEach(el => {
            observer.observe(el);
        });
    }

    // 自适应文本框高度
    autoResizeTextarea() {
        this.queryInput.style.height = 'auto';
        this.queryInput.style.height = Math.min(this.queryInput.scrollHeight, 200) + 'px';
    }

    // 设置加载状态
    setLoadingState(loading) {
        this.sendButton.disabled = loading;
        this.queryInput.disabled = loading;

        if (loading) {
            this.sendButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span class="hidden sm:inline">处理中...</span>';
        } else {
            this.sendButton.innerHTML = '<i class="fas fa-paper-plane"></i><span class="hidden sm:inline">发送</span>';
        }
    }

    // 显示错误信息
    showError(message) {
        this.thinkingProcess.classList.add('hidden');

        const errorHTML = `
            <div class="bg-red-50 border-l-4 border-red-500 p-4 rounded-lg">
                <div class="flex items-center">
                    <i class="fas fa-exclamation-triangle text-red-500 mr-2"></i>
                    <span class="text-red-700">查询处理失败: ${message}</span>
                </div>
            </div>
        `;

        this.resultCard.innerHTML = errorHTML;
        this.resultCard.classList.remove('hidden');
    }

    // 延迟函数
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    new SafeInspiredUI();

    // 添加一些交互增强
    enhanceUIInteractions();
});

// UI交互增强函数
function enhanceUIInteractions() {
    // 添加工具提示
    document.querySelectorAll('[data-tooltip]').forEach(element => {
        element.classList.add('tooltip');
    });

    // 卡片悬浮效果
    document.querySelectorAll('.card-hover').forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-4px)';
            this.style.boxShadow = '0 10px 25px rgba(0,0,0,0.1)';
        });

        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
            this.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
        });
    });

    // 平滑滚动
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        });
    });
}