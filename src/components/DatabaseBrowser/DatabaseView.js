import { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import MacOSModalWindow from '@/components/MacOSModalWindow';
import { 
  Search, RefreshCw, Layers, Table, Code, Activity, Save, Loader2, 
  Trash2, Edit, Plus, Download, Upload, X, Check, AlertCircle, Sparkles,
  Clock, ChevronDown, Shield, Archive, Settings2, AlertTriangle, Edit3,
  PlusCircle, Terminal, ShieldCheck, Eye, Copy, Maximize2, HelpCircle, Wifi
} from 'lucide-react';
import { io } from 'socket.io-client';

export default function DatabaseView({ connection, onClose }) {
  const { state: appState, apiFetch, dispatch } = useApp();
  const { state: osState, addNotification, setExportNaming, setAiHistory, setSshAiPrefs } = useOS();
  const { t } = useTranslation();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [schema, setSchema] = useState([]); // Tables or Collections
  const [selectedSchema, setSelectedSchema] = useState(null);
  const [data, setData] = useState([]);
  const [editingRecord, setEditingRecord] = useState(null); // { mode: 'add' | 'edit', data: {} }
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showQueryBar, setShowQueryBar] = useState(false);
  const [filterQuery, setFilterQuery] = useState(''); // JSON string for MongoDB, WHERE for SQL
  const [aiPrompt, setAiPrompt] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [aiModel, setAiModel] = useState('auto');
  const [usedAiModel, setUsedAiModel] = useState(null);
  const [pendingAction, setPendingAction] = useState(null); // { type: 'DELETE' | 'UPDATE' | 'INSERT', fullQuery: string, mongoAction?: object }
  const fileInputRef = useRef(null);
  const historyRef = useRef(null);
  const helpRef = useRef(null);
  const [failedTables, setFailedTables] = useState([]);
  const [isExportingAll, setIsExportingAll] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [autoRetry, setAutoRetry] = useState(false);
  const [showNamingSettings, setShowNamingSettings] = useState(false);
  const [showAiHelp, setShowAiHelp] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [latency, setLatency] = useState(null);
  const [lastAiUpdate, setLastAiUpdate] = useState(0);
  const socketRef = useRef(null);
  
  // Modal State
  const confirmResolver = useRef(null);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', type: 'danger' });
  const [showCodePreview, setShowCodePreview] = useState(false);

  const showConfirm = (title, message, type = 'danger', showBackup = false) => {
      return new Promise((resolve) => {
          confirmResolver.current = resolve;
          setConfirmModal({ isOpen: true, title, message, type, showBackup, doBackup: true });
      });
  };

  const handleConfirmResult = (confirmed) => {
      if (confirmResolver.current) {
          confirmResolver.current({ confirmed, doBackup: confirmModal.doBackup });
      }
      setConfirmModal(prev => ({ ...prev, isOpen: false }));
      confirmResolver.current = null;
  };

  // Latency Heartbeat Socket
  useEffect(() => {
    const socket = io({
      path: '/api/socket',
      transports: ['websocket'],
      query: { dbUri: appState.dbConfig?.uri || '' }
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('register:connection', { connectionId: connection._id });
    });

    socket.on('heartbeat:pong', (sentTimestamp) => {
      setLatency(Date.now() - sentTimestamp);
    });

    const interval = setInterval(() => {
      if (socket.connected) {
        socket.emit('heartbeat:ping', Date.now());
      }
    }, 3000);

    return () => {
      clearInterval(interval);
      socket.disconnect();
      // Update local status to offline if no other component is using it
      // Note: Full multi-session ref-counting could be added to AppContext,
      // but this handles the most common 'one window' case.
      dispatch({ 
        type: 'UPDATE_CONNECTION', 
        payload: { _id: connection._id, status: 'offline' } 
      });
    };
  }, [appState.dbConfig?.uri]);

  const executePendingAction = async () => {
    if (!pendingAction) return;

    // Mongo action object (delete/update/insert)
    if (connection.dbProvider === 'mongodb' && pendingAction.mongoAction) {
        const { confirmed, doBackup } = await showConfirm(
            t('database.modals.dangerousActionTitle'),
            `${t('database.modals.dangerousActionMsg')}\n\n${t('database.ai.action')}: ${pendingAction.mongoAction.action}\n${t('database.ai.collection')}: ${pendingAction.mongoAction.collection}`,
            'danger',
            true // Show backup checkbox
        );
        if (!confirmed) return;

        if (doBackup) {
            await createAutoBackup(pendingAction.mongoAction.collection, 'pre_action');
        }

        const res = await apiFetch(`/api/connections/${connection._id}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connection, query: pendingAction.mongoAction })
        });
        const resData = await res.json();
        if (!resData.success) {
            addNotification({ title: t('database.notifications.actionError'), message: resData.error || 'Action failed', type: 'error' });
            return;
        }

        addNotification({ title: t('common.success'), message: t('database.notifications.actionSuccess'), type: 'success' });
        setPendingAction(null);
        fetchData(selectedSchema);
        return;
    }

    // Existing SQL/legacy behavior
    fetchData(selectedSchema, pendingAction.fullQuery);
    setPendingAction(null);
  };

  
  const handleCopyCode = (text) => {
    navigator.clipboard.writeText(text);
    addNotification({
      title: t('database.notifications.copied'),
      message: t('database.notifications.copiedMsg'),
      type: 'success'
    });
  };

  
  const aiHistory = osState?.aiHistory || [];
  const exportNaming = osState?.exportNaming || {
    prefix: '',
    suffix: '',
    includeDate: true,
    includeTime: false,
    includeType: true,
  };

  const dynamicExamples = useMemo(() => {
    const keys = data.length > 0 ? Object.keys(data[0]) : [];
    const lowerSchema = selectedSchema?.toLowerCase() || '';
    const allExamples = t('database.ai.examples', { returnObjects: true }) || {};
    const actions = allExamples.actions || {};
    
    let examples = [];

    // 1. Add 'Normal' / Common actions
    if (actions.list) examples.push(actions.list);
    if (actions.search) examples.push(actions.search);

    // 2. Add Context-Specific examples
    if (lowerSchema.includes('session')) {
      if (allExamples.sessions?.status) examples.push(allExamples.sessions.status);
      if (allExamples.sessions?.cleanup) examples.push(allExamples.sessions.cleanup);
    } else if (lowerSchema.includes('note')) {
      if (allExamples.notes?.search) examples.push(allExamples.notes.search);
      if (allExamples.notes?.update) examples.push(allExamples.notes.update);
    } else if (lowerSchema.includes('connect')) {
      if (allExamples.connections?.provider) examples.push(allExamples.connections.provider);
      if (allExamples.connections?.host) examples.push(allExamples.connections.host);
      if (allExamples.connections?.name) examples.push(allExamples.connections.name);
    }

    // 3. Add General Actions (Edit/Delete/Update)
    if (actions.edit) examples.push(actions.edit);
    if (actions.update) examples.push(actions.update);
    if (actions.delete) examples.push(actions.delete);

    // Filter unique and return max 6 (with scrollable area)
    return [...new Set(examples)].slice(0, 6);
  }, [selectedSchema, data, t]);

  useEffect(() => {
    if (connection?._id) {
      fetchSchema();
    }
  }, [connection?._id]);

  useEffect(() => {
    // Check for interrupted exports ONCE on mount
    if (!connection?._id) return;
    const savedQueue = localStorage.getItem(`ssh_monitor_export_resume_${connection._id}`);
    if (savedQueue) {
        const queue = JSON.parse(savedQueue);
        if (queue.length > 0) {
            setFailedTables(queue);
            addNotification({ 
                title: t('database.notifications.unfinishedExport'), 
                message: t('database.notifications.unfinishedExportMsg', { count: queue.length }), 
                type: 'info' 
            });
        }
    }
  }, []); // Only on mount

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (historyRef.current && !historyRef.current.contains(event.target)) {
        setShowHistory(false);
      }
      if (helpRef.current && !helpRef.current.contains(event.target)) {
        setShowAiHelp(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);
  
  // COUNTDOWN LOGIC
  useEffect(() => {
    let timer;
    if (retryCountdown > 0) {
      timer = setInterval(() => {
        setRetryCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            if (autoRetry) handleExportAll(failedTables);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [retryCountdown, autoRetry]);

  const fetchSchema = async () => {
    if (!connection?._id || isSubmitting) return; 
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/connections/${connection._id}/schema`, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ connection })
      });
      
      const text = await res.text();
      let resData;
      try {
        resData = JSON.parse(text);
      } catch (e) {
        throw new Error(`Invalid server response (Status ${res.status}): ${text.substring(0, 100)}...`);
      }

      if (resData.success) {
        setSchema(resData.data);
        if (resData.data.length > 0 && !selectedSchema) setSelectedSchema(resData.data[0]);
        
        // Mark as online in global state
        dispatch({ 
            type: 'UPDATE_CONNECTION', 
            payload: { _id: connection._id, status: 'online' } 
        });

        // If local storage, also persist the online status
        if (connection.storage === 'localstorage') {
            const saved = JSON.parse(localStorage.getItem('ssh_monitor_connections') || '[]');
            const updated = saved.map(c => {
                if (c._id === connection._id) return { ...c, status: 'online', lastConnected: new Date().toISOString() };
                return c;
            });
            localStorage.setItem('ssh_monitor_connections', JSON.stringify(updated));
        }
      } else {
        setError(resData.error || t('database.notifications.fetchFail'));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchData = async (schemaName, customFilter = null) => {
    if (!schemaName) return { success: false, error: 'No schema' };
    setLoading(true);
    try {
      let filterObj = {};
      if (customFilter && connection.dbProvider === 'mongodb') {
         try {
           filterObj = JSON.parse(customFilter);
         } catch (e) {
           addNotification({ title: 'Invalid Query', message: 'Filter must be valid JSON', type: 'error' });
           setLoading(false);
           return { success: false, error: 'Filter must be valid JSON' };
         }
      }

       let isActionQuery = connection.dbProvider !== 'mongodb' && 
                            customFilter && 
                            /(?:^|\s|<query>)(DELETE|UPDATE|INSERT|DROP|ALTER|TRUNCATE)\b/i.test(customFilter);

       // Special handling for MongoDB Mock Data (INSERT)
       let mongoDocs = [];
       if (connection.dbProvider === 'mongodb' && customFilter && /^\s*INSERT/i.test(customFilter)) {
           isActionQuery = true;
           // Extract and parse the values
           const runInsertMatch = customFilter.match(/VALUES\s*((?:\([\s\S]*?\)\s*,?\s*)+)/i);
           const colsMatch = customFilter.match(/INSERT\s+INTO\s+.*?\s*\((.*?)\)\s+VALUES/i);
           
           if (runInsertMatch) {
                const cols = colsMatch ? colsMatch[1].split(',').map(c => c.trim().replace(/[`"']/g, '')) : Object.keys(data[0] || {});
                const rawRows = runInsertMatch[1].split(/\)\s*,\s*\(/);
                
                mongoDocs = rawRows.map(raw => {
                    const cleanRaw = raw.replace(/^\(|\)$/g, ''); 
                    const vals = cleanRaw.split(/,(?=(?:(?:[^']*'){2})*[^']*$)/).map(v => {
                        let val = v.trim().replace(/^['"]|['"]$/g, '');
                        // Try to parse numbers/booleans back
                        if (!isNaN(val) && val !== '') val = Number(val);
                        if (val === 'true') val = true;
                        if (val === 'false') val = false;
                        return val;
                    });
                    
                    const doc = {};
                    cols.forEach((col, idx) => { 
                        if (col !== '_id') doc[col] = vals[idx] !== undefined ? vals[idx] : null; 
                    });
                    return doc;
                });
           }
       }

      if (isActionQuery) {
        const { confirmed, doBackup } = await showConfirm(
            t('database.modals.dangerousActionTitle'), 
            `${t('database.modals.dangerousActionMsg')}\n\nQuery: ${customFilter.substring(0, 100)}...`,
            'danger',
            true
        );
        if (!confirmed) {
            setLoading(false);
            return { success: false, error: 'User cancelled action' };
        }
        
        if (doBackup) {
            await createAutoBackup(schemaName, 'pre_action');
        }
      }

      const res = await apiFetch(`/api/connections/${connection._id}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
           connection,
           query: connection.dbProvider === 'mongodb' 
             ? (isActionQuery ? { action: 'insertMany', collection: schemaName, data: mongoDocs } : { action: 'find', collection: schemaName, filter: filterObj })
             : isActionQuery
               ? customFilter
               : customFilter 
                 ? (customFilter.trim().toUpperCase().startsWith('WHERE') 
                     ? `SELECT * FROM ${schemaName} ${customFilter} LIMIT 100`
                     : `SELECT * FROM ${schemaName} WHERE ${customFilter} LIMIT 100`)
                 : `SELECT * FROM ${schemaName} LIMIT 100`
        })
      });
      const resData = await res.json();
      if (resData.success) {
        if (isActionQuery) {
            addNotification({ title: t('common.success'), message: t('database.notifications.actionSuccess'), type: 'success' });
            fetchData(schemaName);
        } else {
            setData(resData.data);
        }
        return { success: true, data: resData.data };
      } else {
        addNotification({ title: 'Query Error', message: resData.error, type: 'error' });
        return { success: false, error: resData.error };
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message, type: 'error' });
      return { success: false, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedSchema) fetchData(selectedSchema);
  }, [selectedSchema]);

  const handleRunQuery = () => {
    fetchData(selectedSchema, filterQuery);
  };

  const handleClearQuery = () => {
    setFilterQuery('');
    fetchData(selectedSchema, '');
  };
  
  const handleRandomDataPreset = () => {
    if (data.length === 0) {
        addNotification({ title: 'Fetch Data First', message: 'Need some data to generate a smart preset', type: 'info' });
        return;
    }
    
    // Pick a random row
    const randomRow = data[Math.floor(Math.random() * data.length)];
    
    // Pick keys that are usually filterable (not IDs, not objects, not empty)
    const filterableKeys = Object.keys(randomRow).filter(k => {
        const val = randomRow[k];
        return k !== '_id' && k !== 'id' && k !== '__v' &&
               val !== null && 
               typeof val !== 'object' && 
               String(val).trim() !== '';
    });

    if (filterableKeys.length === 0) {
        addNotification({ title: 'No Simple Fields', message: 'Could not find filterable fields in this record', type: 'info' });
        return;
    }

    const randomKey = filterableKeys[Math.floor(Math.random() * filterableKeys.length)];
    const value = randomRow[randomKey];

    if (connection.dbProvider === 'mongodb') {
      setFilterQuery(JSON.stringify({ [randomKey]: value }));
    } else {
      setFilterQuery(`${randomKey} = ${typeof value === 'string' ? `'${value}'` : value}`);
    }
    
    addNotification({ title: 'Smart Preset', message: `Filtering by ${randomKey}`, type: 'success' });
  };

  const removeHistoryItem = (e, item) => {
    e.stopPropagation();
    const newHistory = aiHistory.filter(h => h !== item);
    setAiHistory(newHistory);
  };

  const handleAskAI = async (e, promptOverride = null, isRetry = false, retryCount = 0, initialPrompt = null) => {
    if (e && e.preventDefault) e.preventDefault();
    const currentPrompt = promptOverride || aiPrompt;
    if (!currentPrompt.trim()) return;
    if (!isRetry) setIsAiLoading(true);
    
    const basePrompt = initialPrompt || currentPrompt;

    try {
      const res = await apiFetch(`/api/connections/${connection._id}/ai-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: currentPrompt,
          provider: connection.dbProvider,
          schemaName: selectedSchema,
          sampleData: data.slice(0, 10), // Give AI more sample context
          model: aiModel,
          history: aiHistory.slice(0, 6).map(h => ({ role: 'user', content: h })),
          prefs: osState?.sshAiPrefs
        })
      });
      const resData = await res.json();
      if (resData.success) {
        setLastAiUpdate(Date.now());
        setUsedAiModel(resData.usedModel);
        // Clean any markdown code blocks or AI tags if they leaked through
        // Detect and extract <repeat> tag
        let repeatCount = 1;
        const repeatMatch = resData.query.match(/<repeat>(\d+)<\/repeat>/i);
        if (repeatMatch) {
            repeatCount = parseInt(repeatMatch[1], 10);
        }

        // Clean any markdown code blocks or AI tags
        // Clean any markdown code blocks or AI tags
        // First, if there's a <query> tag, extract its content first to be safe
        let rawQueryContent = resData.query;
        const queryTagMatch = resData.query.match(/<query>([\s\S]*?)<\/query>/i);
        if (queryTagMatch) {
            rawQueryContent = queryTagMatch[1];
        }

        let cleanQuery = rawQueryContent
            .replace(/<query>|<\/query>/gi, '')
            .replace(/<thought>[\s\S]*?<\/thought>/gi, '')
            .replace(/<repeat>[\s\S]*?<\/repeat>/gi, '') 
            .replace(/```(json|sql)?/g, '')
            .replace(/```/g, '')
            .trim();
        
        // SMART PREVIEW LOGIC
        // Allow SQL regex matching for INSERT even on MongoDB (for Mock Data feature)
        const isMongo = connection.dbProvider === 'mongodb';

        // MongoDB: allow AI to return an executable action object
        if (isMongo) {
            let parsed = null;
            try {
                parsed = JSON.parse(cleanQuery);
            } catch {}

            if (parsed && typeof parsed === 'object' && parsed.action) {
                const action = String(parsed.action || '').trim();
                const normalized = action.toLowerCase();
                const collection = parsed.collection || selectedSchema;
                const filter = parsed.filter && typeof parsed.filter === 'object' ? parsed.filter : {};

                const isDelete = normalized.startsWith('delete');
                const isUpdate = normalized.startsWith('update');
                const isInsert = normalized.startsWith('insert');

                // Preview targets for delete/update by fetching matching docs
                if (isDelete || isUpdate) {
                    const criteria = JSON.stringify(filter);
                    setFilterQuery(criteria);
                    fetchData(selectedSchema, criteria);
                }

                // Extract mockRows for INSERT preview from the parsed data
                let mockRows = [];
                if (isInsert && parsed.data) {
                    mockRows = Array.isArray(parsed.data) ? [...parsed.data] : [parsed.data];
                    
                    // Apply repeat count if AI used <repeat> tag
                    if (repeatCount > 1 && mockRows.length > 0) {
                        const templateRow = mockRows[0];
                        mockRows = [];
                        for (let i = 0; i < repeatCount; i++) {
                            const newRow = { ...templateRow };
                            Object.keys(newRow).forEach(k => {
                                const val = newRow[k];
                                if (val === null || val === undefined) return;
                                if (typeof val === 'string') {
                                    const numMatch = val.match(/(\d+)$/);
                                    if (numMatch) {
                                        const originalNum = parseInt(numMatch[1], 10);
                                        const prefix = val.substring(0, numMatch.index);
                                        newRow[k] = `${prefix}${originalNum + i}`;
                                    }
                                }
                            });
                            mockRows.push(newRow);
                        }
                    }
                }
                
                console.log('[AI MongoDB Action] mockRows:', mockRows.length, 'data:', parsed.data);

                // Extract changes for UPDATE preview
                let changes = null;
                if (isUpdate && parsed.update && parsed.update.$set) {
                    changes = {};
                    Object.entries(parsed.update.$set).forEach(([k, v]) => {
                        changes[k.toLowerCase()] = v;
                    });
                }

                setPendingAction({
                    type: isDelete ? 'DELETE' : (isUpdate ? 'UPDATE' : 'INSERT'),
                    fullQuery: JSON.stringify({ ...parsed, collection }),
                    mongoAction: { ...parsed, collection },
                    mockRows,
                    changes,
                });
                // Add preview notification
                const actionLabel = isDelete ? t('database.ai.deletion') : (isUpdate ? t('database.ai.update') : t('database.ai.insertion'));
                addNotification({ 
                    title: t('database.notifications.actionPreviewTitle'),
                    message: t('database.notifications.actionPreviewMsg', { action: actionLabel, count: mockRows.length }),
                    type: 'info' 
                });

                // Add to history if not duplicate
                if (!isRetry && !aiHistory.includes(basePrompt)) {
                    const newHistory = [basePrompt, ...aiHistory].slice(0, 10);
                    setAiHistory(newHistory);
                }
                if (!isRetry) setAiPrompt('');
                setIsAiLoading(false);
                return;
            }
        }
        
        // Try to parse as SQL first
        const deleteMatch = cleanQuery.match(/DELETE\s+FROM\s+([\s\S]*?)(?:\s+WHERE\s+([\s\S]*))?$/i);
        const updateMatch = cleanQuery.match(/UPDATE\s+([\s\S]*?)\s+SET\s+([\s\S]*?)(?:\s+WHERE\s+([\s\S]*))?$/i);
        const insertMatch = cleanQuery.match(/INSERT\s+INTO\s+[\s\S]*?\s+VALUES\s+([\s\S]*)/i);
        
        // If it's MongoDB but matches an SQL INSERT, process it. Otherwise skip unless standard SQL db.
        // If it's MongoDB but matches an SQL INSERT, process it. Otherwise skip unless standard SQL db.
        if (!isMongo || (isMongo && insertMatch)) {
             if (deleteMatch || updateMatch || insertMatch) {
                // If it's a global action (no WHERE), criteria should be empty to show all records
                const criteria = deleteMatch ? (deleteMatch[2] || '') : (updateMatch ? (updateMatch[3] || '') : null);
                
                if (criteria !== null) {
                    setFilterQuery(criteria);
                    fetchData(selectedSchema, criteria); // Show targets (empty criteria shows all)
                } else if (insertMatch) {
                    setFilterQuery('');
                }

                let updateChanges = null;
                let mockRow = null;

                if (updateMatch) {
                    let setClause = updateMatch[2];
                    setClause = setClause.split(/\s+(?:ORDER\s+BY|LIMIT)/i)[0];
                    updateChanges = {};
                    const pairs = setClause.split(/,(?=(?:(?:[^']*'){2})*[^']*$)/);
                    pairs.forEach(pair => {
                        const parts = pair.split('=');
                        if (parts.length >= 2) {
                            const field = parts[0].trim().toLowerCase();
                            const val = parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
                            updateChanges[field] = val;
                        }
                    });
                } else if (insertMatch) {
                    const colsMatch = cleanQuery.match(/INSERT\s+INTO\s+.*?\s*\((.*?)\)\s+VALUES/i);
                    // Extract all value groups: (val1, val2), (val3, val4) ...
                    // This regex finds content inside parentheses after VALUES
                    const valueGroupsMatch = cleanQuery.match(/VALUES\s*((?:\([\s\S]*?\)\s*,?\s*)+)/i);
                    
                    if (valueGroupsMatch) {
                        const cols = colsMatch ? colsMatch[1].split(',').map(c => c.trim().replace(/[`"']/g, '')) : null;
                        
                        // Split by ")," to get each row, then clean up format
                        const rawRows = valueGroupsMatch[1].split(/\)\s*,\s*\(/);
                        
                        mockRow = rawRows.map(raw => {
                            const cleanRaw = raw.replace(/^\(|\)$/g, ''); // Remove leading/trailing parens
                            const vals = cleanRaw.split(/,(?=(?:(?:[^']*'){2})*[^']*$)/).map(v => v.trim().replace(/^['"]|['"]$/g, ''));
                            
                            const rowObj = {};
                            if (cols) {
                                cols.forEach((col, idx) => { rowObj[col] = vals[idx] || ''; });
                            } else if (data.length > 0) {
                                const schemaCols = Object.keys(data[0]);
                                schemaCols.forEach((col, idx) => { rowObj[col] = vals[idx] || ''; });
                            }
                            return rowObj;
                        });
                    }
                }

                // Smart Duplication for Large Data
                if (repeatCount > 1 && mockRow && mockRow.length > 0) {
                    const templateRow = mockRow[0]; // Use first row as template
                    mockRow = [];
                    
                    for (let i = 0; i < repeatCount; i++) {
                        // Clone the object
                        const newRow = { ...templateRow };
                        
                        // Auto-increment intelligent fields
                        Object.keys(newRow).forEach(k => {
                            const val = newRow[k];
                            // Skip if value is null
                            if (val === null || val === undefined) return;

                            if (typeof val === 'string') {
                                // Match number at the end of string (e.g. "User 1") -> "User 2" ...
                                const numMatch = val.match(/(\d+)$/);
                                if (numMatch) {
                                    const originalNum = parseInt(numMatch[1], 10);
                                    const prefix = val.substring(0, numMatch.index);
                                    newRow[k] = `${prefix}${originalNum + i}`;
                                }
                            } else if (typeof val === 'number') {
                                // Simple increment for ID-like fields if they look like sequences
                                if (k === 'id' || k.includes('Id')) {
                                    newRow[k] = val + i;
                                }
                            }
                        });
                        mockRow.push(newRow);
                    }
                }

                setPendingAction({ 
                    type: deleteMatch ? 'DELETE' : (updateMatch ? 'UPDATE' : 'INSERT'), 
                    fullQuery: cleanQuery,
                    changes: updateChanges,
                    mockRows: Array.isArray(mockRow) ? mockRow : (mockRow ? [mockRow] : [])
                });
                // Add preview notification
                const actionLabel = deleteMatch ? t('database.ai.deletion') : (updateMatch ? t('database.ai.update') : t('database.ai.insertion'));
                addNotification({ 
                    title: t('database.notifications.actionPreviewTitle'), 
                    message: t('database.notifications.actionPreviewMsg', { action: actionLabel, count: mockRow ? mockRow.length : '...' }), 
                    type: 'info' 
                });
            } else {
                setFilterQuery(cleanQuery);
                setPendingAction(null);
                const dbRes = await fetchData(selectedSchema, cleanQuery);
                if (!dbRes?.success && retryCount < 3) {
                    addNotification({ title: 'AI Auto-Fix', message: `Query failed. Asking AI to fix... (Attempt ${retryCount + 1}/3)`, type: 'info' });
                    return handleAskAI(null, `The query you generated failed with this error: ${dbRes.error}\n\nPlease fix the query, using correct syntax and table names.\nOriginal requirement: ${basePrompt}`, true, retryCount + 1, basePrompt);
                }
            }
        } else {
            setFilterQuery(cleanQuery);
            setPendingAction(null);
            const dbRes = await fetchData(selectedSchema, cleanQuery);
            if (!dbRes?.success && retryCount < 3) {
                addNotification({ title: 'AI Auto-Fix', message: `Query failed. Asking AI to fix... (Attempt ${retryCount + 1}/3)`, type: 'info' });
                return handleAskAI(null, `The query you generated failed with this error: ${dbRes.error}\n\nPlease fix the query, using correct syntax and table names.\nOriginal requirement: ${basePrompt}`, true, retryCount + 1, basePrompt);
            }
        }

        if (!isRetry) {
             addNotification({ title: 'AI Generated', message: 'Query executed successfully', type: 'success' });
        }
        
        // Add to history if not duplicate
        if (!isRetry && !aiHistory.includes(basePrompt)) {
            const newHistory = [basePrompt, ...aiHistory].slice(0, 10);
            setAiHistory(newHistory);
        }
        
        if (!isRetry) setAiPrompt(''); // Clear prompt after success
      } else {
        if (isRetry) {
             addNotification({ title: 'AI Auto-Fix Failed', message: resData.error, type: 'error' });
        } else {
             addNotification({ title: 'AI Error', message: resData.error, type: 'error' });
        }
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message, type: 'error' });
    } finally {
      if (!isRetry) setIsAiLoading(false);
    }
  };

  // ===== AUTO-BACKUP HELPER =====
  const createAutoBackup = async (tableName, reason = 'backup') => {
    try {
        const query = connection.dbProvider === 'mongodb' 
             ? { action: 'find', collection: tableName, filter: {} }
             : `SELECT * FROM ${tableName} LIMIT 5000`;

        const res = await apiFetch(`/api/connections/${connection._id}/query`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connection, query })
        });
        const resData = await res.json();
        if (!resData.success || !resData.data?.length) return;

        const now = new Date();
        const ts = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}${String(now.getSeconds()).padStart(2,'0')}`;
        const blob = new Blob([JSON.stringify(resData.data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = getExportFilename(tableName, reason);
        link.click();
        URL.revokeObjectURL(url);
        addNotification({ title: `🛡️ ${t('database.notifications.backupCreated')}`, message: t('database.notifications.backupCreatedMsg', { tableName, count: resData.data.length }), type: 'success' });
    } catch (err) {
        addNotification({ title: t('database.notifications.backupWarning'), message: t('database.notifications.backupFail', { message: err.message }), type: 'error' });
    }
  };

  // ===== EXPORT ALL TABLES/COLLECTIONS (individual files) =====
  // ===== EXPORT ALL TABLES/COLLECTIONS (individual files) =====
  const handleExportAll = async (specificTables = null) => {
    if (isExportingAll) return;
    if (schema.length === 0 && !specificTables) {
        addNotification({ title: t('database.notifications.noSchemaTitle'), message: t('database.notifications.noSchemaMsg'), type: 'info' });
        return;
    }
    
    const targetTables = Array.isArray(specificTables) ? specificTables : schema;
    addNotification({ title: t('database.notifications.exportBatchStartTitle'), message: t('database.notifications.exportBatchStartMsg', { count: targetTables.length }), type: 'info' });
    
    let successCount = 0;
    let totalRecords = 0;
    const failures = [];
    
    setIsExportingAll(true);
    if (!specificTables) {
        setFailedTables([]);
        localStorage.removeItem(`ssh_monitor_export_resume_${connection._id}`);
    }

    try {
        for (let i = 0; i < targetTables.length; i++) {
            const tableName = targetTables[i];
            try {
                let tableRecords = [];
                let offset = 0;
                let hasMore = true;
                const CHUNK_SIZE = 5000;

                while (hasMore && tableRecords.length < 50000) { // Safety cap for batch export
                    const res = await apiFetch(`/api/connections/${connection._id}/export`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ 
                          connection, 
                          collection: tableName,
                          limit: CHUNK_SIZE,
                          offset: offset
                        })
                    });
                    
                    if (res.status === 429) {
                       const resData = await res.json();
                       const remaining = targetTables.slice(i);
                       failures.push(...remaining);
                       if (!retryCountdown) {
                         setRetryCountdown(Math.ceil((resData.resetIn || 15000) / 1000));
                         setAutoRetry(true);
                       }
                       // If we already have some data for this table, it's safer to just abort this table and retry fully
                       setIsExportingAll(false);
                       return; 
                    }

                    const resData = await res.json();
                    if (!resData.success) {
                       failures.push(tableName);
                       hasMore = false;
                       break;
                    }

                    tableRecords = tableRecords.concat(resData.data || []);
                    offset = resData.meta.nextOffset;
                    hasMore = resData.meta.hasMore;
                    
                    // If we got less than requested, server is definitely empty
                    if ((resData.data || []).length < CHUNK_SIZE) hasMore = false;
                }

                // Trigger download for the table data
                const jsonString = JSON.stringify(tableRecords, null, 2);
                const blob = new Blob([jsonString], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = getExportFilename(tableName, 'batch');
                link.click();
                
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                
                totalRecords += tableRecords.length;
                successCount++;
                
                // Allow browser to catch up with downloads
                await new Promise(r => setTimeout(r, 600));
            } catch (tableErr) {
                console.error(`🚨 Export error for ${tableName}:`, tableErr);
                const isNetworkError = !tableErr.status && (tableErr.message?.includes('fetch') || tableErr.message?.includes('Network'));
                if (isNetworkError) {
                    const remaining = targetTables.slice(i);
                    failures.push(...remaining);
                    setRetryCountdown(15);
                    setAutoRetry(true);
                    addNotification({ title: t('database.notifications.networkIssueTitle'), message: t('database.notifications.networkIssueMsg'), type: 'warning' });
                    break;
                } else {
                    failures.push(tableName);
                }
            }
        }
        
        setFailedTables(failures);
        if (failures.length > 0) {
            localStorage.setItem(`ssh_monitor_export_resume_${connection._id}`, JSON.stringify(failures));
            addNotification({ 
                title: t('database.notifications.partialExportTitle'), 
                message: t('database.notifications.partialExportMsg', { success: successCount, failed: failures.length }), 
                type: 'warning' 
            });
        } else {
            localStorage.removeItem(`ssh_monitor_export_resume_${connection._id}`);
            addNotification({ 
                title: t('database.notifications.batchExportSuccessTitle'), 
                message: t('database.notifications.batchExportSuccessMsg', { success: successCount, total: totalRecords }), 
                type: 'success' 
            });
        }
    } catch (err) {
        addNotification({ title: t('database.notifications.exportFailedTitle'), message: err.message, type: 'error' });
    } finally {
        setIsExportingAll(false);
    }
  };

  const handleDelete = async (record) => {
    const { confirmed, doBackup } = await showConfirm(
        t('database.modals.confirmDeleteTitle'), 
        t('database.modals.confirmDeleteMsg'),
        'danger',
        true
    );
    if (!confirmed) return;

    if (doBackup) {
        await createAutoBackup(selectedSchema, 'pre_delete');
    }
    
    try {
      const res = await apiFetch(`/api/connections/${connection._id}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connection,
          query: connection.dbProvider === 'mongodb'
            ? { action: 'deleteOne', collection: selectedSchema, filter: { _id: record._id } }
            : `DELETE FROM ${selectedSchema} WHERE id = ${record.id}` // Simplified SQL
        })
      });
      const resData = await res.json();
      if (resData.success) {
        addNotification({ title: 'Deleted', message: 'Record deleted successfully', type: 'success' });
        fetchData(selectedSchema);
      } else {
        addNotification({ title: 'Delete Error', message: resData.error, type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message, type: 'error' });
    }
  };

  const handleSaveRecord = async (formPayload) => {
    setIsSubmitting(true);
    try {
      const isEdit = editingRecord.mode === 'edit';
      const action = isEdit ? 'updateOne' : 'insertOne';
      
      const queryPayload = {
        action,
        collection: selectedSchema,
        data: formPayload
      };

      if (isEdit) {
        queryPayload.filter = { _id: editingRecord.data._id || editingRecord.data.id };
        // Remove _id from data to avoid MongoDB error "Modifying _id is not allowed"
        delete queryPayload.data._id;
      }

      const res = await apiFetch(`/api/connections/${connection._id}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection, query: queryPayload })
      });
      
      const resData = await res.json();
      if (resData.success) {
        addNotification({ title: 'Saved', message: `Record ${isEdit ? 'updated' : 'created'} successfully`, type: 'success' });
        setEditingRecord(null);
        fetchData(selectedSchema);
      } else {
        addNotification({ title: 'Save Error', message: resData.error, type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message, type: 'error' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const getExportFilename = (tableName, type = 'export') => {
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-').split('.')[0];
    
    let parts = [];
    if (exportNaming.prefix) parts.push(exportNaming.prefix);
    parts.push(tableName);
    if (exportNaming.includeType && type) parts.push(type);
    if (exportNaming.suffix) parts.push(exportNaming.suffix);
    if (exportNaming.includeDate) parts.push(dateStr);
    if (exportNaming.includeTime) parts.push(timeStr);
    
    return `${parts.filter(Boolean).join('_')}.json`;
  };

  const handleExport = async () => {
    if (!selectedSchema) return;
    addNotification({ title: t('database.notifications.exportingTitle'), message: t('database.notifications.exportingChunksMsg'), type: 'info' });
    
    try {
        let allRecords = [];
        let offset = 0;
        let hasMore = true;
        const CHUNK_LIMIT = 2500;
        const TOTAL_CAP = 10000;

        while (hasMore && allRecords.length < TOTAL_CAP) {
            const res = await apiFetch(`/api/connections/${connection._id}/export`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                  connection, 
                  collection: selectedSchema,
                  limit: CHUNK_LIMIT,
                  offset: offset
                })
            });
            
            if (res.status === 429) {
                const resData = await res.json();
                addNotification({ title: t('database.notifications.rateLimitTitle'), message: t('database.notifications.rateLimitMsg', { seconds: Math.ceil(resData.resetIn/1000) }), type: 'warning' });
                await new Promise(r => setTimeout(r, resData.resetIn + 500));
                continue; // Retry this specific chunk
            }

            const resData = await res.json();
            if (!resData.success) throw new Error(resData.error || 'Export failed');

            allRecords = allRecords.concat(resData.data);
            offset = resData.meta.nextOffset;
            hasMore = resData.meta.hasMore;

            if (resData.data.length < CHUNK_LIMIT) hasMore = false;
            
            // Progress update for large files
            if (hasMore) {
                addNotification({ title: t('database.notifications.exportingTitle'), message: t('database.notifications.fetchedMsg', { count: allRecords.length }), type: 'info' });
            }
        }

        const jsonString = JSON.stringify(allRecords, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = getExportFilename(selectedSchema, 'full_export');
        link.click();
        URL.revokeObjectURL(url);
        
        addNotification({ title: t('database.notifications.exportSuccessTitle'), message: t('database.notifications.exportSuccessMsg', { count: allRecords.length }), type: 'success' });
    } catch (err) {
        addNotification({ title: t('database.notifications.exportFailedTitle'), message: err.message, type: 'error' });
    }
  };

  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        const records = Array.isArray(imported) ? imported : [imported];
        
        // Performance Optimization: Batching
        // We split the records into chunks of 100 to reduce the number of API calls
        const chunkSize = 100;
        let successCount = 0;
        
        addNotification({ 
            title: t('database.notifications.importingTitle'), 
            message: t('database.notifications.importingMsg', { count: records.length, batches: Math.ceil(records.length/chunkSize) }), 
            type: 'info' 
        });

        for (let i = 0; i < records.length; i += chunkSize) {
           const chunk = records.slice(i, i + chunkSize);
           
           try {
             const res = await apiFetch(`/api/connections/${connection._id}/query`, {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ 
                 connection, 
                 query: { 
                   action: 'insertMany', 
                   collection: selectedSchema, 
                   data: chunk 
                 } 
               })
             });
             
             const resData = await res.json();
             if (resData.success) {
               successCount += chunk.length;
             } else {
               console.error('Batch Import Error:', resData.error);
             }
           } catch (batchErr) {
             console.error('Network Error during batch import:', batchErr);
           }
        }
        
        addNotification({ 
            title: t('database.notifications.importCompleteTitle'), 
            message: t('database.notifications.importCompleteMsg', { success: successCount, total: records.length }), 
            type: 'success' 
        });
        
        fetchData(selectedSchema);
      } catch (err) {
        addNotification({ title: t('database.notifications.importErrorTitle'), message: t('database.notifications.importErrorMsg'), type: 'error' });
        console.error('Import parse error:', err);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };

  return (
    <div className="h-full flex overflow-hidden relative">
      {/* Schema Sidebar */}
      <div className="w-64 border-r border-[var(--border-color)] bg-[var(--bg-secondary)]/30 flex flex-col">
        <div className="p-4 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/10">
           <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2">
                <Layers size={12} /> {connection.dbProvider === 'mongodb' ? 'Collections' : 'Tables'}
              </span>
              <button 
                onClick={fetchSchema}
                className="p-1 text-[var(--text-muted)] hover:text-white transition-colors"
                title="Refresh Schema"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
           </div>
           <div className="relative">
              <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input 
                type="text" 
                placeholder="Filter..." 
                className="w-full bg-[var(--bg-primary)]/50 border border-[var(--border-color)] rounded-lg py-1.5 pl-8 pr-3 text-[11px] focus:outline-none focus:border-[var(--accent-indigo)]/50 focus:ring-1 focus:ring-[var(--accent-indigo)]/20 transition-all"
              />
           </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5 custom-scrollbar">
          {loading && schema.length === 0 ? (
             <div className="text-center py-10 opacity-50">
                <Loader2 size={20} className="animate-spin mx-auto mb-2 text-indigo-400" />
                <span className="text-[10px]">Loading Schema...</span>
             </div>
          ) : schema.length === 0 ? (
             <div className="p-4 text-center text-xs text-[var(--text-muted)] italic">
                No items found
             </div>
          ) : (
              schema.map(name => (
                <button
                  key={name}
                  disabled={!!pendingAction}
                  onClick={() => setSelectedSchema(name)}
                  title={pendingAction ? "Finish or Cancel your current action first" : ""}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
                    selectedSchema === name
                       ? 'bg-[var(--accent-indigo)]/10 text-[var(--accent-indigo)] font-bold border border-[var(--accent-indigo)]/20 shadow-sm'
                       : 'text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] border border-transparent'
                  } ${pendingAction ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {connection.dbProvider === 'mongodb' ? <Layers size={14} /> : <Table size={14} />}
                  <span className="truncate">{name}</span>
                </button>
              ))
          )}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {error ? (
           <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mb-6">
                 <Activity size={32} className="text-red-400" />
              </div>
               <h3 className="text-lg font-bold mb-2 text-red-400">{t('database.errors.connectionError')}</h3>
              <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto mb-8 font-mono bg-black/20 p-4 rounded-xl border border-red-500/10">
                 {error}
              </p>
               <button 
                 onClick={fetchSchema}
                 className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-500/20"
               >
                 {t('database.errors.retry')}
               </button>
           </div>
        ) : (
           <div className="flex flex-col h-full">
              {/* Toolbar */}
              <div className="h-11 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/5 flex items-center justify-between px-3 gap-2">
                 {/* Left: Schema Info */}
                 <div className="flex items-center gap-3 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider shrink-0">Active:</span>
                      <span className="text-[11px] font-bold text-indigo-400 truncate">{selectedSchema || '---'}</span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)]/60 font-mono shrink-0">{data.length} rows</span>

                    {latency !== null && (
                        <div 
                          className="flex items-center gap-1.5 text-[9px] font-bold px-2 py-0.5 rounded-full bg-[var(--bg-secondary)]/80 backdrop-blur-xl border border-[var(--border-color)]/50 shadow-sm opacity-80"
                          style={{ 
                              color: latency < 150 ? '#4ade80' : latency < 300 ? '#fbbf24' : '#f43f5e' 
                          }}
                          title="Network Latency (Ping)"
                        >
                          <Wifi size={9} strokeWidth={3} />
                          <span className="font-mono tracking-tighter">{latency}ms</span>
                        </div>
                    )}
                 </div>

                 {/* Right: Action Buttons */}
                 <div className="flex items-center gap-0.5 shrink-0">
                    {/* Core Actions */}
                    <button 
                      onClick={() => fetchData(selectedSchema)}
                      className="p-1.5 hover:bg-white/5 text-[var(--text-muted)] hover:text-white rounded-md transition-all"
                      title="Refresh Data"
                    >
                       <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button 
                     onClick={() => setShowQueryBar(!showQueryBar)}
                     className={`p-1.5 rounded-md transition-all ${
                       showQueryBar 
                         ? 'bg-indigo-500/20 text-indigo-400' 
                         : 'hover:bg-white/5 text-[var(--text-muted)] hover:text-white'
                     }`}
                     title="Filter / Query"
                   >
                      <Search size={14} />
                   </button>

                    <div className="w-px h-5 bg-[var(--border-color)] mx-1" />

                    {/* Data Actions */}
                    <button 
                      onClick={() => setEditingRecord({ mode: 'add', data: {} })}
                      className="p-1.5 hover:bg-emerald-500/10 text-[var(--text-muted)] hover:text-emerald-400 rounded-md transition-all"
                      title="Add Record"
                    >
                       <Plus size={14} />
                    </button>
                    <button 
                       onClick={() => fileInputRef.current.click()}
                       className="p-1.5 hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] rounded-md transition-all"
                       title="Import JSON"
                     >
                       <Upload size={14} />
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleImport} className="hidden" accept=".json" />
                    <button 
                      onClick={handleExport}
                      className="p-1.5 hover:bg-indigo-500/10 text-[var(--text-muted)] hover:text-indigo-400 rounded-md transition-all"
                      title="Export This Table"
                    >
                       <Download size={14} />
                    </button>

                    <div className="w-px h-5 bg-[var(--border-color)] mx-1" />

                    {/* Safety / Bulk Actions */}
                    <button 
                      onClick={handleExportAll}
                      disabled={!!pendingAction}
                      className={`flex items-center gap-1 px-2 py-1 hover:bg-amber-500/10 text-[var(--text-muted)] hover:text-amber-400 rounded-md text-[10px] font-semibold transition-all ${pendingAction ? 'opacity-50 cursor-not-allowed' : ''}`}
                      title="Export all tables/collections into one file"
                    >
                       <Archive size={13} /> Export All
                    </button>
                      <button 
                        onClick={() => createAutoBackup(selectedSchema, 'manual_backup')}
                        disabled={!!pendingAction}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all ${
                          pendingAction 
                            ? 'opacity-50 cursor-not-allowed' 
                            : 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20'
                        }`}
                        title="Create a timestamped backup of this table"
                      >
                         <Shield size={13} /> Backup
                      </button>
                    
                    <div className="w-px h-5 bg-[var(--border-color)] mx-1" />

                      <button 
                        onClick={() => setShowNamingSettings(!showNamingSettings)}
                        className={`p-1.5 rounded-md transition-all ${
                          showNamingSettings 
                            ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400' 
                            : 'hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                        }`}
                        title="Naming Pattern Settings"
                      >
                         <Settings2 size={14} />
                      </button>
                 </div>
              </div>

              {/* Naming Settings Panel */}
              {showNamingSettings && (
                <div className="bg-[var(--bg-tertiary)] border-b border-[var(--border-color)] p-3 px-4 flex flex-wrap items-center gap-4 animate-in slide-in-from-top duration-200">
                   <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">{t('database.naming.prefix')}</span>
                      <input 
                        type="text" 
                        value={exportNaming.prefix}
                        onChange={(e) => setExportNaming({ prefix: e.target.value })}
                        placeholder={t('database.naming.prefixPlaceholder')}
                        className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1 text-[11px] focus:border-amber-500/50 outline-none w-28 text-[var(--text-primary)]"
                      />
                   </div>
                   <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">{t('database.naming.suffix')}</span>
                      <input 
                        type="text" 
                        value={exportNaming.suffix}
                        onChange={(e) => setExportNaming({ suffix: e.target.value })}
                        placeholder={t('database.naming.suffixPlaceholder')}
                        className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded px-2 py-1 text-[11px] focus:border-amber-500/50 outline-none w-28 text-[var(--text-primary)]"
                      />
                   </div>
                   <div className="flex items-center gap-4 pt-4">
                      <label className="flex items-center gap-2 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={exportNaming.includeDate}
                          onChange={(e) => setExportNaming({ includeDate: e.target.checked })}
                          className="hidden"
                        />
                          <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${exportNaming.includeDate ? 'bg-amber-500 border-amber-500' : 'border-[var(--border-color)]'}`}>
                           {exportNaming.includeDate && <Check size={8} className="text-white" strokeWidth={4} />}
                        </div>
                        <span className="text-[11px] text-[var(--text-muted)] group-hover:text-[var(--text-primary)]">{t('database.naming.date')}</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={exportNaming.includeTime}
                          onChange={(e) => setExportNaming({ includeTime: e.target.checked })}
                          className="hidden"
                        />
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${exportNaming.includeTime ? 'bg-amber-500 border-amber-500' : 'border-[var(--border-color)]'}`}>
                           {exportNaming.includeTime && <Check size={8} className="text-white" strokeWidth={4} />}
                        </div>
                        <span className="text-[11px] text-[var(--text-muted)] group-hover:text-[var(--text-primary)]">{t('database.naming.time')}</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={exportNaming.includeType}
                          onChange={(e) => setExportNaming({ includeType: e.target.checked })}
                          className="hidden"
                        />
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${exportNaming.includeType ? 'bg-amber-500 border-amber-500' : 'border-[var(--border-color)]'}`}>
                           {exportNaming.includeType && <Check size={8} className="text-white" strokeWidth={4} />}
                        </div>
                        <span className="text-[11px] text-[var(--text-muted)] group-hover:text-[var(--text-primary)]" title={t('database.naming.tagTooltip')}>{t('database.naming.tag')}</span>
                      </label>
                   </div>
                   
                   <div className="ml-auto flex flex-col items-end gap-1">
                      <span className="text-[9px] font-bold text-amber-500/80 uppercase tracking-widest">{t('database.naming.preview')}</span>
                      <div className="text-[10px] font-mono text-[var(--text-muted)] italic bg-[var(--bg-primary)]/5 dark:bg-black/20 px-2 py-1 rounded">
                        {getExportFilename('users', '').replace('.json', '')}
                        <span className="text-amber-600 dark:text-amber-500/50">.json</span>
                      </div>
                   </div>
                </div>
              )}

              {/* Failed Exports Banner */}
              {failedTables.length > 0 && (
                 <div className="bg-red-500/10 border-red-500/30 border-b p-2 flex items-center justify-between text-[11px] backdrop-blur-sm">
                   <div className="flex items-center gap-2 text-red-400 font-bold">
                     <AlertCircle size={14} className={retryCountdown > 0 ? "animate-spin" : "animate-pulse"} />
                     {retryCountdown > 0 ? (
                       <span>Rate limited. Auto-retrying {failedTables.length > 1 ? `${failedTables.length} tables` : 'table'} in <strong className="text-white bg-red-600 px-1.5 rounded min-w-[20px] inline-block text-center">{retryCountdown}s</strong></span>
                     ) : (
                       <span>Failed to export: <strong>{failedTables.length} tables</strong> ({failedTables.slice(0, 3).join(', ')}{failedTables.length > 3 ? '...' : ''})</span>
                     )}
                   </div>
                   <div className="flex gap-2">
                     <button 
                       onClick={() => {
                         setRetryCountdown(0);
                         handleExportAll(failedTables);
                       }}
                        disabled={isExportingAll || retryCountdown > 0}
                       className="px-2 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 rounded text-[10px] font-bold transition-all disabled:opacity-50"
                     >
                       {isExportingAll ? 'Processing...' : retryCountdown > 0 ? `Waiting...` : 'Retry Now'}
                     </button>
                     <button 
                       onClick={() => {
                         setFailedTables([]);
                         setRetryCountdown(0);
                         setAutoRetry(false);
                       }}
                       className="p-1 hover:bg-red-500/20 text-red-400 rounded transition-all"
                     >
                       <X size={12} />
                     </button>
                   </div>
                 </div>
              )}

             {/* Pending Action Banner */}
             {pendingAction && (
                <div className={`border-b animate-in fade-in slide-in-from-top-1 duration-300 ${
                    pendingAction.type === 'DELETE' ? 'bg-red-500/5 border-red-500/20' :
                    pendingAction.type === 'UPDATE' ? 'bg-amber-500/5 border-amber-500/20' :
                    'bg-emerald-500/5 border-emerald-500/20'
                }`}>
                    <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-6">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                            <div className={`flex items-center justify-center w-10 h-10 rounded-xl shrink-0 ${
                                pendingAction.type === 'DELETE' ? 'bg-red-500/20 text-red-500' :
                                pendingAction.type === 'UPDATE' ? 'bg-amber-500/20 text-amber-500' :
                                'bg-emerald-500/20 text-emerald-500'
                            }`}>
                                {pendingAction.type === 'DELETE' ? <Trash2 size={20} /> :
                                 pendingAction.type === 'UPDATE' ? <Edit3 size={20} /> :
                                 <PlusCircle size={20} />}
                            </div>
                            
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                    <span className={`text-[10px] font-black uppercase tracking-[0.2em] ${
                                        pendingAction.type === 'DELETE' ? 'text-red-500' :
                                        pendingAction.type === 'UPDATE' ? 'text-amber-500' :
                                        'text-emerald-500'
                                    }`}>
                                        {pendingAction.type} ACTION PREVIEW
                                    </span>
                                    <div className="h-1 w-1 rounded-full bg-[var(--text-muted)] opacity-30" />
                                    <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">
                                        {pendingAction.type === 'INSERT' ? t('database.preview.insertReady') : 
                                         t('database.preview.showingRecords', { count: data.length })}
                                    </span>
                                </div>
                                
                                <div className="flex items-center gap-3 overflow-hidden">
                                    <p className="text-xs font-semibold text-[var(--text-primary)] truncate">
                                        {pendingAction.type === 'DELETE' ? 'Ready to permanently remove matching records.' :
                                         pendingAction.type === 'UPDATE' ? 'Reviewing changes before updating database.' :
                                         'Verifying new data format for insertion.'}
                                    </p>
                                    <button 
                                        onClick={() => setShowCodePreview(true)}
                                        className="flex items-center gap-2 px-2 py-0.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-md shadow-sm overflow-hidden flex-1 max-w-lg hover:border-[var(--accent-indigo)]/50 transition-colors group cursor-zoom-in"
                                        title="Click to examine full query"
                                    >
                                        <Terminal size={10} className="text-[var(--text-muted)] shrink-0" />
                                        <code className="text-[9px] font-mono whitespace-nowrap overflow-hidden text-[var(--text-secondary)] opacity-80 group-hover:opacity-100 flex-1 text-left">
                                            {pendingAction.fullQuery}
                                        </code>
                                        <Maximize2 size={10} className="text-[var(--text-muted)] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <button 
                                onClick={() => setPendingAction(null)}
                                className="px-4 py-2 text-[11px] font-bold text-[var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                            >
                                {t('database.modals.confirmCancel')}
                            </button>
                            <button 
                                onClick={executePendingAction}
                                className={`px-5 py-2 rounded-xl text-[11px] font-bold text-white transition-all shadow-lg flex items-center gap-2 hover:scale-[1.02] active:scale-95 ${
                                    pendingAction.type === 'DELETE' ? 'bg-red-600 hover:bg-red-500 shadow-red-500/20' :
                                    pendingAction.type === 'UPDATE' ? 'bg-amber-500 hover:bg-amber-400 shadow-amber-500/20' :
                                    'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20'
                                }`}
                            >
                                {pendingAction.type === 'DELETE' ? <Trash2 size={14}/> : 
                                 pendingAction.type === 'UPDATE' ? <Save size={14}/> : <Plus size={14}/>}
                                {t('database.preview.confirmAndExecute')}
                            </button>
                        </div>
                    </div>
                </div>
             )}

             {/* Query Bar */}
             {showQueryBar && (
                 <div className="bg-[var(--bg-tertiary)]/30 border-b border-[var(--border-color)] p-4 flex flex-col gap-4 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center gap-3">
                        <div className="flex flex-col gap-1 shrink-0 w-32">
                           <div className="flex items-center gap-2 text-[10px] font-bold text-indigo-400 uppercase tracking-widest">
                              <Search size={14} /> {connection.dbProvider === 'mongodb' ? t('database.query.filterJson') : t('database.query.whereClause')}
                           </div>
                           <button 
                             onClick={handleRandomDataPreset}
                             className="flex items-center justify-center gap-1.5 px-2 py-1 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-md text-[9px] font-bold transition-all border border-indigo-500/20"
                           >
                              <Sparkles size={10} /> {t('database.query.smartPreset')}
                           </button>
                        </div>
                        <div className="flex-1 relative">
                            <input 
                              type="text"
                              value={filterQuery}
                              disabled={!!pendingAction}
                              onChange={(e) => setFilterQuery(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && !pendingAction && handleRunQuery()}
                              placeholder={connection.dbProvider === 'mongodb' ? '{ "age": { "$gt": 25 } }' : 'age > 25 AND status = "active"'}
                              className={`w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl py-2 pl-4 pr-10 text-xs font-mono focus:outline-none focus:border-[var(--accent-indigo)]/50 focus:ring-1 focus:ring-[var(--accent-indigo)]/20 text-[var(--accent-emerald)] placeholder:text-[var(--text-muted)] shadow-inner transition-all ${pendingAction ? 'opacity-50 cursor-not-allowed' : ''}`}
                            />
                           {filterQuery && (
                              <button onClick={handleClearQuery} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white">
                                 <X size={14} />
                              </button>
                           )}
                        </div>
                         <button 
                           onClick={handleRunQuery}
                           disabled={!!pendingAction}
                           className={`px-6 py-2 bg-[var(--accent-indigo)] hover:brightness-110 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-[var(--accent-indigo)]/20 shrink-0 h-[38px] flex items-center gap-2 ${pendingAction ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
                         >
                            <Activity size={14} /> {t('database.query.run')}
                         </button>
                    </div>

                    <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-color)]/30">
                        <div className="flex items-center gap-2 shrink-0 w-32 group/ai-label" ref={helpRef}>
                            <div className="relative flex items-center gap-2">
                                <Sparkles size={14} className="text-purple-400 group-hover/ai-label:animate-pulse" />
                                <span className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">{t('database.ai.title')}</span>
                                <button 
                                    onClick={() => setShowAiHelp(!showAiHelp)}
                                    className={`p-1 rounded-full transition-all ${showAiHelp ? 'bg-purple-500 text-white' : 'text-purple-400/50 hover:text-purple-400 hover:bg-purple-500/10'}`}
                                    title={t('database.ai.help')}
                                >
                                    <HelpCircle size={12} />
                                </button>
                                
                                {showAiHelp && (
                                    <div className="absolute top-full left-0 mt-3 w-72 bg-[var(--bg-secondary)] border border-purple-500/30 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] p-4 z-[100] animate-in slide-in-from-top-2 backdrop-blur-xl">
                                        <div className="flex items-center gap-2 mb-3 border-b border-purple-500/20 pb-2">
                                            <HelpCircle size={14} className="text-purple-400" />
                                            <h4 className="text-[11px] font-bold text-purple-400 uppercase tracking-widest">{t('database.ai.help')}</h4>
                                        </div>
                                            <div className="space-y-2">
                                                <span className="text-[9px] font-bold text-purple-400/60 uppercase tracking-wider">{t('database.ai.examples.title')}</span>
                                                <div className="max-h-48 overflow-y-auto custom-scrollbar pr-1 -mr-1">
                                                    <div className="space-y-1">
                                                        {dynamicExamples.map((val, idx) => (
                                                            <div 
                                                                key={`example-${val}-${idx}`}
                                                                onClick={() => { setAiPrompt(val); setShowAiHelp(false); }}
                                                                className="text-[10px] text-[var(--text-secondary)] hover:text-purple-300 hover:bg-purple-500/10 p-2 rounded-lg cursor-pointer transition-all border border-transparent hover:border-purple-500/20"
                                                            >
                                                                • {val}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex-1 relative">
                              <div className="flex flex-col gap-1 flex-1 min-w-0">
                                <input 
                                    type="text"
                                    value={aiPrompt}
                                    disabled={!!pendingAction}
                                    onChange={(e) => setAiPrompt(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && !pendingAction && handleAskAI(e)}
                                    placeholder={t('database.ai.placeholder')}
                                    className={`w-full bg-[var(--bg-primary)] border border-purple-500/30 rounded-xl py-2 pl-4 pr-12 text-xs focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 text-[var(--text-primary)] placeholder:text-purple-400/40 dark:placeholder:text-purple-300/30 shadow-inner transition-all ${pendingAction ? 'opacity-50 cursor-not-allowed' : ''}`}
                                />
                                {usedAiModel && (
                                   <div className="flex items-center gap-1.5 px-2 animate-in fade-in slide-in-from-left-2 duration-500">
                                      <span className="text-[8px] font-bold text-purple-400/60 uppercase tracking-tighter">⚡ Used:</span>
                                      <span className="text-[8px] font-medium text-purple-400/50 bg-purple-500/5 px-1.5 py-0.5 rounded border border-purple-500/10">
                                         {usedAiModel.split('/').pop().replace(/-/g, ' ')}
                                      </span>
                                   </div>
                                )}
                              </div>
                             
                             {isAiLoading ? (
                                 <div className="absolute right-12 top-1/2 -translate-y-1/2">
                                     <Loader2 size={14} className="animate-spin text-purple-400" />
                                 </div>
                             ) : (
                                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center" ref={historyRef}>
                                    <button 
                                        onClick={() => setShowHistory(!showHistory)}
                                        className="p-1.5 hover:bg-purple-500/10 text-purple-400 rounded-lg transition-all"
                                        title="AI History"
                                    >
                                        <Clock size={16} />
                                    </button>
                                    
                                    {showHistory && (
                                        <div className="absolute top-full mt-2 right-0 w-80 bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] p-2 z-50 animate-in slide-in-from-top-2 backdrop-blur-xl">
                                            <div className="flex items-center justify-between px-3 py-2 mb-1 border-b border-[var(--border-color)]/30">
                                                    <div className="flex items-center gap-2">
                                                        <Clock size={12} className="text-purple-400" />
                                                        <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">{t('database.ai.history')}</span>
                                                    </div>
                                                    <button 
                                                        onClick={() => setAiHistory([])}
                                                        className="text-[10px] font-bold text-red-500/70 hover:text-red-500 transition-colors bg-red-500/5 px-2 py-1 rounded-md"
                                                    >
                                                        {t('database.ai.clearAll')}
                                                    </button>
                                                </div>
                                                <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
                                                    {aiHistory.length === 0 ? (
                                                        <div className="p-8 text-center flex flex-col items-center gap-2">
                                                            <Clock size={24} className="opacity-10" />
                                                            <span className="text-xs text-[var(--text-muted)] italic">{t('database.ai.noHistory')}</span>
                                                        </div>
                                                    ) : (
                                                        aiHistory.map((h, i) => (
                                                            <div 
                                                                key={`history-${h}-${i}`}
                                                                onClick={() => { setAiPrompt(h); setShowHistory(false); }}
                                                                className="group w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-xs text-[var(--text-secondary)] hover:bg-purple-500/10 hover:text-purple-300 transition-all cursor-pointer relative"
                                                            >
                                                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                                                    <Search size={12} className="shrink-0 opacity-30 group-hover:opacity-100 transition-opacity" />
                                                                    <span className="truncate">{h}</span>
                                                                </div>
                                                                <button 
                                                                    onClick={(e) => removeHistoryItem(e, h)}
                                                                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 text-red-400 rounded-lg transition-all"
                                                                    title="Remove"
                                                                >
                                                                    <Trash2 size={12} />
                                                                </button>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="relative">
                                <select 
                                    value={aiModel} 
                                    onChange={(e) => {
                                        setAiModel(e.target.value);
                                        if (e.target.value === 'manual') setAiSettingsOpen(true);
                                    }} 
                                    disabled={isAiLoading || !!pendingAction}
                                    className={`text-[11px] rounded bg-purple-500/10 border border-purple-500/20 px-2 h-[38px] text-[var(--text-primary)] focus:outline-none focus:border-purple-500/50 cursor-pointer ${pendingAction ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    title="AI Model"
                                >
                                    <option value="auto">✨ Auto Select</option>
                                    <option value="llama-3.1-8b-instant">🥉 Llama 3.1 8B (Thinking)</option>
                                    <option value="meta-llama/llama-4-scout-17b-16e-instruct">🥇 Llama 4 Scout (Primary)</option>
                                    <option value="llama-3.3-70b-versatile">🥈 Llama 3.3 70B (Heavy/Large)</option>
                                    <option value="manual">🛠 Custom...</option>
                                </select>
                                
                                {aiModel === 'manual' && (
                                    <button 
                                        onClick={() => setAiSettingsOpen(!aiSettingsOpen)} 
                                        className="absolute -right-2 -top-2 bg-purple-500 text-white rounded-full p-0.5 shadow-lg border border-purple-400"
                                        title="Configure Manual AI"
                                    >
                                        <Settings2 size={10} />
                                    </button>
                                )}

                                {aiSettingsOpen && aiModel === 'manual' && (
                                    <div className="absolute top-10 right-0 w-64 p-3 bg-[var(--bg-secondary)] border border-purple-500/30 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[100] animate-in slide-in-from-top-2 backdrop-blur-xl space-y-2">
                                        <div className="flex items-center justify-between border-b border-purple-500/20 pb-1 mb-2">
                                            <span className="text-[10px] font-bold text-purple-400 uppercase">Manual AI Settings</span>
                                            <button onClick={() => setAiSettingsOpen(false)} className="text-[10px] text-purple-400/60 hover:text-purple-400">Close</button>
                                        </div>
                                        <div className="flex gap-2 mb-2">
                                           <button onClick={() => setSshAiPrefs({ aiEndpoint: 'https://openrouter.ai/api/v1/chat/completions', aiCustomModel: 'anthropic/claude-3.5-sonnet' })} className="text-[9px] px-2 py-1 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30 transition-colors" title="Use OpenRouter Preset">
                                             🌐 OpenRouter
                                           </button>
                                           <button onClick={() => setSshAiPrefs({ aiEndpoint: 'https://api.openai.com/v1/chat/completions', aiCustomModel: 'gpt-4o' })} className="text-[9px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border border-emerald-500/30 transition-colors" title="Use default OpenAI Endpoint">
                                             🟢 OpenAI
                                           </button>
                                        </div>
                                        <input type="text" placeholder="Endpoint URL (e.g. OpenAI format)" value={osState?.sshAiPrefs?.aiEndpoint || ''} onChange={(e) => setSshAiPrefs({ aiEndpoint: e.target.value })} className="w-full text-[10px] rounded bg-black/30 border border-[var(--border-color)] px-2 py-1.5 outline-none focus:border-purple-500" style={{ color: 'var(--text-primary)' }} title="API Endpoint URL" />
                                        <input type="password" placeholder="API Key" value={osState?.sshAiPrefs?.aiApiKey || ''} onChange={(e) => setSshAiPrefs({ aiApiKey: e.target.value })} className="w-full text-[10px] rounded bg-black/30 border border-[var(--border-color)] px-2 py-1.5 outline-none focus:border-purple-500" style={{ color: 'var(--text-primary)' }} title="API Key" />
                                        <input type="text" placeholder="Model Name (e.g. gpt-4o, openrouter/auto)" value={osState?.sshAiPrefs?.aiCustomModel || ''} onChange={(e) => setSshAiPrefs({ aiCustomModel: e.target.value })} className="w-full text-[10px] rounded bg-black/30 border border-[var(--border-color)] px-2 py-1.5 outline-none focus:border-purple-500" style={{ color: 'var(--text-primary)' }} title="Custom Model Name" />
                                        <div className="text-[9px] text-[var(--text-muted)] italic leading-tight pt-1">Settings are shared with Terminal AI config. Requires OpenAI-compatible endpoint.</div>
                                    </div>
                                )}
                            </div>

                            <button 
                                disabled={isAiLoading || !aiPrompt.trim() || !!pendingAction}
                                onClick={handleAskAI}
                                className="px-6 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-purple-500/20 shrink-0 h-[38px] flex items-center gap-2"
                            >
                                {isAiLoading ? t('database.ai.loading') : t('database.ai.generate')}
                            </button>
                    </div>
                </div>
         )}
             {/* Table/Data View */}
             <div className="flex-1 overflow-auto bg-[var(--bg-primary)] p-4 custom-scrollbar">
                {loading && data.length === 0 ? (
                   <div className="h-full flex flex-col items-center justify-center opacity-50">
                      <Loader2 size={24} className="animate-spin mb-4 text-indigo-400" />
                      <span className="text-xs font-medium tracking-widest uppercase">{t('database.status.fetching')}</span>
                   </div>
                ) : (data.length > 0 || (pendingAction?.type === 'INSERT' && pendingAction.mockRows?.length > 0)) ? (
                    <div className="rounded-xl border border-[var(--border-color)] overflow-x-auto bg-[var(--bg-primary)]/10 custom-scrollbar overscroll-x-none" style={{ overscrollBehaviorX: 'none' }}>
                      <table className="w-full text-left text-xs border-collapse">
                         <thead>
                            <tr className="bg-[var(--bg-secondary)] border-b border-[var(--border-color)]">
                                <th className="sticky left-0 z-20 bg-[var(--bg-secondary)] px-4 py-3 w-28 text-center font-bold text-[var(--text-muted)] uppercase tracking-wider border-r border-[var(--border-color)]/50 shadow-[4px_0_8px_rgba(0,0,0,0.1)]">
                                   <div className="flex flex-col items-center gap-1">
                                      {pendingAction ? (
                                         <div className="flex flex-col items-center gap-1">
                                            <div className="flex items-center gap-2">
                                               <AlertCircle size={14} />
                                               {t('database.preview.title', { type: pendingAction.type })}
                                           </div>
                                           <span className="bg-red-600 text-white text-[7px] font-black px-1.5 py-0.5 rounded-full shadow-lg animate-pulse whitespace-nowrap">
                                              PREVIEWING TARGETS
                                           </span>
                                         </div>
                                      ) : (
                                         <span>{t('database.preview.actions')}</span>
                                      )}
                                   </div>
                                </th>
                               {Object.keys(data[0] || (pendingAction?.mockRows?.[0]) || {}).map(key => (
                                  <th key={key} className="px-4 py-3 font-bold text-[var(--text-muted)] uppercase tracking-wider min-w-[150px]">
                                     {key}
                                  </th>
                               ))}
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-[var(--border-color)]">
                            {pendingAction?.type === 'INSERT' && pendingAction.mockRows && pendingAction.mockRows.length > 0 && pendingAction.mockRows.map((mRow, mIdx) => (
                               <tr key={`mock-${mIdx}`} className="bg-emerald-500/10 border-b-2 border-emerald-500/30 animate-pulse">
                                   <td className="sticky left-0 z-10 bg-emerald-500/20 px-4 py-2.5 text-center border-r border-emerald-500/30 shadow-[4px_0_8px_rgba(0,0,0,0.1)]">
                                      <div className="flex flex-col items-center gap-0.5 opacity-100">
                                          <div className="bg-emerald-500 text-white text-[6px] font-black px-1 rounded-full px-1.5">NEW RECORD {mIdx + 1}</div>
                                          <Plus size={10} className="text-emerald-500" />
                                      </div>
                                   </td>
                                   {Object.keys(data[0] || mRow || {}).map(key => (
                                      <td key={key} className="px-4 py-2.5 font-mono text-emerald-700 dark:text-emerald-400 italic font-bold truncate max-w-[300px]">
                                         {String(mRow[key] !== undefined && mRow[key] !== null ? mRow[key] : 'AUTO')}
                                      </td>
                                   ))}
                               </tr>
                            ))}
                            {data.map((row, i) => (
                               <tr 
                                  key={row._id || row.id || i} 
                                  className={`transition-colors group ${
                                    pendingAction?.type === 'DELETE' ? 'bg-red-500/5 hover:bg-red-500/10' :
                                    pendingAction?.type === 'UPDATE' ? 'bg-amber-500/5 hover:bg-amber-500/10' :
                                    'hover:bg-[var(--bg-primary)]/[0.03]'
                                  }`}
                                >
                                   <td className="sticky left-0 z-10 bg-[var(--bg-primary)] px-4 py-2.5 text-center border-r border-[var(--border-color)]/30 group-hover:bg-[var(--bg-tertiary)] transition-all shadow-[4px_0_8px_rgba(0,0,0,0.1)]">
                                      <div className="flex items-center justify-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                         <button 
                                           onClick={() => setEditingRecord({ mode: 'edit', data: row })}
                                           className="p-1.5 hover:bg-blue-500/20 text-blue-400 rounded-lg transition-colors"
                                           title={t('database.editor.edit')}
                                         >
                                            <Edit size={14} />
                                         </button>
                                         <button 
                                           onClick={() => handleDelete(row)}
                                           className="p-1.5 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                                           title={t('database.editor.delete')}
                                         >
                                            <Trash2 size={14} />
                                         </button>
                                      </div>
                                   </td>
                                   {Object.keys(data[0]).map(key => {
                                      const isChanged = pendingAction?.type === 'UPDATE' && 
                                                       pendingAction.changes && 
                                                       pendingAction.changes[key.toLowerCase()] !== undefined;
                                      const displayValue = isChanged ? pendingAction.changes[key.toLowerCase()] : row[key];

                                      return (
                                         <td key={key} className={`px-4 py-2.5 font-mono text-[var(--text-primary)] truncate max-w-[300px] ${isChanged ? 'text-amber-700 dark:text-amber-400 font-bold italic' : ''}`} title={String(displayValue)}>
                                            {isChanged && <span className="mr-1 text-[8px] px-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded border border-amber-500/20 font-black">{t('database.editor.newTag')}</span>}
                                            {typeof displayValue === 'object' ? (
                                               <span className="text-indigo-400/80">{JSON.stringify(displayValue)}</span>
                                            ) : String(displayValue)}
                                         </td>
                                      );
                                   })}
                               </tr>
                            ))}
                         </tbody>
                      </table>
                   </div>
                ) : (
                   <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] bg-[var(--bg-primary)]/5 rounded-3xl border border-dashed border-[var(--border-color)]/5">
                      <Table size={48} className="mb-4 opacity-10" />
                      <p className="text-sm font-medium">{t('database.editor.emptyMsg')}</p>
                      <button 
                        onClick={() => setEditingRecord({ mode: 'add', data: {} })}
                        className="mt-6 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-xs font-bold transition-all"
                      >
                         {t('database.editor.addFirst')}
                      </button>
                   </div>
                )}
             </div>
           </div>
        )}
      </div>

      {/* Editing Modal */}
      {editingRecord && (
         <RecordModal 
           mode={editingRecord.mode} 
           initialData={editingRecord.data} 
           onClose={() => setEditingRecord(null)} 
           onSave={handleSaveRecord}
           isSubmitting={isSubmitting}
         />
      )}
      
      {confirmModal.isOpen && (
         <ConfirmationModal 
             title={confirmModal.title}
             message={confirmModal.message}
             type={confirmModal.type}
             showBackup={confirmModal.showBackup}
             doBackup={confirmModal.doBackup}
             onCancel={() => handleConfirmResult(false)}
             onConfirm={() => handleConfirmResult(true)}
             onToggleBackup={(val) => setConfirmModal(prev => ({ ...prev, doBackup: val }))}
         />
      )}

      {/* Query Examiner Modal */}
      {showCodePreview && pendingAction && (
        <MacOSModalWindow
          isOpen
          title="Query Examiner"
          icon={Code}
          onClose={() => setShowCodePreview(false)}
          zIndexClassName="z-[70]"
          maxWidthClassName="max-w-2xl"
          contentClassName="p-0"
          enableMinimize={false}
          enableMaximize={false}
          draggable
          resizable
          defaultWidth={600}
          defaultHeight={400}
        >
          <div className="bg-[var(--bg-primary)] p-5 flex flex-col h-full space-y-4">
            <div className="flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[var(--accent-indigo)]/10 flex items-center justify-center text-[var(--accent-indigo)]">
                  <Terminal size={18} />
                </div>
                <div>
                  <h3 className="text-xs font-bold text-[var(--text-primary)]">{t('database.ai.generatedCommand')}</h3>
                  <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-bold">{t('database.ai.reviewQuery')}</p>
                </div>
              </div>
              <button 
                onClick={() => handleCopyCode(pendingAction.fullQuery)}
                className="flex items-center gap-2 px-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border-color)] hover:border-[var(--accent-indigo)]/50 rounded-lg text-[10px] font-bold text-[var(--text-primary)] transition-all active:scale-95"
              >
                <Copy size={12} /> Copy
              </button>
            </div>

            <div className="relative flex-1 min-h-0 group">
              <div className="absolute top-3 right-3 text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest opacity-20 select-none">
                {connection?.dbProvider?.toUpperCase() || 'DB'} RAW QUERY
              </div>
               <pre className="h-full p-4 bg-[var(--bg-tertiary)]/50 dark:bg-black/30 border border-[var(--border-color)] rounded-xl overflow-auto custom-scrollbar font-mono text-[10px] leading-relaxed text-[var(--accent-emerald)] shadow-inner whitespace-pre-wrap break-all">
                {pendingAction.fullQuery}
              </pre>
            </div>

            <div className="flex justify-end pt-1 shrink-0">
              <button 
                onClick={() => setShowCodePreview(false)}
                className="px-5 py-1.5 bg-[var(--accent-indigo)] hover:bg-[var(--accent-indigo)]/90 text-white rounded-lg text-[10px] font-bold transition-all shadow-lg shadow-[var(--accent-indigo)]/20"
              >
                Close Examiner
              </button>
            </div>
          </div>
        </MacOSModalWindow>
      )}
    </div>
  );
}

function RecordModal({ mode, initialData, onClose, onSave, isSubmitting }) {
  const { t } = useTranslation();
  const [jsonValue, setJsonValue] = useState(JSON.stringify(initialData, null, 2));
  const [error, setError] = useState(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    try {
      const parsed = JSON.parse(jsonValue);
      onSave(parsed);
    } catch (err) {
      setError(t('database.editor.invalidJson'));
    }
  };

  return (
    <MacOSModalWindow
      isOpen
      title={mode === 'add' ? t('database.editor.addNew') : t('database.editor.editRecord')}
      icon={mode === 'add' ? Plus : Edit}
      onClose={onClose}
      zIndexClassName="z-50"
      draggable={true}
      resizable={true}
      defaultWidth={600}
      defaultHeight={500}
      minWidth={400}
      minHeight={300}
      contentClassName="p-6"
      closeOnOverlayClick
      overlayClassName="bg-black/60 backdrop-blur-sm"
      enableMinimize={false}
      enableMaximize={false}
    >
      <div className="overflow-hidden flex flex-col h-full">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase">{t('database.editor.jsonContent')}</span>
          {error && (
            <span className="text-[10px] text-red-400 flex items-center gap-1 font-bold animate-pulse">
              <AlertCircle size={12} /> {error}
            </span>
          )}
        </div>
         <textarea
          className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-2xl p-4 font-mono text-sm focus:outline-none focus:border-indigo-500/50 resize-none custom-scrollbar text-emerald-700 dark:text-emerald-400/90 flex-1 min-h-0"
          value={jsonValue}
          onChange={(e) => {
            setJsonValue(e.target.value);
            setError(null);
          }}
          spellCheck={false}
        />
        <div className="mt-4 p-4 rounded-xl bg-indigo-500/5 border border-indigo-500/10 flex items-start gap-3">
          <Activity size={16} className="text-indigo-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-[var(--text-muted)] leading-relaxed italic">
            {t('database.editor.formatGuide')}
          </p>
        </div>

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
             className="px-5 py-2 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            {t('database.editor.cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex items-center gap-2 px-6 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-500/20"
          >
            {isSubmitting ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
            {mode === 'add' ? t('database.editor.createRecord') : t('database.editor.saveChanges')}
          </button>
        </div>
      </div>
    </MacOSModalWindow>
  );
}

function ConfirmationModal({ title, message, type, showBackup, doBackup, onCancel, onConfirm, onToggleBackup }) {
  const { t } = useTranslation();
  const isDanger = type === 'danger';
  const Icon = isDanger ? AlertTriangle : AlertCircle;

  return (
    <MacOSModalWindow
      isOpen
      title={title}
      onClose={onCancel}
      zIndexClassName="z-[61]"
      maxWidthClassName="max-w-md"
      contentClassName="p-0"
      enableMinimize={false}
      enableMaximize={false}
      draggable
      resizable
      defaultWidth={440}
      defaultHeight={280}
    >
      <div className="flex flex-col h-full bg-[var(--bg-primary)]">
        {/* Main Content Area */}
        <div className="p-5 flex gap-4">
           <div className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center shadow-inner ${
             isDanger 
               ? 'bg-red-500/10 text-red-500' 
               : 'bg-indigo-500/10 text-indigo-500'
           }`}>
             <Icon size={22} />
           </div>
           
           <div className="flex-1 space-y-1.5 min-w-0">
             <h2 className="text-[13px] font-bold text-[var(--text-primary)] leading-tight tracking-tight uppercase opacity-80">
               Confirm Action
             </h2>
             <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed font-medium opacity-80 break-words">
               {message}
             </p>
           </div>
        </div>

        {/* Options & Backup Selection */}
        {showBackup && (
          <div className="px-5 py-3 bg-[var(--bg-secondary)]/50 border-y border-[var(--border-color)]/20">
            <label className="flex items-center gap-3 cursor-pointer group">
              <div className="relative flex items-center shrink-0">
                <input 
                  type="checkbox" 
                  checked={doBackup}
                  onChange={(e) => onToggleBackup(e.target.checked)}
                  className="peer h-4 w-4 opacity-0 absolute cursor-pointer z-10"
                />
                <div className={`h-4 w-4 rounded border transition-all flex items-center justify-center ${
                  doBackup 
                    ? 'bg-emerald-500 border-emerald-500' 
                    : 'border-[var(--border-color)] bg-[var(--bg-primary)] group-hover:border-emerald-500/50'
                }`}>
                  {doBackup && <Check size={10} className="text-white font-black" strokeWidth={4} />}
                </div>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] font-bold text-[var(--text-primary)] uppercase tracking-wider">
                  Auto-download Backup
                </span>
                <span className="text-[9px] text-[var(--text-muted)] leading-tight truncate">
                  Safety download before changes.
                </span>
              </div>
              <div className="ml-auto shrink-0">
                <ShieldCheck size={14} className={doBackup ? 'text-emerald-500' : 'text-[var(--text-muted)] opacity-20'} />
              </div>
            </label>
          </div>
        )}

        {/* Footer Actions */}
        <div className="mt-auto p-3 px-5 flex items-center justify-end gap-2 bg-[var(--bg-tertiary)]/10 rounded-b-2xl">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-[10px] font-bold text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-all rounded-lg"
          >
            {t('database.modals.confirmCancel')}
          </button>
          <button
            onClick={onConfirm}
            className={`px-5 py-2 rounded-lg text-[10px] font-black text-white transition-all shadow-lg hover:brightness-110 active:scale-95 flex items-center gap-2 ${
              isDanger 
                ? 'bg-red-600 shadow-red-500/10' 
                : 'bg-indigo-600 shadow-indigo-500/10'
            }`}
          >
            {isDanger ? 'Confirm' : t('database.modals.confirmOk')}
          </button>
        </div>
      </div>
    </MacOSModalWindow>
  );
}
