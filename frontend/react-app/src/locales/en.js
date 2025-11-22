export default {
    app: {
        title: "QueryGPT",
        welcome: "Welcome to QueryGPT",
        description: "Start exploring your data. I can execute SQL queries, generate charts, and perform deep analysis.",
        disclaimer: "AI can make mistakes. Please verify important information.",
        inputPlaceholder: "Ask a question about your data..."
    },
    sidebar: {
        recentChats: "RECENT CHATS",
        newChat: "New Chat",
        settings: "Settings",
        delete: "Delete",
        unnamed: "Unnamed Chat"
    },
    settings: {
        title: "System Settings",
        tabs: {
            basic: "Basic",
            models: "Models",
            database: "Database",
            prompts: "Prompts",
            features: "Features"
        },
        basic: {
            language: "Language",
            contextRounds: "Context Rounds"
        },
        database: {
            testConnection: "Test Connection",
            saveConfig: "Save Config"
        },
        models: {
            configured: "Configured Models",
            add: "Add Model",
            back: "Back",
            name: "Display Name",
            id: "Model ID",
            provider: "Provider",
            apiKey: "API Key (Optional)",
            apiKeyDesc: "If empty, environment variable will be used",
            baseUrl: "API Base URL (Optional)",
            confirm: "Add Model",
            empty: "No models configured, please add one."
        },
        features: {
            smartRouting: "Smart Routing",
            dbGuard: "DB Guard",
            thoughtStream: "Thought Stream"
        },
        prompts: {
            qa: "QA Mode Prompt",
            analysis: "Analysis Mode Prompt",
            restore: "Restore Defaults",
            save: "Save Prompts"
        }
    },
    chat: {
        thinking: "Thinking...",
        stepsCompleted: "Completed {count} analysis steps...",
        executingSql: "Executed SQL",
        error: "Error",
        connectionError: "Database Connection Failed",
        interrupted: "Interrupted",
        userInterrupted: "User interrupted query",
        analyzing: "Analyzing data..."
    },
    viewMode: {
        dev: "Developer Mode",
        user: "User Mode"
    }
};
