import React, { useState, useEffect } from 'react';
import { Send, Settings, Database, History, Trash2, Plus, Loader2, ChevronDown, Box, AlertTriangle, Square, Code, Eye } from 'lucide-react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { clsx } from 'clsx';
import SettingsModal from './components/SettingsModal';
import ArtifactViewer from './components/ArtifactViewer';
import { useLanguage } from './contexts/LanguageContext';

// 简单的 API 封装
const api = {
  chat: async (message, history = [], options = {}) => {
    try {
      const response = await axios.post('/api/chat', {
        query: message,
        conversation_id: options.conversationId,
        model: options.model || 'gpt-4o',
        use_database: true,
        language: 'zh' // 强制中文
      });
      return response.data;
    } catch (error) {
      throw error.response?.data || error;
    }
  },
  stop: async (conversationId) => {
     return axios.post('/api/stop_query', { conversation_id: conversationId });
  },
  getHistory: async () => {
    return axios.get('/api/history/conversations').then(r => r.data.conversations);
  },
  getConversation: async (id) => {
    return axios.get(`/api/history/conversation/${id}`).then(r => r.data);
  },
  deleteConversation: async (id) => {
    return axios.delete(`/api/history/conversation/${id}`);
  },
  getModels: async () => {
    return axios.get('/api/models').then(r => r.data.models);
  }
};

