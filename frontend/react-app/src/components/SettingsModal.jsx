import React, { useState, useEffect } from 'react';
import { X, Save, Undo, Database, Brain, MessageSquare, Activity, Settings as SettingsIcon, Plus, Trash2, Edit3, ArrowLeft, Check, Moon, Sun, Play } from 'lucide-react';
import axios from 'axios';
import { useLanguage } from '../contexts/LanguageContext';

export default function SettingsModal({ isOpen, onClose, onModelUpdate }) {
  const { changeLanguage } = useLanguage();
  const [activeTab, setActiveTab] = useState('basic');
  const [config, setConfig] = useState(null);
  const [models, setModels] = useState([]);
  const [prompts, setPrompts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState('light');

  // 模型添加/编辑状态
  const [isEditingModel, setIsEditingModel] = useState(false);
  const [modelForm, setModelForm] = useState({
      name: '',
      id: '',
      provider: 'openai',
      api_key: '',
      base_url: ''
  });
  const [testingModel, setTestingModel] = useState(false);

  // 数据库配置状态
  const [dbConfig, setDbConfig] = useState({
    host: '127.0.0.1',
    port: 3306,
    user: 'root',
    password: '',
    database: ''
  });

  useEffect(() => {
    if (isOpen) {
      loadConfig();
    } else {
        // 当 Modal 关闭时通知父组件更新模型
        if (onModelUpdate) {
            onModelUpdate();
        }
    }
  }, [isOpen]);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const [cfgRes, modelsRes, promptsRes] = await Promise.all([
        axios.get('/api/config'),
        axios.get('/api/models'),
        axios.get('/api/prompts')
      ]);
      
      setConfig(cfgRes.data);
      if (cfgRes.data.interface_theme) {
          setTheme(cfgRes.data.interface_theme);
      }
      setModels(modelsRes.data.models || []);
      setPrompts(promptsRes.data);
      
      // 加载数据库配置
      if (cfgRes.data.database) {
        setDbConfig({
          host: cfgRes.data.database.host || '127.0.0.1',
          port: cfgRes.data.database.port || 3306,
          user: cfgRes.data.database.user || '',
          password: cfgRes.data.database.password || '',
          database: cfgRes.data.database.database || ''
        });
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async (section, data) => {
    try {
      setSaving(true);

      if (section === 'prompts') {
        await axios.post('/api/prompts', data);
        setPrompts({ ...prompts, ...data });
        alert('Prompt设置已保存');
        return;
      }

      let newConfig = { ...config };
      
      if (section === 'database') {
        await axios.post('/api/database/config', data);
        newConfig.database = data;
      } else if (section === 'models') {
         await axios.post('/api/models', { models: data });
         setModels(data);
         if (onModelUpdate) onModelUpdate(); // 立即同步
         return;
      } else {
        if (section === 'basic') {
            newConfig = { ...newConfig, ...data };
            if (data.language) changeLanguage(data.language);
            if (data.interface_theme) setTheme(data.interface_theme);
        } else if (section === 'features') {
            newConfig.features = { ...(newConfig.features || {}), ...data };
        }
        await axios.post('/api/config', newConfig);
      }
      
      setConfig(newConfig);
      alert('设置已保存');
    } catch (error) {
      console.error("Save failed:", error);
      alert('保存失败: ' + (error.response?.data?.error || error.message));
    } finally {
      setSaving(false);
    }
  };

  const resetPrompts = async () => {
    if (!confirm('确定要恢复默认 Prompt 设置吗？所有自定义修改将丢失。')) return;
    try {
        setSaving(true);
        const res = await axios.post('/api/prompts/reset');
        if (res.data.success) {
            setPrompts(res.data.prompts);
            alert('已恢复默认设置');
        }
    } catch (error) {
        alert('重置失败: ' + error.message);
    } finally {
        setSaving(false);
    }
  };

  const testDatabase = async () => {
    try {
      setSaving(true);
      const res = await axios.post('/api/database/test', dbConfig);
      if (res.data.success) {
        alert(`连接成功！发现 ${res.data.table_count} 个表`);
      } else {
        alert(`连接失败: ${res.data.message}`);
      }
    } catch (error) {
      alert('测试请求失败');
    } finally {
      setSaving(false);
    }
  };

  // --- Model Management ---

  const deleteModel = async (modelId) => {
      if(!confirm('确定删除此模型配置吗？')) return;
      try {
          const newModels = models.filter(m => m.id !== modelId);
          await axios.post('/api/models', { models: newModels });
          setModels(newModels);
          if (onModelUpdate) onModelUpdate();
      } catch (err) {
          alert('删除失败');
      }
  };

  const startEditModel = (model) => {
      setModelForm({
          name: model.name || '',
          id: model.id || '',
          provider: model.provider || model.type || 'openai',
          api_key: model.api_key || '',
          base_url: model.base_url || model.api_base || ''
      });
      setIsEditingModel(true);
  };

  const startAddModel = () => {
      setModelForm({
          name: '',
          id: '',
          provider: 'openai',
          api_key: '',
          base_url: ''
      });
      setIsEditingModel(true);
  };

  const handleSaveModel = async () => {
      if (!modelForm.name || !modelForm.id) {
          alert("请填写模型名称和ID");
          return;
      }
      try {
          setSaving(true);
          // 如果 ID 存在，则是更新（先移除旧的同 ID），否则是追加
          let updatedModels = models.filter(m => m.id !== modelForm.id);
          updatedModels.push(modelForm);

          await axios.post('/api/models', { models: updatedModels });
          setModels(updatedModels);
          setIsEditingModel(false);
          if (onModelUpdate) onModelUpdate();
      } catch (err) {
          alert("保存模型失败: " + err.message);
      } finally {
          setSaving(false);
      }
  };

  const handleTestModel = async () => {
      if (!modelForm.id) return;
      setTestingModel(true);
      try {
          // 使用 chat API 发送一个简单的 hello 来测试
          const res = await axios.post('/api/chat', {
              query: 'Hello',
              model: modelForm.id,
              use_database: false, // 纯对话测试
              history: []
          });
          if (res.data.success) {
              alert("测试成功！模型回复正常。");
          } else {
              alert("测试失败: " + (res.data.error || "未知错误"));
          }
      } catch (e) {
          alert("测试请求失败: " + (e.response?.data?.error || e.message));
      } finally {
          setTestingModel(false);
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className={`bg-white rounded-xl shadow-2xl w-[800px] h-[600px] flex flex-col overflow-hidden ${theme === 'dark' ? 'dark bg-slate-900 text-white' : ''}`}>
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <SettingsIcon size={20} /> 系统设置
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-48 bg-slate-50 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 flex flex-col py-2">
            <TabButton 
              id="basic" label="基础设置" icon={<SettingsIcon size={16} />} 
              active={activeTab === 'basic'} onClick={() => setActiveTab('basic')} 
            />
            <TabButton 
              id="models" label="模型管理" icon={<Brain size={16} />} 
              active={activeTab === 'models'} onClick={() => setActiveTab('models')} 
            />
            <TabButton 
              id="database" label="数据库配置" icon={<Database size={16} />} 
              active={activeTab === 'database'} onClick={() => setActiveTab('database')} 
            />
            <TabButton
              id="prompts" label="Prompt 设置" icon={<Edit3 size={16} />}
              active={activeTab === 'prompts'} onClick={() => setActiveTab('prompts')}
            />
            <TabButton 
              id="features" label="功能开关" icon={<Activity size={16} />} 
              active={activeTab === 'features'} onClick={() => setActiveTab('features')} 
            />
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-6 bg-white dark:bg-slate-900">
            {loading ? (
              <div className="flex items-center justify-center h-full text-slate-400">加载中...</div>
            ) : (
              <>
                {/* Basic Settings */}
                {activeTab === 'basic' && (
                  <div className="space-y-6">
                    <div className="space-y-2">
                        <label className="block font-medium">语言 / Language</label>
                        <select 
                            className="w-full p-2 border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-600"
                            value={config?.language || 'zh'}
                            onChange={(e) => saveConfig('basic', { language: e.target.value })}
                        >
                            <option value="zh">简体中文</option>
                            <option value="en">English</option>
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="block font-medium">界面主题</label>
                        <div className="flex gap-4">
                            <button
                                onClick={() => saveConfig('basic', { interface_theme: 'light' })}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${theme === 'light' ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200'}`}
                            >
                                <Sun size={16} /> 浅色
                            </button>
                             <button
                                onClick={() => saveConfig('basic', { interface_theme: 'dark' })}
                                className={`flex items-center gap-2 px-4 py-2 rounded-lg border ${theme === 'dark' ? 'border-blue-500 bg-blue-900/20 text-blue-400' : 'border-slate-200'}`}
                            >
                                <Moon size={16} /> 深色 (WIP)
                            </button>
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="block font-medium">默认上下文轮数</label>
                        <select 
                            className="w-full p-2 border rounded-lg bg-white dark:bg-slate-800 dark:border-slate-600"
                            value={config?.context_rounds || 3}
                            onChange={(e) => saveConfig('basic', { context_rounds: parseInt(e.target.value) })}
                        >
                            <option value="0">0 (单轮)</option>
                            <option value="3">3 (推荐)</option>
                            <option value="5">5</option>
                            <option value="10">10</option>
                        </select>
                    </div>
                  </div>
                )}

                {/* Database Settings */}
                {activeTab === 'database' && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="block text-sm font-medium">Host</label>
                            <input 
                                type="text" 
                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-600"
                                value={dbConfig.host}
                                onChange={(e) => setDbConfig({...dbConfig, host: e.target.value})}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-sm font-medium">Port</label>
                            <input 
                                type="number" 
                                className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-600"
                                value={dbConfig.port}
                                onChange={(e) => setDbConfig({...dbConfig, port: parseInt(e.target.value)})}
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium">User</label>
                        <input 
                            type="text" 
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-600"
                            value={dbConfig.user}
                            onChange={(e) => setDbConfig({...dbConfig, user: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium">Password</label>
                        <input 
                            type="password" 
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-600"
                            value={dbConfig.password}
                            onChange={(e) => setDbConfig({...dbConfig, password: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium">Database Name</label>
                        <input 
                            type="text" 
                            className="w-full p-2 border rounded-lg dark:bg-slate-800 dark:border-slate-600"
                            value={dbConfig.database}
                            placeholder="Optional"
                            onChange={(e) => setDbConfig({...dbConfig, database: e.target.value})}
                        />
                    </div>
                    
                    <div className="flex gap-3 pt-4">
                        <button 
                            onClick={testDatabase}
                            disabled={saving}
                            className="px-4 py-2 bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 transition-colors"
                        >
                            测试连接
                        </button>
                        <button 
                            onClick={() => saveConfig('database', dbConfig)}
                            disabled={saving}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                        >
                            <Save size={16} /> 保存配置
                        </button>
                    </div>
                  </div>
                )}

                {/* Feature Flags */}
                {activeTab === 'features' && (
                  <div className="space-y-6">
                    <Toggle 
                        label="智能路由 (Smart Routing)" 
                        desc="自动判断查询类型，选择最优执行路径"
                        checked={config?.features?.smart_routing?.enabled || false}
                        onChange={(v) => saveConfig('features', { smart_routing: { ...config?.features?.smart_routing, enabled: v } })}
                    />
                    <Toggle 
                        label="数据库守卫 (DB Guard)" 
                        desc="执行前自动检查数据库健康状态"
                        checked={config?.features?.db_guard?.auto_check || true}
                        onChange={(v) => saveConfig('features', { db_guard: { ...config?.features?.db_guard, auto_check: v } })}
                    />
                    <Toggle 
                        label="思考过程播报 (Thought Stream)" 
                        desc="实时显示 AI 的分析步骤"
                        checked={config?.features?.thought_stream?.enabled || true}
                        onChange={(v) => saveConfig('features', { thought_stream: { ...config?.features?.thought_stream, enabled: v } })}
                    />
                  </div>
                )}

                {/* Prompt Settings */}
                {activeTab === 'prompts' && prompts && (
                    <div className="space-y-6">
                        <div className="flex justify-end mb-4">
                             <button
                                onClick={resetPrompts}
                                className="text-sm text-slate-500 hover:text-red-600 flex items-center gap-1"
                            >
                                <Undo size={14} /> 恢复默认设置
                            </button>
                        </div>

                        <div className="space-y-4">
                             <PromptField
                                label="QA 模式提示词"
                                value={prompts.qaPrompt}
                                onChange={(v) => setPrompts({...prompts, qaPrompt: v})}
                                placeholder="当用户查询与数据库无关时的系统提示词"
                             />
                             <PromptField
                                label="Analysis 模式提示词 (Analysis Prompt)"
                                value={prompts.analysisPrompt}
                                onChange={(v) => setPrompts({...prompts, analysisPrompt: v})}
                                rows={10}
                                placeholder="负责数据分析的核心 System Prompt"
                             />
                        </div>
                    </div>
                )}

                {/* Models Management */}
                {activeTab === 'models' && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="font-medium">{isEditingModel ? (modelForm.id ? "编辑模型" : "添加新模型") : "已配置模型"}</h3>
                            {!isEditingModel ? (
                                <button
                                    className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg"
                                    onClick={startAddModel}
                                >
                                    <Plus size={16} /> 添加模型
                                </button>
                            ) : (
                                <button
                                    className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-800 bg-slate-100 px-3 py-1.5 rounded-lg"
                                    onClick={() => setIsEditingModel(false)}
                                >
                                    <ArrowLeft size={16} /> 返回列表
                                </button>
                            )}
                        </div>
                        
                        {isEditingModel ? (
                            <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-lg border border-slate-200 dark:border-slate-700 space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">显示名称 (Name)</label>
                                        <input
                                            type="text"
                                            className="w-full p-2 border rounded-lg dark:bg-slate-700 dark:border-slate-600"
                                            placeholder="例如: GPT-4 Custom"
                                            value={modelForm.name}
                                            onChange={e => setModelForm({...modelForm, name: e.target.value})}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">模型 ID (Model ID)</label>
                                        <input
                                            type="text"
                                            className="w-full p-2 border rounded-lg dark:bg-slate-700 dark:border-slate-600"
                                            placeholder="例如: gpt-4-turbo-preview"
                                            value={modelForm.id}
                                            onChange={e => setModelForm({...modelForm, id: e.target.value})}
                                            readOnly={!!models.find(m => m.id === modelForm.id && m.id !== '')} // 如果是编辑且ID已存在则只读? 简化起见允许修改ID会视为新模型
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">提供商 (Provider)</label>
                                    <select
                                        className="w-full p-2 border rounded-lg bg-white dark:bg-slate-700 dark:border-slate-600"
                                        value={modelForm.provider}
                                        onChange={e => setModelForm({...modelForm, provider: e.target.value})}
                                    >
                                        <option value="openai">OpenAI / Compatible</option>
                                        <option value="anthropic">Anthropic</option>
                                        <option value="google">Google Gemini</option>
                                        <option value="ollama">Ollama</option>
                                        <option value="azure">Azure OpenAI</option>
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">API Key (Optional)</label>
                                    <input
                                        type="password"
                                        className="w-full p-2 border rounded-lg dark:bg-slate-700 dark:border-slate-600"
                                        placeholder="sk-..."
                                        value={modelForm.api_key}
                                        onChange={e => setModelForm({...modelForm, api_key: e.target.value})}
                                    />
                                    <p className="text-xs text-slate-500">如果不填，将尝试使用环境变量中配置的 Key</p>
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">API Base URL (Optional)</label>
                                    <input
                                        type="text"
                                        className="w-full p-2 border rounded-lg dark:bg-slate-700 dark:border-slate-600"
                                        placeholder="https://api.openai.com/v1"
                                        value={modelForm.base_url}
                                        onChange={e => setModelForm({...modelForm, base_url: e.target.value})}
                                    />
                                </div>

                                <div className="pt-4 flex justify-between items-center">
                                     <button
                                        onClick={handleTestModel}
                                        disabled={testingModel || !modelForm.id}
                                        className="px-4 py-2 bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100 transition-colors flex items-center gap-2"
                                    >
                                        {testingModel ? <Activity size={16} className="animate-spin" /> : <Play size={16} />}
                                        测试可用性
                                    </button>
                                    <button
                                        onClick={handleSaveModel}
                                        disabled={saving || !modelForm.name || !modelForm.id}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Check size={16} /> 保存模型
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                                {models.map(model => (
                                    <div key={model.id} className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg flex justify-between items-center bg-slate-50 dark:bg-slate-800 hover:bg-white dark:hover:bg-slate-700 hover:shadow-sm transition-all">
                                        <div>
                                            <div className="font-medium text-slate-800 dark:text-slate-200">{model.name}</div>
                                            <div className="text-xs text-slate-500 flex gap-2 mt-1">
                                                <span className="bg-slate-200 dark:bg-slate-600 px-1.5 py-0.5 rounded">{model.provider || model.type}</span>
                                                <span className="font-mono">{model.id}</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => startEditModel(model)}
                                                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                                                title="编辑"
                                            >
                                                <Edit3 size={16} />
                                            </button>
                                            <button
                                                onClick={() => deleteModel(model.id)}
                                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors"
                                                title="删除"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                {models.length === 0 && (
                                    <div className="text-center py-8 text-slate-400 border-2 border-dashed border-slate-200 rounded-lg">
                                        暂无模型，请添加
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TabButton({ id, label, icon, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors
        ${active ? 'bg-white dark:bg-slate-900 text-blue-600 border-r-2 border-blue-600' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'}`}
    >
      {icon}
      {label}
    </button>
  );
}

function Toggle({ label, desc, checked, onChange }) {
    return (
        <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
            <div>
                <div className="font-medium">{label}</div>
                <div className="text-sm text-slate-500">{desc}</div>
            </div>
            <button 
                onClick={() => onChange(!checked)}
                className={`w-12 h-6 rounded-full transition-colors relative ${checked ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600'}`}
            >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${checked ? 'left-7' : 'left-1'}`} />
            </button>
        </div>
    );
}

function PromptField({ label, value, onChange, placeholder, rows = 3 }) {
    return (
        <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
            <textarea
                className="w-full p-3 border rounded-lg text-sm font-mono bg-slate-50 dark:bg-slate-800 focus:bg-white dark:focus:bg-slate-700 transition-colors"
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                rows={rows}
            />
        </div>
    );
}
