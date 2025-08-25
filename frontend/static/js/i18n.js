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
            promptSettings: 'Prompt设置',
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
            hint: '提示：直接输入自然语言查询，系统会自动转换为SQL并生成图表',
            userView: '用户视图',
            developerView: '开发者视图',
            analysisComplete: '分析完成',
            executionComplete: '执行完成',
            finalOutput: '最终输出',
            needChart: '需要图表？尝试在查询中明确要求"生成图表"或"可视化展示"'
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
            databaseQuery: '数据库查询提示词',
            explorationStrategy: '探索策略',
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
            updateTime: '更新时间',
            maintaining: '持续维护中',
            releaseDate: '2025年8月',
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
            promptSettings: 'Prompt Settings',
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
            hint: 'Tip: Enter natural language queries, and the system will automatically convert them to SQL and generate charts',
            userView: 'User View',
            developerView: 'Developer View',
            analysisComplete: 'Analysis Complete',
            executionComplete: 'Execution Complete',
            finalOutput: 'Final Output',
            needChart: 'Need a chart? Try explicitly requesting "generate chart" or "visualize data" in your query'
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
            unavailable: 'Not Configured',
            edit: 'Edit',
            test: 'Test',
            delete: 'Delete',
            apiKey: 'API Key',
            maxTokens: 'Max Tokens',
            temperature: 'Temperature',
            modelNamePlaceholder: 'e.g. GPT-4',
            modelIdPlaceholder: 'e.g. gpt-4',
            apiBasePlaceholder: 'e.g. http://localhost:11434/v1',
            apiKeyPlaceholder: 'Enter API key'
        },
        
        // Database configuration
        database: {
            title: 'MySQL Database Configuration',
            compatibility: 'Compatible with all MySQL protocol databases: OLAP (Doris, StarRocks, ClickHouse), NewSQL (TiDB, OceanBase)',
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
        
        // Prompt Settings
        prompts: {
            title: 'Prompt Settings',
            description: 'Customize prompts used by the query module to adjust AI behavior for your business needs.',
            databaseQuery: 'Database Query Prompts',
            explorationStrategy: 'Exploration Strategy',
            businessTerms: 'Business Terms',
            tableSelection: 'Table Selection Strategy',
            fieldMapping: 'Field Mapping Rules',
            dataProcessing: 'Data Processing Rules',
            outputRequirements: 'Output Requirements',
            save: 'Save Settings',
            reset: 'Reset to Defaults',
            export: 'Export Config',
            import: 'Import Config',
            tipsTitle: 'Usage Tips',
            tip1: 'Modifying prompts helps AI better understand your business scenario',
            tip2: 'Recommend backing up current config before making changes',
            tip3: 'Reset will restore all prompts to system defaults',
            tip4: 'Support import/export for easy migration between environments',
            saveSuccess: 'Prompt settings saved successfully',
            resetSuccess: 'Reset to defaults successfully',
            exportSuccess: 'Configuration exported successfully',
            importSuccess: 'Configuration imported successfully',
            saveFailed: 'Failed to save, please try again',
            resetFailed: 'Failed to reset, please try again',
            importFailed: 'Import failed, please check file format'
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
            releaseDate: 'August 2025',
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
            checkingConnection: 'Checking connection...',
            thinking: 'Thinking...',
            thinkingTitle: 'Thinking...',
            processing: 'Processing...',
            stopping: 'Stopping query...',
            stopped: 'Query cancelled',
            interrupted: 'Query interrupted by user',
            interruptedMessage: '⚠️ Query interrupted by user',
            testingModel: 'Testing model connection...',
            testingDatabase: 'Testing database connection...',
            testingConnection: 'Testing connection...',
            deletingConversation: 'Deleting conversation...',
            processingRequest: 'Processing previous request, please wait...',
            openingVisualization: 'Opening visualization...',
            generatingQuery: 'Generating optimal query plan...',
            optimizingQuery: 'Optimizing query...',
            continuousTip: 'Supports continuous conversation, you can continue asking based on previous results',
            dataMining: 'Data mining in progress, please wait...',
            understandingRequest: 'Understanding request...',
            analyzingRequirements: 'Analyzing requirements...',
            connectingDatabase: 'Connecting to database...',
            processingData: 'Processing data, almost done...',
            parsingDataStructure: 'Parsing data structure...',
            step: 'Step',
            codeExecution: 'Code Execution',
            summary: 'Summary',
            system: 'System',
            output: 'Output',
            console: 'Console',
            message: 'Message',
            error: 'Error',
            exception: 'Exception',
            noDetailedSteps: 'No detailed execution steps available',
            
            // Tips system
            tips: {
                detailed: 'The more detailed the description, the more accurate the query',
                naturalLanguage: 'Supports natural language queries, like "last month\'s sales"',
                flexibleTime: 'Flexible time descriptions: this week, last quarter, Q3 2024 all work',
                autoChart: 'Query results will automatically generate charts',
                continuous: 'Supports continuous conversation, ask follow-up questions based on results',
                comparison: 'Try comparison analysis: "Compare this year with last year"',
                examples: 'Examples: "Top 10 sales this month" or "East region revenue"',
                ranking: 'Supports ranking queries: "Top 5 sales"',
                trend: 'Analyze trends: "Sales trend for last 6 months"',
                followUp: 'Follow up with: "Group by month" or "Add year-over-year"',
                filter: 'Supports filtering: "Products with profit margin >30%"',
                doubleClick: 'Double-click charts to zoom in',
                tabKey: 'Press Tab to quickly switch input fields',
                help: 'Type "help" to see more features',
                
                // Late night care
                lateNight1: 'It\'s late, take a rest after this query~',
                lateNight2: 'Early morning hours, remember to protect your eyes',
                lateNight3: 'Working late, remember to take breaks',
                lateNight4: 'Still working so late, you\'re really dedicated!',
                lateNight5: 'Night owl mode activated, but health is more important',
                midnight: 'Past midnight, rest early for your health',
                earlyMorning: 'Early morning, health is more important than data'
            }
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
        },
        
        // Notification messages
        notifications: {
            apiConnected: 'API connection successful!',
            modelSaved: 'Model configuration saved',
            saveFailed: 'Save failed',
            dbConnected: 'Database connection successful!',
            dbConfigSaved: 'Database configuration saved',
            uiSettingsSaved: 'Interface settings saved',
            sendFailed: 'Send failed, please try again',
            requestFailed: 'Request processing failed. Check network connection or try again later.'
        },
        
        // Query related
        query: {
            executeComplete: 'Query execution completed',
            loadingChart: 'Loading chart...',
            chartLoadFailed: 'Chart loading failed',
            dataFound: 'Data successfully retrieved',
            queryFailed: 'Query failed',
            noDataDetected: 'No data query results detected',
            sqlExecuted: 'Executed {count} SQL queries',
            noSqlDetected: 'No SQL query commands detected',
            chartGenerated: 'Visualization chart generated successfully',
            noChartGenerated: 'No visualization chart generated for this query',
            generatedCharts: 'Generated charts:',
            processing: 'Processing your query, please wait...',
            rawData: 'Raw data',
            step: 'Step',
            codeExecution: 'Code execution',
            consoleOutput: 'Console output',
            error: 'Error',
            systemMessage: 'System message',
            summary: 'Summary',
            finalOutput: 'Final output'
        },
        
        // Tip messages
        tips: {
            notSatisfied: 'Not satisfied? Try adding details and providing feedback to AI again',
            errorOccurred: 'Encountered an error? Try simplifying query conditions or check if table names are correct',
            notPrecise: 'Query not precise enough? Try specifying specific time ranges or data dimensions'
        },
        
        // Export functionality
        export: {
            title: 'Export Results',
            options: 'Export Options',
            format: 'Export Format',
            content: 'Include Content'
        },
        
        // System configuration
        config: {
            configuration: 'Configuration',
            model: 'Model',
            settings: 'Settings'
        }
    },
    
    // 繁體中文
    ru: {
        // Системные заголовки
        systemName: 'QueryGPT',
        systemDesc: 'Интеллектуальная система запросов и визуализации данных',
        
        // Навигационное меню
        nav: {
            query: 'Запрос',
            newQuery: 'Запрос данных',
            history: 'История',
            settings: 'Настройки',
            basicSettings: 'Основные настройки',
            modelManagement: 'Управление моделями',
            databaseConfig: 'Конфигурация БД',
            about: 'О системе'
        },
        
        // Страница чата
        chat: {
            title: 'Запросы и анализ данных',
            newConversation: 'Новый диалог',
            inputPlaceholder: 'Введите запрос...',
            welcome: 'Добро пожаловать в интеллектуальную систему анализа данных QueryGPT',
            welcomeDesc: 'Я могу помочь вам:',
            feature1: 'Запрашивать базы данных на естественном языке',
            feature2: 'Автоматически создавать визуализации данных',
            feature3: 'Интеллектуально анализировать данные и предоставлять инсайты',
            tryExample: 'Попробуйте эти примеры:',
            example1: 'Показать данные о продажах за последний месяц',
            example2: 'Проанализировать распределение продаж по категориям продуктов',
            example3: 'Найти топ-10 клиентов по объёму продаж',
            example4: 'Создать график роста пользователей',
            exampleBtn1: 'Просмотр БД',
            exampleBtn2: 'Анализ продаж',
            exampleBtn3: 'Доля продуктов',
            exampleBtn4: 'Тренды пользователей',
            hint: 'Подсказка: Введите запрос на естественном языке, система автоматически преобразует его в SQL и создаст графики',
            userView: 'Вид пользователя',
            developerView: 'Вид разработчика',
            analysisComplete: 'Анализ завершён',
            executionComplete: 'Выполнение завершено',
            finalOutput: 'Окончательный результат',
            needChart: 'Нужен график? Попробуйте явно указать "создать график" или "визуализировать данные" в запросе'
        },
        
        // Страница настроек
        settings: {
            title: 'Системные настройки',
            language: 'Язык',
            languageDesc: 'Выберите язык интерфейса системы',
            chinese: '中文',
            english: 'English',
            traditionalChinese: '繁體中文',
            japanese: '日本語',
            spanish: 'Español',
            french: 'Français',
            german: 'Deutsch',
            russian: 'Русский',
            portuguese: 'Português',
            korean: '한국어',
            viewMode: 'Режим просмотра по умолчанию',
            userMode: 'Пользовательский режим (упрощённый)',
            developerMode: 'Режим разработчика (подробный)',
            contextRounds: 'Количество раундов контекста',
            contextDesc: 'Настройте, сколько предыдущих раундов диалога ИИ запоминает для исправления ошибок и понимания контекста',
            noHistory: 'Без истории (одиночный раунд)',
            roundHistory: 'Сохранять {n} раунд(ов) истории',
            recommended: '(Рекомендуется)',
            mayAffectPerformance: '(Может влиять на производительность)'
        },
        
        // Управление моделями
        models: {
            title: 'Управление моделями',
            addModel: 'Добавить модель',
            name: 'Название модели',
            type: 'Тип',
            apiAddress: 'API адрес',
            status: 'Статус',
            actions: 'Действия',
            available: 'Доступна',
            unavailable: 'Не настроена',
            edit: 'Редактировать',
            test: 'Тестировать',
            delete: 'Удалить',
            apiKey: 'API ключ',
            maxTokens: 'Макс. токенов',
            temperature: 'Температура',
            modelNamePlaceholder: 'Например: GPT-4',
            modelIdPlaceholder: 'Например: gpt-4',
            apiBasePlaceholder: 'Например: http://localhost:11434/v1',
            apiKeyPlaceholder: 'Введите API ключ'
        },
        
        // Конфигурация базы данных
        database: {
            title: 'Конфигурация базы данных Doris',
            host: 'Адрес хоста',
            hostPlaceholder: 'Например: localhost или 192.168.1.100',
            port: 'Порт',
            username: 'Имя пользователя',
            usernamePlaceholder: 'Имя пользователя БД',
            password: 'Пароль',
            passwordPlaceholder: 'Пароль БД',
            dbName: 'Имя базы данных',
            dbNamePlaceholder: 'Оставьте пустым для межбазовых запросов (рекомендуется)',
            hint: 'Подсказка: Оставьте пустым для межбазовых запросов, используйте формат база.таблица',
            testConnection: 'Тест соединения',
            saveConfig: 'Сохранить конфигурацию',
            connectionSuccess: 'Соединение успешно',
            connectionInfo: 'База данных подключена, найдено таблиц: {count}'
        },
        
        // Страница "О системе"
        about: {
            title: 'О системе',
            version: 'Версия',
            developer: 'Разработчик',
            independentDev: 'Независимый разработчик',
            organization: 'Организация',
            openSource: 'Открытый проект',
            versionInfo: 'Информация о версии',
            betaVersion: 'Бета-версия',
            updateTime: 'Время обновления',
            maintaining: 'В активной разработке',
            releaseDate: 'Август 2025',
            features: {
                ai: 'ИИ анализ данных',
                database: 'Запросы к БД',
                visualization: 'Генерация визуализаций'
            },
            license: 'Лицензионная информация',
            licenseDetails: {
                openInterpreter: 'Ядро OpenInterpreter:',
                openInterpreterLicense: 'Лицензия MIT',
                openInterpreterDesc: 'Открытый движок выполнения кода на естественном языке, разрешает коммерческое использование',
                openInterpreterDetail1: '• Этот проект использует версию 0.4.3, установленную через pip, следует лицензии MIT',
                openInterpreterDetail2: '• Разрешено свободное использование, модификация и развёртывание',
                openInterpreterDetail3: '• Предоставляет основные ИИ-возможности преобразования естественного языка в код',
                otherLibs: 'Flask/PyMySQL/Plotly и др.:',
                otherLibsLicense: 'Лицензии MIT/BSD',
                otherLibsDesc: 'Разрешено коммерческое использование, модификация и распространение',
                flaskDetail: '• Flask 3.1.1 - Легковесный веб-фреймворк, лицензия BSD',
                pymysqlDetail: '• PyMySQL 1.1.1 - Библиотека подключения к MySQL, лицензия MIT',
                plotlyDetail: '• Plotly 6.3.0 - Библиотека визуализации данных, лицензия MIT',
                allOpenSource: '• Все зависимости имеют открытые лицензии',
                disclaimer: 'Отказ от ответственности:',
                disclaimerText: 'Эта система является инструментом на основе больших языковых моделей. Разработчик не несёт ответственности за потерю данных или другие проблемы, которые могут возникнуть при использовании. Пожалуйста, сделайте резервные копии данных и настройте права доступа перед использованием.'
            },
            techStack: 'Технологический стек',
            backend: 'Бэкенд технологии',
            frontend: 'Фронтенд технологии',
            usageStatement: 'Условия использования системы',
            systemDesc: 'Эта система разработана на основе открытых компонентов, использует лицензию MIT:',
            freeUse: 'Свободное использование, модификация и распространение',
            commercial: 'Поддерживает коммерческое и некоммерческое использование',
            copyright: 'Пожалуйста, сохраняйте уведомление об авторских правах',
            contactEmail: 'Email разработчика'
        },
        
        // История
        history: {
            title: 'История',
            search: 'Поиск в истории...',
            recent: 'Недавние',
            today: 'Сегодня',
            thisWeek: 'На этой неделе',
            loading: 'Загрузка...',
            noRecords: 'История пуста',
            deleteConfirm: 'Вы уверены, что хотите удалить этот диалог? Это действие нельзя отменить.',
            cancel: 'Отмена',
            delete: 'Удалить'
        },
        
        // Общие
        common: {
            save: 'Сохранить',
            cancel: 'Отмена',
            confirm: 'Подтвердить',
            close: 'Закрыть',
            loading: 'Обработка...',
            success: 'Успешно',
            error: 'Ошибка',
            checkingConnection: 'Проверка соединения...',
            thinking: 'Обдумываю...',
            thinkingTitle: 'Обдумываю...',
            processing: 'Обработка...',
            stopping: 'Остановка запроса...',
            stopped: 'Запрос отменён',
            interrupted: 'Запрос прерван пользователем',
            interruptedMessage: '⚠️ Запрос прерван пользователем',
            testingModel: 'Тестирование подключения к модели...',
            testingDatabase: 'Тестирование подключения к БД...',
            testingConnection: 'Тестирование соединения...',
            deletingConversation: 'Удаление диалога...',
            processingRequest: 'Обрабатывается предыдущий запрос, пожалуйста подождите...',
            openingVisualization: 'Открытие визуализации...',
            generatingQuery: 'Генерация оптимального плана запроса...',
            optimizingQuery: 'Оптимизация запроса...',
            continuousTip: 'Поддерживается непрерывный диалог, можно продолжать задавать вопросы на основе предыдущих результатов',
            dataMining: 'Анализ данных, пожалуйста подождите...',
            understandingRequest: 'Понимание запроса...',
            analyzingRequirements: 'Анализ требований...',
            connectingDatabase: 'Подключение к базе данных...',
            processingData: 'Обработка данных, почти готово...',
            parsingDataStructure: 'Анализ структуры данных...',
            step: 'Шаг',
            codeExecution: 'Выполнение кода',
            summary: 'Итог',
            system: 'Система',
            output: 'Вывод',
            console: 'Консоль',
            message: 'Сообщение',
            error: 'Ошибка',
            exception: 'Исключение',
            noDetailedSteps: 'Нет подробной информации о шагах выполнения',
            
            // Система подсказок
            tips: {
                detailed: 'Чем подробнее описание, тем точнее запрос',
                naturalLanguage: 'Поддерживаются запросы на естественном языке, например "продажи за прошлый месяц"',
                flexibleTime: 'Гибкие временные описания: эта неделя, прошлый квартал, Q3 2024 - всё распознается',
                autoChart: 'Результаты запросов автоматически преобразуются в графики',
                continuous: 'Поддерживается непрерывный диалог, можно задавать уточняющие вопросы',
                comparison: 'Попробуйте сравнительный анализ: "Сравнить данные этого года с прошлым"',
                examples: 'Примеры: "ТОП-10 продаж этого месяца" или "Доход восточного региона"',
                ranking: 'Поддерживаются запросы рейтингов: "Топ-5 по продажам"',
                trend: 'Анализ трендов: "Тренд продаж за последние 6 месяцев"',
                followUp: 'Можно уточнять: "Сгруппировать по месяцам" или "Добавить сравнение с прошлым годом"',
                filter: 'Поддерживается фильтрация: "Продукты с маржой >30%"',
                doubleClick: 'Двойной клик на графике для увеличения',
                tabKey: 'Нажмите Tab для быстрого переключения полей ввода',
                help: 'Введите "помощь" для просмотра дополнительных функций',
                
                // Забота о пользователе в позднее время
                lateNight1: 'Уже поздно, закончите этот запрос и отдохните~',
                lateNight2: 'Раннее утро, берегите глаза',
                lateNight3: 'Работаете допоздна, не забывайте отдыхать',
                lateNight4: 'Так поздно ещё работаете, вы очень усердны!',
                lateNight5: 'Режим совы активирован, но здоровье важнее',
                midnight: 'Уже за полночь, ранний отдых полезен для здоровья',
                earlyMorning: 'Раннее утро, здоровье важнее данных'
            }
        },
        
        // Сообщения об ошибках
        errors: {
            networkError: 'Ошибка сетевого подключения',
            loadConfigFailed: 'Не удалось загрузить конфигурацию',
            saveConfigFailed: 'Не удалось сохранить конфигурацию',
            connectionFailed: 'Соединение не удалось',
            testConnectionFailed: 'Тест соединения не удался',
            saveModelFailed: 'Не удалось сохранить модель',
            deleteModelFailed: 'Не удалось удалить модель',
            fillRequiredFields: 'Пожалуйста, заполните все обязательные поля',
            enterQuery: 'Пожалуйста, введите запрос',
            sendFailed: 'Отправка не удалась, попробуйте снова',
            loadConversationFailed: 'Не удалось загрузить диалог',
            copyFailed: 'Копирование не удалось',
            clearCacheFailed: 'Не удалось очистить кэш',
            apiConnectionSuccess: 'API подключение успешно!',
            dbConnectionSuccess: 'Подключение к БД успешно!',
            configSaved: 'Конфигурация сохранена',
            cacheCleared: 'Кэш очищен',
            copiedToClipboard: 'Скопировано в буфер обмена',
            newConversationStarted: 'Новый диалог начат',
            languageSwitchedRu: 'Язык изменён на русский',
            languageSwitchedEn: 'Language switched to English',
            serverError: 'Ошибка сервера, попробуйте позже',
            permissionError: 'Нет прав для выполнения этой операции',
            validationError: 'Неверный формат данных, проверьте и попробуйте снова',
            generalError: 'Произошла ошибка, попробуйте снова'
        },
        
        // Уведомления
        notifications: {
            apiConnected: 'Соединение с API успешно!',
            modelSaved: 'Конфигурация модели сохранена',
            saveFailed: 'Сохранение не удалось',
            dbConnected: 'Соединение с базой данных успешно!',
            dbConfigSaved: 'Конфигурация базы данных сохранена',
            uiSettingsSaved: 'Настройки интерфейса сохранены',
            sendFailed: 'Отправка не удалась, попробуйте снова',
            requestFailed: 'Обработка запроса не удалась. Проверьте сетевое соединение или попробуйте позже.'
        },
        
        // Запросы
        query: {
            executeComplete: 'Выполнение запроса завершено',
            loadingChart: 'Загрузка графика...',
            chartLoadFailed: 'Загрузка графика не удалась',
            dataFound: 'Данные успешно получены',
            queryFailed: 'Запрос не удался',
            noDataDetected: 'Результаты запроса данных не обнаружены',
            sqlExecuted: 'Выполнено {count} SQL запросов',
            noSqlDetected: 'Команды SQL запросов не обнаружены',
            chartGenerated: 'График визуализации успешно создан',
            noChartGenerated: 'График визуализации для этого запроса не создан',
            generatedCharts: 'Созданные графики:',
            processing: 'Обработка вашего запроса, пожалуйста подождите...',
            rawData: 'Исходные данные',
            step: 'Шаг',
            codeExecution: 'Выполнение кода',
            consoleOutput: 'Вывод консоли',
            error: 'Ошибка',
            systemMessage: 'Системное сообщение',
            summary: 'Сводка',
            finalOutput: 'Окончательный результат'
        },
        
        // Подсказки
        tips: {
            notSatisfied: 'Не удовлетворены? Попробуйте добавить детали и предоставить обратную связь ИИ снова',
            errorOccurred: 'Возникла ошибка? Попробуйте упростить условия запроса или проверить правильность имён таблиц',
            notPrecise: 'Запрос недостаточно точен? Попробуйте указать конкретные временные диапазоны или измерения данных'
        },
        
        // Экспорт
        export: {
            title: 'Экспорт результатов',
            options: 'Параметры экспорта',
            format: 'Формат экспорта',
            content: 'Включить содержимое'
        },
        
        // Конфигурация системы
        config: {
            configuration: 'Конфигурация',
            model: 'Модель',
            settings: 'Настройки'
        }
    },
    
    'zh-TW': {
        systemName: 'QueryGPT',
        systemDesc: '智慧數據查詢與視覺化系統',
        
        nav: {
            query: '查詢',
            newQuery: '數據查詢',
            history: '歷史記錄',
            settings: '設定',
            basicSettings: '基礎設定',
            modelManagement: '模型管理',
            databaseConfig: '資料庫配置',
            about: '關於'
        },
        
        chat: {
            title: '數據查詢與分析',
            newConversation: '新對話',
            inputPlaceholder: '輸入查詢內容...',
            welcome: '歡迎使用 QueryGPT 智慧數據分析系統',
            welcomeDesc: '我可以幫助您：',
            feature1: '使用自然語言查詢資料庫',
            feature2: '自動生成數據視覺化圖表',
            feature3: '智慧分析數據並提供洞察',
            tryExample: '試試這些範例：',
            example1: '顯示最近一個月的銷售數據',
            example2: '分析產品類別的銷售佔比',
            example3: '查找銷售額最高的前10個客戶',
            example4: '生成用戶增長趨勢圖',
            exampleBtn1: '查看資料庫',
            exampleBtn2: '銷售分析',
            exampleBtn3: '產品佔比',
            exampleBtn4: '用戶趨勢',
            hint: '提示：直接輸入自然語言查詢，系統會自動轉換為SQL並生成圖表',
            userView: '用戶視圖',
            developerView: '開發者視圖',
            analysisComplete: '分析完成',
            executionComplete: '執行完成',
            finalOutput: '最終輸出',
            needChart: '需要圖表？嘗試在查詢中明確要求"生成圖表"或"視覺化展示"'
        },
        
        settings: {
            title: '系統設定',
            language: '語言',
            languageDesc: '選擇系統介面語言',
            chinese: '简体中文',
            english: 'English',
            traditionalChinese: '繁體中文',
            japanese: '日本語',
            spanish: 'Español',
            french: 'Français',
            german: 'Deutsch',
            russian: 'Русский',
            portuguese: 'Português',
            korean: '한국어',
            viewMode: '預設視圖模式',
            userMode: '用戶模式（簡潔）',
            developerMode: '開發者模式（詳細）',
            contextRounds: '上下文保留輪數',
            contextDesc: '設定AI記住之前幾輪對話的內容，用於錯誤修正和上下文理解',
            noHistory: '不保留歷史（單輪對話）',
            roundHistory: '保留{n}輪歷史',
            recommended: '（推薦）',
            mayAffectPerformance: '（可能影響效能）'
        },
        
        models: {
            title: '模型管理',
            addModel: '新增模型',
            name: '模型名稱',
            type: '類型',
            apiAddress: 'API地址',
            status: '狀態',
            actions: '操作',
            available: '可用',
            unavailable: '未配置',
            edit: '編輯',
            test: '測試',
            delete: '刪除',
            apiKey: 'API金鑰',
            maxTokens: '最大Token數',
            temperature: '溫度參數',
            modelNamePlaceholder: '例如: GPT-4',
            modelIdPlaceholder: '例如: gpt-4',
            apiBasePlaceholder: '例如: http://localhost:11434/v1',
            apiKeyPlaceholder: '輸入API金鑰'
        },
        
        database: {
            title: 'MySQL資料庫配置',
            compatibility: '相容所有 MySQL 協議資料庫：OLAP（Doris、StarRocks、ClickHouse）、NewSQL（TiDB、OceanBase）',
            host: '主機地址',
            hostPlaceholder: '例如: localhost 或 192.168.1.100',
            port: '埠號',
            username: '用戶名',
            usernamePlaceholder: '資料庫用戶名',
            password: '密碼',
            passwordPlaceholder: '資料庫密碼',
            dbName: '資料庫名',
            dbNamePlaceholder: '留空可跨庫查詢（推薦）',
            hint: '提示：留空允許跨資料庫查詢，使用 庫名.表名 格式訪問任意表',
            testConnection: '測試連線',
            saveConfig: '儲存配置',
            connectionSuccess: '連線成功',
            connectionInfo: '資料庫連線正常，共發現 {count} 個表'
        },
        
        about: {
            title: '關於系統',
            version: '版本',
            developer: '開發者',
            independentDev: '獨立開發者',
            organization: '所屬單位',
            openSource: '開源專案',
            versionInfo: '版本資訊',
            betaVersion: '測試版本',
            updateTime: '更新時間',
            maintaining: '持續維護中',
            releaseDate: '2025年8月',
            features: {
                ai: '智慧數據分析',
                database: '資料庫查詢',
                visualization: '視覺化生成'
            },
            license: '授權說明',
            licenseDetails: {
                openInterpreter: 'OpenInterpreter 核心引擎：',
                openInterpreterLicense: 'MIT授權',
                openInterpreterDesc: '開源自然語言程式碼執行引擎，允許商業使用',
                openInterpreterDetail1: '• 本專案使用pip安裝的0.4.3版本，遵循MIT授權',
                openInterpreterDetail2: '• 允許自由使用、修改和部署',
                openInterpreterDetail3: '• 提供自然語言轉程式碼的核心AI能力',
                otherLibs: 'Flask/PyMySQL/Plotly等：',
                otherLibsLicense: 'MIT/BSD授權',
                otherLibsDesc: '允許商業使用、修改和分發',
                flaskDetail: '• Flask 3.1.1 - 輕量級Web框架，BSD授權',
                pymysqlDetail: '• PyMySQL 1.1.1 - MySQL資料庫連線庫，MIT授權',
                plotlyDetail: '• Plotly 6.3.0 - 數據視覺化庫，MIT授權',
                allOpenSource: '• 所有依賴均為開源授權',
                disclaimer: '免責聲明：',
                disclaimerText: '本系統為大模型驅動的工具，開發者對使用過程中可能出現的資料損失或其他問題不承擔責任。請在使用前做好資料備份和權限管理。'
            },
            techStack: '技術堆疊',
            backend: '後端技術',
            frontend: '前端技術',
            usageStatement: '本系統使用聲明',
            systemDesc: '本系統基於開源組件開發，採用 MIT 授權：',
            freeUse: '自由使用、修改和分發',
            commercial: '支援商業和非商業用途',
            copyright: '請保留版權聲明',
            contactEmail: '開發者聯絡郵箱'
        },
        
        history: {
            title: '歷史記錄',
            search: '搜尋歷史記錄...',
            recent: '最近',
            today: '今天',
            thisWeek: '本週',
            loading: '載入中...',
            noRecords: '暫無歷史記錄',
            deleteConfirm: '確定要刪除這個對話嗎？此操作無法撤銷。',
            cancel: '取消',
            delete: '刪除'
        },
        
        common: {
            save: '儲存',
            cancel: '取消',
            confirm: '確認',
            close: '關閉',
            loading: '處理中...',
            success: '操作成功',
            error: '操作失敗',
            checkingConnection: '檢查連線中...',
            thinking: '正在思考中...',
            thinkingTitle: '正在思考...',
            processing: '正在處理...',
            stopping: '正在停止查詢...',
            stopped: '查詢已取消',
            interrupted: '查詢已被用戶中斷',
            interruptedMessage: '⚠️ 查詢已被用戶中斷',
            testingModel: '正在測試模型連線...',
            testingDatabase: '正在測試資料庫連線...',
            testingConnection: '正在測試連線...',
            deletingConversation: '正在刪除對話...',
            processingRequest: '正在處理上一個請求，請稍候...',
            openingVisualization: '正在開啟視覺化結果...',
            generatingQuery: '正在生成最佳查詢方案...',
            optimizingQuery: '正在優化查詢語句...',
            continuousTip: '支援連續對話，可基於上次結果繼續提問',
            dataMining: '資料挖掘中，請稍候...',
            understandingRequest: '理解需求中...',
            analyzingRequirements: '分析需求...',
            connectingDatabase: '連線資料庫中...',
            processingData: '資料處理中，馬上就好...',
            parsingDataStructure: '解析資料結構中...',
            step: '步驟',
            codeExecution: '程式碼執行',
            summary: '總結',
            system: '系統',
            output: '輸出',
            console: '控制台',
            message: '訊息',
            error: '錯誤',
            exception: '異常',
            noDetailedSteps: '無詳細執行步驟資訊',
            
            tips: {
                detailed: '描述越詳細，查詢越精準',
                naturalLanguage: '支援自然語言查詢，如"上個月的銷售額"',
                flexibleTime: '時間描述靈活：本週、上季度、2024年Q3都能識別',
                autoChart: '查詢結果會自動生成圖表',
                continuous: '支援連續對話，可基於上次結果繼續提問',
                comparison: '試試對比分析："對比今年和去年的資料"',
                examples: '範例："本月銷售TOP10" 或 "華東地區營收"',
                ranking: '支援排名查詢："銷售前5名"',
                trend: '可分析趨勢："最近6個月銷售趨勢"',
                followUp: '可以追問："按月份分組" 或 "加上同比"',
                filter: '支援條件篩選："毛利率>30%的產品"',
                doubleClick: '雙擊圖表可放大查看',
                tabKey: '按Tab鍵快速切換輸入框',
                help: '輸入"幫助"查看更多功能',
                
                lateNight1: '夜深了，查完這個就休息吧~',
                lateNight2: '凌晨時分，注意保護眼睛哦',
                lateNight3: '深夜工作辛苦了，記得適當休息',
                lateNight4: '這麼晚還在努力，您真是太拼了！',
                lateNight5: '夜貓子模式已啟動，但健康更重要哦',
                midnight: '已經過了午夜，早點休息對身體好哦',
                earlyMorning: '凌晨了，健康比資料更重要'
            }
        },
        
        errors: {
            networkError: '網路連線失敗',
            loadConfigFailed: '載入配置失敗',
            saveConfigFailed: '儲存配置失敗',
            connectionFailed: '連線失敗',
            testConnectionFailed: '連線測試失敗',
            saveModelFailed: '儲存模型失敗',
            deleteModelFailed: '刪除模型失敗',
            fillRequiredFields: '請填寫所有必填欄位',
            enterQuery: '請輸入查詢內容',
            sendFailed: '發送失敗，請重試',
            loadConversationFailed: '載入對話失敗',
            copyFailed: '複製失敗',
            clearCacheFailed: '清空快取失敗',
            apiConnectionSuccess: 'API連線成功！',
            dbConnectionSuccess: '資料庫連線成功！',
            configSaved: '配置已儲存',
            cacheCleared: '快取已清空',
            copiedToClipboard: '已複製到剪貼簿',
            newConversationStarted: '已開始新對話',
            languageSwitchedZh: '語言已切換為繁體中文',
            languageSwitchedEn: 'Language switched to English',
            serverError: '伺服器回應異常，稍後重試',
            permissionError: '無權限執行此操作',
            validationError: '資料格式錯誤，檢查後重試',
            generalError: '發生錯誤，請重試'
        },
        
        // 通知訊息
        notifications: {
            apiConnected: 'API連線成功！',
            modelSaved: '模型配置已儲存',
            saveFailed: '儲存失敗',
            dbConnected: '資料庫連線成功！',
            dbConfigSaved: '資料庫配置已儲存',
            uiSettingsSaved: '介面設定已儲存',
            sendFailed: '傳送失敗，請重試',
            requestFailed: '處理請求失敗。檢查網路連線或稍後重試。'
        },
        
        // 查詢相關
        query: {
            executeComplete: '查詢執行完成',
            loadingChart: '載入圖表中...',
            chartLoadFailed: '圖表載入失敗',
            dataFound: '成功查詢到資料',
            queryFailed: '查詢失敗',
            noDataDetected: '未檢測到資料查詢結果',
            sqlExecuted: '執行了 {count} 條SQL查詢',
            noSqlDetected: '未檢測到SQL查詢指令',
            chartGenerated: '成功生成視覺化圖表',
            noChartGenerated: '本次查詢未生成視覺化圖表',
            generatedCharts: '生成的圖表：',
            processing: '正在處理您的查詢，請稍候...',
            rawData: '原始資料',
            step: '步驟',
            codeExecution: '程式碼執行',
            consoleOutput: '控制台輸出',
            error: '錯誤',
            systemMessage: '系統訊息',
            summary: '總結',
            finalOutput: '最終輸出'
        },
        
        // 提示訊息
        tips: {
            notSatisfied: '不滿意？嘗試補充細節重新反饋給AI',
            errorOccurred: '遇到錯誤？嘗試簡化查詢條件或檢查表名是否正確',
            notPrecise: '查詢不夠精準？嘗試指定具體的時間範圍或資料維度'
        },
        
        // 匯出功能
        export: {
            title: '匯出結果',
            options: '匯出選項',
            format: '匯出格式',
            content: '包含內容'
        },
        
        // 系統配置項
        config: {
            configuration: '配置',
            model: '模型',
            settings: '設定'
        }
    },
    
    // Português
    pt: {
        // Títulos do sistema
        systemName: 'QueryGPT',
        systemDesc: 'Sistema Inteligente de Consulta e Visualização de Dados',
        
        // Menu de navegação
        nav: {
            query: 'Consulta',
            newQuery: 'Consulta de Dados',
            history: 'Histórico',
            settings: 'Configurações',
            basicSettings: 'Configurações Básicas',
            modelManagement: 'Gerenciamento de Modelos',
            databaseConfig: 'Configuração do Banco de Dados',
            about: 'Sobre'
        },
        
        // Página de chat
        chat: {
            title: 'Consulta e Análise de Dados',
            newConversation: 'Nova Conversa',
            inputPlaceholder: 'Digite sua consulta...',
            welcome: 'Bem-vindo ao Sistema de Análise Inteligente de Dados QueryGPT',
            welcomeDesc: 'Posso ajudá-lo a:',
            feature1: 'Consultar bancos de dados usando linguagem natural',
            feature2: 'Gerar visualizações de dados automaticamente',
            feature3: 'Analisar dados inteligentemente e fornecer insights',
            tryExample: 'Experimente estes exemplos:',
            example1: 'Mostrar dados de vendas do último mês',
            example2: 'Analisar distribuição de vendas por categoria de produto',
            example3: 'Encontrar os 10 principais clientes por valor de vendas',
            example4: 'Gerar gráfico de tendência de crescimento de usuários',
            exampleBtn1: 'Ver Banco de Dados',
            exampleBtn2: 'Análise de Vendas',
            exampleBtn3: 'Mix de Produtos',
            exampleBtn4: 'Tendências de Usuários',
            hint: 'Dica: Digite consultas em linguagem natural, o sistema converterá automaticamente para SQL e gerará gráficos',
            userView: 'Visualização do Usuário',
            developerView: 'Visualização do Desenvolvedor',
            analysisComplete: 'Análise Concluída',
            executionComplete: 'Execução Concluída',
            finalOutput: 'Saída Final',
            needChart: 'Precisa de um gráfico? Tente solicitar explicitamente "gerar gráfico" ou "visualizar dados" em sua consulta'
        },
        
        // Página de configurações
        settings: {
            title: 'Configurações do Sistema',
            language: 'Idioma',
            languageDesc: 'Selecione o idioma da interface do sistema',
            chinese: '中文',
            english: 'English',
            traditionalChinese: '繁體中文',
            japanese: '日本語',
            spanish: 'Español',
            french: 'Français',
            german: 'Deutsch',
            russian: 'Русский',
            portuguese: 'Português',
            korean: '한국어',
            viewMode: 'Modo de Visualização Padrão',
            userMode: 'Modo Usuário (Simples)',
            developerMode: 'Modo Desenvolvedor (Detalhado)',
            contextRounds: 'Rodadas de Histórico de Contexto',
            contextDesc: 'Define quantas rodadas de conversa a IA lembra para correção de erros e compreensão de contexto',
            noHistory: 'Sem histórico (conversa única)',
            roundHistory: 'Manter {n} rodada(s) de histórico',
            recommended: '(Recomendado)',
            mayAffectPerformance: '(Pode afetar o desempenho)'
        },
        
        // Gerenciamento de modelos
        models: {
            title: 'Gerenciamento de Modelos',
            addModel: 'Adicionar Modelo',
            name: 'Nome do Modelo',
            type: 'Tipo',
            apiAddress: 'Endereço da API',
            status: 'Status',
            actions: 'Ações',
            available: 'Disponível',
            unavailable: 'Não Configurado',
            edit: 'Editar',
            test: 'Testar',
            delete: 'Excluir',
            apiKey: 'Chave da API',
            maxTokens: 'Máximo de Tokens',
            temperature: 'Temperatura',
            modelNamePlaceholder: 'ex: GPT-4',
            modelIdPlaceholder: 'ex: gpt-4',
            apiBasePlaceholder: 'ex: http://localhost:11434/v1',
            apiKeyPlaceholder: 'Digite a chave da API'
        },
        
        // Configuração do banco de dados
        database: {
            title: 'Configuração do Banco de Dados Doris',
            host: 'Endereço do Host',
            hostPlaceholder: 'ex: localhost ou 192.168.1.100',
            port: 'Porta',
            username: 'Nome de Usuário',
            usernamePlaceholder: 'Nome de usuário do banco de dados',
            password: 'Senha',
            passwordPlaceholder: 'Senha do banco de dados',
            dbName: 'Nome do Banco de Dados',
            dbNamePlaceholder: 'Deixe vazio para consultas entre bancos (recomendado)',
            hint: 'Dica: Deixe vazio para permitir consultas entre bancos de dados, use o formato banco.tabela',
            testConnection: 'Testar Conexão',
            saveConfig: 'Salvar Configuração',
            connectionSuccess: 'Conexão Bem-sucedida',
            connectionInfo: 'Banco de dados conectado, encontrada(s) {count} tabela(s)'
        },
        
        // Página sobre
        about: {
            title: 'Sobre o Sistema',
            version: 'Versão',
            developer: 'Desenvolvedor',
            independentDev: 'Desenvolvedor Independente',
            organization: 'Organização',
            openSource: 'Projeto Open Source',
            versionInfo: 'Informações da Versão',
            betaVersion: 'Versão Beta',
            updateTime: 'Tempo de Atualização',
            maintaining: 'Em Manutenção',
            releaseDate: 'Agosto de 2025',
            features: {
                ai: 'Análise de Dados com IA',
                database: 'Consulta de Banco de Dados',
                visualization: 'Geração de Visualizações'
            },
            license: 'Declaração de Licença',
            licenseDetails: {
                openInterpreter: 'Motor Principal OpenInterpreter:',
                openInterpreterLicense: 'Licença MIT',
                openInterpreterDesc: 'Motor de execução de código em linguagem natural de código aberto, permite uso comercial',
                openInterpreterDetail1: '• Este projeto usa a versão 0.4.3 instalada via pip, segue a licença MIT',
                openInterpreterDetail2: '• Livre para usar, modificar e implantar',
                openInterpreterDetail3: '• Fornece capacidades principais de IA para linguagem natural para código',
                otherLibs: 'Flask/PyMySQL/Plotly etc:',
                otherLibsLicense: 'Licença MIT/BSD',
                otherLibsDesc: 'Permite uso comercial, modificação e distribuição',
                flaskDetail: '• Flask 3.1.1 - Framework web leve, licença BSD',
                pymysqlDetail: '• PyMySQL 1.1.1 - Biblioteca de conexão de banco de dados MySQL, licença MIT',
                plotlyDetail: '• Plotly 6.3.0 - Biblioteca de visualização de dados, licença MIT',
                allOpenSource: '• Todas as dependências são licenciadas como código aberto',
                disclaimer: 'Aviso Legal:',
                disclaimerText: 'Este sistema é uma ferramenta alimentada por IA. O desenvolvedor não é responsável por qualquer perda de dados ou outros problemas que possam ocorrer durante o uso. Por favor, faça backup de seus dados e gerencie permissões antes do uso.'
            },
            techStack: 'Stack Tecnológico',
            backend: 'Tecnologias Backend',
            frontend: 'Tecnologias Frontend',
            usageStatement: 'Declaração de Uso do Sistema',
            systemDesc: 'Este sistema é desenvolvido com base em componentes de código aberto, usando licença MIT:',
            freeUse: 'Livre para usar, modificar e distribuir',
            commercial: 'Suporta uso comercial e não comercial',
            copyright: 'Por favor, mantenha o aviso de direitos autorais',
            contactEmail: 'E-mail de Contato do Desenvolvedor'
        },
        
        // Histórico
        history: {
            title: 'Histórico',
            search: 'Pesquisar histórico...',
            recent: 'Recente',
            today: 'Hoje',
            thisWeek: 'Esta Semana',
            loading: 'Carregando...',
            noRecords: 'Nenhum registro no histórico',
            deleteConfirm: 'Tem certeza de que deseja excluir esta conversa? Esta ação não pode ser desfeita.',
            cancel: 'Cancelar',
            delete: 'Excluir'
        },
        
        // Comum
        common: {
            save: 'Salvar',
            cancel: 'Cancelar',
            confirm: 'Confirmar',
            close: 'Fechar',
            loading: 'Processando...',
            success: 'Sucesso',
            error: 'Falhou',
            checkingConnection: 'Verificando conexão...',
            thinking: 'Pensando...',
            thinkingTitle: 'Pensando...',
            processing: 'Processando...',
            stopping: 'Parando consulta...',
            stopped: 'Consulta cancelada',
            interrupted: 'Consulta interrompida pelo usuário',
            interruptedMessage: '⚠️ Consulta interrompida pelo usuário',
            testingModel: 'Testando conexão do modelo...',
            testingDatabase: 'Testando conexão do banco de dados...',
            testingConnection: 'Testando conexão...',
            deletingConversation: 'Excluindo conversa...',
            processingRequest: 'Processando solicitação anterior, por favor aguarde...',
            openingVisualization: 'Abrindo visualização...',
            generatingQuery: 'Gerando plano de consulta otimizado...',
            optimizingQuery: 'Otimizando consulta...',
            continuousTip: 'Suporta conversa contínua, você pode continuar perguntando com base nos resultados anteriores',
            dataMining: 'Mineração de dados em andamento, por favor aguarde...',
            understandingRequest: 'Compreendendo solicitação...',
            analyzingRequirements: 'Analisando requisitos...',
            connectingDatabase: 'Conectando ao banco de dados...',
            processingData: 'Processando dados, quase pronto...',
            parsingDataStructure: 'Analisando estrutura de dados...',
            step: 'Passo',
            codeExecution: 'Execução de Código',
            summary: 'Resumo',
            system: 'Sistema',
            output: 'Saída',
            console: 'Console',
            message: 'Mensagem',
            error: 'Erro',
            exception: 'Exceção',
            noDetailedSteps: 'Nenhuma etapa de execução detalhada disponível',
            
            // Sistema de dicas
            tips: {
                detailed: 'Quanto mais detalhada a descrição, mais precisa a consulta',
                naturalLanguage: 'Suporta consultas em linguagem natural, como "vendas do mês passado"',
                flexibleTime: 'Descrições de tempo flexíveis: esta semana, último trimestre, Q3 2024 todos funcionam',
                autoChart: 'Os resultados da consulta gerarão gráficos automaticamente',
                continuous: 'Suporta conversa contínua, faça perguntas de acompanhamento com base nos resultados',
                comparison: 'Tente análise comparativa: "Compare este ano com o ano passado"',
                examples: 'Exemplos: "Top 10 vendas deste mês" ou "Receita da região leste"',
                ranking: 'Suporta consultas de classificação: "Top 5 em vendas"',
                trend: 'Analise tendências: "Tendência de vendas dos últimos 6 meses"',
                followUp: 'Acompanhe com: "Agrupar por mês" ou "Adicionar comparação anual"',
                filter: 'Suporta filtragem: "Produtos com margem de lucro >30%"',
                doubleClick: 'Clique duas vezes nos gráficos para ampliar',
                tabKey: 'Pressione Tab para alternar rapidamente os campos de entrada',
                help: 'Digite "ajuda" para ver mais recursos',
                
                // Cuidado noturno
                lateNight1: 'Está tarde, descanse após esta consulta~',
                lateNight2: 'Madrugada, lembre-se de proteger seus olhos',
                lateNight3: 'Trabalhando até tarde, lembre-se de fazer pausas',
                lateNight4: 'Ainda trabalhando tão tarde, você é muito dedicado!',
                lateNight5: 'Modo coruja noturna ativado, mas a saúde é mais importante',
                midnight: 'Passou da meia-noite, descanse cedo para sua saúde',
                earlyMorning: 'Madrugada, a saúde é mais importante que os dados'
            }
        },
        
        // Mensagens de erro
        errors: {
            networkError: 'Falha na conexão de rede',
            loadConfigFailed: 'Falha ao carregar configuração',
            saveConfigFailed: 'Falha ao salvar configuração',
            connectionFailed: 'Conexão falhou',
            testConnectionFailed: 'Teste de conexão falhou',
            saveModelFailed: 'Falha ao salvar modelo',
            deleteModelFailed: 'Falha ao excluir modelo',
            fillRequiredFields: 'Por favor, preencha todos os campos obrigatórios',
            enterQuery: 'Por favor, insira uma consulta',
            sendFailed: 'Envio falhou, por favor tente novamente',
            loadConversationFailed: 'Falha ao carregar conversa',
            copyFailed: 'Cópia falhou',
            clearCacheFailed: 'Falha ao limpar cache',
            apiConnectionSuccess: 'Conexão API bem-sucedida!',
            dbConnectionSuccess: 'Conexão com banco de dados bem-sucedida!',
            configSaved: 'Configuração salva',
            cacheCleared: 'Cache limpo',
            copiedToClipboard: 'Copiado para a área de transferência',
            newConversationStarted: 'Nova conversa iniciada',
            languageSwitchedPt: 'Idioma alterado para Português',
            languageSwitchedZh: '语言已切换为中文',
            languageSwitchedEn: 'Language switched to English',
            serverError: 'Erro no servidor, por favor tente novamente mais tarde',
            permissionError: 'Permissão negada',
            validationError: 'Formato de dados inválido',
            generalError: 'Ocorreu um erro, por favor tente novamente'
        },
        
        // Mensagens de notificação
        notifications: {
            apiConnected: 'Conexão API bem-sucedida!',
            modelSaved: 'Configuração do modelo salva',
            saveFailed: 'Falha ao salvar',
            dbConnected: 'Conexão de banco de dados bem-sucedida!',
            dbConfigSaved: 'Configuração do banco de dados salva',
            uiSettingsSaved: 'Configurações da interface salvas',
            sendFailed: 'Falha no envio, tente novamente',
            requestFailed: 'Falha no processamento da solicitação. Verifique a conexão de rede ou tente novamente mais tarde.'
        },
        
        // Relacionado a consultas
        query: {
            executeComplete: 'Execução da consulta concluída',
            loadingChart: 'Carregando gráfico...',
            chartLoadFailed: 'Falha ao carregar gráfico',
            dataFound: 'Dados recuperados com sucesso',
            queryFailed: 'Consulta falhou',
            noDataDetected: 'Nenhum resultado de consulta de dados detectado',
            sqlExecuted: 'Executadas {count} consultas SQL',
            noSqlDetected: 'Nenhum comando de consulta SQL detectado',
            chartGenerated: 'Gráfico de visualização gerado com sucesso',
            noChartGenerated: 'Nenhum gráfico de visualização gerado para esta consulta',
            generatedCharts: 'Gráficos gerados:',
            processing: 'Processando sua consulta, aguarde...',
            rawData: 'Dados brutos',
            step: 'Passo',
            codeExecution: 'Execução de código',
            consoleOutput: 'Saída do console',
            error: 'Erro',
            systemMessage: 'Mensagem do sistema',
            summary: 'Resumo',
            finalOutput: 'Saída final'
        },
        
        // Mensagens de dica
        tips: {
            notSatisfied: 'Não satisfeito? Tente adicionar detalhes e fornecer feedback ao AI novamente',
            errorOccurred: 'Encontrou um erro? Tente simplificar as condições da consulta ou verificar se os nomes das tabelas estão corretos',
            notPrecise: 'Consulta não precisa o suficiente? Tente especificar intervalos de tempo específicos ou dimensões de dados'
        },
        
        // Funcionalidade de exportação
        export: {
            title: 'Exportar Resultados',
            options: 'Opções de Exportação',
            format: 'Formato de Exportação',
            content: 'Incluir Conteúdo'
        },
        
        // Configuração do sistema
        config: {
            configuration: 'Configuração',
            model: 'Modelo',
            settings: 'Configurações'
        }
    },
    
    // Español
    es: {
        // Títulos del sistema
        systemName: 'QueryGPT',
        systemDesc: 'Sistema Inteligente de Consulta y Visualización de Datos',
        
        // Menú de navegación
        nav: {
            query: 'Consulta',
            newQuery: 'Consulta de Datos',
            history: 'Historial',
            settings: 'Configuración',
            basicSettings: 'Configuración Básica',
            modelManagement: 'Gestión de Modelos',
            databaseConfig: 'Configuración de Base de Datos',
            about: 'Acerca de'
        },
        
        // Página de chat
        chat: {
            title: 'Consulta y Análisis de Datos',
            newConversation: 'Nueva Conversación',
            inputPlaceholder: 'Ingrese su consulta...',
            welcome: 'Bienvenido al Sistema de Análisis Inteligente de Datos QueryGPT',
            welcomeDesc: 'Puedo ayudarte a:',
            feature1: 'Consultar bases de datos usando lenguaje natural',
            feature2: 'Generar visualizaciones de datos automáticamente',
            feature3: 'Analizar datos inteligentemente y proporcionar insights',
            tryExample: 'Prueba estos ejemplos:',
            example1: 'Mostrar datos de ventas del último mes',
            example2: 'Analizar distribución de ventas por categoría de producto',
            example3: 'Encontrar los 10 principales clientes por ventas',
            example4: 'Generar gráfico de tendencia de crecimiento de usuarios',
            exampleBtn1: 'Ver Base de Datos',
            exampleBtn2: 'Análisis de Ventas',
            exampleBtn3: 'Mix de Productos',
            exampleBtn4: 'Tendencias de Usuarios',
            hint: 'Consejo: Ingresa consultas en lenguaje natural, el sistema las convertirá automáticamente a SQL y generará gráficos',
            userView: 'Vista de Usuario',
            developerView: 'Vista de Desarrollador',
            analysisComplete: 'Análisis Completo',
            executionComplete: 'Ejecución Completa',
            finalOutput: 'Salida Final',
            needChart: '¿Necesitas un gráfico? Intenta solicitar explícitamente "generar gráfico" o "visualizar datos" en tu consulta'
        },
        
        // Página de configuración
        settings: {
            title: 'Configuración del Sistema',
            language: 'Idioma',
            languageDesc: 'Seleccionar idioma de la interfaz del sistema',
            chinese: '中文',
            english: 'English',
            spanish: 'Español',
            viewMode: 'Modo de Vista Predeterminado',
            userMode: 'Modo Usuario (Simple)',
            developerMode: 'Modo Desarrollador (Detallado)',
            contextRounds: 'Rondas de Historial de Contexto',
            contextDesc: 'Establecer cuántas rondas de conversación recuerda la IA para corrección de errores y comprensión del contexto',
            noHistory: 'Sin historial (Conversación única)',
            roundHistory: 'Mantener {n} ronda(s) de historial',
            recommended: '(Recomendado)',
            mayAffectPerformance: '(Puede afectar el rendimiento)'
        },
        
        // Gestión de modelos
        models: {
            title: 'Gestión de Modelos',
            addModel: 'Agregar Modelo',
            name: 'Nombre del Modelo',
            type: 'Tipo',
            apiAddress: 'Dirección API',
            status: 'Estado',
            actions: 'Acciones',
            available: 'Disponible',
            unavailable: 'No Configurado',
            edit: 'Editar',
            test: 'Probar',
            delete: 'Eliminar',
            apiKey: 'Clave API',
            maxTokens: 'Tokens Máximos',
            temperature: 'Temperatura',
            modelNamePlaceholder: 'ej. GPT-4',
            modelIdPlaceholder: 'ej. gpt-4',
            apiBasePlaceholder: 'ej. http://localhost:11434/v1',
            apiKeyPlaceholder: 'Ingrese clave API'
        },
        
        // Configuración de base de datos
        database: {
            title: 'Configuración de Base de Datos Doris',
            host: 'Dirección del Host',
            hostPlaceholder: 'ej. localhost o 192.168.1.100',
            port: 'Puerto',
            username: 'Nombre de Usuario',
            usernamePlaceholder: 'Nombre de usuario de la base de datos',
            password: 'Contraseña',
            passwordPlaceholder: 'Contraseña de la base de datos',
            dbName: 'Nombre de Base de Datos',
            dbNamePlaceholder: 'Dejar vacío para consultas entre bases de datos (recomendado)',
            hint: 'Sugerencia: Dejar vacío para habilitar consultas entre bases de datos, usar formato basededatos.tabla',
            testConnection: 'Probar Conexión',
            saveConfig: 'Guardar Configuración',
            connectionSuccess: 'Conexión Exitosa',
            connectionInfo: 'Base de datos conectada, se encontraron {count} tabla(s)'
        },
        
        // Página Acerca de
        about: {
            title: 'Acerca del Sistema',
            version: 'Versión',
            developer: 'Desarrollador',
            independentDev: 'Desarrollador Independiente',
            organization: 'Organización',
            openSource: 'Proyecto de Código Abierto',
            versionInfo: 'Información de Versión',
            betaVersion: 'Versión Beta',
            updateTime: 'Tiempo de Actualización',
            maintaining: 'En Mantenimiento Continuo',
            releaseDate: 'Agosto 2025',
            features: {
                ai: 'Análisis de Datos con IA',
                database: 'Consulta de Base de Datos',
                visualization: 'Generación de Visualizaciones'
            },
            license: 'Declaración de Licencia',
            licenseDetails: {
                openInterpreter: 'Motor Central OpenInterpreter:',
                openInterpreterLicense: 'Licencia MIT',
                openInterpreterDesc: 'Motor de ejecución de código de lenguaje natural de código abierto, permite uso comercial',
                openInterpreterDetail1: '• Este proyecto usa la versión 0.4.3 instalada por pip, sigue la licencia MIT',
                openInterpreterDetail2: '• Libre para usar, modificar y desplegar',
                openInterpreterDetail3: '• Proporciona capacidades centrales de IA para lenguaje natural a código',
                otherLibs: 'Flask/PyMySQL/Plotly etc:',
                otherLibsLicense: 'Licencia MIT/BSD',
                otherLibsDesc: 'Permite uso comercial, modificación y distribución',
                flaskDetail: '• Flask 3.1.1 - Framework web ligero, licencia BSD',
                pymysqlDetail: '• PyMySQL 1.1.1 - Biblioteca de conexión a base de datos MySQL, licencia MIT',
                plotlyDetail: '• Plotly 6.3.0 - Biblioteca de visualización de datos, licencia MIT',
                allOpenSource: '• Todas las dependencias tienen licencia de código abierto',
                disclaimer: 'Descargo de Responsabilidad:',
                disclaimerText: 'Este sistema es una herramienta impulsada por IA. El desarrollador no es responsable de pérdida de datos u otros problemas que puedan ocurrir durante el uso. Por favor respalde sus datos y gestione permisos antes de usar.'
            },
            techStack: 'Stack Tecnológico',
            backend: 'Tecnologías Backend',
            frontend: 'Tecnologías Frontend',
            usageStatement: 'Declaración de Uso del Sistema',
            systemDesc: 'Este sistema está desarrollado basándose en componentes de código abierto, usando licencia MIT:',
            freeUse: 'Libre para usar, modificar y distribuir',
            commercial: 'Soporta uso comercial y no comercial',
            copyright: 'Por favor mantenga el aviso de copyright',
            contactEmail: 'Correo de Contacto del Desarrollador'
        },
        
        // Historial
        history: {
            title: 'Historial',
            search: 'Buscar historial...',
            recent: 'Reciente',
            today: 'Hoy',
            thisWeek: 'Esta Semana',
            loading: 'Cargando...',
            noRecords: 'Sin registros de historial',
            deleteConfirm: '¿Está seguro de que desea eliminar esta conversación? Esta acción no se puede deshacer.',
            cancel: 'Cancelar',
            delete: 'Eliminar'
        },
        
        // Común
        common: {
            save: 'Guardar',
            cancel: 'Cancelar',
            confirm: 'Confirmar',
            close: 'Cerrar',
            loading: 'Procesando...',
            success: 'Éxito',
            error: 'Error',
            checkingConnection: 'Verificando conexión...',
            thinking: 'Pensando...',
            thinkingTitle: 'Pensando...',
            processing: 'Procesando...',
            stopping: 'Deteniendo consulta...',
            stopped: 'Consulta cancelada',
            interrupted: 'Consulta interrumpida por el usuario',
            interruptedMessage: '⚠️ Consulta interrumpida por el usuario',
            testingModel: 'Probando conexión del modelo...',
            testingDatabase: 'Probando conexión de base de datos...',
            testingConnection: 'Probando conexión...',
            deletingConversation: 'Eliminando conversación...',
            processingRequest: 'Procesando solicitud anterior, por favor espere...',
            openingVisualization: 'Abriendo visualización...',
            generatingQuery: 'Generando plan de consulta óptimo...',
            optimizingQuery: 'Optimizando consulta...',
            continuousTip: 'Soporta conversación continua, puede continuar preguntando basándose en resultados anteriores',
            dataMining: 'Minería de datos en progreso, por favor espere...',
            understandingRequest: 'Comprendiendo solicitud...',
            analyzingRequirements: 'Analizando requisitos...',
            connectingDatabase: 'Conectando a base de datos...',
            processingData: 'Procesando datos, casi listo...',
            parsingDataStructure: 'Analizando estructura de datos...',
            step: 'Paso',
            codeExecution: 'Ejecución de Código',
            summary: 'Resumen',
            system: 'Sistema',
            output: 'Salida',
            console: 'Consola',
            message: 'Mensaje',
            error: 'Error',
            exception: 'Excepción',
            noDetailedSteps: 'No hay pasos de ejecución detallados disponibles',
            
            // Sistema de consejos
            tips: {
                detailed: 'Cuanto más detallada la descripción, más precisa la consulta',
                naturalLanguage: 'Soporta consultas en lenguaje natural, como "ventas del mes pasado"',
                flexibleTime: 'Descripciones de tiempo flexibles: esta semana, último trimestre, Q3 2024 todos funcionan',
                autoChart: 'Los resultados de consulta generarán gráficos automáticamente',
                continuous: 'Soporta conversación continua, haz preguntas de seguimiento basadas en resultados',
                comparison: 'Prueba análisis comparativo: "Comparar este año con el año pasado"',
                examples: 'Ejemplos: "Top 10 ventas este mes" o "Ingresos región Este"',
                ranking: 'Soporta consultas de ranking: "Top 5 ventas"',
                trend: 'Analizar tendencias: "Tendencia de ventas últimos 6 meses"',
                followUp: 'Seguimiento con: "Agrupar por mes" o "Agregar año sobre año"',
                filter: 'Soporta filtrado: "Productos con margen de ganancia >30%"',
                doubleClick: 'Doble clic en gráficos para ampliar',
                tabKey: 'Presiona Tab para cambiar rápidamente campos de entrada',
                help: 'Escribe "ayuda" para ver más características',
                
                // Cuidado nocturno
                lateNight1: 'Es tarde, descansa después de esta consulta~',
                lateNight2: 'Horas de madrugada, recuerda proteger tus ojos',
                lateNight3: 'Trabajando tarde, recuerda tomar descansos',
                lateNight4: '¡Todavía trabajando tan tarde, eres muy dedicado!',
                lateNight5: 'Modo nocturno activado, pero la salud es más importante',
                midnight: 'Pasada la medianoche, descansar temprano es bueno para tu salud',
                earlyMorning: 'Madrugada, la salud es más importante que los datos'
            }
        },
        
        // Mensajes de error
        errors: {
            networkError: 'Fallo de conexión de red',
            loadConfigFailed: 'Error al cargar configuración',
            saveConfigFailed: 'Error al guardar configuración',
            connectionFailed: 'Conexión fallida',
            testConnectionFailed: 'Prueba de conexión fallida',
            saveModelFailed: 'Error al guardar modelo',
            deleteModelFailed: 'Error al eliminar modelo',
            fillRequiredFields: 'Por favor complete todos los campos requeridos',
            enterQuery: 'Por favor ingrese una consulta',
            sendFailed: 'Envío fallido, por favor intente de nuevo',
            loadConversationFailed: 'Error al cargar conversación',
            copyFailed: 'Error al copiar',
            clearCacheFailed: 'Error al limpiar caché',
            apiConnectionSuccess: '¡Conexión API exitosa!',
            dbConnectionSuccess: '¡Conexión a base de datos exitosa!',
            configSaved: 'Configuración guardada',
            cacheCleared: 'Caché limpiado',
            copiedToClipboard: 'Copiado al portapapeles',
            newConversationStarted: 'Nueva conversación iniciada',
            languageSwitchedZh: '语言已切换为中文',
            languageSwitchedEn: 'Language switched to English',
            languageSwitchedEs: 'Idioma cambiado a Español',
            serverError: 'Error del servidor, por favor intente más tarde',
            permissionError: 'Permiso denegado',
            validationError: 'Formato de datos inválido',
            generalError: 'Ocurrió un error, por favor intente de nuevo'
        },
        
        // Mensajes de notificación
        notifications: {
            apiConnected: '¡Conexión API exitosa!',
            modelSaved: 'Configuración del modelo guardada',
            saveFailed: 'Error al guardar',
            dbConnected: '¡Conexión de base de datos exitosa!',
            dbConfigSaved: 'Configuración de base de datos guardada',
            uiSettingsSaved: 'Configuraciones de interfaz guardadas',
            sendFailed: 'Error de envío, intente de nuevo',
            requestFailed: 'Error en el procesamiento de la solicitud. Verifique la conexión de red o intente más tarde.'
        },
        
        // Relacionado con consultas
        query: {
            executeComplete: 'Ejecución de consulta completada',
            loadingChart: 'Cargando gráfico...',
            chartLoadFailed: 'Error al cargar gráfico',
            dataFound: 'Datos recuperados exitosamente',
            queryFailed: 'Consulta falló',
            noDataDetected: 'No se detectaron resultados de consulta de datos',
            sqlExecuted: 'Ejecutadas {count} consultas SQL',
            noSqlDetected: 'No se detectaron comandos de consulta SQL',
            chartGenerated: 'Gráfico de visualización generado exitosamente',
            noChartGenerated: 'No se generó gráfico de visualización para esta consulta',
            generatedCharts: 'Gráficos generados:',
            processing: 'Procesando su consulta, por favor espere...',
            rawData: 'Datos sin procesar',
            step: 'Paso',
            codeExecution: 'Ejecución de código',
            consoleOutput: 'Salida de consola',
            error: 'Error',
            systemMessage: 'Mensaje del sistema',
            summary: 'Resumen',
            finalOutput: 'Salida final'
        },
        
        // Mensajes de consejo
        tips: {
            notSatisfied: '¿No satisfecho? Intente agregar detalles y proporcionar comentarios al AI nuevamente',
            errorOccurred: '¿Encontró un error? Intente simplificar las condiciones de consulta o verificar si los nombres de tabla son correctos',
            notPrecise: '¿Consulta no lo suficientemente precisa? Intente especificar rangos de tiempo específicos o dimensiones de datos'
        },
        
        // Funcionalidad de exportación
        export: {
            title: 'Exportar Resultados',
            options: 'Opciones de Exportación',
            format: 'Formato de Exportación',
            content: 'Incluir Contenido'
        },
        
        // Configuración del sistema
        config: {
            configuration: 'Configuración',
            model: 'Modelo',
            settings: 'Configuraciones'
        }
    },
    
    // Français
    fr: {
        // Titres du système
        systemName: 'QueryGPT',
        systemDesc: 'Système Intelligent de Requêtes et Visualisation de Données',
        
        // Menu de navigation
        nav: {
            query: 'Requête',
            newQuery: 'Requête de Données',
            history: 'Historique',
            settings: 'Paramètres',
            basicSettings: 'Paramètres de Base',
            modelManagement: 'Gestion des Modèles',
            databaseConfig: 'Configuration Base de Données',
            about: 'À Propos'
        },
        
        // Page de discussion
        chat: {
            title: 'Requêtes et Analyse de Données',
            newConversation: 'Nouvelle Conversation',
            inputPlaceholder: 'Entrez votre requête...',
            welcome: 'Bienvenue dans le Système d\'Analyse de Données Intelligent QueryGPT',
            welcomeDesc: 'Je peux vous aider à :',
            feature1: 'Interroger des bases de données en langage naturel',
            feature2: 'Générer automatiquement des visualisations de données',
            feature3: 'Analyser intelligemment les données et fournir des insights',
            tryExample: 'Essayez ces exemples :',
            example1: 'Afficher les données de vente du mois dernier',
            example2: 'Analyser la répartition des ventes par catégorie de produit',
            example3: 'Trouver les 10 meilleurs clients par chiffre d\'affaires',
            example4: 'Générer le graphique de tendance de croissance des utilisateurs',
            exampleBtn1: 'Voir Base de Données',
            exampleBtn2: 'Analyse des Ventes',
            exampleBtn3: 'Répartition Produits',
            exampleBtn4: 'Tendances Utilisateurs',
            hint: 'Astuce : Entrez des requêtes en langage naturel, le système les convertira automatiquement en SQL et générera des graphiques',
            userView: 'Vue Utilisateur',
            developerView: 'Vue Développeur',
            analysisComplete: 'Analyse Terminée',
            executionComplete: 'Exécution Terminée',
            finalOutput: 'Résultat Final',
            needChart: 'Besoin d\'un graphique ? Essayez de demander explicitement "générer un graphique" ou "visualiser les données" dans votre requête'
        },
        
        // Page des paramètres
        settings: {
            title: 'Paramètres Système',
            language: 'Langue',
            languageDesc: 'Sélectionner la langue de l\'interface',
            chinese: '中文',
            english: 'English',
            traditionalChinese: '繁體中文',
            japanese: '日本語',
            spanish: 'Español',
            french: 'Français',
            german: 'Deutsch',
            russian: 'Русский',
            portuguese: 'Português',
            korean: '한국어',
            viewMode: 'Mode d\'Affichage par Défaut',
            userMode: 'Mode Utilisateur (Simple)',
            developerMode: 'Mode Développeur (Détaillé)',
            contextRounds: 'Tours de Contexte Historique',
            contextDesc: 'Définir combien de tours de conversation l\'IA mémorise pour la correction d\'erreurs et la compréhension du contexte',
            noHistory: 'Pas d\'historique (Tour unique)',
            roundHistory: 'Conserver {n} tour(s) d\'historique',
            recommended: '(Recommandé)',
            mayAffectPerformance: '(Peut affecter les performances)'
        },
        
        // Gestion des modèles
        models: {
            title: 'Gestion des Modèles',
            addModel: 'Ajouter un Modèle',
            name: 'Nom du Modèle',
            type: 'Type',
            apiAddress: 'Adresse API',
            status: 'Statut',
            actions: 'Actions',
            available: 'Disponible',
            unavailable: 'Non Configuré',
            edit: 'Modifier',
            test: 'Tester',
            delete: 'Supprimer',
            apiKey: 'Clé API',
            maxTokens: 'Tokens Maximum',
            temperature: 'Température',
            modelNamePlaceholder: 'ex : GPT-4',
            modelIdPlaceholder: 'ex : gpt-4',
            apiBasePlaceholder: 'ex : http://localhost:11434/v1',
            apiKeyPlaceholder: 'Entrez la clé API'
        },
        
        // Configuration de la base de données
        database: {
            title: 'Configuration Base de Données Doris',
            host: 'Adresse de l\'Hôte',
            hostPlaceholder: 'ex : localhost ou 192.168.1.100',
            port: 'Port',
            username: 'Nom d\'Utilisateur',
            usernamePlaceholder: 'Nom d\'utilisateur de la base de données',
            password: 'Mot de Passe',
            passwordPlaceholder: 'Mot de passe de la base de données',
            dbName: 'Nom de la Base de Données',
            dbNamePlaceholder: 'Laisser vide pour les requêtes inter-bases (recommandé)',
            hint: 'Astuce : Laisser vide permet les requêtes inter-bases, utilisez le format base.table',
            testConnection: 'Tester la Connexion',
            saveConfig: 'Enregistrer la Configuration',
            connectionSuccess: 'Connexion Réussie',
            connectionInfo: 'Base de données connectée, {count} table(s) trouvée(s)'
        },
        
        // Page À propos
        about: {
            title: 'À Propos du Système',
            version: 'Version',
            developer: 'Développeur',
            independentDev: 'Développeur Indépendant',
            organization: 'Organisation',
            openSource: 'Projet Open Source',
            versionInfo: 'Informations de Version',
            betaVersion: 'Version Bêta',
            updateTime: 'Date de Mise à Jour',
            maintaining: 'En Maintenance Continue',
            releaseDate: 'Août 2025',
            features: {
                ai: 'Analyse de Données IA',
                database: 'Requêtes Base de Données',
                visualization: 'Génération de Visualisations'
            },
            license: 'Déclaration de Licence',
            licenseDetails: {
                openInterpreter: 'Moteur Principal OpenInterpreter :',
                openInterpreterLicense: 'Licence MIT',
                openInterpreterDesc: 'Moteur open source d\'exécution de code en langage naturel, permet l\'utilisation commerciale',
                openInterpreterDetail1: '• Ce projet utilise la version 0.4.3 installée via pip, suit la licence MIT',
                openInterpreterDetail2: '• Libre d\'utilisation, de modification et de déploiement',
                openInterpreterDetail3: '• Fournit les capacités principales d\'IA pour la conversion langage naturel vers code',
                otherLibs: 'Flask/PyMySQL/Plotly etc :',
                otherLibsLicense: 'Licence MIT/BSD',
                otherLibsDesc: 'Permet l\'utilisation commerciale, la modification et la distribution',
                flaskDetail: '• Flask 3.1.1 - Framework web léger, licence BSD',
                pymysqlDetail: '• PyMySQL 1.1.1 - Bibliothèque de connexion MySQL, licence MIT',
                plotlyDetail: '• Plotly 6.3.0 - Bibliothèque de visualisation de données, licence MIT',
                allOpenSource: '• Toutes les dépendances sont sous licence open source',
                disclaimer: 'Avertissement :',
                disclaimerText: 'Ce système est un outil piloté par IA. Le développeur n\'est pas responsable de toute perte de données ou autres problèmes pouvant survenir lors de l\'utilisation. Veuillez sauvegarder vos données et gérer les permissions avant utilisation.'
            },
            techStack: 'Stack Technologique',
            backend: 'Technologies Backend',
            frontend: 'Technologies Frontend',
            usageStatement: 'Déclaration d\'Utilisation du Système',
            systemDesc: 'Ce système est développé sur la base de composants open source, utilisant la licence MIT :',
            freeUse: 'Libre d\'utilisation, de modification et de distribution',
            commercial: 'Supporte l\'utilisation commerciale et non commerciale',
            copyright: 'Veuillez conserver les mentions de droits d\'auteur',
            contactEmail: 'Email de Contact du Développeur'
        },
        
        // Historique
        history: {
            title: 'Historique',
            search: 'Rechercher dans l\'historique...',
            recent: 'Récent',
            today: 'Aujourd\'hui',
            thisWeek: 'Cette Semaine',
            loading: 'Chargement...',
            noRecords: 'Aucun historique',
            deleteConfirm: 'Êtes-vous sûr de vouloir supprimer cette conversation ? Cette action est irréversible.',
            cancel: 'Annuler',
            delete: 'Supprimer'
        },
        
        // Commun
        common: {
            save: 'Enregistrer',
            cancel: 'Annuler',
            confirm: 'Confirmer',
            close: 'Fermer',
            loading: 'Traitement...',
            success: 'Succès',
            error: 'Échec',
            checkingConnection: 'Vérification de la connexion...',
            thinking: 'Réflexion en cours...',
            thinkingTitle: 'En train de réfléchir...',
            processing: 'Traitement...',
            stopping: 'Arrêt de la requête...',
            stopped: 'Requête annulée',
            interrupted: 'Requête interrompue par l\'utilisateur',
            interruptedMessage: '⚠️ Requête interrompue par l\'utilisateur',
            testingModel: 'Test de la connexion au modèle...',
            testingDatabase: 'Test de la connexion à la base de données...',
            testingConnection: 'Test de la connexion...',
            deletingConversation: 'Suppression de la conversation...',
            processingRequest: 'Traitement de la requête précédente, veuillez patienter...',
            openingVisualization: 'Ouverture de la visualisation...',
            generatingQuery: 'Génération du plan de requête optimal...',
            optimizingQuery: 'Optimisation de la requête...',
            continuousTip: 'Supporte la conversation continue, vous pouvez poser des questions basées sur les résultats précédents',
            dataMining: 'Exploration de données en cours, veuillez patienter...',
            understandingRequest: 'Compréhension de la demande...',
            analyzingRequirements: 'Analyse des exigences...',
            connectingDatabase: 'Connexion à la base de données...',
            processingData: 'Traitement des données, presque terminé...',
            parsingDataStructure: 'Analyse de la structure des données...',
            step: 'Étape',
            codeExecution: 'Exécution du Code',
            summary: 'Résumé',
            system: 'Système',
            output: 'Sortie',
            console: 'Console',
            message: 'Message',
            error: 'Erreur',
            exception: 'Exception',
            noDetailedSteps: 'Aucune étape d\'exécution détaillée disponible',
            
            // Système de conseils
            tips: {
                detailed: 'Plus la description est détaillée, plus la requête est précise',
                naturalLanguage: 'Supporte les requêtes en langage naturel, comme "les ventes du mois dernier"',
                flexibleTime: 'Descriptions temporelles flexibles : cette semaine, dernier trimestre, T3 2024 fonctionnent tous',
                autoChart: 'Les résultats de requête génèrent automatiquement des graphiques',
                continuous: 'Supporte la conversation continue, posez des questions de suivi basées sur les résultats',
                comparison: 'Essayez l\'analyse comparative : "Comparer cette année avec l\'année dernière"',
                examples: 'Exemples : "Top 10 des ventes ce mois" ou "Revenus région Est"',
                ranking: 'Supporte les requêtes de classement : "Top 5 des ventes"',
                trend: 'Analyser les tendances : "Tendance des ventes sur 6 mois"',
                followUp: 'Continuez avec : "Grouper par mois" ou "Ajouter année sur année"',
                filter: 'Supporte le filtrage : "Produits avec marge bénéficiaire >30%"',
                doubleClick: 'Double-cliquez sur les graphiques pour zoomer',
                tabKey: 'Appuyez sur Tab pour changer rapidement de champ',
                help: 'Tapez "aide" pour voir plus de fonctionnalités',
                
                // Messages de soins tard dans la nuit
                lateNight1: 'Il est tard, reposez-vous après cette requête~',
                lateNight2: 'Heures matinales, n\'oubliez pas de protéger vos yeux',
                lateNight3: 'Travailler tard, n\'oubliez pas de faire des pauses',
                lateNight4: 'Toujours au travail si tard, vous êtes vraiment dévoué !',
                lateNight5: 'Mode noctambule activé, mais la santé est plus importante',
                midnight: 'Minuit passé, reposez-vous tôt pour votre santé',
                earlyMorning: 'Tôt le matin, la santé est plus importante que les données'
            }
        },
        
        // Messages d'erreur
        errors: {
            networkError: 'Échec de la connexion réseau',
            loadConfigFailed: 'Échec du chargement de la configuration',
            saveConfigFailed: 'Échec de l\'enregistrement de la configuration',
            connectionFailed: 'Connexion échouée',
            testConnectionFailed: 'Test de connexion échoué',
            saveModelFailed: 'Échec de l\'enregistrement du modèle',
            deleteModelFailed: 'Échec de la suppression du modèle',
            fillRequiredFields: 'Veuillez remplir tous les champs obligatoires',
            enterQuery: 'Veuillez entrer une requête',
            sendFailed: 'Échec de l\'envoi, veuillez réessayer',
            loadConversationFailed: 'Échec du chargement de la conversation',
            copyFailed: 'Échec de la copie',
            clearCacheFailed: 'Échec de la suppression du cache',
            apiConnectionSuccess: 'Connexion API réussie !',
            dbConnectionSuccess: 'Connexion à la base de données réussie !',
            configSaved: 'Configuration enregistrée',
            cacheCleared: 'Cache effacé',
            copiedToClipboard: 'Copié dans le presse-papiers',
            newConversationStarted: 'Nouvelle conversation démarrée',
            languageSwitchedZh: '语言已切换为中文',
            languageSwitchedEn: 'Language switched to English',
            languageSwitchedFr: 'Langue changée en français',
            serverError: 'Erreur serveur, veuillez réessayer plus tard',
            permissionError: 'Permission refusée',
            validationError: 'Format de données invalide',
            generalError: 'Une erreur s\'est produite, veuillez réessayer'
        },
        
        // Messages de notification
        notifications: {
            apiConnected: 'Connexion API réussie !',
            modelSaved: 'Configuration du modèle sauvegardée',
            saveFailed: 'Échec de la sauvegarde',
            dbConnected: 'Connexion de base de données réussie !',
            dbConfigSaved: 'Configuration de base de données sauvegardée',
            uiSettingsSaved: 'Paramètres d\'interface sauvegardés',
            sendFailed: 'Échec de l\'envoi, veuillez réessayer',
            requestFailed: 'Échec du traitement de la demande. Vérifiez la connexion réseau ou réessayez plus tard.'
        },
        
        // Relatif aux requêtes
        query: {
            executeComplete: 'Exécution de requête terminée',
            loadingChart: 'Chargement du graphique...',
            chartLoadFailed: 'Échec du chargement du graphique',
            dataFound: 'Données récupérées avec succès',
            queryFailed: 'Requête échouée',
            noDataDetected: 'Aucun résultat de requête de données détecté',
            sqlExecuted: '{count} requêtes SQL exécutées',
            noSqlDetected: 'Aucune commande de requête SQL détectée',
            chartGenerated: 'Graphique de visualisation généré avec succès',
            noChartGenerated: 'Aucun graphique de visualisation généré pour cette requête',
            generatedCharts: 'Graphiques générés :',
            processing: 'Traitement de votre requête, veuillez patienter...',
            rawData: 'Données brutes',
            step: 'Étape',
            codeExecution: 'Exécution de code',
            consoleOutput: 'Sortie console',
            error: 'Erreur',
            systemMessage: 'Message système',
            summary: 'Résumé',
            finalOutput: 'Sortie finale'
        },
        
        // Messages de conseil
        tips: {
            notSatisfied: 'Pas satisfait ? Essayez d\'ajouter des détails et de donner un retour à l\'IA à nouveau',
            errorOccurred: 'Rencontré une erreur ? Essayez de simplifier les conditions de requête ou vérifiez si les noms de table sont corrects',
            notPrecise: 'Requête pas assez précise ? Essayez de spécifier des plages de temps spécifiques ou des dimensions de données'
        },
        
        // Fonctionnalité d'exportation
        export: {
            title: 'Exporter les Résultats',
            options: 'Options d\'Exportation',
            format: 'Format d\'Exportation',
            content: 'Inclure le Contenu'
        },
        
        // Configuration du système
        config: {
            configuration: 'Configuration',
            model: 'Modèle',
            settings: 'Paramètres'
        }
    },
    
    // 한국어
    ko: {
        // 시스템 제목
        systemName: 'QueryGPT',
        systemDesc: '지능형 데이터 쿼리 및 시각화 시스템',
        
        // 네비게이션 메뉴
        nav: {
            query: '쿼리',
            newQuery: '데이터 쿼리',
            history: '히스토리',
            settings: '설정',
            basicSettings: '기본 설정',
            modelManagement: '모델 관리',
            databaseConfig: '데이터베이스 설정',
            about: '정보'
        },
        
        // 채팅 페이지
        chat: {
            title: '데이터 쿼리 및 분석',
            newConversation: '새 대화',
            inputPlaceholder: '쿼리를 입력하세요...',
            welcome: 'QueryGPT 지능형 데이터 분석 시스템에 오신 것을 환영합니다',
            welcomeDesc: '다음과 같은 작업을 도와드릴 수 있습니다:',
            feature1: '자연어로 데이터베이스 쿼리하기',
            feature2: '데이터 시각화 차트 자동 생성',
            feature3: '데이터를 지능적으로 분석하고 인사이트 제공',
            tryExample: '다음 예시를 시도해보세요:',
            example1: '지난 달 판매 데이터 표시',
            example2: '제품 카테고리별 판매 비율 분석',
            example3: '판매액 상위 10개 고객 찾기',
            example4: '사용자 증가 추세 차트 생성',
            exampleBtn1: '데이터베이스 보기',
            exampleBtn2: '판매 분석',
            exampleBtn3: '제품 비율',
            exampleBtn4: '사용자 트렌드',
            hint: '팁: 자연어로 쿼리를 입력하면 시스템이 자동으로 SQL로 변환하고 차트를 생성합니다',
            userView: '사용자 뷰',
            developerView: '개발자 뷰',
            analysisComplete: '분석 완료',
            executionComplete: '실행 완료',
            finalOutput: '최종 출력',
            needChart: '차트가 필요하신가요? 쿼리에 "차트 생성" 또는 "시각화"를 명시해보세요'
        },
        
        // 설정 페이지
        settings: {
            title: '시스템 설정',
            language: '언어',
            languageDesc: '시스템 인터페이스 언어 선택',
            chinese: '中文',
            english: 'English',
            korean: '한국어',
            viewMode: '기본 보기 모드',
            userMode: '사용자 모드 (간단)',
            developerMode: '개발자 모드 (상세)',
            contextRounds: '컨텍스트 히스토리 라운드',
            contextDesc: 'AI가 오류 수정 및 컨텍스트 이해를 위해 기억할 대화 라운드 수 설정',
            noHistory: '히스토리 없음 (단일 라운드)',
            roundHistory: '{n}라운드 히스토리 유지',
            recommended: '(권장)',
            mayAffectPerformance: '(성능에 영향을 줄 수 있음)'
        },
        
        // 모델 관리
        models: {
            title: '모델 관리',
            addModel: '모델 추가',
            name: '모델 이름',
            type: '유형',
            apiAddress: 'API 주소',
            status: '상태',
            actions: '작업',
            available: '사용 가능',
            unavailable: '미설정',
            edit: '편집',
            test: '테스트',
            delete: '삭제',
            apiKey: 'API 키',
            maxTokens: '최대 토큰 수',
            temperature: '온도 매개변수',
            modelNamePlaceholder: '예: GPT-4',
            modelIdPlaceholder: '예: gpt-4',
            apiBasePlaceholder: '예: http://localhost:11434/v1',
            apiKeyPlaceholder: 'API 키 입력'
        },
        
        // 데이터베이스 설정
        database: {
            title: 'Doris 데이터베이스 설정',
            host: '호스트 주소',
            hostPlaceholder: '예: localhost 또는 192.168.1.100',
            port: '포트',
            username: '사용자명',
            usernamePlaceholder: '데이터베이스 사용자명',
            password: '비밀번호',
            passwordPlaceholder: '데이터베이스 비밀번호',
            dbName: '데이터베이스명',
            dbNamePlaceholder: '크로스 데이터베이스 쿼리를 위해 비워두기 (권장)',
            hint: '힌트: 비워두면 크로스 데이터베이스 쿼리가 가능하며, 데이터베이스.테이블 형식으로 접근할 수 있습니다',
            testConnection: '연결 테스트',
            saveConfig: '설정 저장',
            connectionSuccess: '연결 성공',
            connectionInfo: '데이터베이스 연결 정상, 총 {count}개 테이블 발견'
        },
        
        // 정보 페이지
        about: {
            title: '시스템 정보',
            version: '버전',
            developer: '개발자',
            independentDev: '독립 개발자',
            organization: '소속',
            openSource: '오픈소스 프로젝트',
            versionInfo: '버전 정보',
            betaVersion: '베타 버전',
            updateTime: '업데이트 시간',
            maintaining: '지속적인 유지보수 중',
            releaseDate: '2025년 8월',
            features: {
                ai: 'AI 데이터 분석',
                database: '데이터베이스 쿼리',
                visualization: '시각화 생성'
            },
            license: '라이선스 설명',
            licenseDetails: {
                openInterpreter: 'OpenInterpreter 코어 엔진:',
                openInterpreterLicense: 'MIT 라이선스',
                openInterpreterDesc: '오픈소스 자연어 코드 실행 엔진, 상업적 사용 허용',
                openInterpreterDetail1: '• 이 프로젝트는 pip로 설치된 0.4.3 버전을 사용하며 MIT 라이선스를 따릅니다',
                openInterpreterDetail2: '• 자유롭게 사용, 수정 및 배포 가능',
                openInterpreterDetail3: '• 자연어를 코드로 변환하는 핵심 AI 기능 제공',
                otherLibs: 'Flask/PyMySQL/Plotly 등:',
                otherLibsLicense: 'MIT/BSD 라이선스',
                otherLibsDesc: '상업적 사용, 수정 및 배포 허용',
                flaskDetail: '• Flask 3.1.1 - 경량 웹 프레임워크, BSD 라이선스',
                pymysqlDetail: '• PyMySQL 1.1.1 - MySQL 데이터베이스 연결 라이브러리, MIT 라이선스',
                plotlyDetail: '• Plotly 6.3.0 - 데이터 시각화 라이브러리, MIT 라이선스',
                allOpenSource: '• 모든 종속성은 오픈소스 라이선스입니다',
                disclaimer: '면책 조항:',
                disclaimerText: '이 시스템은 AI 기반 도구입니다. 개발자는 사용 중 발생할 수 있는 데이터 손실이나 기타 문제에 대해 책임지지 않습니다. 사용 전 데이터 백업 및 권한 관리를 해주시기 바랍니다.'
            },
            techStack: '기술 스택',
            backend: '백엔드 기술',
            frontend: '프론트엔드 기술',
            usageStatement: '시스템 사용 안내',
            systemDesc: '이 시스템은 오픈소스 컴포넌트를 기반으로 개발되었으며 MIT 라이선스를 사용합니다:',
            freeUse: '자유롭게 사용, 수정 및 배포',
            commercial: '상업적 및 비상업적 용도 지원',
            copyright: '저작권 표시를 유지해주세요',
            contactEmail: '개발자 연락처 이메일'
        },
        
        // 히스토리
        history: {
            title: '히스토리',
            search: '히스토리 검색...',
            recent: '최근',
            today: '오늘',
            thisWeek: '이번 주',
            loading: '로딩 중...',
            noRecords: '히스토리 기록이 없습니다',
            deleteConfirm: '이 대화를 삭제하시겠습니까? 이 작업은 취소할 수 없습니다.',
            cancel: '취소',
            delete: '삭제'
        },
        
        // 공통
        common: {
            save: '저장',
            cancel: '취소',
            confirm: '확인',
            close: '닫기',
            loading: '처리 중...',
            success: '성공',
            error: '실패',
            checkingConnection: '연결 확인 중...',
            thinking: '생각 중...',
            thinkingTitle: '생각 중...',
            processing: '처리 중...',
            stopping: '쿼리 중지 중...',
            stopped: '쿼리가 취소되었습니다',
            interrupted: '사용자가 쿼리를 중단했습니다',
            interruptedMessage: '⚠️ 사용자가 쿼리를 중단했습니다',
            testingModel: '모델 연결 테스트 중...',
            testingDatabase: '데이터베이스 연결 테스트 중...',
            testingConnection: '연결 테스트 중...',
            deletingConversation: '대화 삭제 중...',
            processingRequest: '이전 요청을 처리 중입니다. 잠시만 기다려주세요...',
            openingVisualization: '시각화 결과 열기 중...',
            generatingQuery: '최적의 쿼리 계획 생성 중...',
            optimizingQuery: '쿼리 최적화 중...',
            continuousTip: '연속 대화를 지원합니다. 이전 결과를 기반으로 계속 질문할 수 있습니다',
            dataMining: '데이터 마이닝 중, 잠시만 기다려주세요...',
            understandingRequest: '요청 이해 중...',
            analyzingRequirements: '요구사항 분석 중...',
            connectingDatabase: '데이터베이스 연결 중...',
            processingData: '데이터 처리 중, 곧 완료됩니다...',
            parsingDataStructure: '데이터 구조 분석 중...',
            step: '단계',
            codeExecution: '코드 실행',
            summary: '요약',
            system: '시스템',
            output: '출력',
            console: '콘솔',
            message: '메시지',
            error: '오류',
            exception: '예외',
            noDetailedSteps: '상세 실행 단계 정보가 없습니다',
            
            // 팁 시스템
            tips: {
                detailed: '설명이 자세할수록 쿼리가 더 정확합니다',
                naturalLanguage: '"지난 달 매출" 같은 자연어 쿼리를 지원합니다',
                flexibleTime: '유연한 시간 표현: 이번 주, 지난 분기, 2024년 3분기 모두 인식 가능',
                autoChart: '쿼리 결과가 자동으로 차트를 생성합니다',
                continuous: '연속 대화를 지원하여 이전 결과를 기반으로 추가 질문이 가능합니다',
                comparison: '비교 분석을 시도해보세요: "올해와 작년 데이터 비교"',
                examples: '예시: "이번 달 매출 TOP 10" 또는 "동부 지역 수익"',
                ranking: '순위 쿼리 지원: "판매 상위 5위"',
                trend: '트렌드 분석 가능: "최근 6개월 판매 추세"',
                followUp: '추가 질문 가능: "월별로 그룹화" 또는 "전년 대비 추가"',
                filter: '조건 필터링 지원: "이익률 >30% 제품"',
                doubleClick: '차트를 더블클릭하여 확대할 수 있습니다',
                tabKey: 'Tab 키를 눌러 빠르게 입력 필드를 전환하세요',
                help: '"도움말"을 입력하여 더 많은 기능을 확인하세요',
                
                // 심야 배려
                lateNight1: '늦은 시간이네요, 이 쿼리를 마치고 쉬세요~',
                lateNight2: '새벽 시간입니다, 눈 건강에 주의하세요',
                lateNight3: '늦은 밤까지 고생하셨네요, 적절한 휴식을 취하세요',
                lateNight4: '이렇게 늦게까지 일하시다니, 정말 열심히 하시네요!',
                lateNight5: '올빼미 모드가 활성화되었지만, 건강이 더 중요해요',
                midnight: '자정이 지났네요, 건강을 위해 일찍 쉬세요',
                earlyMorning: '새벽이에요, 데이터보다 건강이 더 중요합니다'
            }
        },
        
        // 오류 메시지
        errors: {
            networkError: '네트워크 연결 실패',
            loadConfigFailed: '설정 로드 실패',
            saveConfigFailed: '설정 저장 실패',
            connectionFailed: '연결 실패',
            testConnectionFailed: '연결 테스트 실패',
            saveModelFailed: '모델 저장 실패',
            deleteModelFailed: '모델 삭제 실패',
            fillRequiredFields: '모든 필수 항목을 입력해주세요',
            enterQuery: '쿼리를 입력해주세요',
            sendFailed: '전송 실패, 다시 시도해주세요',
            loadConversationFailed: '대화 로드 실패',
            copyFailed: '복사 실패',
            clearCacheFailed: '캐시 삭제 실패',
            apiConnectionSuccess: 'API 연결 성공!',
            dbConnectionSuccess: '데이터베이스 연결 성공!',
            configSaved: '설정이 저장되었습니다',
            cacheCleared: '캐시가 삭제되었습니다',
            copiedToClipboard: '클립보드에 복사되었습니다',
            newConversationStarted: '새 대화가 시작되었습니다',
            languageSwitchedKo: '언어가 한국어로 변경되었습니다',
            languageSwitchedZh: '语言已切换为中文',
            languageSwitchedEn: 'Language switched to English',
            serverError: '서버 오류가 발생했습니다. 나중에 다시 시도해주세요',
            permissionError: '이 작업을 수행할 권한이 없습니다',
            validationError: '잘못된 데이터 형식입니다',
            generalError: '오류가 발생했습니다. 다시 시도해주세요'
        },
        
        // 알림 메시지
        notifications: {
            apiConnected: 'API 연결 성공!',
            modelSaved: '모델 구성이 저장되었습니다',
            saveFailed: '저장 실패',
            dbConnected: '데이터베이스 연결 성공!',
            dbConfigSaved: '데이터베이스 구성이 저장되었습니다',
            uiSettingsSaved: '인터페이스 설정이 저장되었습니다',
            sendFailed: '전송 실패, 다시 시도해주세요',
            requestFailed: '요청 처리 실패. 네트워크 연결을 확인하거나 나중에 다시 시도해주세요.'
        },
        
        // 쿼리 관련
        query: {
            executeComplete: '쿼리 실행 완료',
            loadingChart: '차트 로딩 중...',
            chartLoadFailed: '차트 로딩 실패',
            dataFound: '데이터를 성공적으로 검색했습니다',
            queryFailed: '쿼리 실패',
            noDataDetected: '데이터 쿼리 결과가 감지되지 않았습니다',
            sqlExecuted: '{count}개의 SQL 쿼리를 실행했습니다',
            noSqlDetected: 'SQL 쿼리 명령이 감지되지 않았습니다',
            chartGenerated: '시각화 차트가 성공적으로 생성되었습니다',
            noChartGenerated: '이 쿼리에 대한 시각화 차트가 생성되지 않았습니다',
            generatedCharts: '생성된 차트:',
            processing: '쿼리를 처리 중입니다. 잠시 기다려주세요...',
            rawData: '원시 데이터',
            step: '단계',
            codeExecution: '코드 실행',
            consoleOutput: '콘솔 출력',
            error: '오류',
            systemMessage: '시스템 메시지',
            summary: '요약',
            finalOutput: '최종 출력'
        },
        
        // 팁 메시지
        tips: {
            notSatisfied: '만족스럽지 않나요? 세부 사항을 추가하고 AI에게 다시 피드백을 제공해보세요',
            errorOccurred: '오류가 발생했나요? 쿼리 조건을 단순화하거나 테이블 이름이 올바른지 확인해보세요',
            notPrecise: '쿼리가 충분히 정확하지 않나요? 구체적인 시간 범위나 데이터 차원을 지정해보세요'
        },
        
        // 내보내기 기능
        export: {
            title: '결과 내보내기',
            options: '내보내기 옵션',
            format: '내보내기 형식',
            content: '포함 내용'
        },
        
        // 시스템 구성
        config: {
            configuration: '구성',
            model: '모델',
            settings: '설정'
        }
    },
    
    // 德语
    de: {
        // 系统标题
        systemName: 'QueryGPT',
        systemDesc: 'Intelligentes Datenabfrage- und Visualisierungssystem',
        
        // 导航菜单
        nav: {
            query: 'Abfrage',
            newQuery: 'Datenabfrage',
            history: 'Verlauf',
            settings: 'Einstellungen',
            basicSettings: 'Grundeinstellungen',
            modelManagement: 'Modellverwaltung',
            databaseConfig: 'Datenbankkonfiguration',
            about: 'Über'
        },
        
        // 聊天页面
        chat: {
            title: 'Datenabfrage und Analyse',
            newConversation: 'Neue Unterhaltung',
            inputPlaceholder: 'Geben Sie Ihre Abfrage ein...',
            welcome: 'Willkommen bei QueryGPT Intelligentes Datenanalysesystem',
            welcomeDesc: 'Ich kann Ihnen helfen bei:',
            feature1: 'Datenbankabfragen in natürlicher Sprache',
            feature2: 'Automatische Erstellung von Datenvisualisierungen',
            feature3: 'Intelligente Datenanalyse mit Erkenntnissen',
            tryExample: 'Probieren Sie diese Beispiele:',
            example1: 'Zeige Verkaufsdaten des letzten Monats',
            example2: 'Analysiere Verkaufsverteilung nach Produktkategorie',
            example3: 'Finde die Top 10 Kunden nach Umsatz',
            example4: 'Erstelle Nutzerwachstums-Trenddiagramm',
            exampleBtn1: 'Datenbank anzeigen',
            exampleBtn2: 'Verkaufsanalyse',
            exampleBtn3: 'Produktverteilung',
            exampleBtn4: 'Nutzertrends',
            hint: 'Tipp: Geben Sie Abfragen in natürlicher Sprache ein, das System konvertiert sie automatisch zu SQL und erstellt Diagramme',
            userView: 'Benutzeransicht',
            developerView: 'Entwickleransicht',
            analysisComplete: 'Analyse abgeschlossen',
            executionComplete: 'Ausführung abgeschlossen',
            finalOutput: 'Endausgabe',
            needChart: 'Benötigen Sie ein Diagramm? Fordern Sie explizit "Diagramm erstellen" oder "Daten visualisieren" in Ihrer Abfrage an'
        },
        
        // 设置页面
        settings: {
            title: 'Systemeinstellungen',
            language: 'Sprache',
            languageDesc: 'Systemsprache auswählen',
            chinese: '中文',
            english: 'English',
            german: 'Deutsch',
            viewMode: 'Standard-Ansichtsmodus',
            userMode: 'Benutzermodus (Einfach)',
            developerMode: 'Entwicklermodus (Detailliert)',
            contextRounds: 'Kontext-Verlaufsrunden',
            contextDesc: 'Legt fest, wie viele Gesprächsrunden die KI für Fehlerkorrektur und Kontextverständnis speichert',
            noHistory: 'Kein Verlauf (Einzelrunde)',
            roundHistory: '{n} Runde(n) Verlauf behalten',
            recommended: '(Empfohlen)',
            mayAffectPerformance: '(Kann die Leistung beeinträchtigen)'
        },
        
        // 模型管理
        models: {
            title: 'Modellverwaltung',
            addModel: 'Modell hinzufügen',
            name: 'Modellname',
            type: 'Typ',
            apiAddress: 'API-Adresse',
            status: 'Status',
            actions: 'Aktionen',
            available: 'Verfügbar',
            unavailable: 'Nicht konfiguriert',
            edit: 'Bearbeiten',
            test: 'Testen',
            delete: 'Löschen',
            apiKey: 'API-Schlüssel',
            maxTokens: 'Max. Token',
            temperature: 'Temperatur',
            modelNamePlaceholder: 'z.B. GPT-4',
            modelIdPlaceholder: 'z.B. gpt-4',
            apiBasePlaceholder: 'z.B. http://localhost:11434/v1',
            apiKeyPlaceholder: 'API-Schlüssel eingeben'
        },
        
        // 数据库配置
        database: {
            title: 'Doris Datenbankkonfiguration',
            host: 'Host-Adresse',
            hostPlaceholder: 'z.B. localhost oder 192.168.1.100',
            port: 'Port',
            username: 'Benutzername',
            usernamePlaceholder: 'Datenbank-Benutzername',
            password: 'Passwort',
            passwordPlaceholder: 'Datenbank-Passwort',
            dbName: 'Datenbankname',
            dbNamePlaceholder: 'Leer lassen für datenbanküberschreitende Abfragen (empfohlen)',
            hint: 'Hinweis: Leer lassen ermöglicht datenbanküberschreitende Abfragen, verwenden Sie das Format datenbank.tabelle',
            testConnection: 'Verbindung testen',
            saveConfig: 'Konfiguration speichern',
            connectionSuccess: 'Verbindung erfolgreich',
            connectionInfo: 'Datenbankverbindung hergestellt, {count} Tabelle(n) gefunden'
        },
        
        // 关于页面
        about: {
            title: 'Über das System',
            version: 'Version',
            developer: 'Entwickler',
            independentDev: 'Unabhängiger Entwickler',
            organization: 'Organisation',
            openSource: 'Open-Source-Projekt',
            versionInfo: 'Versionsinformationen',
            betaVersion: 'Beta-Version',
            updateTime: 'Aktualisierungszeit',
            maintaining: 'In aktiver Wartung',
            releaseDate: 'August 2025',
            features: {
                ai: 'KI-Datenanalyse',
                database: 'Datenbankabfrage',
                visualization: 'Visualisierungsgenerierung'
            },
            license: 'Lizenzerklärung',
            licenseDetails: {
                openInterpreter: 'OpenInterpreter Kern-Engine:',
                openInterpreterLicense: 'MIT-Lizenz',
                openInterpreterDesc: 'Open-Source-Engine für natürliche Sprachcodeausführung, erlaubt kommerzielle Nutzung',
                openInterpreterDetail1: '• Dieses Projekt verwendet die pip-installierte Version 0.4.3, folgt der MIT-Lizenz',
                openInterpreterDetail2: '• Freie Nutzung, Modifikation und Bereitstellung',
                openInterpreterDetail3: '• Bietet KI-Kernfähigkeiten für natürliche Sprache zu Code',
                otherLibs: 'Flask/PyMySQL/Plotly etc.:',
                otherLibsLicense: 'MIT/BSD-Lizenz',
                otherLibsDesc: 'Erlaubt kommerzielle Nutzung, Modifikation und Verteilung',
                flaskDetail: '• Flask 3.1.1 - Leichtgewichtiges Web-Framework, BSD-Lizenz',
                pymysqlDetail: '• PyMySQL 1.1.1 - MySQL-Datenbankverbindungsbibliothek, MIT-Lizenz',
                plotlyDetail: '• Plotly 6.3.0 - Datenvisualisierungsbibliothek, MIT-Lizenz',
                allOpenSource: '• Alle Abhängigkeiten sind Open-Source-lizenziert',
                disclaimer: 'Haftungsausschluss:',
                disclaimerText: 'Dieses System ist ein KI-gesteuertes Tool. Der Entwickler übernimmt keine Verantwortung für Datenverluste oder andere Probleme während der Nutzung. Bitte sichern Sie Ihre Daten und verwalten Sie Berechtigungen vor der Nutzung.'
            },
            techStack: 'Technologie-Stack',
            backend: 'Backend-Technologien',
            frontend: 'Frontend-Technologien',
            usageStatement: 'System-Nutzungserklärung',
            systemDesc: 'Dieses System basiert auf Open-Source-Komponenten und verwendet die MIT-Lizenz:',
            freeUse: 'Freie Nutzung, Modifikation und Verteilung',
            commercial: 'Unterstützt kommerzielle und nicht-kommerzielle Nutzung',
            copyright: 'Bitte behalten Sie den Copyright-Hinweis',
            contactEmail: 'Entwickler-Kontakt-E-Mail'
        },
        
        // 历史记录
        history: {
            title: 'Verlauf',
            search: 'Verlauf durchsuchen...',
            recent: 'Kürzlich',
            today: 'Heute',
            thisWeek: 'Diese Woche',
            loading: 'Lädt...',
            noRecords: 'Keine Verlaufseinträge',
            deleteConfirm: 'Möchten Sie diese Unterhaltung wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.',
            cancel: 'Abbrechen',
            delete: 'Löschen'
        },
        
        // 通用
        common: {
            save: 'Speichern',
            cancel: 'Abbrechen',
            confirm: 'Bestätigen',
            close: 'Schließen',
            loading: 'Verarbeitung läuft...',
            success: 'Erfolgreich',
            error: 'Fehlgeschlagen',
            checkingConnection: 'Verbindung wird geprüft...',
            thinking: 'Denke nach...',
            thinkingTitle: 'Denke nach...',
            processing: 'Verarbeitung läuft...',
            stopping: 'Abfrage wird gestoppt...',
            stopped: 'Abfrage abgebrochen',
            interrupted: 'Abfrage vom Benutzer unterbrochen',
            interruptedMessage: '⚠️ Abfrage vom Benutzer unterbrochen',
            testingModel: 'Teste Modellverbindung...',
            testingDatabase: 'Teste Datenbankverbindung...',
            testingConnection: 'Teste Verbindung...',
            deletingConversation: 'Lösche Unterhaltung...',
            processingRequest: 'Verarbeite vorherige Anfrage, bitte warten...',
            openingVisualization: 'Öffne Visualisierung...',
            generatingQuery: 'Generiere optimalen Abfrageplan...',
            optimizingQuery: 'Optimiere Abfrage...',
            continuousTip: 'Unterstützt fortlaufende Unterhaltung, Sie können basierend auf vorherigen Ergebnissen Folgefragen stellen',
            dataMining: 'Data Mining läuft, bitte warten...',
            understandingRequest: 'Verstehe Anfrage...',
            analyzingRequirements: 'Analysiere Anforderungen...',
            connectingDatabase: 'Verbinde mit Datenbank...',
            processingData: 'Verarbeite Daten, fast fertig...',
            parsingDataStructure: 'Parse Datenstruktur...',
            step: 'Schritt',
            codeExecution: 'Code-Ausführung',
            summary: 'Zusammenfassung',
            system: 'System',
            output: 'Ausgabe',
            console: 'Konsole',
            message: 'Nachricht',
            error: 'Fehler',
            exception: 'Ausnahme',
            noDetailedSteps: 'Keine detaillierten Ausführungsschritte verfügbar',
            
            // Tips系统
            tips: {
                detailed: 'Je detaillierter die Beschreibung, desto präziser die Abfrage',
                naturalLanguage: 'Unterstützt Abfragen in natürlicher Sprache, wie "Verkäufe des letzten Monats"',
                flexibleTime: 'Flexible Zeitbeschreibungen: diese Woche, letztes Quartal, Q3 2024 funktionieren alle',
                autoChart: 'Abfrageergebnisse generieren automatisch Diagramme',
                continuous: 'Unterstützt fortlaufende Unterhaltung, stellen Sie Folgefragen basierend auf Ergebnissen',
                comparison: 'Versuchen Sie Vergleichsanalysen: "Vergleiche dieses Jahr mit letztem Jahr"',
                examples: 'Beispiele: "Top 10 Verkäufe diesen Monat" oder "Umsatz Ostregion"',
                ranking: 'Unterstützt Ranking-Abfragen: "Top 5 Verkäufe"',
                trend: 'Trends analysieren: "Verkaufstrend der letzten 6 Monate"',
                followUp: 'Nachfragen mit: "Nach Monat gruppieren" oder "Jahresvergleich hinzufügen"',
                filter: 'Unterstützt Filterung: "Produkte mit Gewinnmarge >30%"',
                doubleClick: 'Doppelklick auf Diagramme zum Vergrößern',
                tabKey: 'Tab-Taste drücken für schnellen Eingabefeldwechsel',
                help: 'Geben Sie "Hilfe" ein für weitere Funktionen',
                
                // 深夜关怀
                lateNight1: 'Es ist spät, machen Sie nach dieser Abfrage eine Pause~',
                lateNight2: 'Frühe Morgenstunden, denken Sie an Ihre Augen',
                lateNight3: 'Spät arbeiten, denken Sie an Pausen',
                lateNight4: 'So spät noch arbeiten, Sie sind wirklich fleißig!',
                lateNight5: 'Nachteulen-Modus aktiviert, aber Gesundheit ist wichtiger',
                midnight: 'Nach Mitternacht, früh schlafen ist gut für die Gesundheit',
                earlyMorning: 'Früher Morgen, Gesundheit ist wichtiger als Daten'
            }
        },
        
        // 错误消息
        errors: {
            networkError: 'Netzwerkverbindung fehlgeschlagen',
            loadConfigFailed: 'Konfiguration konnte nicht geladen werden',
            saveConfigFailed: 'Konfiguration konnte nicht gespeichert werden',
            connectionFailed: 'Verbindung fehlgeschlagen',
            testConnectionFailed: 'Verbindungstest fehlgeschlagen',
            saveModelFailed: 'Modell konnte nicht gespeichert werden',
            deleteModelFailed: 'Modell konnte nicht gelöscht werden',
            fillRequiredFields: 'Bitte alle Pflichtfelder ausfüllen',
            enterQuery: 'Bitte geben Sie eine Abfrage ein',
            sendFailed: 'Senden fehlgeschlagen, bitte erneut versuchen',
            loadConversationFailed: 'Unterhaltung konnte nicht geladen werden',
            copyFailed: 'Kopieren fehlgeschlagen',
            clearCacheFailed: 'Cache konnte nicht geleert werden',
            apiConnectionSuccess: 'API-Verbindung erfolgreich!',
            dbConnectionSuccess: 'Datenbankverbindung erfolgreich!',
            configSaved: 'Konfiguration gespeichert',
            cacheCleared: 'Cache geleert',
            copiedToClipboard: 'In Zwischenablage kopiert',
            newConversationStarted: 'Neue Unterhaltung gestartet',
            languageSwitchedDe: 'Sprache zu Deutsch gewechselt',
            languageSwitchedEn: 'Language switched to English',
            serverError: 'Serverfehler, bitte später erneut versuchen',
            permissionError: 'Keine Berechtigung',
            validationError: 'Ungültiges Datenformat',
            generalError: 'Ein Fehler ist aufgetreten, bitte erneut versuchen'
        },
        
        // Benachrichtigungen
        notifications: {
            apiConnected: 'API-Verbindung erfolgreich!',
            modelSaved: 'Modellkonfiguration gespeichert',
            saveFailed: 'Speichern fehlgeschlagen',
            dbConnected: 'Datenbankverbindung erfolgreich!',
            dbConfigSaved: 'Datenbankkonfiguration gespeichert',
            uiSettingsSaved: 'Benutzeroberflächen-Einstellungen gespeichert',
            sendFailed: 'Senden fehlgeschlagen, bitte erneut versuchen',
            requestFailed: 'Anfrageverarbeitung fehlgeschlagen. Überprüfen Sie die Netzwerkverbindung oder versuchen Sie es später erneut.'
        },
        
        // Abfrage-bezogen
        query: {
            executeComplete: 'Abfrageausführung abgeschlossen',
            loadingChart: 'Diagramm wird geladen...',
            chartLoadFailed: 'Diagramm laden fehlgeschlagen',
            dataFound: 'Daten erfolgreich abgerufen',
            queryFailed: 'Abfrage fehlgeschlagen',
            noDataDetected: 'Keine Datenabfrageergebnisse erkannt',
            sqlExecuted: '{count} SQL-Abfragen ausgeführt',
            noSqlDetected: 'Keine SQL-Abfragebefehle erkannt',
            chartGenerated: 'Visualisierungsdiagramm erfolgreich erstellt',
            noChartGenerated: 'Kein Visualisierungsdiagramm für diese Abfrage erstellt',
            generatedCharts: 'Erstellte Diagramme:',
            processing: 'Ihre Abfrage wird verarbeitet, bitte warten...',
            rawData: 'Rohdaten',
            step: 'Schritt',
            codeExecution: 'Code-Ausführung',
            consoleOutput: 'Konsolenausgabe',
            error: 'Fehler',
            systemMessage: 'Systemnachricht',
            summary: 'Zusammenfassung',
            finalOutput: 'Endausgabe'
        },
        
        // Tipp-Nachrichten
        tips: {
            notSatisfied: 'Nicht zufrieden? Versuchen Sie, Details hinzuzufügen und der KI erneut Feedback zu geben',
            errorOccurred: 'Fehler aufgetreten? Versuchen Sie, Abfragebedingungen zu vereinfachen oder zu prüfen, ob Tabellennamen korrekt sind',
            notPrecise: 'Abfrage nicht präzise genug? Versuchen Sie, spezifische Zeitbereiche oder Datendimensionen anzugeben'
        },
        
        // Export-Funktionalität
        export: {
            title: 'Ergebnisse exportieren',
            options: 'Export-Optionen',
            format: 'Export-Format',
            content: 'Inhalt einschließen'
        },
        
        // Systemkonfiguration
        config: {
            configuration: 'Konfiguration',
            model: 'Modell',
            settings: 'Einstellungen'
        }
    },
    
    // 日本語
    ja: {
        // システムタイトル
        systemName: 'QueryGPT',
        systemDesc: 'インテリジェントデータクエリと可視化システム',
        
        // ナビゲーションメニュー
        nav: {
            query: 'クエリ',
            newQuery: 'データクエリ',
            history: '履歴',
            settings: '設定',
            basicSettings: '基本設定',
            modelManagement: 'モデル管理',
            databaseConfig: 'データベース設定',
            about: '概要'
        },
        
        // チャットページ
        chat: {
            title: 'データクエリと分析',
            newConversation: '新しい会話',
            inputPlaceholder: 'クエリ内容を入力...',
            welcome: 'QueryGPT インテリジェントデータ分析システムへようこそ',
            welcomeDesc: '私ができること：',
            feature1: '自然言語でデータベースをクエリ',
            feature2: 'データ可視化チャートの自動生成',
            feature3: 'データの知的分析と洞察の提供',
            tryExample: 'これらの例を試してみてください：',
            example1: '先月の売上データを表示',
            example2: '製品カテゴリの売上比率を分析',
            example3: '売上高上位10の顧客を検索',
            example4: 'ユーザー成長トレンドチャートを生成',
            exampleBtn1: 'データベースを表示',
            exampleBtn2: '売上分析',
            exampleBtn3: '製品比率',
            exampleBtn4: 'ユーザートレンド',
            hint: 'ヒント：自然言語でクエリを直接入力すると、システムが自動的にSQLに変換してチャートを生成します',
            userView: 'ユーザービュー',
            developerView: '開発者ビュー',
            analysisComplete: '分析完了',
            executionComplete: '実行完了',
            finalOutput: '最終出力',
            needChart: 'チャートが必要ですか？クエリで「チャート生成」または「可視化表示」を明確に要求してみてください'
        },
        
        // 設定ページ
        settings: {
            title: 'システム設定',
            language: '言語',
            languageDesc: 'システムインターフェース言語を選択',
            chinese: '中国語',
            english: 'English',
            viewMode: 'デフォルトビューモード',
            userMode: 'ユーザーモード（簡潔）',
            developerMode: '開発者モード（詳細）',
            contextRounds: 'コンテキスト保持ラウンド数',
            contextDesc: 'AIが前の会話内容を記憶するラウンド数を設定し、エラー修正とコンテキスト理解に使用',
            noHistory: '履歴を保持しない（単一ラウンド会話）',
            roundHistory: '{n}ラウンドの履歴を保持',
            recommended: '（推奨）',
            mayAffectPerformance: '（パフォーマンスに影響する可能性があります）'
        },
        
        // モデル管理
        models: {
            title: 'モデル管理',
            addModel: 'モデルを追加',
            name: 'モデル名',
            type: 'タイプ',
            apiAddress: 'APIアドレス',
            status: 'ステータス',
            actions: 'アクション',
            available: '利用可能',
            unavailable: '未設定',
            edit: '編集',
            test: 'テスト',
            delete: '削除',
            apiKey: 'APIキー',
            maxTokens: '最大トークン数',
            temperature: '温度パラメータ',
            modelNamePlaceholder: '例: GPT-4',
            modelIdPlaceholder: '例: gpt-4',
            apiBasePlaceholder: '例: http://localhost:11434/v1',
            apiKeyPlaceholder: 'APIキーを入力'
        },
        
        // データベース設定
        database: {
            title: 'Dorisデータベース設定',
            host: 'ホストアドレス',
            hostPlaceholder: '例: localhost または 192.168.1.100',
            port: 'ポート',
            username: 'ユーザー名',
            usernamePlaceholder: 'データベースユーザー名',
            password: 'パスワード',
            passwordPlaceholder: 'データベースパスワード',
            dbName: 'データベース名',
            dbNamePlaceholder: '空欄の場合はクロスデータベースクエリ（推奨）',
            testConnection: '接続テスト',
            saveConfig: '設定を保存',
            connectionSuccess: '接続成功',
            connectionInfo: 'データベース接続正常、{count}個のテーブルを発見'
        },
        
        // 概要ページ
        about: {
            title: 'QueryGPT について',
            subtitle: 'インテリジェントデータクエリと可視化プラットフォーム',
            description: 'QueryGPTは先進的な大規模言語モデルと自然言語処理技術に基づき、ユーザーが自然言語でデータベースをクエリし、インテリジェントな分析と可視化を実現することを可能にします。',
            
            features: {
                title: '主な機能',
                nlp: '自然言語処理',
                nlpDesc: '日常言語でデータベースに質問し、システムが自動的にSQLクエリに変換',
                ai: 'AI分析',
                aiDesc: '大規模言語モデルがデータを知的に分析し、洞察と提案を提供',
                visualization: 'インテリジェント可視化',
                visualizationDesc: 'データ特性に基づいて最適なチャートタイプを自動選択',
                multidb: 'マルチデータベースサポート',
                multidbDesc: 'Doris、MySQL、PostgreSQLなどの主流データベースをサポート',
                realtime: 'リアルタイム対話',
                realtimeDesc: '対話式クエリ体験、継続的な最適化と調整',
                export: 'データエクスポート',
                exportDesc: '複数の形式でのクエリ結果とチャートのエクスポートをサポート',
                
                capabilities: {
                    title: '技術能力',
                    database: 'データベースクエリ',
                    visualization: '可視化生成'
                }
            },
            
            license: 'ライセンス説明',
            licenseDetails: {
                title: 'オープンソースライセンス',
                description: 'このプロジェクトはMITライセンスの下でリリースされており、自由に使用、変更、配布することができます。',
                mit: 'MITライセンス条項',
                mitText: '著作権の表示とライセンス声明を保持する限り、商用および非商用目的での使用が許可されています。',
                notice: '注意事項：',
                noticeText: '本システムを使用または配布する際は、著作権表示とライセンス情報を保持してください。',
                disclaimer: '免責事項：',
                disclaimerText: '本システムは大規模言語モデル駆動のツールです。開発者は使用過程で発生する可能性のあるデータ損失やその他の問題について責任を負いません。使用前にデータバックアップと権限管理を行ってください。'
            },
            
            techStack: '技術スタック',
            backend: 'バックエンド技術',
            frontend: 'フロントエンド技術',
            database: 'データベース',
            ai: 'AIモデル',
            
            contact: 'お問い合わせ',
            github: 'GitHubリポジトリ',
            copyright: '著作権表示を保持してください',
            contactEmail: '開発者連絡先メール'
        },
        
        // 履歴
        history: {
            title: 'クエリ履歴',
            empty: '履歴なし',
            loadMore: 'さらに読み込む',
            confirmDelete: '削除を確認',
            confirmDeleteMsg: 'この会話を削除してもよろしいですか？',
            confirm: '確認',
            cancel: 'キャンセル',
            delete: '削除'
        },
        
        // 共通
        common: {
            save: '保存',
            cancel: 'キャンセル',
            confirm: '確認',
            delete: '削除',
            edit: '編集',
            add: '追加',
            close: '閉じる',
            loading: '読み込み中...',
            success: '成功',
            error: 'エラー',
            warning: '警告',
            info: '情報',
            send: '送信',
            clear: 'クリア',
            export: 'エクスポート',
            import: 'インポート',
            refresh: '更新',
            search: '検索',
            filter: 'フィルター',
            sort: 'ソート',
            copy: 'コピー',
            paste: '貼り付け',
            cut: '切り取り',
            download: 'ダウンロード',
            upload: 'アップロード',
            print: '印刷',
            preview: 'プレビュー',
            settings: '設定',
            help: 'ヘルプ',
            about: '概要',
            version: 'バージョン',
            update: '更新',
            install: 'インストール',
            uninstall: 'アンインストール',
            enable: '有効',
            disable: '無効',
            start: '開始',
            stop: '停止',
            pause: '一時停止',
            resume: '再開',
            retry: '再試行',
            reset: 'リセット',
            backup: 'バックアップ',
            restore: '復元',
            
            timeGreeting: {
                morning: 'おはようございます！',
                morning2: '今日も素敵な一日を',
                morning3: '朝の時間、データで新しい発見を',
                morning4: 'フレッシュな朝、新鮮な洞察を',
                morning5: '朝の光、データの世界を照らします',
                afternoon: 'こんにちは！',
                afternoon2: 'お疲れ様です',
                afternoon3: '午後の時間、効率的なクエリを',
                afternoon4: '午後の日差し、データ分析に適しています',
                afternoon5: 'ランチ後、データで新しい視点を',
                evening: 'こんばんは！',
                evening2: 'お疲れ様でした',
                evening3: '夕方の時間、一日の収穫をまとめましょう',
                evening4: '夕日が美しく、データ分析も美しい',
                evening5: '夕食前、最後のクエリはいかがですか',
                lateNight: '夜更かしご苦労様です',
                lateNight2: '夜深く、静かにデータと対話',
                lateNight3: '深夜勤務お疲れ様、適度な休息を',
                lateNight4: 'こんなに遅くまで頑張って、本当にお疲れ様！',
                lateNight5: '夜更かしモード起動、でも健康の方が大切です',
                midnight: 'もう夜中、早めに休んで体に良いです',
                earlyMorning: '早朝ですね、データより健康の方が大切です'
            }
        },
        
        // エラーメッセージ
        errors: {
            networkError: 'ネットワークエラー、接続を確認してください',
            serverError: 'サーバーエラー、後でもう一度お試しください',
            permissionError: 'アクセス権限がありません',
            validationError: 'データ形式エラー',
            generalError: 'エラーが発生しました、もう一度お試しください',
            languageSwitchedJa: '言語が日本語に切り替わりました',
            languageSwitchedEn: 'Language switched to English'
        },
        
        // 通知メッセージ
        notifications: {
            apiConnected: 'API接続成功！',
            modelSaved: 'モデル設定が保存されました',
            saveFailed: '保存失敗',
            dbConnected: 'データベース接続成功！',
            dbConfigSaved: 'データベース設定が保存されました',
            uiSettingsSaved: 'インターフェース設定が保存されました',
            sendFailed: '送信失敗、再試行してください',
            requestFailed: 'リクエスト処理失敗。ネットワーク接続を確認するか、後で再試行してください。'
        },
        
        // クエリ関連
        query: {
            executeComplete: 'クエリ実行完了',
            loadingChart: 'チャート読み込み中...',
            chartLoadFailed: 'チャート読み込み失敗',
            dataFound: 'データの取得に成功しました',
            queryFailed: 'クエリ失敗',
            noDataDetected: 'データクエリ結果が検出されませんでした',
            sqlExecuted: '{count}個のSQLクエリを実行しました',
            noSqlDetected: 'SQLクエリコマンドが検出されませんでした',
            chartGenerated: '可視化チャートの生成に成功しました',
            noChartGenerated: 'このクエリでは可視化チャートが生成されませんでした',
            generatedCharts: '生成されたチャート：',
            processing: 'クエリを処理中です。しばらくお待ちください...',
            rawData: '生データ',
            step: 'ステップ',
            codeExecution: 'コード実行',
            consoleOutput: 'コンソール出力',
            error: 'エラー',
            systemMessage: 'システムメッセージ',
            summary: '要約',
            finalOutput: '最終出力'
        },
        
        // ヒントメッセージ
        tips: {
            notSatisfied: '満足できませんか？詳細を追加してAIに再度フィードバックを提供してみてください',
            errorOccurred: 'エラーが発生しましたか？クエリ条件を簡素化するか、テーブル名が正しいかを確認してみてください',
            notPrecise: 'クエリが十分に正確ではありませんか？具体的な時間範囲やデータ次元を指定してみてください'
        },
        
        // エクスポート機能
        export: {
            title: '結果をエクスポート',
            options: 'エクスポートオプション',
            format: 'エクスポート形式',
            content: 'コンテンツを含む'
        },
        
        // システム設定
        config: {
            configuration: '設定',
            model: 'モデル',
            settings: '設定'
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