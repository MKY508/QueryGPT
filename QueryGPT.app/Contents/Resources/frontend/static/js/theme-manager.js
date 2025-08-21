/**
 * Theme Manager
 * 主题管理器 - 支持明亮/深色模式切换
 */

class ThemeManager {
    constructor() {
        this.currentTheme = 'auto';
        this.init();
    }

    init() {
        // 从本地存储获取主题设置
        this.currentTheme = localStorage.getItem('theme') || 'auto';
        
        // 应用主题
        this.applyTheme(this.currentTheme);
        
        // 监听系统主题变化
        this.setupSystemThemeListener();
        
        // 创建主题切换按钮
        this.createThemeToggle();
    }

    applyTheme(theme) {
        const html = document.documentElement;
        
        // 移除现有主题类
        html.removeAttribute('data-theme');
        
        switch (theme) {
            case 'light':
                html.setAttribute('data-theme', 'light');
                break;
            case 'dark':
                html.setAttribute('data-theme', 'dark');
                break;
            case 'auto':
            default:
                // 使用系统偏好
                const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
                if (prefersDark) {
                    html.setAttribute('data-theme', 'dark');
                } else {
                    html.setAttribute('data-theme', 'light');
                }
                break;
        }
        
        // 更新主题图标
        this.updateThemeIcon(theme);
        
        // 保存到本地存储
        localStorage.setItem('theme', theme);
        this.currentTheme = theme;
        
        // 触发主题变化事件
        window.dispatchEvent(new CustomEvent('themeChanged', { 
            detail: { theme: this.getEffectiveTheme() }
        }));
    }

    getEffectiveTheme() {
        if (this.currentTheme === 'auto') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        return this.currentTheme;
    }

    setupSystemThemeListener() {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        
        mediaQuery.addEventListener('change', (e) => {
            if (this.currentTheme === 'auto') {
                this.applyTheme('auto');
            }
        });
    }

    createThemeToggle() {
        // 查找侧边栏底部插入主题切换按钮
        const sidebarFooter = document.querySelector('.sidebar-footer');
        if (!sidebarFooter) return;

        // 创建主题切换容器
        const themeToggleContainer = document.createElement('div');
        themeToggleContainer.className = 'theme-toggle-container';
        themeToggleContainer.innerHTML = `
            <div class="theme-toggle">
                <button class="theme-btn" data-theme="light" title="明亮模式">
                    <i class="fas fa-sun"></i>
                </button>
                <button class="theme-btn" data-theme="auto" title="跟随系统">
                    <i class="fas fa-circle-half-stroke"></i>
                </button>
                <button class="theme-btn" data-theme="dark" title="深色模式">
                    <i class="fas fa-moon"></i>
                </button>
                <div class="theme-indicator"></div>
            </div>
        `;

        // 添加样式
        const style = document.createElement('style');
        style.textContent = `
            .theme-toggle-container {
                margin-top: var(--spacing-4);
                padding-top: var(--spacing-4);
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }

            .theme-toggle {
                display: flex;
                background: rgba(255, 255, 255, 0.1);
                border-radius: var(--radius-full);
                padding: 2px;
                position: relative;
            }

            .theme-btn {
                flex: 1;
                background: transparent;
                border: none;
                color: rgba(255, 255, 255, 0.7);
                cursor: pointer;
                padding: var(--spacing-2) var(--spacing-3);
                border-radius: var(--radius-full);
                font-size: var(--text-sm);
                transition: all var(--duration-fast) var(--ease-out);
                position: relative;
                z-index: 2;
            }

            .theme-btn:hover {
                color: rgba(255, 255, 255, 0.9);
                background: rgba(255, 255, 255, 0.1);
            }

            .theme-btn.active {
                color: var(--primary-700);
            }

            .theme-indicator {
                position: absolute;
                top: 2px;
                width: calc(33.333% - 2px);
                height: calc(100% - 4px);
                background: rgba(255, 255, 255, 0.9);
                border-radius: var(--radius-full);
                transition: transform var(--duration-normal) var(--ease-out);
                box-shadow: var(--shadow-sm);
            }

            .theme-indicator.light { transform: translateX(0); }
            .theme-indicator.auto { transform: translateX(100%); }
            .theme-indicator.dark { transform: translateX(200%); }
        `;
        document.head.appendChild(style);

        // 插入到侧边栏
        sidebarFooter.appendChild(themeToggleContainer);

        // 添加事件监听器
        const themeButtons = themeToggleContainer.querySelectorAll('.theme-btn');
        const indicator = themeToggleContainer.querySelector('.theme-indicator');

        themeButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const theme = e.currentTarget.dataset.theme;
                this.applyTheme(theme);
            });
        });

        // 初始状态
        this.updateThemeIcon(this.currentTheme);
    }

    updateThemeIcon(theme) {
        const themeButtons = document.querySelectorAll('.theme-btn');
        const indicator = document.querySelector('.theme-indicator');
        
        if (themeButtons.length === 0) return;

        // 更新按钮状态
        themeButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });

        // 更新指示器位置
        if (indicator) {
            indicator.className = `theme-indicator ${theme}`;
        }
    }

    // 公共方法
    setTheme(theme) {
        if (['light', 'dark', 'auto'].includes(theme)) {
            this.applyTheme(theme);
        }
    }

    getTheme() {
        return this.currentTheme;
    }

    toggleTheme() {
        const themes = ['light', 'auto', 'dark'];
        const currentIndex = themes.indexOf(this.currentTheme);
        const nextIndex = (currentIndex + 1) % themes.length;
        this.setTheme(themes[nextIndex]);
    }

    // 针对特定组件的主题适配
    adaptComponent(element, options = {}) {
        const effectiveTheme = this.getEffectiveTheme();
        const { lightClass = 'light-theme', darkClass = 'dark-theme' } = options;
        
        element.classList.remove(lightClass, darkClass);
        element.classList.add(effectiveTheme === 'dark' ? darkClass : lightClass);
    }

    // 获取当前主题的CSS变量值
    getThemeVariable(variableName) {
        return getComputedStyle(document.documentElement)
            .getPropertyValue(variableName)
            .trim();
    }

    // 动态更新CSS变量（用于主题自定义）
    setThemeVariable(variableName, value) {
        document.documentElement.style.setProperty(variableName, value);
    }
}

// 创建全局实例
window.ThemeManager = new ThemeManager();

// 导出供其他模块使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ThemeManager;
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', () => {
    // 添加页面加载动画
    document.body.classList.add('page-enter');
    
    // 监听主题变化，更新图表等组件
    window.addEventListener('themeChanged', (e) => {
        console.log('Theme changed to:', e.detail.theme);
        
        // 如果存在图表，重新渲染以适配新主题
        if (window.Plotly && window.currentCharts) {
            window.currentCharts.forEach(chart => {
                // 这里可以添加图表主题更新逻辑
                // Plotly.relayout(chart.element, chart.getLayoutForTheme(e.detail.theme));
            });
        }
    });
});

// 为开发者提供的调试工具
window.debugTheme = {
    getCurrentTheme: () => window.ThemeManager.getTheme(),
    setTheme: (theme) => window.ThemeManager.setTheme(theme),
    getEffectiveTheme: () => window.ThemeManager.getEffectiveTheme(),
    getVariable: (name) => window.ThemeManager.getThemeVariable(name),
    setVariable: (name, value) => window.ThemeManager.setThemeVariable(name, value)
};