function App() {
  const { t } = useLanguage();
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // 模型选择状态
  const [models, setModels] = useState([]);
  const [currentModel, setCurrentModel] = useState('gpt-4o');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [showDevMode, setShowDevMode] = useState(false);

  const messagesEndRef = React.useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    loadHistory();
    loadModels();
  }, []);

  const loadHistory = async () => {
    try {
      const list = await api.getHistory();
      setConversations(list || []);
    } catch (e) {
      console.error("Failed to load history", e);
    }
  };

  const loadModels = async () => {
    try {
      const list = await api.getModels();
      setModels(list || []);
      // 尝试恢复上次的模型
      const savedModel = localStorage.getItem('selected_model');
      if (savedModel && list.find(m => m.id === savedModel)) {
        setCurrentModel(savedModel);
      } else if (list.length > 0) {
        setCurrentModel(list[0].id);
      }
    } catch (e) {
      console.error("Failed to load models", e);
    }
  };

  const parseMessageContent = (content) => {
    if (typeof content !== 'string') return JSON.stringify(content);
    
    // 尝试解析 JSON 字符串（处理 raw_output, dual_view 等）
    try {
        if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
            const parsed = JSON.parse(content);
            
            // 处理 raw_output 数组格式 (如: [{"type": "console", ...}])
            if (Array.isArray(parsed)) {
                // 提取所有文本内容并拼接
                return parsed
                    .filter(item => item.content)
                    .map(item => item.content)
                    .join('\n\n');
            }
            
            if (parsed.type === 'dual_view') {
                return parsed.data.content || JSON.stringify(parsed.data);
            }
            if (parsed.type === 'raw_output') {
                if (Array.isArray(parsed.data)) {
                     return parsed.data
                        .filter(item => item.content)
                        .map(item => item.content)
                        .join('\n\n');
                }
                return parsed.data;
            }
            // 如果是普通 JSON 对象，保持原样或提取 content
            if (parsed.content) return parsed.content;
        }
    } catch (e) {
        // 解析失败，说明是普通文本
    }
    return content;
  };

  const loadConversation = async (id) => {
    if (isLoading) return;
    try {
      setIsLoading(true);
      const data = await api.getConversation(id);
      
      // 处理后端可能返回的嵌套结构 {success: true, conversation: {...}}
      const conversationData = data.conversation || data;
      
      if (!conversationData || !conversationData.messages) {
          throw new Error("无效的对话数据");
      }

      setConversationId(id);
      
      // 格式化消息
      const formattedMessages = conversationData.messages.map(msg => {
        let content = parseMessageContent(msg.content);
        let sql = null;
        let visualization = null;
        let steps = [];

        // 提取执行详情
        if (msg.execution) { // 注意：后端使用的是 execution 字段
            sql = msg.execution.sql;
            visualization = msg.execution.visualization;
            steps = msg.execution.steps || [];
        } else if (msg.execution_details) { // 兼容旧数据
            sql = msg.execution_details.sql;
            visualization = msg.execution_details.visualization;
            steps = msg.execution_details.steps || [];
        }

        return {
            role: msg.type === 'user' ? 'user' : 'assistant',
            content: content,
            sql: sql,
            visualization: visualization,
            steps: steps
        };
      });

      setMessages(formattedMessages);
      
      // 移动端自动关闭侧边栏
      if (window.innerWidth < 768) {
        setSidebarOpen(false);
      }
    } catch (error) {
      console.error("Failed to load conversation", error);
      alert("无法加载对话历史: " + (error.message || "未知错误"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteConversation = async (e, id) => {
    e.stopPropagation();
    if (!confirm('确定要删除这个对话吗？')) return;
    
    try {
      await api.deleteConversation(id);
      if (conversationId === id) {
        startNewChat();
      }
      loadHistory();
    } catch (error) {
      console.error("Failed to delete", error);
    }
  };

  const handleModelSelect = (modelId) => {
    setCurrentModel(modelId);
    localStorage.setItem('selected_model', modelId);
    setModelDropdownOpen(false);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isLoading) {
        // Handle Stop
        if (conversationId) {
            try {
                await api.stop(conversationId);
                setIsLoading(false); // Optimistically stop loading
            } catch (err) {
                console.error("Failed to stop", err);
            }
        }
        return;
    }

    if (!input.trim()) return;

    const userMsg = { role: 'user', content: input };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const data = await api.chat(input, messages, { 
        conversationId,
        model: currentModel
      });
      
      if (data.success) {
        setConversationId(data.conversation_id);
        
        const botMsg = { 
          role: 'assistant', 
          content: parseMessageContent(data.result), // 使用解析逻辑
          sql: data.sql,
          visualization: data.visualization,
          steps: data.steps 
        };
        
        // 处理双视图数据格式 (冗余检查，防止 data.result 已经是对象)
        if (data.result?.type === 'dual_view') {
            botMsg.content = data.result.data.content;
        }

        setMessages(prev => [...prev, botMsg]);
        loadHistory();
      } else if (data.interrupted) {
        const botMsg = {
            role: 'assistant',
            content: data.partial_result || '已中断',
            isError: true,
            steps: [{ index: '!', summary: '用户中断查询', isError: true }]
        };
        setMessages(prev => [...prev, botMsg]);
      } else {
        // 如果是数据库连接错误，尝试在步骤中显示
        const errorMsg = data.error || '未知错误';
        const isConnectionError = errorMsg.includes('connect') || errorMsg.includes('Unknown MySQL server') || errorMsg.includes('Access denied');

        const botMsg = {
            role: 'assistant',
            content: isConnectionError ? '数据库连接失败，请检查配置。' : `出错了: ${errorMsg}`,
            isError: true,
            steps: isConnectionError ? [{ index: '!', summary: `连接失败: ${errorMsg}`, isError: true }] : []
        };

        setMessages(prev => [...prev, botMsg]);
      }
    } catch (err) {
        setMessages(prev => [...prev, { role: 'assistant', content: `请求失败: ${err.message || '未知错误'}`, isError: true }]);
    } finally {
      setIsLoading(false);
    }
  };

  const startNewChat = () => {
    setConversationId(null);
    setMessages([]);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white">
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {/* Sidebar */}
      <div className={clsx("bg-slate-900 text-slate-300 flex-shrink-0 transition-all duration-300 flex flex-col border-r border-slate-800", sidebarOpen ? "w-64" : "w-0")}>
        <div className="p-4 flex justify-between items-center h-16">
          <div className="flex items-center gap-2 font-bold text-white">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Database size={18} className="text-white" />
            </div>
            <span className="text-lg">QueryGPT</span>
          </div>
          <button onClick={startNewChat} className="p-2 hover:bg-slate-800 rounded-lg transition-colors text-slate-400 hover:text-white" title={t('sidebar.newChat')}>
            <Plus size={20} />
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1 scrollbar-thin">
            <div className="text-xs font-medium text-slate-500 uppercase px-2 mb-2 mt-2">{t('sidebar.recentChats')}</div>
            {conversations.map(chat => (
                <div 
                    key={chat.id}
                    onClick={() => loadConversation(chat.id)}
                    className={clsx(
                        "p-2 rounded-lg cursor-pointer truncate text-sm transition-colors flex items-center gap-2 group relative pr-8",
                        conversationId === chat.id ? "bg-slate-800 text-white" : "hover:bg-slate-800/50"
                    )}
                >
                    <MessageSquare size={14} className={clsx("flex-shrink-0", conversationId === chat.id ? "text-blue-400" : "text-slate-500 group-hover:text-blue-400")} />
                    <span className="truncate">{chat.title || t('sidebar.unnamed')}</span>
                    
                    <button 
                        onClick={(e) => handleDeleteConversation(e, chat.id)}
                        className="absolute right-1 p-1.5 rounded hover:bg-red-500/20 hover:text-red-400 text-slate-600 opacity-0 group-hover:opacity-100 transition-all"
                        title={t('sidebar.delete')}
                    >
                        <Trash2 size={12} />
                    </button>
                </div>
            ))}
        </div>

        <div className="p-4 border-t border-slate-800">
            <button 
                onClick={() => setSettingsOpen(true)}
                className="flex items-center gap-3 text-sm w-full p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
                <Settings size={18} /> {t('sidebar.settings')}
            </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col h-full relative bg-slate-50/50">
        {/* Header */}
        <header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-sm flex items-center px-4 justify-between sticky top-0 z-10">
            <div className="flex items-center gap-4">
                <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600">
                    <History size={20} />
                </button>
                
                {/* Model Selector */}
                <div className="flex items-center gap-2">
                    {/* View Mode Toggle */}
                    <button 
                        onClick={() => setShowDevMode(!showDevMode)}
                        className={clsx(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                            showDevMode ? "bg-indigo-100 text-indigo-700" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                        title={showDevMode ? t('viewMode.user') : t('viewMode.dev')}
                    >
                        {showDevMode ? <Code size={16} /> : <Eye size={16} />}
                        {showDevMode ? "Dev" : "User"}
                    </button>

                    <div className="relative">
                        <button
                            onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-sm font-medium text-slate-700 transition-colors"
                        >
                            <Box size={16} className="text-blue-600" />
                            {models.find(m => m.id === currentModel)?.name || currentModel}
                            <ChevronDown size={14} className={`transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} />
                        </button>

                        {modelDropdownOpen && (
                            <>
                                <div className="fixed inset-0 z-10" onClick={() => setModelDropdownOpen(false)} />
                                <div className="absolute top-full left-0 mt-2 w-56 bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-20 animate-in fade-in zoom-in-95 duration-100">
                                    {models.map(model => (
                                        <button
                                            key={model.id}
                                            onClick={() => handleModelSelect(model.id)}
                                            className={clsx(
                                                "w-full text-left px-4 py-2.5 text-sm hover:bg-slate-50 flex items-center justify-between",
                                                currentModel === model.id ? "text-blue-600 bg-blue-50" : "text-slate-700"
                                            )}
                                        >
                                            {model.name}
                                            {currentModel === model.id && <div className="w-1.5 h-1.5 rounded-full bg-blue-600" />}
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </header>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6 scroll-smooth">
            {messages.length === 0 && (
                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-6">
                        <Database size={32} className="text-slate-400" />
                    </div>
                    <h2 className="text-xl font-semibold text-slate-700 mb-2">{t('app.welcome')}</h2>
                    <p className="text-slate-500 max-w-md text-center">{t('app.description')}</p>
                    
                    <div className="grid grid-cols-2 gap-4 mt-8 max-w-2xl w-full">
                        {['显示最近的销售数据', '分析用户增长趋势', '按收入统计热门产品', '上个月的销售趋势'].map(q => (
                            <button 
                                key={q}
                                onClick={() => setInput(q)}
                                className="p-4 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:border-blue-300 hover:shadow-md transition-all text-left"
                            >
                                {q}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            
            {messages.map((msg, idx) => (
                <div key={idx} className={clsx("flex gap-4 max-w-4xl mx-auto animate-in slide-in-from-bottom-2 duration-300", msg.role === 'user' ? "justify-end" : "justify-start")}>
                    {msg.role === 'assistant' && (
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-1">
                            <Brain size={16} className="text-blue-600" />
                        </div>
                    )}
                    
                    <div className={clsx(
                        "rounded-2xl px-5 py-3.5 max-w-[85%] shadow-sm",
                        msg.role === 'user' 
                            ? "bg-blue-600 text-white rounded-br-sm" 
                            : "bg-white text-slate-800 border border-slate-200 rounded-bl-sm"
                    )}>
                        {/* Thinking Steps */}
                        {msg.steps && msg.steps.length > 0 && (
                            <div className="mb-4 space-y-2">
                                {showDevMode ? (
                                    // Developer Mode: Show all steps detailed
                                    msg.steps.map((step, i) => (
                                        <div
                                            key={i}
                                            className={clsx(
                                                "flex items-start gap-2 text-xs p-2 rounded border transition-all",
                                                step.isError
                                                    ? "bg-red-50 text-red-600 border-red-100"
                                                    : "bg-slate-50 text-slate-500 border-slate-100"
                                            )}
                                        >
                                            <div className={clsx(
                                                "w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 text-[10px] font-bold",
                                                step.isError ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"
                                            )}>
                                                {step.index}
                                            </div>
                                            <span className={step.isError ? "font-medium" : ""}>{step.summary}</span>
                                        </div>
                                    ))
                                ) : (
                                    // User Mode: Show simple summary
                                    <div className="flex items-center gap-2 text-xs text-slate-500 italic">
                                        <Brain size={12} />
                                        <span>{t('chat.stepsCompleted').replace('{count}', msg.steps.length)}</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Error Warning Card */}
                        {msg.isError && msg.content && !msg.steps?.length && (
                            <div className="mb-4 p-4 bg-red-50 border border-red-100 rounded-lg flex gap-3">
                                <AlertTriangle className="text-red-500 flex-shrink-0 mt-0.5" size={18} />
                                <div className="text-sm text-red-700">
                                    {msg.content}
                                </div>
                            </div>
                        )}

                        {!msg.isError && (
                            <ReactMarkdown
                                className="prose prose-sm max-w-none dark:prose-invert prose-p:leading-relaxed prose-pre:bg-slate-800 prose-pre:text-slate-100"
                                components={{
                                    table: ({node, ...props}) => <div className="overflow-x-auto my-4 border rounded-lg"><table className="min-w-full divide-y divide-slate-200" {...props} /></div>,
                                    thead: ({node, ...props}) => <thead className="bg-slate-50" {...props} />,
                                    th: ({node, ...props}) => <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 uppercase tracking-wider" {...props} />,
                                    td: ({node, ...props}) => <td className="px-3 py-2 whitespace-nowrap text-sm text-slate-600 border-t border-slate-100" {...props} />,
                                }}
                            >
                                {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)}
                            </ReactMarkdown>
                        )}
                        
                        {msg.sql && showDevMode && (
                            <div className="mt-4">
                                <div className="text-xs font-medium text-slate-500 mb-1 flex items-center gap-1">
                                    <Database size={12} /> {t('chat.executingSql')}
                                </div>
                                <div className="bg-slate-900 text-slate-200 p-3 rounded-lg text-xs font-mono overflow-x-auto border border-slate-800 shadow-inner">
                                    {msg.sql}
                                </div>
                            </div>
                        )}

                        {/* Artifacts / Charts */}
                        {msg.visualization && (
                            <ArtifactViewer artifacts={msg.visualization} />
                        )}
                    </div>
                </div>
            ))}
            
            {isLoading && (
                 <div className="flex gap-4 max-w-4xl mx-auto">
                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <Brain size={16} className="text-blue-600" />
                    </div>
                    <div className="bg-white px-5 py-4 rounded-2xl rounded-bl-sm border border-slate-200 shadow-sm flex items-center gap-3">
                        <Loader2 className="animate-spin text-blue-600" size={18} />
                        <span className="text-sm text-slate-500 font-medium animate-pulse">{t('chat.analyzing')}</span>
                    </div>
                 </div>
            )}
            <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-slate-200 relative z-20">
            <form onSubmit={handleSubmit} className="max-w-4xl mx-auto relative">
                <div className="relative flex items-center">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={t('app.inputPlaceholder')}
                        className="w-full pl-5 pr-14 py-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 shadow-lg shadow-slate-100/50 transition-all"
                    />
                    <button 
                        type="submit" 
                        disabled={!input.trim() && !isLoading}
                        className={clsx(
                            "absolute right-2 p-2.5 text-white rounded-xl transition-all hover:scale-105 active:scale-95 shadow-md",
                            isLoading
                                ? "bg-red-500 hover:bg-red-600 shadow-red-200"
                                : "bg-blue-600 hover:bg-blue-700 shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed"
                        )}
                    >
                        {isLoading ? <Square size={18} fill="currentColor" /> : <Send size={18} />}
                    </button>
                </div>
                <div className="text-center mt-2">
                    <p className="text-xs text-slate-400">{t('app.disclaimer')}</p>
                </div>
            </form>
        </div>
      </div>
    </div>
  );
}