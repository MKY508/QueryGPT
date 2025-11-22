export default {
    app: {
        title: "QueryGPT",
        welcome: "欢迎使用 QueryGPT",
        description: "开始探索您的数据。我可以执行 SQL 查询、生成图表并进行深度分析。",
        disclaimer: "AI 可能会犯错，请核实重要信息。",
        inputPlaceholder: "开始询问关于您数据的问题..."
    },
    sidebar: {
        recentChats: "最近对话",
        newChat: "新对话",
        settings: "设置",
        delete: "删除",
        unnamed: "未命名对话"
    },
    settings: {
        title: "系统设置",
        tabs: {
            basic: "基础设置",
            models: "模型管理",
            database: "数据库配置",
            prompts: "Prompt 设置",
            features: "功能开关"
        },
        basic: {
            language: "语言 / Language",
            contextRounds: "默认上下文轮数"
        },
        database: {
            testConnection: "测试连接",
            saveConfig: "保存配置"
        },
        models: {
            configured: "已配置模型",
            add: "添加模型",
            back: "返回列表",
            name: "显示名称 (Name)",
            id: "模型 ID (Model ID)",
            provider: "提供商 (Provider)",
            apiKey: "API Key (Optional)",
            apiKeyDesc: "如果不填，将尝试使用环境变量中配置的 Key",
            baseUrl: "API Base URL (Optional)",
            confirm: "确认添加",
            empty: "暂无模型，请添加"
        },
        features: {
            smartRouting: "智能路由",
            dbGuard: "数据库守卫",
            thoughtStream: "思考过程播报"
        },
        prompts: {
            qa: "QA 模式提示词",
            analysis: "Analysis 模式提示词",
            restore: "恢复默认设置",
            save: "保存 Prompt 设置"
        }
    },
    chat: {
        thinking: "正在思考...",
        stepsCompleted: "已完成 {count} 个分析步骤...",
        executingSql: "执行的 SQL",
        error: "出错了",
        connectionError: "数据库连接失败",
        interrupted: "已中断",
        userInterrupted: "用户中断查询",
        analyzing: "正在分析数据..."
    },
    viewMode: {
        dev: "开发者模式",
        user: "用户模式"
    }
};
