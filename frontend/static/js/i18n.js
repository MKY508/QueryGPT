// 国际化语言配置
const i18nLogger = (function resolveI18nLogger() {
    const fallback = {};
    ['error', 'warn', 'info', 'debug', 'trace'].forEach((level) => {
        fallback[level] = (...args) => {
            if (window.console && typeof window.console[level] === 'function') {
                window.console[level](...args);
            } else if (window.console && typeof window.console.log === 'function') {
                window.console.log(...args);
            }
        };
    });

    const getActiveLogger = () => {
        if (window.loggerFactory && typeof window.loggerFactory.createSafeLogger === 'function') {
            return window.loggerFactory.createSafeLogger('frontend:i18n');
        }
        if (window.Logger && typeof window.Logger.getLogger === 'function') {
            return window.Logger.getLogger('frontend:i18n');
        }
        return fallback;
    };

    return {
        error: (...args) => getActiveLogger().error(...args),
        warn: (...args) => getActiveLogger().warn(...args),
        info: (...args) => getActiveLogger().info(...args),
        debug: (...args) => getActiveLogger().debug(...args),
        trace: (...args) => getActiveLogger().trace(...args)
    };
})();

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
            promptSettings: 'Prompt设置',
            about: '关于'
        },
        
        // 聊天页面
        chat: {
            title: '数据查询与分析',
            newConversation: '新对话',
            onboarding: '引导',
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
            hint: '提示：直接输入自然语言查询，系统会自动转换为SQL并生成图表',
            userView: '用户视图',
            developerView: '开发者视图',
            analysisComplete: '分析完成',
            executionComplete: '执行完成',
            finalOutput: '最终输出',
            needChart: '需要图表？尝试在查询中明确要求"生成图表"或"可视化展示"'
        },
        // 新手引导
        onboarding: {
            step1Title: '欢迎使用 QueryGPT',
            step1Content: '这是您的智能数据分析助手，让我快速带您了解主要功能',
            step2Title: '自然语言查询',
            step2Content: '在这里输入您的问题，比如"显示最近30天的销售数据"',
            step3Title: '发送查询',
            step3Content: '点击这里或按 Enter 键发送',
            step4Title: '切换AI模型',
            step4Content: '选择不同的AI模型以获得最佳效果',
            step5Title: '查看历史',
            step5Content: '这里可以查看所有查询历史',
            step6Title: '系统设置',
            step6Content: '在这里配置数据库连接和其他选项',
            buttons: {
                prev: '上一步',
                next: '下一步',
                complete: '完成',
                skip: '跳过',
                close: '关闭'
            },
            confirmSkipTitle: '跳过新手引导',
            confirmSkipMessage: '确定要跳过新手引导吗？\n您可以稍后在帮助菜单中重新启动引导。',
            confirmSkipContinue: '继续引导',
            confirmSkipConfirm: '跳过',
            endConfirmMessage: '要结束新手引导吗？',
            finishedToast: '新手引导完成！开始探索 QueryGPT 吧'
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
            mayAffectPerformance: '（可能影响性能）',
            smartRouting: '智能路由',
            smartRoutingStatus: '已启用',
            smartRoutingDesc: '使用AI智能判断查询类型，自动选择最优执行路径，可显著提升简单查询的响应速度',
            smartRoutingEnabled: '智能路由已启用',
            smartRoutingDisabled: '智能路由已禁用',
            smartRoutingToggleFailed: '切换失败，请重试',
            dbGuard: '数据库守卫',
            dbGuardDesc: '运行前自动测试数据库连通性，失败时提醒用户并可选择继续执行。',
            dbGuardWarn: '失败时提醒并允许继续执行',
            dbGuardEnabled: '数据库守卫已启用',
            dbGuardDisabled: '数据库守卫已禁用',
            dbGuardWarnOn: '失败时将提醒并允许继续执行',
            dbGuardWarnOff: '失败时不再自动弹窗提醒',
            thoughtStream: '步骤播报',
            thoughtStreamDesc: '在执行每个主要动作前输出简短说明，实时展示智能助手的思考过程。',
            thoughtStreamEnabled: '步骤播报已启用',
            thoughtStreamDisabled: '步骤播报已关闭',
            thoughtTemplateZh: '步骤模板（中文）',
            thoughtTemplateEn: '步骤模板（英文）',
            thoughtTemplateHint: '使用 {index} 表示步骤编号，{summary} 表示操作说明。',
            thoughtTemplateHintEn: 'Use {index} for the step number and {summary} for the action description.',
            thoughtTemplateSaved: '模板已保存',
            featureUpdateFailed: '更新失败，请重试',
            toggleOn: '已启用',
            toggleOff: '已关闭'
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
            unavailable: '未配置',
            edit: '编辑',
            test: '测试',
            delete: '删除',
            apiKey: 'API密钥',
            maxTokens: '最大Token数',
            temperature: '温度参数',
            modelNamePlaceholder: '例如: GPT-4',
            modelIdPlaceholder: '例如: gpt-4',
            apiBasePlaceholder: '例如: http://localhost:11434/v1',
            apiKeyPlaceholder: '输入API密钥'
        },
        
        // 数据库配置
        database: {
            title: 'MySQL数据库配置',
            compatibility: '兼容所有 MySQL 协议数据库：OLAP（Doris、StarRocks、ClickHouse）、NewSQL（TiDB、OceanBase）',
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
        
        // Prompt设置
        prompts: {
            title: 'Prompt设置',
            description: '自定义查询模块使用的提示词，可以根据您的业务需求调整AI的行为模式。',
            routingPrompt: '智能路由提示词',
            routingClassifier: '路由分类策略',
            routingStrategy: '路由策略',
            exploration: '数据库探索策略',
            simpleAnalysisPrompt: '简单分析提示词',
            complexAnalysisPrompt: '复杂分析提示词（默认）',
            visualizationPrompt: '可视化提示词',
            databaseQuery: '数据库查询提示词',
            businessTerms: '业务术语',
            tableSelection: '表选择策略',
            fieldMapping: '字段识别规则',
            dataProcessing: '数据处理规则',
            outputRequirements: '输出要求',
            save: '保存设置',
            reset: '恢复默认',
            export: '导出配置',
            import: '导入配置',
            tipsTitle: '使用提示',
            tip1: '修改提示词可以让AI更好地理解您的业务场景',
            tip2: '建议先备份当前配置再进行修改',
            tip3: '恢复默认会将所有提示词重置为系统默认值',
            tip4: '支持导入导出配置，方便在不同环境间迁移',
            saveSuccess: 'Prompt设置已保存',
            resetSuccess: '已恢复默认设置',
            exportSuccess: '配置已导出',
            importSuccess: '配置已导入',
            saveFailed: '保存失败，请重试',
            resetFailed: '恢复默认失败，请重试',
            importFailed: '导入失败，请检查文件格式'
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
            stableVersion: '正式版本',
            updateTime: '更新时间',
            maintaining: '持续维护中',
            releaseDate: '2025年11月',
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
            checkingConnection: '检查连接中...',
            thinking: '正在思考中...',
            thinkingTitle: '正在思考...',
            processing: '正在处理...',
            stopping: '正在停止查询...',
            stopped: '查询已取消',
            interrupted: '查询已被用户中断',
            interruptedMessage: '⚠️ 查询已被用户中断',
            testingModel: '正在测试模型连接...',
            testingDatabase: '正在测试数据库连接...',
            testingConnection: '正在测试连接...',
            deletingConversation: '正在删除对话...',
            processingRequest: '正在处理上一个请求，请稍候...',
            openingVisualization: '正在打开可视化结果...',
            generatingQuery: '正在生成最佳查询方案...',
            optimizingQuery: '正在优化查询语句...',
            continuousTip: '支持连续对话，可基于上次结果继续提问',
            dataMining: '数据挖掘中，请稍候...',
            understandingRequest: '理解需求中...',
            analyzingRequirements: '分析需求...',
            connectingDatabase: '连接数据库中...',
            processingData: '数据处理中，马上就好...',
            parsingDataStructure: '解析数据结构中...',
            step: '步骤',
            codeExecution: '代码执行',
            summary: '总结',
            system: '系统',
            output: '输出',
            console: '控制台',
            message: '消息',
            error: '错误',
            exception: '异常',
            noDetailedSteps: '无详细执行步骤信息',
            
            // Tips系统
            tips: {
                detailed: '描述越详细，查询越精准',
                naturalLanguage: '支持自然语言查询，如"上个月的销售额"',
                flexibleTime: '时间描述灵活：本周、上季度、2024年Q3都能识别',
                autoChart: '查询结果会自动生成图表',
                continuous: '支持连续对话，可基于上次结果继续提问',
                comparison: '试试对比分析："对比今年和去年的数据"',
                examples: '示例："本月销售TOP10" 或 "华东地区营收"',
                ranking: '支持排名查询："销售前5名"',
                trend: '可分析趋势："最近6个月销售趋势"',
                followUp: '可以追问："按月份分组" 或 "加上同比"',
                filter: '支持条件筛选："毛利率>30%的产品"',
                doubleClick: '双击图表可放大查看',
                tabKey: '按Tab键快速切换输入框',
                help: '输入"帮助"查看更多功能',
                
                // 深夜关怀
                lateNight1: '夜深了，查完这个就休息吧~',
                lateNight2: '凌晨时分，注意保护眼睛哦',
                lateNight3: '深夜工作辛苦了，记得适当休息',
                lateNight4: '这么晚还在努力，您真是太拼了！',
                lateNight5: '夜猫子模式已激活，但健康更重要哦',
                midnight: '已经过了午夜，早点休息对身体好哦',
                earlyMorning: '凌晨了，健康比数据更重要'
            }
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
        },
        
        // 新增通知消息
        notifications: {
            apiConnected: 'API连接成功！',
            modelSaved: '模型配置已保存',
            saveFailed: '保存失败',
            dbConnected: '数据库连接成功！',
            dbConfigSaved: '数据库配置已保存',
            uiSettingsSaved: '界面设置已保存',
            sendFailed: '发送失败，请重试',
            requestFailed: '处理请求失败。检查网络连接或稍后重试。'
        },

        warnings: {
            dbUnavailable: '数据库连接失败，请先完成配置或稍后重试。',
            dbWarningTitle: '数据库连接失败',
            dbWarningDesc: '当前无法连接数据库，相关操作已暂停。',
            dbHint: '最近尝试',
            dbTarget: '目标',
            dbUser: '用户',
            dbCheckedAt: '上次检测',
            dbAutoDismiss: '提示将在',
            dbContinue: '继续执行',
            dbForce: '已忽略数据库检查，正在继续执行…',
            dbConfigure: '前往設定',
            seconds: '秒後自動隱藏。'
        },
        
        // 查询相关
        query: {
            executeComplete: '查询执行完成',
            loadingChart: '加载图表中...',
            chartLoadFailed: '图表加载失败',
            dataFound: '成功查询到数据',
            queryFailed: '查询失败',
            noDataDetected: '未检测到数据查询结果',
            sqlExecuted: '执行了 {count} 条SQL查询',
            noSqlDetected: '未检测到SQL查询命令',
            chartGenerated: '成功生成可视化图表',
            noChartGenerated: '本次查询未生成可视化图表',
            generatedCharts: '生成的图表：',
            processing: '正在处理您的查询，请稍候...',
            rawData: '原始数据',
            step: '步骤',
            codeExecution: '代码执行',
            consoleOutput: '控制台输出',
            error: '错误',
            systemMessage: '系统消息',
            summary: '总结',
            finalOutput: '最终输出'
        },
        
        // 提示消息
        tips: {
            notSatisfied: '不满意？尝试补充细节重新反馈给AI',
            errorOccurred: '遇到错误？尝试简化查询条件或检查表名是否正确',
            notPrecise: '查询不够精准？尝试指定具体的时间范围或数据维度'
        },
        
        // 导出功能
        export: {
            title: '导出结果',
            options: '导出选项',
            format: '导出格式',
            content: '包含内容'
        },
        
        // 系统配置项
        config: {
            configuration: '配置',
            model: '模型',
            settings: '设置'
        }
    }
    // 其他语言已提取为独立的 JSON 文件，存放在 /static/js/locales/ 目录
    // 通过懒加载机制按需加载，减少初始加载体积
};

