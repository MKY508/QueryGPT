// 国际化语言配置
const i18n = {
    zh: {
        // 系统标题
        systemName: 'QueryGPT',
        systemDesc: '智能数据查询与可视化系统',
        
        // 导航菜单
        nav: {
            query: '查询',
            newQuery: '数据查询',
            history: '历史记录',
            settings: '设置',
            basicSettings: '基础设置',
            modelManagement: '模型管理',
            databaseConfig: '数据库配置',
            about: '关于'
        },
        
        // 聊天页面
        chat: {
            title: '数据查询与分析',
            newConversation: '新对话',
            inputPlaceholder: '输入查询内容...',
            welcome: '欢迎使用 QueryGPT 智能数据分析系统',
            welcomeDesc: '我可以帮助您：',
            feature1: '使用自然语言查询数据库',
            feature2: '自动生成数据可视化图表',
            feature3: '智能分析数据并提供洞察',
            tryExample: '试试这些示例：',
            example1: '显示最近一个月的销售数据',
            example2: '分析产品类别的销售占比',
            example3: '查找销售额最高的前10个客户',
            example4: '生成用户增长趋势图',
            exampleBtn1: '查看数据库',
            exampleBtn2: '销售分析',
            exampleBtn3: '产品占比',
            exampleBtn4: '用户趋势',
            hint: '提示：直接输入自然语言查询，系统会自动转换为SQL并生成图表'
        },
        
        // 设置页面
        settings: {
            title: '系统设置',
            language: '语言',
            languageDesc: '选择系统界面语言',
            chinese: '中文',
            english: 'English',
            viewMode: '默认视图模式',
            userMode: '用户模式（简洁）',
            developerMode: '开发者模式（详细）',
            contextRounds: '上下文保留轮数',
            contextDesc: '设置AI记住之前几轮对话的内容，用于错误修正和上下文理解',
            noHistory: '不保留历史（单轮对话）',
            roundHistory: '保留{n}轮历史',
            recommended: '（推荐）',
            mayAffectPerformance: '（可能影响性能）'
        },
        
        // 模型管理
        models: {
            title: '模型管理',
            addModel: '添加模型',
            name: '模型名称',
            type: '类型',
            apiAddress: 'API地址',
            status: '状态',
            actions: '操作',
            available: '可用',
            edit: '编辑',
            test: '测试',
            delete: '删除',
            apiKey: 'API密钥',
            maxTokens: '最大Token数',
            temperature: '温度参数'
        },
        
        // 数据库配置
        database: {
            title: 'Doris数据库配置',
            host: '主机地址',
            hostPlaceholder: '例如: localhost 或 192.168.1.100',
            port: '端口',
            username: '用户名',
            usernamePlaceholder: '数据库用户名',
            password: '密码',
            passwordPlaceholder: '数据库密码',
            dbName: '数据库名',
            dbNamePlaceholder: '留空可跨库查询（推荐）',
            hint: '提示：留空允许跨数据库查询，使用 库名.表名 格式访问任意表',
            testConnection: '测试连接',
            saveConfig: '保存配置',
            connectionSuccess: '连接成功',
            connectionInfo: '数据库连接正常，共发现 {count} 个表'
        },
        
        // 关于页面
        about: {
            title: '关于系统',
            version: '版本',
            developer: '开发者',
            independentDev: '独立开发者',
            organization: '所属单位',
            openSource: '开源项目',
            versionInfo: '版本信息',
            betaVersion: '测试版本',
            updateTime: '更新时间',
            maintaining: '持续维护中',
            features: {
                ai: '智能数据分析',
                database: '数据库查询',
                visualization: '可视化生成'
            },
            license: '许可证说明',
            licenseDetails: {
                openInterpreter: 'OpenInterpreter 核心引擎：',
                openInterpreterLicense: 'MIT许可证',
                openInterpreterDesc: '开源自然语言代码执行引擎，允许商业使用',
                openInterpreterDetail1: '• 本项目使用pip安装的0.4.3版本，遵循MIT许可证',
                openInterpreterDetail2: '• 允许自由使用、修改和部署',
                openInterpreterDetail3: '• 提供自然语言转代码的核心AI能力',
                otherLibs: 'Flask/PyMySQL/Plotly等：',
                otherLibsLicense: 'MIT/BSD许可证',
                otherLibsDesc: '允许商业使用、修改和分发',
                flaskDetail: '• Flask 3.1.1 - 轻量级Web框架，BSD许可证',
                pymysqlDetail: '• PyMySQL 1.1.1 - MySQL数据库连接库，MIT许可证',
                plotlyDetail: '• Plotly 6.3.0 - 数据可视化库，MIT许可证',
                allOpenSource: '• 所有依赖均为开源许可证',
                disclaimer: '免责声明：',
                disclaimerText: '本系统为大模型驱动的工具，开发者对使用过程中可能出现的数据损失或其他问题不承担责任。请在使用前做好数据备份和权限管理。'
            },
            techStack: '技术栈',
            backend: '后端技术',
            frontend: '前端技术',
            usageStatement: '本系统使用声明',
            systemDesc: '本系统基于开源组件开发，采用 MIT 许可证：',
            freeUse: '自由使用、修改和分发',
            commercial: '支持商业和非商业用途',
            copyright: '请保留版权声明',
            contactEmail: '开发者联系邮箱'
        },
        
        // 历史记录
        history: {
            title: '历史记录',
            search: '搜索历史记录...',
            recent: '最近',
            today: '今天',
            thisWeek: '本周',
            loading: '加载中...',
            noRecords: '暂无历史记录',
            deleteConfirm: '确定要删除这个对话吗？此操作无法撤销。',
            cancel: '取消',
            delete: '删除'
        },
        
        // 通用
        common: {
            save: '保存',
            cancel: '取消',
            confirm: '确认',
            close: '关闭',
            loading: '处理中...',
            success: '操作成功',
            error: '操作失败',
            checkingConnection: '检查连接中...'
        },
        
        // 错误消息
        errors: {
            networkError: '网络连接失败',
            loadConfigFailed: '加载配置失败',
            saveConfigFailed: '保存配置失败',
            connectionFailed: '连接失败',
            testConnectionFailed: '连接测试失败',
            saveModelFailed: '保存模型失败',
            deleteModelFailed: '删除模型失败',
            fillRequiredFields: '请填写所有必填字段',
            enterQuery: '请输入查询内容',
            sendFailed: '发送失败，请重试',
            loadConversationFailed: '加载对话失败',
            copyFailed: '复制失败',
            clearCacheFailed: '清空缓存失败',
            apiConnectionSuccess: 'API连接成功！',
            dbConnectionSuccess: '数据库连接成功！',
            configSaved: '配置已保存',
            cacheCleared: '缓存已清空',
            copiedToClipboard: '已复制到剪贴板',
            newConversationStarted: '已开始新对话',
            languageSwitchedZh: '语言已切换为中文',
            languageSwitchedEn: 'Language switched to English',
            serverError: '服务器响应异常，稍后重试',
            permissionError: '无权限执行此操作',
            validationError: '数据格式错误，检查后重试',
            generalError: '发生错误，请重试'
        }
    },
    
    en: {
        // System titles
        systemName: 'QueryGPT',
        systemDesc: 'Intelligent Data Query & Visualization System',
        
        // Navigation menu
        nav: {
            query: 'Query',
            newQuery: 'Data Query',
            history: 'History',
            settings: 'Settings',
            basicSettings: 'Basic Settings',
            modelManagement: 'Model Management',
            databaseConfig: 'Database Config',
            about: 'About'
        },
        
        // Chat page
        chat: {
            title: 'Data Query & Analysis',
            newConversation: 'New Chat',
            inputPlaceholder: 'Enter your query...',
            welcome: 'Welcome to QueryGPT Intelligent Data Analysis System',
            welcomeDesc: 'I can help you:',
            feature1: 'Query databases using natural language',
            feature2: 'Automatically generate data visualizations',
            feature3: 'Intelligently analyze data and provide insights',
            tryExample: 'Try these examples:',
            example1: 'Show sales data for the last month',
            example2: 'Analyze sales distribution by product category',
            example3: 'Find top 10 customers by sales amount',
            example4: 'Generate user growth trend chart',
            exampleBtn1: 'View Database',
            exampleBtn2: 'Sales Analysis',
            exampleBtn3: 'Product Mix',
            exampleBtn4: 'User Trends',
            hint: 'Tip: Enter natural language queries, and the system will automatically convert them to SQL and generate charts'
        },
        
        // Settings page
        settings: {
            title: 'System Settings',
            language: 'Language',
            languageDesc: 'Select system interface language',
            chinese: '中文',
            english: 'English',
            viewMode: 'Default View Mode',
            userMode: 'User Mode (Simple)',
            developerMode: 'Developer Mode (Detailed)',
            contextRounds: 'Context History Rounds',
            contextDesc: 'Set how many conversation rounds AI remembers for error correction and context understanding',
            noHistory: 'No history (Single round)',
            roundHistory: 'Keep {n} round(s) history',
            recommended: '(Recommended)',
            mayAffectPerformance: '(May affect performance)'
        },
        
        // Model management
        models: {
            title: 'Model Management',
            addModel: 'Add Model',
            name: 'Model Name',
            type: 'Type',
            apiAddress: 'API Address',
            status: 'Status',
            actions: 'Actions',
            available: 'Available',
            edit: 'Edit',
            test: 'Test',
            delete: 'Delete',
            apiKey: 'API Key',
            maxTokens: 'Max Tokens',
            temperature: 'Temperature'
        },
        
        // Database configuration
        database: {
            title: 'Doris Database Configuration',
            host: 'Host Address',
            hostPlaceholder: 'e.g., localhost or 192.168.1.100',
            port: 'Port',
            username: 'Username',
            usernamePlaceholder: 'Database username',
            password: 'Password',
            passwordPlaceholder: 'Database password',
            dbName: 'Database Name',
            dbNamePlaceholder: 'Leave empty for cross-database queries (recommended)',
            hint: 'Hint: Leave empty to enable cross-database queries, use database.table format',
            testConnection: 'Test Connection',
            saveConfig: 'Save Config',
            connectionSuccess: 'Connection Successful',
            connectionInfo: 'Database connected, found {count} table(s)'
        },
        
        // About page
        about: {
            title: 'About System',
            version: 'Version',
            developer: 'Developer',
            independentDev: 'Independent Developer',
            organization: 'Organization',
            openSource: 'Open Source Project',
            versionInfo: 'Version Info',
            betaVersion: 'Beta Version',
            updateTime: 'Update Time',
            maintaining: 'Under Maintenance',
            features: {
                ai: 'AI Data Analysis',
                database: 'Database Query',
                visualization: 'Visualization Generation'
            },
            license: 'License Statement',
            licenseDetails: {
                openInterpreter: 'OpenInterpreter Core Engine:',
                openInterpreterLicense: 'MIT License',
                openInterpreterDesc: 'Open source natural language code execution engine, allows commercial use',
                openInterpreterDetail1: '• This project uses pip installed version 0.4.3, follows MIT license',
                openInterpreterDetail2: '• Free to use, modify and deploy',
                openInterpreterDetail3: '• Provides core AI capabilities for natural language to code',
                otherLibs: 'Flask/PyMySQL/Plotly etc:',
                otherLibsLicense: 'MIT/BSD License',
                otherLibsDesc: 'Allows commercial use, modification and distribution',
                flaskDetail: '• Flask 3.1.1 - Lightweight web framework, BSD license',
                pymysqlDetail: '• PyMySQL 1.1.1 - MySQL database connection library, MIT license',
                plotlyDetail: '• Plotly 6.3.0 - Data visualization library, MIT license',
                allOpenSource: '• All dependencies are open source licensed',
                disclaimer: 'Disclaimer:',
                disclaimerText: 'This system is an AI-powered tool. The developer is not responsible for any data loss or other issues that may occur during use. Please backup your data and manage permissions before use.'
            },
            techStack: 'Technology Stack',
            backend: 'Backend Technologies',
            frontend: 'Frontend Technologies',
            usageStatement: 'System Usage Statement',
            systemDesc: 'This system is developed based on open source components, using MIT license:',
            freeUse: 'Free to use, modify, and distribute',
            commercial: 'Supports commercial and non-commercial use',
            copyright: 'Please retain copyright notice',
            contactEmail: 'Developer Contact Email'
        },
        
        // History
        history: {
            title: 'History',
            search: 'Search history...',
            recent: 'Recent',
            today: 'Today',
            thisWeek: 'This Week',
            loading: 'Loading...',
            noRecords: 'No history records',
            deleteConfirm: 'Are you sure you want to delete this conversation? This action cannot be undone.',
            cancel: 'Cancel',
            delete: 'Delete'
        },
        
        // Common
        common: {
            save: 'Save',
            cancel: 'Cancel',
            confirm: 'Confirm',
            close: 'Close',
            loading: 'Processing...',
            success: 'Success',
            error: 'Failed',
            checkingConnection: 'Checking connection...'
        },
        
        // Error messages
        errors: {
            networkError: 'Network connection failed',
            loadConfigFailed: 'Failed to load configuration',
            saveConfigFailed: 'Failed to save configuration',
            connectionFailed: 'Connection failed',
            testConnectionFailed: 'Connection test failed',
            saveModelFailed: 'Failed to save model',
            deleteModelFailed: 'Failed to delete model',
            fillRequiredFields: 'Please fill in all required fields',
            enterQuery: 'Please enter a query',
            sendFailed: 'Send failed, please try again',
            loadConversationFailed: 'Failed to load conversation',
            copyFailed: 'Copy failed',
            clearCacheFailed: 'Failed to clear cache',
            apiConnectionSuccess: 'API connection successful!',
            dbConnectionSuccess: 'Database connection successful!',
            configSaved: 'Configuration saved',
            cacheCleared: 'Cache cleared',
            copiedToClipboard: 'Copied to clipboard',
            newConversationStarted: 'New conversation started',
            languageSwitchedZh: '语言已切换为中文',
            languageSwitchedEn: 'Language switched to English',
            serverError: 'Server error, please try again later',
            permissionError: 'Permission denied',
            validationError: 'Invalid data format',
            generalError: 'An error occurred, please try again'
        }
    }
};

