import React, { useState, useEffect, useRef } from 'react';
import { Send, Settings, Database, History, Trash2, Plus, Loader2, ChevronDown, Box, AlertTriangle, Square, Code, Eye, Brain, MessageSquare, Info } from 'lucide-react';
import axios from 'axios';
import ReactMarkdown from 'react-markdown';
import { clsx } from 'clsx';
import SettingsModal from './components/SettingsModal';
import ArtifactViewer from './components/ArtifactViewer';
import AboutModal from './components/AboutModal';
import { useLanguage } from './contexts/LanguageContext';

// 简单的 API 封装
const api = {
  chatStream: async (message, history = [], options = {}, onEvent) => {
      const { conversationId, model } = options;
      const params = new URLSearchParams({
          query: message,
          model: model || 'gpt-4o',
          use_database: 'true',
          language: 'zh',
          conversation_id: conversationId || ''
      });

      const eventSource = new EventSource(`/api/chat/stream?${params.toString()}`);

      eventSource.onmessage = (event) => {
          try {
              const data = JSON.parse(event.data);
              onEvent(data);
              if (data.type === 'done' || data.type === 'error') {
                  eventSource.close();
              }
          } catch (e) {
              console.error("Failed to parse event", e);
          }
      };

      eventSource.onerror = (err) => {
          console.error("EventSource failed:", err);
          onEvent({ type: 'error', data: { error: 'Connection failed' } });
          eventSource.close();
      };

      return eventSource;
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
  const [aboutOpen, setAboutOpen] = useState(false);
  
  // 模型选择状态
  const [models, setModels] = useState([]);
  const [currentModel, setCurrentModel] = useState('gpt-4o');
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [showDevMode, setShowDevMode] = useState(false);

  const messagesEndRef = React.useRef(null);
  const eventSourceRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    loadHistory();
    loadModels();
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const res = await axios.get('/api/config');
      if (res.data.interface_theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    } catch (e) {
      console.error("Failed to load config", e);
    }
  };

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
    if (content === null || content === undefined) return '';
    if (typeof content !== 'string') return JSON.stringify(content);
    
    // 尝试解析 JSON 字符串
    try {
        if (content.trim().startsWith('{') || content.trim().startsWith('[')) {
            const parsed = JSON.parse(content);
            
            // 处理 raw_output
            if (Array.isArray(parsed)) {
                return parsed
                    .filter(item => item && item.content)
                    .map(item => item.content)
                    .join('\n\n');
            }
            
            if (parsed && typeof parsed === 'object') {
                if (parsed.type === 'dual_view') {
                    return parsed.data?.content || JSON.stringify(parsed.data || '');
                }
                if (parsed.type === 'raw_output') {
                    if (Array.isArray(parsed.data)) {
                         return parsed.data
                            .filter(item => item && item.content)
                            .map(item => item.content)
                            .join('\n\n');
                    }
                    return parsed.data || '';
                }
                if (parsed.content) return parsed.content;
            }
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
        let execution_time = null;
        let rows_count = null;

        if (msg.execution) {
            sql = msg.execution.sql;
            visualization = msg.execution.visualization;
            steps = msg.execution.steps || [];
            execution_time = msg.execution.execution_time;
            rows_count = msg.execution.rows_affected;
        } else if (msg.execution_details) {
            sql = msg.execution_details.sql;
            visualization = msg.execution_details.visualization;
            steps = msg.execution_details.steps || [];
            execution_time = msg.execution_details.execution_time;
            rows_count = msg.execution_details.rows_affected;
        }

        return {
            role: msg.type === 'user' ? 'user' : 'assistant',
            content: content,
            sql: sql,
            visualization: visualization,
            steps: steps,
            execution_time,
            rows_count
        };
      });

      setMessages(formattedMessages);
      
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
                if (eventSourceRef.current) {
                    eventSourceRef.current.close();
                }
                await api.stop(conversationId);
                // 更新最后一条消息为中断状态
                setMessages(prev => {
                    const newMessages = [...prev];
                    const lastMsg = newMessages[newMessages.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant') {
                        lastMsg.isError = true;
                        lastMsg.content = lastMsg.content || '已中断';
                    }
                    return newMessages;
                });
                setIsLoading(false);
            } catch (err) {
                console.error("Failed to stop", err);
            }
        }
        return;
    }

    if (!input.trim()) return;

    const userMsg = { role: 'user', content: input };
    const botMsgPlaceholder = {
        role: 'assistant',
        content: '',
        steps: [],
        isLoading: true
    };

    // 立即更新UI
    setMessages(prev => [...prev, userMsg, botMsgPlaceholder]);
    const currentInput = input;
    setInput('');
    setIsLoading(true);

    try {
        const eventSource = await api.chatStream(currentInput, messages, {
            conversationId,
            model: currentModel
        }, (data) => {
            setMessages(prev => {
                const newMessages = [...prev];
                const lastMsgIndex = newMessages.length - 1;
                // Safety check: ensure we have messages
                if (lastMsgIndex < 0) return prev;

                const lastMsg = { ...newMessages[lastMsgIndex] }; // Clone last message

                if (lastMsg.role !== 'assistant') return prev;

                // Ensure steps array exists
                if (!lastMsg.steps) lastMsg.steps = [];

                if (data.type === 'progress') {
                    // Update steps (Thinking process)
                    if (data.data && data.data.message) {
                        const exists = lastMsg.steps.find(s => s.summary === data.data.message);
                        if (!exists) {
                            lastMsg.steps = [...lastMsg.steps, {
                                index: lastMsg.steps.length + 1,
                                summary: data.data.message,
                                stage: data.data.stage
                            }];
                        }
                    }
                } else if (data.type === 'result') {
                    // Update final result
                    if (data.data) {
                        lastMsg.content = parseMessageContent(data.data.result);
                        lastMsg.visualization = data.data.visualization;
                        lastMsg.sql = data.data.sql;
                        lastMsg.execution_time = data.data.execution_time;
                        lastMsg.rows_count = data.data.rows_count;
                        // Sync steps if backend sends a final list
                        if (data.data.steps && Array.isArray(data.data.steps) && data.data.steps.length > 0) {
                             lastMsg.steps = data.data.steps;
                        }
                        if (data.data.conversation_id) {
                            setConversationId(data.data.conversation_id);
                        }
                    }
                    lastMsg.isLoading = false;
                } else if (data.type === 'error') {
                    lastMsg.isError = true;
                    lastMsg.content = data.data?.error || 'Unknown error';
                    lastMsg.isLoading = false;
                } else if (data.type === 'done') {
                    lastMsg.isLoading = false;
                    loadHistory();
                }

                newMessages[lastMsgIndex] = lastMsg;
                return newMessages;
            });
        });

        eventSourceRef.current = eventSource;

    } catch (err) {
        setMessages(prev => {
            const newMessages = [...prev];
            const lastMsg = newMessages[newMessages.length - 1];
            if (lastMsg) {
                lastMsg.isError = true;
                lastMsg.content = `请求失败: ${err.message || '未知错误'}`;
                lastMsg.isLoading = false;
            }
            return newMessages;
        });
        setIsLoading(false);
    }
  };

  const startNewChat = () => {
    setConversationId(null);
    setMessages([]);
  };

  const handleModelUpdate = () => {
    loadModels();
    loadConfig();
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-white">
      <SettingsModal isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} onModelUpdate={handleModelUpdate} />
      <AboutModal isOpen={aboutOpen} onClose={() => setAboutOpen(false)} />

      {/* Sidebar */}
      <div className={clsx("bg-slate-900 text-slate-300 flex-shrink-0 transition-all duration-300 flex flex-col border-r border-slate-800 overflow-hidden", sidebarOpen ? "w-64" : "w-0")}>
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

        <div className="p-4 border-t border-slate-800 space-y-1">
            <button 
                onClick={() => setSettingsOpen(true)}
                className="flex items-center gap-3 text-sm w-full p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
                <Settings size={18} /> {t('sidebar.settings')}
            </button>
            <button
                onClick={() => setAboutOpen(true)}
                className="flex items-center gap-3 text-sm w-full p-2 hover:bg-slate-800 rounded-lg transition-colors"
            >
                <Info size={18} /> {t('sidebar.about') || "About"}
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

                        {/* Thinking Steps (Show if Dev Mode) */}
                        {showDevMode && msg.steps && msg.steps.length > 0 && (
                            <div className="mb-4 space-y-2">
                                {msg.steps.map((step, i) => (
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
                                ))}
                            </div>
                        )}

                        {/* User Mode: Simple Loading Indicator */}
                        {!showDevMode && msg.isLoading && !msg.content && (
                            <div className="flex items-center gap-2 text-slate-400 text-sm mt-2 mb-2">
                                <Loader2 className="animate-spin" size={16} />
                                <span>{t('chat.analyzing') || "正在分析数据..."}</span>
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

                        {/* Main Content (Markdown) */}
                        {!msg.isError && msg.content && (
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
                        
                        {/* Developer Mode: SQL & Stats */}
                        {showDevMode && !msg.isLoading && (
                            <div className="mt-6 pt-4 border-t border-slate-100 space-y-3">
                                {msg.sql && (
                                    <div>
                                        <div className="text-xs font-medium text-slate-500 mb-1 flex items-center gap-1">
                                            <Database size={12} /> SQL
                                        </div>
                                        <div className="bg-slate-900 text-slate-200 p-3 rounded-lg text-xs font-mono overflow-x-auto border border-slate-800 shadow-inner">
                                            {msg.sql}
                                        </div>
                                    </div>
                                )}
                                {(msg.execution_time || msg.rows_count) && (
                                     <div className="flex gap-4 text-xs text-slate-400 font-mono">
                                        {msg.execution_time && <span>Time: {msg.execution_time}s</span>}
                                        {msg.rows_count && <span>Rows: {msg.rows_count}</span>}
                                     </div>
                                )}
                            </div>
                        )}

                        {/* Artifacts / Charts (Always visible if present) */}
                        {msg.visualization && (
                            <ArtifactViewer artifacts={msg.visualization} />
                        )}

                        {/* Dev Mode Loading Spinner */}
                        {msg.isLoading && !msg.content && showDevMode && (!msg.steps || msg.steps.length === 0) && (
                            <div className="flex items-center gap-2 text-slate-400 text-sm mt-2">
                                <Loader2 className="animate-spin" size={16} />
                                <span>Generating...</span>
                            </div>
                        )}

                    </div>
                </div>
            ))}
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

export default App;