class LanguageManager {
    constructor() {
        this.currentLang = localStorage.getItem('language') || 'zh';
        // 懒加载：只加载默认语言，其他语言按需加载
        this.translations = { zh: i18n.zh }; // 只保留默认语言
        this.loadedLanguages = new Set(['zh']); // 已加载的语言集合
        this.loadingPromises = {}; // 正在加载的语言 Promise，避免重复加载
    }
    
    // 获取当前语言
    getCurrentLanguage() {
        return this.currentLang;
    }
    
    // 异步加载语言文件
    async loadLanguage(lang) {
        // 如果已经加载，直接返回
        if (this.loadedLanguages.has(lang)) {
            return this.translations[lang];
        }
        
        // 如果正在加载，返回已有的 Promise
        if (this.loadingPromises[lang]) {
            return this.loadingPromises[lang];
        }
        
        // 如果是默认语言，直接从 i18n 对象获取（已在内存中）
        if (lang === 'zh' && i18n.zh) {
            this.translations[lang] = i18n[lang];
            this.loadedLanguages.add(lang);
            return this.translations[lang];
        }
        
        // 从 JSON 文件加载其他语言
        const loadPromise = fetch(`/static/js/locales/${lang}.json`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to load language: ${lang}`);
                }
                return response.json();
            })
            .then(data => {
                this.translations[lang] = data;
                this.loadedLanguages.add(lang);
                delete this.loadingPromises[lang];
                return data;
            })
            .catch(error => {
                i18nLogger.warn(`Failed to load language ${lang}, falling back to zh:`, error);
                delete this.loadingPromises[lang];
                // 如果加载失败，回退到默认语言
                if (!this.translations[lang]) {
                    this.translations[lang] = this.translations.zh;
                }
                return this.translations.zh;
            });
        
        this.loadingPromises[lang] = loadPromise;
        return loadPromise;
    }
    
    // 设置语言（支持异步加载）
    async setLanguage(lang) {
        // 如果语言已加载，直接切换
        if (this.loadedLanguages.has(lang)) {
            this.currentLang = lang;
            localStorage.setItem('language', lang);
            this.updatePageLanguage();
            return true;
        }
        
        // 否则先加载语言文件
        try {
            await this.loadLanguage(lang);
            this.currentLang = lang;
            localStorage.setItem('language', lang);
            this.updatePageLanguage();
            return true;
        } catch (error) {
            i18nLogger.error(`Failed to set language to ${lang}:`, error);
        return false;
        }
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
        
        // 更新所有带有 data-i18n-title 属性的元素的 title
        document.querySelectorAll('[data-i18n-title]').forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            const translation = this.t(key);
            element.title = translation;
        });
        
        // 更新所有带有 data-i18n-placeholder 属性的元素的 placeholder
        document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            const translation = this.t(key);
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.placeholder = translation;
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