// 语言管理器
class LanguageManager {
    constructor() {
        this.currentLang = localStorage.getItem('language') || 'zh';
        this.translations = i18n;
    }
    
    // 获取当前语言
    getCurrentLanguage() {
        return this.currentLang;
    }
    
    // 设置语言
    setLanguage(lang) {
        if (this.translations[lang]) {
            this.currentLang = lang;
            localStorage.setItem('language', lang);
            this.updatePageLanguage();
            return true;
        }
        return false;
    }
    
    // 获取翻译文本
    t(key) {
        const keys = key.split('.');
        let value = this.translations[this.currentLang];
        
        for (const k of keys) {
            if (value && value[k]) {
                value = value[k];
            } else {
                // 如果找不到翻译，返回key本身
                return key;
            }
        }
        
        return value;
    }
    
    // 更新页面语言
    updatePageLanguage() {
        // 更新所有带有 data-i18n 属性的元素
        document.querySelectorAll('[data-i18n]').forEach(element => {
            const key = element.getAttribute('data-i18n');
            const translation = this.t(key);
            
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                // 对于输入框，更新placeholder
                element.placeholder = translation;
            } else if (element.tagName === 'SPAN' || !element.querySelector('i')) {
                // 对于span标签或没有图标的元素，直接更新文本
                element.textContent = translation;
            } else {
                // 对于包含图标的元素，保留图标和其他子元素
                const icons = element.querySelectorAll('i');
                const spans = element.querySelectorAll('span[data-i18n]');
                
                if (spans.length > 0) {
                    // 如果有子span带data-i18n，递归处理
                    // 父元素不做处理
                } else if (icons.length > 0) {
                    // 保留所有图标，更新文本节点
                    const childNodes = Array.from(element.childNodes);
                    childNodes.forEach(node => {
                        if (node.nodeType === Node.TEXT_NODE) {
                            node.textContent = ' ' + translation;
                        }
                    });
                    
                    // 如果没有文本节点，添加一个
                    const hasTextNode = childNodes.some(node => node.nodeType === Node.TEXT_NODE);
                    if (!hasTextNode) {
                        element.appendChild(document.createTextNode(' ' + translation));
                    }
                } else {
                    element.textContent = translation;
                }
            }
        });
        
