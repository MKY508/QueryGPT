import React, { useState, useEffect } from 'react';
import { X, Save, Undo, Database, Brain, MessageSquare, Activity, Settings as SettingsIcon, Plus, Trash2, Edit3, ArrowLeft, Check } from 'lucide-react';
import axios from 'axios';
import { useLanguage } from '../contexts/LanguageContext';

export default function SettingsModal({ isOpen, onClose }) {
  const { changeLanguage } = useLanguage();
  const [activeTab, setActiveTab] = useState('basic');
  const [config, setConfig] = useState(null);
  const [models, setModels] = useState([]);
  const [prompts, setPrompts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 模型添加状态
  const [isAddingModel, setIsAddingModel] = useState(false);
  const [newModel, setNewModel] = useState({
      name: '',
      id: '',
      provider: 'openai',
      api_key: '',
      base_url: ''
  });

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
         return; // Early return for models
      } else {
        if (section === 'basic') {
            newConfig = { ...newConfig, ...data };
            // Sync language with context
            if (data.language) {
                changeLanguage(data.language);
            }
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

  const deleteModel = async (modelId) => {
      if(!confirm('确定删除此模型配置吗？')) return;
      try {
          const newModels = models.filter(m => m.id !== modelId);
          await axios.post('/api/models', { models: newModels });
          setModels(newModels);
      } catch (err) {
          alert('删除失败');
      }
  };

  const handleAddModel = async () => {
      if (!newModel.name || !newModel.id) {
          alert("请填写模型名称和ID");
          return;
      }
      try {
          setSaving(true);
          const updatedModels = [...models, newModel];
          await axios.post('/api/models', { models: updatedModels });
          setModels(updatedModels);
          setIsAddingModel(false);
          setNewModel({
              name: '',
              id: '',
              provider: 'openai',
              api_key: '',
              base_url: ''
          });
      } catch (err) {
          alert("添加模型失败: " + err.message);
      } finally {
          setSaving(false);
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-[800px] h-[600px] flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-slate-200">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <SettingsIcon size={20} /> 系统设置
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-48 bg-slate-50 border-r border-slate-200 flex flex-col py-2">
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
          <div className="flex-1 overflow-y-auto p-6">
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
                            className="w-full p-2 border rounded-lg bg-white"
                            value={config?.language || 'zh'}
                            onChange={(e) => saveConfig('basic', { language: e.target.value })}
                        >
                            <option value="zh">简体中文</option>
                            <option value="en">English</option>
                        </select>
                    </div>
                    <div className="space-y-2">
                        <label className="block font-medium">默认上下文轮数</label>
                        <select 
                            className="w-full p-2 border rounded-lg bg-white"
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
                                className="w-full p-2 border rounded-lg" 
                                value={dbConfig.host}
                                onChange={(e) => setDbConfig({...dbConfig, host: e.target.value})}
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="block text-sm font-medium">Port</label>
                            <input 
                                type="number" 
                                className="w-full p-2 border rounded-lg" 
                                value={dbConfig.port}
                                onChange={(e) => setDbConfig({...dbConfig, port: parseInt(e.target.value)})}
                            />
                        </div>
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium">User</label>
                        <input 
                            type="text" 
                            className="w-full p-2 border rounded-lg" 
                            value={dbConfig.user}
                            onChange={(e) => setDbConfig({...dbConfig, user: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium">Password</label>
                        <input 
                            type="password" 
                            className="w-full p-2 border rounded-lg" 
                            value={dbConfig.password}
                            onChange={(e) => setDbConfig({...dbConfig, password: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="block text-sm font-medium">Database Name</label>
                        <input 
                            type="text" 
                            className="w-full p-2 border rounded-lg" 
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

                             <div className="border-t pt-4 mt-6">
                                <h3 className="font-medium mb-4 text-slate-800">高级配置 (Advanced)</h3>
                                <div className="space-y-4">
                                    <PromptField
                                        label="智能路由规则 (Routing)"
                                        value={prompts.routing}
                                        onChange={(v) => setPrompts({...prompts, routing: v})}
                                        rows={4}
                                    />
                                    <PromptField
                                        label="数据库探索策略 (Exploration)"
                                        value={prompts.exploration}
                                        onChange={(v) => setPrompts({...prompts, exploration: v})}
                                        rows={4}
                                    />
                                     <PromptField
                                        label="表选择策略 (Table Selection)"
                                        value={prompts.tableSelection}
                                        onChange={(v) => setPrompts({...prompts, tableSelection: v})}
                                        rows={3}
                                    />
                                    <PromptField
                                        label="数据处理要求 (Data Processing)"
                                        value={prompts.dataProcessing}
                                        onChange={(v) => setPrompts({...prompts, dataProcessing: v})}
                                        rows={3}
                                    />
                                    <PromptField
                                        label="输出要求 (Output Requirements)"
                                        value={prompts.outputRequirements}
                                        onChange={(v) => setPrompts({...prompts, outputRequirements: v})}
                                        rows={3}
                                    />
                                </div>
                             </div>

                             <div className="flex justify-end pt-4">
                                <button
                                    onClick={() => saveConfig('prompts', prompts)}
                                    disabled={saving}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                                >
                                    <Save size={16} /> 保存 Prompt 设置
                                </button>
                             </div>
                        </div>
                    </div>
                )}

                {/* Models Management */}
                {activeTab === 'models' && (
                    <div className="space-y-4">
                        <div className="flex justify-between items-center">
                            <h3 className="font-medium">{isAddingModel ? "添加新模型" : "已配置模型"}</h3>
                            {!isAddingModel ? (
                                <button
                                    className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg"
                                    onClick={() => setIsAddingModel(true)}
                                >
                                    <Plus size={16} /> 添加模型
                                </button>
                            ) : (
                                <button
                                    className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-800 bg-slate-100 px-3 py-1.5 rounded-lg"
                                    onClick={() => setIsAddingModel(false)}
                                >
                                    <ArrowLeft size={16} /> 返回列表
                                </button>
                            )}
                        </div>
                        
                        {isAddingModel ? (
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="block text-sm font-medium text-slate-700">显示名称 (Name)</label>
                                        <input
                                            type="text"
                                            className="w-full p-2 border rounded-lg"
                                            placeholder="例如: GPT-4 Custom"
                                            value={newModel.name}
                                            onChange={e => setNewModel({...newModel, name: e.target.value})}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="block text-sm font-medium text-slate-700">模型 ID (Model ID)</label>
                                        <input
                                            type="text"
                                            className="w-full p-2 border rounded-lg"
                                            placeholder="例如: gpt-4-turbo-preview"
                                            value={newModel.id}
                                            onChange={e => setNewModel({...newModel, id: e.target.value})}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-sm font-medium text-slate-700">提供商 (Provider)</label>
                                    <select
                                        className="w-full p-2 border rounded-lg bg-white"
                                        value={newModel.provider}
                                        onChange={e => setNewModel({...newModel, provider: e.target.value})}
                                    >
                                        <option value="openai">OpenAI / Compatible</option>
                                        <option value="anthropic">Anthropic</option>
                                        <option value="google">Google Gemini</option>
                                        <option value="ollama">Ollama</option>
                                        <option value="azure">Azure OpenAI</option>
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-sm font-medium text-slate-700">API Key (Optional)</label>
                                    <input
                                        type="password"
                                        className="w-full p-2 border rounded-lg"
                                        placeholder="sk-..."
                                        value={newModel.api_key}
                                        onChange={e => setNewModel({...newModel, api_key: e.target.value})}
                                    />
                                    <p className="text-xs text-slate-500">如果不填，将尝试使用环境变量中配置的 Key</p>
                                </div>

                                <div className="space-y-2">
                                    <label className="block text-sm font-medium text-slate-700">API Base URL (Optional)</label>
                                    <input
                                        type="text"
                                        className="w-full p-2 border rounded-lg"
                                        placeholder="https://api.openai.com/v1"
                                        value={newModel.base_url}
                                        onChange={e => setNewModel({...newModel, base_url: e.target.value})}
                                    />
                                </div>

                                <div className="pt-4 flex justify-end">
                                    <button
                                        onClick={handleAddModel}
                                        disabled={saving || !newModel.name || !newModel.id}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        <Check size={16} /> 确认添加
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                                {models.map(model => (
                                    <div key={model.id} className="p-4 border border-slate-200 rounded-lg flex justify-between items-center bg-slate-50 hover:bg-white hover:shadow-sm transition-all">
                                        <div>
                                            <div className="font-medium text-slate-800">{model.name}</div>
                                            <div className="text-xs text-slate-500 flex gap-2 mt-1">
                                                <span className="bg-slate-200 px-1.5 py-0.5 rounded">{model.provider || model.type}</span>
                                                <span className="font-mono">{model.id}</span>
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => deleteModel(model.id)}
                                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
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
        ${active ? 'bg-white text-blue-600 border-r-2 border-blue-600' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
    >
      {icon}
      {label}
    </button>
  );
}

function Toggle({ label, desc, checked, onChange }) {
    return (
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div>
                <div className="font-medium">{label}</div>
                <div className="text-sm text-slate-500">{desc}</div>
            </div>
            <button 
                onClick={() => onChange(!checked)}
                className={`w-12 h-6 rounded-full transition-colors relative ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}
            >
                <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${checked ? 'left-7' : 'left-1'}`} />
            </button>
        </div>
    );
}

function PromptField({ label, value, onChange, placeholder, rows = 3 }) {
    return (
        <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">{label}</label>
            <textarea
                className="w-full p-3 border rounded-lg text-sm font-mono bg-slate-50 focus:bg-white transition-colors"
                value={value || ''}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                rows={rows}
            />
        </div>
    );
}
