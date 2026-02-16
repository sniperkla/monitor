import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '@/context/AppContext';
import { useOS } from '@/context/OSContext';
import MacOSModalWindow from '@/components/MacOSModalWindow';
import { 
  Search, RefreshCw, Layers, Table, Code, Activity, Save, Loader2, 
  Trash2, Edit, Plus, Download, Upload, X, Check, AlertCircle, Sparkles,
  Clock, ChevronDown, Shield, Archive, Settings2
} from 'lucide-react';

export default function DatabaseView({ connection, onClose }) {
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
  const [pendingAction, setPendingAction] = useState(null); // { type: 'DELETE' | 'UPDATE', fullQuery: string }
  const fileInputRef = useRef(null);
  const historyRef = useRef(null);
  const [failedTables, setFailedTables] = useState([]);
  const [isExportingAll, setIsExportingAll] = useState(false);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [autoRetry, setAutoRetry] = useState(false);
  const [showNamingSettings, setShowNamingSettings] = useState(false);
  
  // Modal State
  const confirmResolver = useRef(null);
  const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', type: 'danger' });

  const showConfirm = (title, message, type = 'danger') => {
      return new Promise((resolve) => {
          confirmResolver.current = resolve;
          setConfirmModal({ isOpen: true, title, message, type });
      });
  };

  const handleConfirmResult = (result) => {
      if (confirmResolver.current) confirmResolver.current(result);
      setConfirmModal(prev => ({ ...prev, isOpen: false }));
      confirmResolver.current = null;
  };
  
  const { addNotification, state: osState, setExportNaming, setAiHistory, language } = useOS();
  const aiHistory = osState?.aiHistory || [];
  const exportNaming = osState?.exportNaming || {
    prefix: '',
    suffix: '',
    includeDate: true,
    includeTime: false,
    includeType: true,
  };
  const { apiFetch, dispatch } = useApp();
  const { t } = useTranslation();

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
                title: 'Unfinished Export Found', 
                message: `You have ${queue.length} tables pending from a previous session.`, 
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
        setError(resData.error || 'Failed to fetch schema');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchData = async (schemaName, customFilter = null) => {
    if (!schemaName) return;
    setLoading(true);
    try {
      let filterObj = {};
      if (customFilter && connection.dbProvider === 'mongodb') {
         try {
           filterObj = JSON.parse(customFilter);
         } catch (e) {
           addNotification({ title: 'Invalid Query', message: 'Filter must be valid JSON', type: 'error' });
           setLoading(false);
           return;
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
        const confirmed = await showConfirm(
            '⚠️ DANGEROUS ACTION DETECTED', 
            `This query will MODIFY or DELETE data from your database. There is no UNDO.\n\nQuery: ${customFilter.substring(0, 100)}...\n\n🛡️ A backup of "${schemaName}" will be auto-downloaded before execution.\n\nAre you absolutely sure?`,
            'danger'
        );
        if (!confirmed) {
            setLoading(false);
            return;
        }
        // AUTO-BACKUP: Download current data as a safety net before executing
        await createAutoBackup(schemaName, 'pre_action');
      }

      const res = await apiFetch(`/api/connections/${connection._id}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
           connection,
           query: connection.dbProvider === 'mongodb' 
             ? (isActionQuery ? { action: 'insertMany', collection: schemaName, data: mongoDocs } : { action: 'find', collection: schemaName, filter: filterObj })
             : isActionQuery
               ? customFilter // Send raw SQL if it's an action (DELETE/UPDATE)
               : customFilter 
                 ? `SELECT * FROM ${schemaName} WHERE ${customFilter} LIMIT 100`
                 : `SELECT * FROM ${schemaName} LIMIT 100`
        })
      });
      const resData = await res.json();
      if (resData.success) {
        if (isActionQuery) {
            addNotification({ title: 'Success', message: 'Action executed successfully', type: 'success' });
            fetchData(schemaName); // Refresh view
        } else {
            setData(resData.data);
        }
      } else {
        addNotification({ title: 'Query Error', message: resData.error, type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message, type: 'error' });
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

  const handleAskAI = async () => {
    if (!aiPrompt.trim()) return;
    setIsAiLoading(true);
    try {
      const res = await apiFetch(`/api/connections/${connection._id}/ai-query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: aiPrompt,
          provider: connection.dbProvider,
          schemaName: selectedSchema,
          sampleData: data.slice(0, 3) // Give AI some sample context
        })
      });
      const resData = await res.json();
      if (resData.success) {
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

                addNotification({ 
                    title: 'Action Preview', 
                    message: `Previewing ${deleteMatch ? 'DELETION' : (updateMatch ? 'UPDATE' : 'INSERTION')}...`, 
                    type: 'info' 
                });
            } else {
                setFilterQuery(cleanQuery);
                setPendingAction(null);
            }
        } else {
            setFilterQuery(cleanQuery);
            setPendingAction(null);
        }

        addNotification({ title: 'AI Generated', message: 'Query generated successfully', type: 'success' });
        
        // Add to history if not duplicate
        if (!aiHistory.includes(aiPrompt)) {
            const newHistory = [aiPrompt, ...aiHistory].slice(0, 10);
            setAiHistory(newHistory);
        }
        
        setAiPrompt(''); // Clear prompt after success
      } else {
        addNotification({ title: 'AI Error', message: resData.error, type: 'error' });
      }
    } catch (err) {
      addNotification({ title: 'Error', message: err.message, type: 'error' });
    } finally {
      setIsAiLoading(false);
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
        addNotification({ title: '🛡️ Backup Created', message: `Auto-backup of ${tableName} (${resData.data.length} records) saved`, type: 'success' });
    } catch (err) {
        addNotification({ title: 'Backup Warning', message: `Could not create backup: ${err.message}`, type: 'error' });
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
    if (!await showConfirm(t('database.modals.confirmDeleteTitle'), t('database.modals.confirmDeleteMsg'))) return;
    
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
                 onClick={() => setSelectedSchema(name)}
                 className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-all ${
                   selectedSchema === name
                      ? 'bg-[var(--accent-indigo)]/10 text-[var(--accent-indigo)] font-bold border border-[var(--accent-indigo)]/20 shadow-sm'
                      : 'text-[var(--text-muted)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)] border border-transparent'
                 }`}
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
           <>
              {/* Toolbar */}
              <div className="h-11 border-b border-[var(--border-color)] bg-[var(--bg-tertiary)]/5 flex items-center justify-between px-3 gap-2">
                 {/* Left: Schema Info */}
                 <div className="flex items-center gap-3 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider shrink-0">Active:</span>
                      <span className="text-[11px] font-bold text-indigo-400 truncate">{selectedSchema || '---'}</span>
                    </div>
                    <span className="text-[10px] text-[var(--text-muted)]/60 font-mono shrink-0">{data.length} rows</span>
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

                    <div className="w-px h-5 bg-white/8 mx-1" />

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
                      className="p-1.5 hover:bg-white/5 text-[var(--text-muted)] hover:text-white rounded-md transition-all"
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

                    <div className="w-px h-5 bg-white/8 mx-1" />

                    {/* Safety / Bulk Actions */}
                    <button 
                      onClick={handleExportAll}
                      className="flex items-center gap-1 px-2 py-1 hover:bg-amber-500/10 text-[var(--text-muted)] hover:text-amber-400 rounded-md text-[10px] font-semibold transition-all"
                      title="Export all tables/collections into one file"
                    >
                       <Archive size={13} /> Export All
                    </button>
                    <button 
                      onClick={() => createAutoBackup(selectedSchema, 'manual_backup')}
                      className="flex items-center gap-1 px-2 py-1 hover:bg-cyan-500/10 text-[var(--text-muted)] hover:text-cyan-400 rounded-md text-[10px] font-semibold transition-all"
                      title="Create a timestamped backup of this table"
                    >
                       <Shield size={13} /> Backup
                    </button>
                    
                    <div className="w-px h-5 bg-white/8 mx-1" />

                    <button 
                      onClick={() => setShowNamingSettings(!showNamingSettings)}
                      className={`p-1.5 rounded-md transition-all ${
                        showNamingSettings 
                          ? 'bg-amber-500/20 text-amber-400' 
                          : 'hover:bg-white/5 text-[var(--text-muted)] hover:text-white'
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
                        className="bg-black/20 border border-white/10 rounded px-2 py-1 text-[11px] focus:border-amber-500/50 outline-none w-28"
                      />
                   </div>
                   <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">{t('database.naming.suffix')}</span>
                      <input 
                        type="text" 
                        value={exportNaming.suffix}
                        onChange={(e) => setExportNaming({ suffix: e.target.value })}
                        placeholder={t('database.naming.suffixPlaceholder')}
                        className="bg-black/20 border border-white/10 rounded px-2 py-1 text-[11px] focus:border-amber-500/50 outline-none w-28"
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
                         <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${exportNaming.includeDate ? 'bg-amber-500 border-amber-500' : 'border-white/20'}`}>
                           {exportNaming.includeDate && <Check size={8} className="text-black" strokeWidth={4} />}
                        </div>
                        <span className="text-[11px] text-[var(--text-muted)] group-hover:text-white">{t('database.naming.date')}</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={exportNaming.includeTime}
                          onChange={(e) => setExportNaming({ includeTime: e.target.checked })}
                          className="hidden"
                        />
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${exportNaming.includeTime ? 'bg-amber-500 border-amber-500' : 'border-white/20'}`}>
                           {exportNaming.includeTime && <Check size={8} className="text-black" strokeWidth={4} />}
                        </div>
                        <span className="text-[11px] text-[var(--text-muted)] group-hover:text-white">{t('database.naming.time')}</span>
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer group">
                        <input 
                          type="checkbox" 
                          checked={exportNaming.includeType}
                          onChange={(e) => setExportNaming({ includeType: e.target.checked })}
                          className="hidden"
                        />
                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center transition-all ${exportNaming.includeType ? 'bg-amber-500 border-amber-500' : 'border-white/20'}`}>
                           {exportNaming.includeType && <Check size={8} className="text-black" strokeWidth={4} />}
                        </div>
                        <span className="text-[11px] text-[var(--text-muted)] group-hover:text-white" title={t('database.naming.tagTooltip')}>{t('database.naming.tag')}</span>
                      </label>
                   </div>
                   
                   <div className="ml-auto flex flex-col items-end gap-1">
                      <span className="text-[9px] font-bold text-amber-500/80 uppercase tracking-widest">{t('database.naming.preview')}</span>
                      <div className="text-[10px] font-mono text-white/40 italic bg-black/20 px-2 py-1 rounded">
                        {getExportFilename('users', '').replace('.json', '')}
                        <span className="text-amber-500/50">.json</span>
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
                <div className={`${
                    pendingAction.type === 'DELETE' ? 'bg-red-500/10 border-red-500/30' :
                    pendingAction.type === 'UPDATE' ? 'bg-amber-500/10 border-amber-500/30' :
                    'bg-emerald-500/10 border-emerald-500/30'
                } border-b p-2 flex items-center justify-between animate-in fade-in slide-in-from-top-1`}>
                    <div className="flex items-center gap-3 px-2">
                        <div className={`${
                            pendingAction.type === 'DELETE' ? 'bg-red-500/20' :
                            pendingAction.type === 'UPDATE' ? 'bg-amber-500/20' :
                            'bg-emerald-500/20'
                        } p-1.5 rounded-lg`}>
                            <AlertCircle size={16} className={
                                pendingAction.type === 'DELETE' ? 'text-red-400' :
                                pendingAction.type === 'UPDATE' ? 'text-amber-400' :
                                'text-emerald-400'
                            } />
                        </div>
                        <div>
                            <div className={`text-[10px] font-bold uppercase tracking-widest leading-none ${
                                pendingAction.type === 'DELETE' ? 'text-red-600 dark:text-red-400' :
                                pendingAction.type === 'UPDATE' ? 'text-amber-600 dark:text-amber-400' :
                                'text-green-600 dark:text-green-400'
                            }`}>
                                {pendingAction.type} PREVIEW
                            </div>
                            <div className={`text-[11px] mt-1 flex flex-col gap-2 ${
                                pendingAction.type === 'DELETE' ? 'text-red-800/80 dark:text-red-200/70' :
                                pendingAction.type === 'UPDATE' ? 'text-amber-800/80 dark:text-amber-200/70' :
                                'text-green-800/80 dark:text-green-200/70'
                            }`}>
                                 {pendingAction.type === 'INSERT' ? (
                                     <span>{t('database.preview.insertReady')}</span>
                                 ) : (
                                     <span>{t('database.preview.showingRecords', { count: data.length })} <span className={`font-black underline decoration-2 underline-offset-2 ${
                                         pendingAction.type === 'DELETE' ? 'text-red-600 dark:white' : 'text-amber-600 dark:white'
                                     }`}>{pendingAction.type === 'DELETE' ? t('database.preview.toBeDeleted') : t('database.preview.toBeUpdated')}</span>.</span>
                                 )}
                                <div className={`group relative font-mono text-[9px] p-2 rounded-lg border flex items-center gap-3 max-w-2xl transition-all ${
                                    pendingAction.type === 'DELETE' ? 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400' :
                                    pendingAction.type === 'UPDATE' ? 'bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-400' :
                                    'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
                                }`}>
                                    <span className="opacity-50 shrink-0 font-bold tracking-tighter">CMD:</span>
                                    <code className="truncate flex-1">{pendingAction.fullQuery}</code>
                                    <button 
                                        onClick={() => navigator.clipboard.writeText(pendingAction.fullQuery)}
                                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-white/10 rounded transition-all shrink-0"
                                        title="Copy Command"
                                    >
                                        <Code size={10} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => setPendingAction(null)}
                            className="px-3 py-1.5 hover:bg-red-500/10 text-red-700 dark:text-[var(--text-muted)] rounded-lg text-[10px] font-bold transition-all border border-red-500/20"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={() => {
                                fetchData(selectedSchema, pendingAction.fullQuery);
                                setPendingAction(null);
                            }}
                            className={`px-4 py-1.5 text-white rounded-lg text-[10px] font-bold shadow-lg transition-all flex items-center gap-2 ${
                                pendingAction.type === 'DELETE' ? 'bg-red-600 hover:bg-red-500 shadow-red-900/20' :
                                pendingAction.type === 'UPDATE' ? 'bg-amber-500 hover:bg-amber-400 shadow-amber-900/20' :
                                'bg-green-600 hover:bg-green-500 shadow-green-900/20'
                            }`}
                        >
                            {pendingAction.type === 'DELETE' ? <Trash2 size={12}/> : 
                             pendingAction.type === 'UPDATE' ? <Save size={12}/> : <Plus size={12}/>}
                            Confirm & Execute {pendingAction.type}
                        </button>
                    </div>
                </div>
             )}

             {/* Query Bar */}
             {showQueryBar && (
                 <div className="bg-[var(--bg-tertiary)]/30 border-b border-[var(--border-color)] p-3 flex flex-col gap-3 animate-in slide-in-from-top-2 duration-200">
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
                             onChange={(e) => setFilterQuery(e.target.value)}
                             onKeyDown={(e) => e.key === 'Enter' && handleRunQuery()}
                             placeholder={connection.dbProvider === 'mongodb' ? '{ "age": { "$gt": 25 } }' : 'age > 25 AND status = "active"'}
                             className="w-full bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-xl py-2 pl-4 pr-10 text-xs font-mono focus:outline-none focus:border-[var(--accent-indigo)]/50 focus:ring-1 focus:ring-[var(--accent-indigo)]/20 text-[var(--accent-emerald)] placeholder:text-[var(--text-muted)] shadow-inner transition-all"
                           />
                           {filterQuery && (
                              <button onClick={handleClearQuery} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-white">
                                 <X size={14} />
                              </button>
                           )}
                        </div>
                        <button 
                          onClick={handleRunQuery}
                          className="px-6 py-2 bg-[var(--accent-indigo)] hover:brightness-110 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-[var(--accent-indigo)]/20 shrink-0 h-[38px] flex items-center gap-2"
                        >
                           <Activity size={14} /> {t('database.query.run')}
                        </button>
                    </div>

                    <div className="flex items-center gap-3 pt-2 border-t border-[var(--border-color)]/30">
                        <div className="flex items-center gap-2 shrink-0 w-32">
                            <Sparkles size={14} className="text-purple-400" />
                            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">{t('database.ai.title')}</span>
                        </div>
                        <div className="flex-1 relative">
                            <input 
                                type="text"
                                value={aiPrompt}
                                onChange={(e) => setAiPrompt(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAskAI()}
                                placeholder={t('database.ai.placeholder')}
                                className="w-full bg-[var(--bg-primary)] border border-purple-500/30 rounded-xl py-2 pl-4 pr-12 text-xs focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/20 text-[var(--text-primary)] placeholder:text-purple-600/50 shadow-inner transition-all"
                            />
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
                                                            key={i}
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
                        <button 
                            disabled={isAiLoading || !aiPrompt.trim()}
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
                ) : data.length > 0 ? (
                    <div className="rounded-xl border border-[var(--border-color)] overflow-x-auto bg-black/10 custom-scrollbar overscroll-x-none" style={{ overscrollBehaviorX: 'none' }}>
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
                               {Object.keys(data[0]).map(key => (
                                  <th key={key} className="px-4 py-3 font-bold text-[var(--text-muted)] uppercase tracking-wider min-w-[150px]">
                                     {key}
                                  </th>
                               ))}
                            </tr>
                         </thead>
                         <tbody className="divide-y divide-[var(--border-color)]">
                            {pendingAction?.type === 'INSERT' && pendingAction.mockRows && pendingAction.mockRows.map((mRow, mIdx) => (
                               <tr key={`mock-${mIdx}`} className="bg-emerald-500/10 border-b-2 border-emerald-500/30 animate-pulse">
                                   <td className="sticky left-0 z-10 bg-emerald-500/20 px-4 py-2.5 text-center border-r border-emerald-500/30 shadow-[4px_0_8px_rgba(0,0,0,0.1)]">
                                      <div className="flex flex-col items-center gap-0.5 opacity-100">
                                          <div className="bg-emerald-500 text-white text-[6px] font-black px-1 rounded-full px-1.5">NEW RECORD {mIdx + 1}</div>
                                          <Plus size={10} className="text-emerald-500" />
                                      </div>
                                   </td>
                                   {Object.keys(data[0]).map(key => (
                                      <td key={key} className="px-4 py-2.5 font-mono text-emerald-700 dark:text-emerald-400 italic font-bold truncate max-w-[300px]">
                                         {String(mRow[key] || 'AUTO')}
                                      </td>
                                   ))}
                               </tr>
                            ))}
                            {data.map((row, i) => (
                               <tr 
                                  key={i} 
                                  className={`transition-colors group ${
                                    pendingAction?.type === 'DELETE' ? 'bg-red-500/5 hover:bg-red-500/10' :
                                    pendingAction?.type === 'UPDATE' ? 'bg-amber-500/5 hover:bg-amber-500/10' :
                                    'hover:bg-white/[0.03]'
                                  }`}
                                >
                                   <td className="sticky left-0 z-10 bg-[var(--bg-primary)] px-4 py-2.5 text-center border-r border-[var(--border-color)]/30 group-hover:bg-[#1a1a1a] transition-all shadow-[4px_0_8px_rgba(0,0,0,0.1)]">
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
                   <div className="h-full flex flex-col items-center justify-center text-[var(--text-muted)] bg-black/5 rounded-3xl border border-dashed border-white/5">
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
           </>
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
             onCancel={() => handleConfirmResult(false)}
             onConfirm={() => handleConfirmResult(true)}
         />
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
      maxWidthClassName="max-w-2xl"
      maxHeightClassName="max-h-[80vh]"
      contentClassName="p-6"
      closeOnOverlayClick
      overlayClassName="bg-black/60 backdrop-blur-sm"
    >
      <div className="overflow-hidden flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase">{t('database.editor.jsonContent')}</span>
          {error && (
            <span className="text-[10px] text-red-400 flex items-center gap-1 font-bold animate-pulse">
              <AlertCircle size={12} /> {error}
            </span>
          )}
        </div>
        <textarea
          className="w-full bg-black/40 border border-white/10 rounded-2xl p-4 font-mono text-sm focus:outline-none focus:border-indigo-500/50 resize-none custom-scrollbar text-emerald-400/90 min-h-[40vh]"
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
            className="px-5 py-2 text-xs font-bold text-[var(--text-muted)] hover:text-white transition-colors"
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

function ConfirmationModal({ title, message, type, onCancel, onConfirm }) {
  const { t } = useTranslation();
  const isDanger = type === 'danger';
  return (
    <MacOSModalWindow
      isOpen
      title={title}
      icon={AlertCircle}
      onClose={onCancel}
      zIndexClassName="z-[60]"
      maxWidthClassName="max-w-md"
      maxHeightClassName="max-h-[80vh]"
      contentClassName="p-6"
      closeOnOverlayClick
      overlayClassName="bg-black/60 backdrop-blur-sm"
    >
      <p className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed font-medium">
        {message}
      </p>

      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-xs font-bold text-gray-400 hover:text-white transition-colors rounded-lg"
        >
          {t('database.modals.confirmCancel')}
        </button>
        <button
          onClick={onConfirm}
          className={`px-6 py-2 rounded-xl text-xs font-bold text-white transition-all shadow-lg ${isDanger ? 'bg-red-500 hover:bg-red-600 shadow-red-500/20' : 'bg-blue-500 hover:bg-blue-600 shadow-blue-500/20'}`}
        >
          {isDanger ? t('database.modals.confirmYes') : t('database.modals.confirmOk')}
        </button>
      </div>
    </MacOSModalWindow>
  );
}