        // 更新select选项中的固定文本
        this.updateSelectOptions();
        
        // 触发自定义事件，通知其他组件语言已更改
        window.dispatchEvent(new CustomEvent('languageChanged', { 
            detail: { language: this.currentLang } 
        }));
    }
    
    // 更新select选项的文本
    updateSelectOptions() {
        // 更新视图模式选项
        const viewModeSelect = document.getElementById('default-view-mode');
        if (viewModeSelect) {
            viewModeSelect.options[0].textContent = this.t('settings.userMode');
            viewModeSelect.options[1].textContent = this.t('settings.developerMode');
        }
        
        // 更新上下文轮数选项
        const contextSelect = document.getElementById('context-rounds');
        if (contextSelect) {
            contextSelect.options[0].textContent = this.t('settings.noHistory');
            contextSelect.options[1].textContent = this.format('settings.roundHistory', {n: 1});
            contextSelect.options[2].textContent = this.format('settings.roundHistory', {n: 2});
            contextSelect.options[3].textContent = this.format('settings.roundHistory', {n: 3}) + ' ' + this.t('settings.recommended');
            contextSelect.options[4].textContent = this.format('settings.roundHistory', {n: 5});
            contextSelect.options[5].textContent = this.format('settings.roundHistory', {n: 10}) + ' ' + this.t('settings.mayAffectPerformance');
        }
    }
    
    // 格式化带参数的文本
    format(key, params) {
        let text = this.t(key);
        if (params) {
            Object.keys(params).forEach(param => {
                text = text.replace(`{${param}}`, params[param]);
            });
        }
        return text;
    }
}

// 创建全局实例
window.i18nManager = new LanguageManager();

// 页面加载完成后初始化，增加延迟确保所有元素都已渲染
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // 延迟执行，确保其他脚本已初始化
        setTimeout(() => {
            window.i18nManager.updatePageLanguage();
        }, 100);
    });
} else {
    // 如果DOM已加载，直接执行
    setTimeout(() => {
        window.i18nManager.updatePageLanguage();
    }, 100);
}