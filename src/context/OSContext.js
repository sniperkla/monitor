'use client';

import { createContext, useContext, useReducer, useEffect, useState, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import i18n from '@/lib/i18n';
import { AppRegistry } from '@/apps/AppRegistry';

const OSContext = createContext();

const initialState = {
  windows: [], // Array of open windows { id, title, component, isMinimized, isMaximized, zIndex, x, y, width, height, appType, props }
  activeWindowId: null,
  nextZIndex: 100,
  wallpaper: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop',
  glassmorphism: true,
  iconPositions: {}, // { [id]: { x, y } }
  iconSize: 'medium', // small, medium, large
  iconStyle: 'glass', // glass, flat, neumorphic, outline, minimal
  sortBy: 'name', // name, type, date
  brightness: 100, // 0-100
  uiScale: 100, // 75, 100, 125
  notifications: {
    system: true,
    terminal: false,
    desktop: true
  },
  language: 'en',
  theme: 'dark', // light, dark, auto
  customWallpapers: [], // Array of URL strings
  taskbarPosition: 'bottom', // top, bottom, left, right
  windowLayout: 'mac', // mac, pc
  selectedIconIds: [], // IDs of currently selected icons
  timestamp: 0, // Last modified timestamp for conflict resolution
  notificationQueue: [], // Array of { id, title, message, type, timestamp }
  modal: {
    isOpen: false,
    type: 'alert', // alert, confirm, prompt
    title: '',
    message: '',
    confirmLabel: '',
    cancelLabel: '',
    defaultValue: '',
    onConfirm: null,
    onCancel: null
  },
  deferredPrompt: null,
  exportNaming: {
    prefix: '',
    suffix: '',
    includeDate: true,
    includeTime: false,
    includeType: true,
  },
  aiHistory: [],
  sshAiHistory: [],
  sshAiPrefs: {
    preferSudo: true,
    enforcePatch: true,
    autoApplyPatch: false,
    editor: 'nano',
    viewer: 'cat',
    autoExplainOnError: false,
    autoAnswerPrompts: false,
  },
  // Virtual desktops
  currentDesktopId: 'desktop-1',
  desktops: [
    { id: 'desktop-1', name: 'Desktop 1', wallpaper: null }
  ],
  windowsByDesktop: {
    'desktop-1': []
  },
  // Keyboard shortcuts
  keyboardShortcuts: {
    previewWindow: 'Ctrl+Cmd+Up',
    prevDesktop: 'Ctrl+Cmd+Left',
    nextDesktop: 'Ctrl+Cmd+Right',
    minimizeAll: 'Ctrl+Cmd+M',
    closeAll: 'Ctrl+Cmd+W',
    spotlight: 'Cmd+K',
  },
  terminalSettings: {
    activePreset: 'modern', // modern, retro, matrix, solarized
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    cursorStyle: 'bar',
    cursorBlink: true,
    theme: {
      background: '#0c0c0c',
      foreground: '#e4e4e7',
      cursor: '#6366f1',
      selectionBackground: 'rgba(99, 102, 241, 0.3)',
    },
    backgroundOpacity: 1,
    customPresets: [] // Array of { id, name, settings }
  },
};

function osReducer(state, action) {
  switch (action.type) {
    case 'OPEN_WINDOW': {
      // Check if window with same ID already exists (e.g. settings)
      // Also scan windowsByDesktop in case windows[] fell out of sync.
      const existing = state.windows.find(w => w.id === action.payload.id)
        || Object.values(state.windowsByDesktop || {}).flat().find(w => w.id === action.payload.id);
      if (existing) {
        const targetDesktopId = Object.entries(state.windowsByDesktop || {}).find(([, list]) =>
          Array.isArray(list) && list.some(w => w.id === existing.id)
        )?.[0];

        const nextCurrentDesktopId = targetDesktopId || state.currentDesktopId;

        return {
          ...state,
          currentDesktopId: nextCurrentDesktopId,
          activeWindowId: existing.id,
          windows: state.windows.map(w =>
            w.id === existing.id ? { ...w, isMinimized: false, zIndex: state.nextZIndex } : w
          ),
          windowsByDesktop: Object.fromEntries(
            Object.entries(state.windowsByDesktop || {}).map(([desktopId, list]) => [
              desktopId,
              (list || []).map(w =>
                w.id === existing.id ? { ...w, isMinimized: false, zIndex: state.nextZIndex } : w
              ),
            ])
          ),
          nextZIndex: state.nextZIndex + 1,
        };
      }
      const cascadeOffset = (state.windows.length % 10) * 30;
      const defaultX = 100 + cascadeOffset;
      const defaultY = 40 + cascadeOffset;

      const newWindow = { 
        ...action.payload, 
        x: action.payload.x ?? defaultX, 
        y: action.payload.y ?? defaultY,
        width: action.payload.width ?? 800,
        height: action.payload.height ?? 600,
        isMinimized: false, 
        isMaximized: false, 
        zIndex: state.nextZIndex 
      };

      return {
        ...state,
        windows: [...state.windows.filter(w => w.id !== newWindow.id), newWindow],
        // Add to current desktop, removing any stale entry with the same id first
        windowsByDesktop: {
          ...state.windowsByDesktop,
          [state.currentDesktopId]: [
            ...(state.windowsByDesktop[state.currentDesktopId] || []).filter(w => w.id !== newWindow.id),
            newWindow,
          ],
        },
        activeWindowId: action.payload.id,
        nextZIndex: state.nextZIndex + 1,
      };
    }
    case 'CLOSE_WINDOW':
      return {
        ...state,
        windows: state.windows.filter(w => w.id !== action.payload),
        // Remove from all desktops
        windowsByDesktop: Object.fromEntries(
          Object.entries(state.windowsByDesktop).map(([desktopId, windows]) => [
            desktopId,
            windows.filter(w => w.id !== action.payload)
          ])
        ),
        activeWindowId: state.activeWindowId === action.payload ? null : state.activeWindowId,
      };
    case 'MINIMIZE_WINDOW':
      return {
        ...state,
        windows: state.windows.map(w =>
          w.id === action.payload ? { ...w, isMinimized: true } : w
        ),
        windowsByDesktop: Object.fromEntries(
          Object.entries(state.windowsByDesktop).map(([desktopId, wins]) => [
            desktopId,
            (wins || []).map(w => (w.id === action.payload ? { ...w, isMinimized: true } : w)),
          ])
        ),
        activeWindowId: null,
      };
    case 'MINIMIZE_ALL':
      return {
        ...state,
        windows: state.windows.map(w => ({ ...w, isMinimized: true })),
        windowsByDesktop: Object.fromEntries(
          Object.entries(state.windowsByDesktop).map(([desktopId, wins]) => [
            desktopId,
            (wins || []).map(w => ({ ...w, isMinimized: true })),
          ])
        ),
        timestamp: Date.now()
      };
    case 'RESTORE_ALL':
      return {
        ...state,
        windows: state.windows.map(w => ({ ...w, isMinimized: false })),
        windowsByDesktop: Object.fromEntries(
          Object.entries(state.windowsByDesktop).map(([desktopId, wins]) => [
            desktopId,
            (wins || []).map(w => ({ ...w, isMinimized: false })),
          ])
        ),
        timestamp: Date.now(),
        activeWindowId: state.windows.length > 0 ? state.windows[state.windows.length - 1].id : null,
      };
    case 'MAXIMIZE_WINDOW':
      return {
        ...state,
        windows: state.windows.map(w =>
          w.id === action.payload ? { ...w, isMaximized: !w.isMaximized, snapSide: null } : w
        ),
        windowsByDesktop: Object.fromEntries(
          Object.entries(state.windowsByDesktop).map(([desktopId, wins]) => [
            desktopId,
            (wins || []).map(w =>
              w.id === action.payload ? { ...w, isMaximized: !w.isMaximized, snapSide: null } : w
            ),
          ])
        ),
      };
    case 'SNAP_WINDOW':
      return {
        ...state,
        windows: state.windows.map(w =>
          w.id === action.payload.id 
            ? { 
                ...w, 
                snapSide: action.payload.side, 
                isMaximized: action.payload.side === 'top' 
              } 
            : w
        ),
        windowsByDesktop: Object.fromEntries(
          Object.entries(state.windowsByDesktop).map(([desktopId, wins]) => [
            desktopId,
            (wins || []).map(w =>
              w.id === action.payload.id
                ? {
                    ...w,
                    snapSide: action.payload.side,
                    isMaximized: action.payload.side === 'top',
                  }
                : w
            ),
          ])
        ),
      };
    case 'SET_WINDOW_TITLE':
      return {
        ...state,
        windows: state.windows.map(w => w.id === action.payload.id ? { ...w, title: action.payload.title } : w),
        windowsByDesktop: Object.fromEntries(
          Object.entries(state.windowsByDesktop || {}).map(([desktopId, list]) => [
            desktopId,
            (list || []).map(w => w.id === action.payload.id ? { ...w, title: action.payload.title } : w),
          ])
        ),
      };
    case 'FOCUS_WINDOW':
      return {
        ...state,
        activeWindowId: action.payload,
        windows: state.windows.map(w =>
          w.id === action.payload ? { ...w, zIndex: state.nextZIndex, isMinimized: false } : w
        ),
        windowsByDesktop: Object.fromEntries(
          Object.entries(state.windowsByDesktop).map(([desktopId, wins]) => [
            desktopId,
            (wins || []).map(w =>
              w.id === action.payload ? { ...w, zIndex: state.nextZIndex, isMinimized: false } : w
            ),
          ])
        ),
        nextZIndex: state.nextZIndex + 1,
      };
    case 'SET_WALLPAPER':
      return {
        ...state,
        wallpaper: action.payload,
        timestamp: Date.now()
      };
    case 'ADD_CUSTOM_WALLPAPER': {
      const current = state.customWallpapers || [];
      if (current.includes(action.payload)) return state;
      return {
        ...state,
        customWallpapers: [...current, action.payload],
        timestamp: Date.now()
      };
    }
    case 'REMOVE_CUSTOM_WALLPAPER': {
      const current = state.customWallpapers || [];
      return {
        ...state,
        customWallpapers: current.filter(w => w !== action.payload),
        timestamp: Date.now()
      };
    }
    case 'TOGGLE_GLASS':
      return {
        ...state,
        glassmorphism: action.payload,
        timestamp: Date.now()
      };
    case 'UPDATE_ICON_POSITIONS':
      return {
        ...state,
        iconPositions: { ...state.iconPositions, ...action.payload },
        timestamp: Date.now()
      };
    case 'UPDATE_MULTIPLE_ICON_POSITIONS':
      return {
        ...state,
        iconPositions: { ...state.iconPositions, ...action.payload },
        timestamp: Date.now()
      };
    case 'SET_ICON_SIZE':
      return { ...state, iconSize: action.payload, timestamp: Date.now() };
    case 'SET_ICON_STYLE':
      return { ...state, iconStyle: action.payload, timestamp: Date.now() };
    case 'SET_SORT_BY':
      return { ...state, sortBy: action.payload };
    case 'SET_BRIGHTNESS':
      return { ...state, brightness: action.payload, timestamp: Date.now() };
    case 'SET_UI_SCALE':
      return { ...state, uiScale: action.payload, timestamp: Date.now() };
    case 'SET_NOTIFICATIONS':
      return { ...state, notifications: { ...state.notifications, ...action.payload }, timestamp: Date.now() };
    case 'ADD_NOTIFICATION':
      return { 
        ...state, 
        notificationQueue: [...state.notificationQueue, action.payload] 
      };
    case 'REMOVE_NOTIFICATION':
      return { 
        ...state, 
        notificationQueue: state.notificationQueue.filter(n => n.id !== action.payload) 
      };
    case 'UPDATE_NOTIFICATION':
      return {
        ...state,
        notificationQueue: state.notificationQueue.map(n => 
          n.id === action.payload.id ? { ...n, ...action.payload } : n
        )
      };
    case 'CLEAR_NOTIFICATIONS':
      return { ...state, notificationQueue: [] };
    case 'SET_LANGUAGE':
      return { ...state, language: action.payload, timestamp: Date.now() };
    case 'SET_THEME':
      return { ...state, theme: action.payload, timestamp: Date.now() };
    case 'SET_TERMINAL_SETTINGS':
      return { 
        ...state, 
        terminalSettings: { ...state.terminalSettings, ...action.payload }, 
        timestamp: Date.now() 
      };
    case 'SET_TASKBAR_POSITION':
      return { ...state, taskbarPosition: action.payload, timestamp: Date.now() };
    case 'SET_WINDOW_LAYOUT':
      return { ...state, windowLayout: action.payload, timestamp: Date.now() };
    case 'SET_SELECTED_ICONS':
      return { ...state, selectedIconIds: action.payload };
    case 'TOGGLE_ICON_SELECTION': {
      const id = action.payload;
      const current = state.selectedIconIds;
      return {
        ...state,
        selectedIconIds: current.includes(id) 
          ? current.filter(i => i !== id) 
          : [...current, id]
      };
    }
    case 'MOVE_SELECTED_ICONS': {
      const { deltaX, deltaY, basePositions } = action.payload;
      const newPositions = { ...state.iconPositions };
      state.selectedIconIds.forEach(id => {
        const base = basePositions[id];
        if (base) {
          newPositions[id] = { 
            x: Math.round(base.x + deltaX), 
            y: Math.round(base.y + deltaY) 
          };
        }
      });
      return { 
        ...state, 
        iconPositions: newPositions,
        timestamp: Date.now() 
      };
    }

    case 'SET_INITIAL_STATE': {
      // Hydrate windows carefully
      let hydratedWindows = state.windows;
      const hydrateOne = (w) => {
        if (!w?.id) return null;

        const existing = state.windows.find(ew => ew.id === w.id);
        const propsChanged = existing && JSON.stringify(existing.props) !== JSON.stringify(w.props);
        if (existing && !propsChanged && existing.component) {
          return { ...existing, ...w, component: existing.component };
        }

        let Component = null;
        let Icon = null;

        if (w.appType && AppRegistry[w.appType]) {
          Component = AppRegistry[w.appType].component;
          Icon = AppRegistry[w.appType].icon;
        } else if (AppRegistry[w.id]) {
          Component = AppRegistry[w.id].component;
          Icon = AppRegistry[w.id].icon;
        } else if (typeof w.id === 'string' && (w.id.startsWith('term-') || w.id.startsWith('standalone-term-'))) {
          Component = AppRegistry['terminal']?.component;
          Icon = AppRegistry['terminal']?.icon;
        } else if (typeof w.id === 'string' && (w.id.startsWith('standalone-files-') || w.id.startsWith('files-'))) {
          Component = AppRegistry['files']?.component;
          Icon = AppRegistry['files']?.icon;
        } else if (typeof w.id === 'string' && w.id.startsWith('standalone-docker-')) {
          Component = AppRegistry['docker-app']?.component;
          Icon = AppRegistry['docker-app']?.icon;
        } else if (typeof w.id === 'string' && w.id.startsWith('standalone-db-')) {
          Component = AppRegistry['database-browser']?.component;
          Icon = AppRegistry['database-browser']?.icon;
        }

        if (!Component) return null;
        try {
          return {
            ...w,
            component: <Component windowId={w.id} {...(w.props || {})} />,
            icon: Icon,
          };
        } catch (e) {
          console.error('Failed to hydrate component for', w.id, e);
          return null;
        }
      };

      if (action.payload.openWindows && Array.isArray(action.payload.openWindows)) {
        hydratedWindows = action.payload.openWindows.map(hydrateOne).filter(Boolean);
      }

      let hydratedWindowsByDesktop = state.windowsByDesktop;
      if (action.payload.windowsByDesktop && typeof action.payload.windowsByDesktop === 'object') {
        hydratedWindowsByDesktop = Object.fromEntries(
          Object.entries(action.payload.windowsByDesktop).map(([desktopId, list]) => {
            const seen = new Set();
            return [
              desktopId,
              (Array.isArray(list) ? list : [])
                .map(hydrateOne)
                .filter(Boolean)
                .filter(w => {
                  if (seen.has(w.id)) return false;
                  seen.add(w.id);
                  return true;
                }),
            ];
          })
        );
      }

      // Merge payload carefully to avoid wiping defaults with missing fields
      return {
        ...state,
        ...action.payload,
        // Re-apply critical defaults if payload values are missing or null
        wallpaper: action.payload.wallpaper || state.wallpaper,
        theme: action.payload.theme || state.theme,
        language: action.payload.language || state.language,
        customWallpapers: action.payload.customWallpapers || state.customWallpapers || [],
        iconPositions: action.payload.iconPositions || state.iconPositions || {},
        aiHistory: action.payload.aiHistory || state.aiHistory || [],
        sshAiHistory: action.payload.sshAiHistory || state.sshAiHistory || [],
        sshAiPrefs: action.payload.sshAiPrefs || state.sshAiPrefs || { preferSudo: true, enforcePatch: true, autoApplyPatch: false, autoTmux: false, editor: 'nano', viewer: 'cat', autoExplainOnError: false, autoAnswerPrompts: false },
        exportNaming: action.payload.exportNaming || state.exportNaming || {
          prefix: '',
          suffix: '',
          includeDate: true,
          includeTime: false,
          includeType: true,
        },
        keyboardShortcuts: action.payload.keyboardShortcuts || state.keyboardShortcuts,
        windows: hydratedWindows.length > 0 ? hydratedWindows : state.windows,
        windowsByDesktop: hydratedWindowsByDesktop || action.payload.windowsByDesktop || state.windowsByDesktop
      };
    }
    case 'SHOW_MODAL':
      return {
        ...state,
        modal: {
          isOpen: true,
          ...action.payload
        }
      };
    case 'CLOSE_MODAL':
      return {
        ...state,
        modal: {
          ...state.modal,
          isOpen: false,
          onConfirm: null,
          onCancel: null
        }
      };
    case 'SET_EXPORT_NAMING':
      return { ...state, exportNaming: { ...state.exportNaming, ...action.payload }, timestamp: Date.now() };
    case 'SET_AI_HISTORY':
      return { ...state, aiHistory: action.payload, timestamp: Date.now() };
    case 'SET_SSH_AI_HISTORY':
      return { ...state, sshAiHistory: action.payload, timestamp: Date.now() };
    case 'SET_SSH_AI_PREFS':
      return { ...state, sshAiPrefs: { ...(state.sshAiPrefs || {}), ...(action.payload || {}) }, timestamp: Date.now() };
    case 'SET_DEFERRED_PROMPT':
      return { ...state, deferredPrompt: action.payload };
    // Virtual desktops
    case 'SWITCH_DESKTOP':
      return {
        ...state,
        currentDesktopId: action.payload,
        activeWindowId: null,
      };
    case 'ADD_WINDOW_TO_DESKTOP': {
      const { desktopId, window } = action.payload;
      return {
        ...state,
        windowsByDesktop: {
          ...state.windowsByDesktop,
          [desktopId]: [...(state.windowsByDesktop[desktopId] || []), window],
        },
      };
    }
    case 'REMOVE_WINDOW_FROM_DESKTOP': {
      const { desktopId, windowId } = action.payload;
      return {
        ...state,
        windowsByDesktop: {
          ...state.windowsByDesktop,
          [desktopId]: (state.windowsByDesktop[desktopId] || []).filter(w => w.id !== windowId),
        },
      };
    }
    case 'MOVE_WINDOW_TO_DESKTOP': {
      const { windowId, fromDesktopId, toDesktopId } = action.payload;
      const window = state.windowsByDesktop[fromDesktopId]?.find(w => w.id === windowId);
      if (!window) return state;
      return {
        ...state,
        windowsByDesktop: {
          ...state.windowsByDesktop,
          [fromDesktopId]: (state.windowsByDesktop[fromDesktopId] || []).filter(w => w.id !== windowId),
          [toDesktopId]: [...(state.windowsByDesktop[toDesktopId] || []), window],
        },
      };
    }
    case 'ADD_WINDOWS_TO_DESKTOP': {
      const { desktopId, windows: windowsToAdd } = action.payload;
      return {
        ...state,
        windowsByDesktop: {
          ...state.windowsByDesktop,
          [desktopId]: [...(state.windowsByDesktop[desktopId] || []), ...windowsToAdd],
        },
      };
    }
    case 'REMOVE_WINDOW_FROM_DESKTOP': {
      const { desktopId, windowId } = action.payload;
      return {
        ...state,
        windowsByDesktop: {
          ...state.windowsByDesktop,
          [desktopId]: (state.windowsByDesktop[desktopId] || []).filter(w => w.id !== windowId),
        },
      };
    }
    case 'ADD_DESKTOP': {
      const newDesktop = action.payload;
      return {
        ...state,
        desktops: [...state.desktops, newDesktop],
        windowsByDesktop: {
          ...state.windowsByDesktop,
          [newDesktop.id]: []
        },
        timestamp: Date.now()
      };
    }
    case 'ADD_WINDOW_TO_DESKTOP': {
      const { desktopId, window } = action.payload;
      return {
        ...state,
        windowsByDesktop: {
          ...state.windowsByDesktop,
          [desktopId]: [...(state.windowsByDesktop[desktopId] || []), window]
        },
        timestamp: Date.now()
      };
    }
    case 'REMOVE_DESKTOP': {
      const { desktopId, targetDesktopId } = action.payload;
      // Never allow removing the last desktop
      if ((state.desktops || []).length <= 1) return state;

      const windowsToMove = state.windowsByDesktop?.[desktopId] || [];

      const nextDesktops = (state.desktops || []).filter(d => d.id !== desktopId);
      const nextWindowsByDesktop = { ...(state.windowsByDesktop || {}) };

      delete nextWindowsByDesktop[desktopId];

      nextWindowsByDesktop[targetDesktopId] = [
        ...(nextWindowsByDesktop[targetDesktopId] || []),
        ...windowsToMove,
      ];

      const nextCurrentDesktopId =
        state.currentDesktopId === desktopId ? targetDesktopId : state.currentDesktopId;

      return {
        ...state,
        desktops: nextDesktops,
        windowsByDesktop: nextWindowsByDesktop,
        currentDesktopId: nextCurrentDesktopId,
        timestamp: Date.now(),
      };
    }
    case 'RENAME_DESKTOP': {
      const { desktopId, name } = action.payload;
      return {
        ...state,
        desktops: (state.desktops || []).map(d => (d.id === desktopId ? { ...d, name } : d)),
        timestamp: Date.now(),
      };
    }
    case 'REORDER_DESKTOPS': {
      const { sourceId, targetId } = action.payload;
      if (!sourceId || !targetId || sourceId === targetId) return state;
      const list = [...(state.desktops || [])];
      const from = list.findIndex(d => d.id === sourceId);
      const to = list.findIndex(d => d.id === targetId);
      if (from === -1 || to === -1) return state;
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      return { ...state, desktops: list, timestamp: Date.now() };
    }
    case 'MOVE_WINDOW_TO_DESKTOP': {
      const { windowId, fromDesktopId, toDesktopId } = action.payload;
      if (!windowId || !fromDesktopId || !toDesktopId || fromDesktopId === toDesktopId) return state;

      const fromList = state.windowsByDesktop?.[fromDesktopId] || [];
      const win = fromList.find(w => w.id === windowId);
      if (!win) return state;

      return {
        ...state,
        windowsByDesktop: {
          ...(state.windowsByDesktop || {}),
          [fromDesktopId]: fromList.filter(w => w.id !== windowId),
          [toDesktopId]: [
            ...((state.windowsByDesktop || {})[toDesktopId] || []),
            win,
          ],
        },
        currentDesktopId: toDesktopId,
        activeWindowId: windowId,
        timestamp: Date.now(),
      };
    }
    case 'SET_KEYBOARD_SHORTCUTS': {
      return {
        ...state,
        keyboardShortcuts: { ...state.keyboardShortcuts, ...action.payload },
        timestamp: Date.now(),
      };
    }
    case 'UPDATE_WINDOW_POSITION': {
      const { id, position } = action.payload;
      const posData = position?.position || position || {};
      return {
        ...state,
        windows: (state.windows || []).map(w =>
          w.id === id ? { ...w, ...posData } : w
        ),
        windowsByDesktop: Object.fromEntries(
          Object.entries(state.windowsByDesktop || {}).map(([desktopId, wins]) => [
            desktopId,
            (wins || []).map(w =>
              w.id === id ? { ...w, ...posData } : w
            ),
          ])
        ),
        timestamp: Date.now()
      };
    }
    default:
      return state;
  }
}

export function OSProvider({ children }) {
  const [state, dispatch] = useReducer(osReducer, initialState);
  const { data: session, status: authStatus } = useSession();
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  
  const stateRef = useRef(state);
  stateRef.current = state;
  const lastSavedStateRef = useRef(null);
  // Helper for consistent serialization during sync checks
  const serializeStateForSync = (s) => {
    const sanitizeProps = (props) => {
      const p = props || {};
      const initialConnection = p.initialConnection;
      if (initialConnection && typeof initialConnection === 'object') {
        const initialConnectionId = initialConnection._id || initialConnection.id;
        const next = { ...p };
        delete next.initialConnection;
        if (initialConnectionId && !next.initialConnectionId) next.initialConnectionId = initialConnectionId;
        return next;
      }
      return p;
    };

    const safeDesktops = (s.desktops || []).map((d) => ({
      id: d.id,
      name: d.name,
      wallpaper: d.wallpaper ?? null,
    }));

    const safeWindowsByDesktop = Object.fromEntries(
      Object.entries(s.windowsByDesktop || {}).map(([desktopId, list]) => [
        desktopId,
        (list || []).map((w) => ({
          id: w.id,
          title: w.title,
          x: Math.round(w.x || 0),
          y: Math.round(w.y || 0),
          width: Math.round(w.width || 800),
          height: Math.round(w.height || 600),
          isMaximized: !!w.isMaximized,
          isMinimized: !!w.isMinimized,
          snapSide: w.snapSide || null,
          zIndex: w.zIndex || 100,
          appType: w.appType || null,
          props: sanitizeProps(w.props),
        })),
      ])
    );

    return JSON.stringify({
      wallpaper: s.wallpaper,
      glassmorphism: !!s.glassmorphism,
      desktops: safeDesktops,
      currentDesktopId: s.currentDesktopId || 'desktop-1',
      windowsByDesktop: safeWindowsByDesktop,
      iconPositions: s.iconPositions || {},
      iconSize: s.iconSize || 'medium',
      iconStyle: s.iconStyle || 'glass',
      sortBy: s.sortBy || 'name',
      brightness: s.brightness ?? 100,
      uiScale: s.uiScale ?? 100,
      notifications: s.notifications || { system: true, terminal: false, desktop: true },
      language: s.language || 'en',
      customWallpapers: s.customWallpapers || [],
      taskbarPosition: s.taskbarPosition || 'bottom',
      windowLayout: s.windowLayout || 'mac',
      theme: s.theme || 'dark',
      exportNaming: s.exportNaming || {
        prefix: '',
        suffix: '',
        includeDate: true,
        includeTime: false,
        includeType: true,
      },
      aiHistory: s.aiHistory || [],
      sshAiHistory: s.sshAiHistory || [],
      sshAiPrefs: s.sshAiPrefs || { preferSudo: true, enforcePatch: true, autoApplyPatch: false, autoTmux: false, editor: 'nano', viewer: 'cat', autoExplainOnError: false, autoAnswerPrompts: false },
      terminalSettings: s.terminalSettings || {
        activePreset: 'modern',
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        cursorStyle: 'bar',
        cursorBlink: true,
        theme: {
          background: '#0c0c0c',
          foreground: '#e4e4e7',
          cursor: '#6366f1',
          selectionBackground: 'rgba(99, 102, 241, 0.3)',
        },
        backgroundOpacity: s.terminalSettings?.backgroundOpacity ?? 1,
        customPresets: []
      },
      openWindows: (s.windows || s.openWindows || []).map((w) => ({
        id: w.id,
        title: w.title,
        x: Math.round(w.x || 0),
        y: Math.round(w.y || 0),
        width: Math.round(w.width || 800),
        height: Math.round(w.height || 600),
        isMaximized: !!w.isMaximized,
        isMinimized: !!w.isMinimized,
        snapSide: w.snapSide || null,
        zIndex: w.zIndex || 100,
        appType: w.appType || null,
        props: sanitizeProps(w.props),
      })),
      activeWindowId: s.activeWindowId || null,
      nextZIndex: s.nextZIndex || 100,
      keyboardShortcuts: s.keyboardShortcuts || {
        previewWindow: 'Ctrl+Cmd+Up',
        prevDesktop: 'Ctrl+Cmd+Left',
        nextDesktop: 'Ctrl+Cmd+Right',
        minimizeAll: 'Ctrl+Cmd+M',
        closeAll: 'Ctrl+Cmd+W',
        spotlight: 'Cmd+K',
      },
    });
  };

  // 1. Initial Load from LocalStorage (for fast boot/guests)
  useEffect(() => {
    const saved = localStorage.getItem('webtop_os_state');
    if (saved && isInitialLoad) {
      try {
        const parsed = JSON.parse(saved);
        dispatch({ type: 'SET_INITIAL_STATE', payload: parsed });
      } catch (e) {
        console.error('Failed to load OS state', e);
      }
    }
  }, []);

  // 2. Fetch from DB if logged in
  useEffect(() => {
    const userEmail = session?.user?.email;
    if (userEmail) {
      const fetchSettings = async () => {
        try {
          const res = await fetch('/api/user/settings');
          const data = await res.json();
          if (data.success && data.settings) {
            const localTimestamp = stateRef.current.timestamp || 0;
            const dbTimestamp = data.settings.timestamp || 0;
            
            const lastSyncedEmail = localStorage.getItem('webtop_os_synced_email');
            const isFreshLogin = lastSyncedEmail !== userEmail;

            console.log('[OS] DB Fetch - customWallpapers:', data.settings.customWallpapers);
            console.log('[OS] DB Fetch - local customWallpapers:', stateRef.current.customWallpapers);
            console.log('[OS] Timestamps - DB:', dbTimestamp, 'Local:', localTimestamp, 'isFreshLogin:', isFreshLogin);

            if (isFreshLogin || dbTimestamp > localTimestamp || (localTimestamp === 0 && dbTimestamp !== 0)) {
              console.log(`🔄 [OS] Hydrating from DB (DB: ${dbTimestamp}, Local: ${localTimestamp})`);
              
              // Sync i18n immediately if needed to prevent flicker
              if (data.settings.language && i18n.language !== data.settings.language) {
                 await i18n.changeLanguage(data.settings.language).catch(console.error);
              }

              localStorage.setItem('webtop_os_synced_email', userEmail);
              lastSavedStateRef.current = serializeStateForSync(data.settings);
              dispatch({ type: 'SET_INITIAL_STATE', payload: data.settings });
            } else if (localTimestamp > dbTimestamp) {
              console.log('📤 [OS] Local state newer, pushing to DB');
              await saveSettings();
            }
          }
        } catch (error) {
          console.error('Failed to sync settings from DB', error);
        } finally {
          setIsInitialLoad(false);
        }
      };
      fetchSettings();
    } else {
      // If not logged in, stop loading immediately
      if (authStatus !== 'loading') {
        setIsInitialLoad(false);
      }
    }
  }, [session?.user?.email, authStatus]);

  // 3. Persist to LocalStorage
  useEffect(() => {
    const payload = serializeStateForSync(state);
    localStorage.setItem('webtop_os_state', JSON.stringify({
      ...JSON.parse(payload),
      timestamp: state.timestamp || Date.now()
    }));
  }, [
    state.wallpaper, 
    state.glassmorphism, 
    state.desktops,
    state.currentDesktopId,
    state.windowsByDesktop,
    state.iconPositions, 
    state.iconSize, 
    state.iconStyle, 
    state.sortBy, 
    state.brightness, 
    state.uiScale, 
    state.notifications, 
    state.language,
    state.customWallpapers,
    state.taskbarPosition,
    state.theme,
    state.keyboardShortcuts,
    state.terminalSettings,
    state.windows
  ]);

  // Sync state.language with i18n
  useEffect(() => {
    if (state.language && i18n.language !== state.language) {
      i18n.changeLanguage(state.language);
    }
  }, [state.language]);


  // Save on tab close or visibility hidden
  useEffect(() => {
    const userEmail = session?.user?.email;
    if (!userEmail) return;

    const saveOnUnload = () => {
      if (isInitialLoad) return;
      const payload = serializeStateForSync(stateRef.current);
      const fullData = { ...JSON.parse(payload), timestamp: Date.now() };
      const blob = new Blob([JSON.stringify(fullData)], { type: 'application/json' });
      navigator.sendBeacon('/api/user/settings', blob);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saveOnUnload();
    };

    window.addEventListener('beforeunload', saveOnUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', saveOnUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [session?.user?.email, isInitialLoad]);

  // 4. Sync to DB if logged in (Debounced)
  useEffect(() => {
    const userEmail = session?.user?.email;
    if (!userEmail || isInitialLoad) return;

    const serialized = serializeStateForSync(state);
    
    // Check if state actually changed from last known DB state
    if (lastSavedStateRef.current === serialized) {
      return;
    }

    const timer = setTimeout(async () => {
      try {
        console.log('💾 [OS] Syncing settings to DB...');
        const res = await fetch('/api/user/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...JSON.parse(serialized),
            timestamp: Date.now(),
          })
        });
        if (res.ok) {
          lastSavedStateRef.current = serialized;
        }
      } catch (error) {
        console.error('Failed to sync settings to DB', error);
      }
    }, 5000); // 5s debounce for stability
      
    return () => clearTimeout(timer);
  }, [
    session?.user?.email,
    state.wallpaper, 
    state.glassmorphism, 
    state.desktops,
    state.currentDesktopId,
    state.windowsByDesktop,
    state.iconPositions, 
    state.iconSize, 
    state.iconStyle,
    state.sortBy, 
    state.brightness, 
    state.uiScale, 
    state.notifications,
    state.language,
    state.customWallpapers,
    state.taskbarPosition,
    state.theme,
    state.windows,
    state.keyboardShortcuts,
    state.exportNaming,
    state.aiHistory,
    state.sshAiHistory,
    state.sshAiPrefs,
    state.terminalSettings,
    isInitialLoad
  ]);


  const saveSettings = async () => {
    const userEmail = session?.user?.email;
    if (!userEmail) return;
    try {
      const payload = serializeStateForSync(state);
      const parsedPayload = JSON.parse(payload);
      console.log('[OS] Saving settings - customWallpapers:', parsedPayload.customWallpapers);
      
      await fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...parsedPayload,
          timestamp: Date.now(),
        })
      });
      lastSavedStateRef.current = payload;
      console.log('Settings saved manually');
    } catch (error) {
      console.error('Failed to save settings manually', error);
    }
  };

  // 6. Migrate existing windows to current desktop on first load
  useEffect(() => {
    if (state.windows.length > 0 && Object.values(state.windowsByDesktop).every(arr => arr.length === 0)) {
      // If we have windows but no desktop assignments, migrate them to current desktop
      const currentWindows = state.windowsByDesktop[state.currentDesktopId] || [];
      if (currentWindows.length === 0) {
        dispatch({
          type: 'ADD_WINDOWS_TO_DESKTOP',
          payload: {
            desktopId: state.currentDesktopId,
            windows: state.windows
          }
        });
      }
    }
  }, [state.windows, state.windowsByDesktop, state.currentDesktopId]);

  // 7. Sync i18n with state language
  useEffect(() => {
    if (state.language && i18n.language !== state.language) {
      i18n.changeLanguage(state.language);
    }
  }, [state.language]);

  const openWindow = (id, title, component, icon, options = {}) => {
    dispatch({ type: 'OPEN_WINDOW', payload: { id, title, component, icon, ...options } });
  };

  const closeWindow = (id) => {
    dispatch({ type: 'CLOSE_WINDOW', payload: id });
  };

  const focusWindow = (id) => {
    dispatch({ type: 'FOCUS_WINDOW', payload: id });
  };

  const toggleMinimize = (id) => {
    const win = state.windows.find(w => w.id === id);
    if (win?.isMinimized) {
      focusWindow(id);
    } else {
      dispatch({ type: 'MINIMIZE_WINDOW', payload: id });
    }
  };

  const toggleMaximize = (id) => {
    dispatch({ type: 'MAXIMIZE_WINDOW', payload: id });
  };

  const setWallpaper = (url) => {
    dispatch({ type: 'SET_WALLPAPER', payload: url });
    // Immediately persist — don't wait for the 5s debounce
    if (session?.user?.email) {
      const newState = { ...stateRef.current, wallpaper: url };
      const payload = serializeStateForSync(newState);
      fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(payload), timestamp: Date.now() }),
      }).then(res => {
        if (res.ok) lastSavedStateRef.current = payload;
      }).catch(console.error);
    }
  };

  const setGlassmorphism = (enabled) => {
    dispatch({ type: 'TOGGLE_GLASS', payload: enabled });
  };

  const updateIconPosition = (id, x, y) => {
    dispatch({ type: 'UPDATE_ICON_POSITIONS', payload: { [id]: { x, y } } });
  };

  const setIconSize = (size) => {
    dispatch({ type: 'SET_ICON_SIZE', payload: size });
  };
  
  const snapWindow = (id, side) => {
    dispatch({ type: 'SNAP_WINDOW', payload: { id, side } });
  };

  const setIconStyle = (style) => {
    dispatch({ type: 'SET_ICON_STYLE', payload: style });
  };

  const setBrightness = (level) => {
    dispatch({ type: 'SET_BRIGHTNESS', payload: level });
  };

  const setUiScale = (scale) => {
    dispatch({ type: 'SET_UI_SCALE', payload: scale });
  };

  const setNotifications = (payload) => {
    dispatch({ type: 'SET_NOTIFICATIONS', payload });
  };

  const addCustomWallpaper = (url) => {
    dispatch({ type: 'ADD_CUSTOM_WALLPAPER', payload: url });
    if (session?.user?.email) {
      const current = stateRef.current.customWallpapers || [];
      const newState = { ...stateRef.current, customWallpapers: current.includes(url) ? current : [...current, url] };
      const payload = serializeStateForSync(newState);
      fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(payload), timestamp: Date.now() }),
      }).then(res => {
        if (res.ok) lastSavedStateRef.current = payload;
      }).catch(console.error);
    }
  };

  const removeCustomWallpaper = (url) => {
    dispatch({ type: 'REMOVE_CUSTOM_WALLPAPER', payload: url });
    if (session?.user?.email) {
      const current = stateRef.current.customWallpapers || [];
      const newState = { ...stateRef.current, customWallpapers: current.filter(w => w !== url) };
      const payload = serializeStateForSync(newState);
      fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...JSON.parse(payload), timestamp: Date.now() }),
      }).then(res => {
        if (res.ok) lastSavedStateRef.current = payload;
      }).catch(console.error);
    }
  };

  const setSortBy = (sort) => {
    dispatch({ type: 'SET_SORT_BY', payload: sort });
  };

  const setTaskbarPosition = (pos) => {
    dispatch({ type: 'SET_TASKBAR_POSITION', payload: pos });
  };

  const setWindowLayout = (layout) => {
    dispatch({ type: 'SET_WINDOW_LAYOUT', payload: layout });
  };

  const setLanguage = (language) => {
    dispatch({ type: 'SET_LANGUAGE', payload: language });
  };

  const setTheme = (theme) => {
    dispatch({ type: 'SET_THEME', payload: theme });
  };

  const setSelectedIcons = (iconIds) => {
    dispatch({ type: 'SET_SELECTED_ICONS', payload: iconIds });
  };

  const setExportNaming = (naming) => {
    dispatch({ type: 'SET_EXPORT_NAMING', payload: naming });
  };

  const setAiHistory = (history) => {
    dispatch({ type: 'SET_AI_HISTORY', payload: history });
  };

  const setSshAiHistory = (history) => {
    dispatch({ type: 'SET_SSH_AI_HISTORY', payload: history });
  };

  const setSshAiPrefs = (prefs) => {
    dispatch({ type: 'SET_SSH_AI_PREFS', payload: prefs });
  };

  const setDeferredPrompt = (promptEvent) => {
    dispatch({ type: 'SET_DEFERRED_PROMPT', payload: promptEvent });
  };

  const updateMultipleIconPositions = (positions) => {
    dispatch({ type: 'UPDATE_MULTIPLE_ICON_POSITIONS', payload: positions });
  };

  const updateWindowPosition = (id, position) => {
    dispatch({ type: 'UPDATE_WINDOW_POSITION', payload: { id, position } });
  };

  const minimizeAll = () => {
    dispatch({ type: 'MINIMIZE_ALL' });
  };

  const restoreAll = () => {
    dispatch({ type: 'RESTORE_ALL' });
  };

  const addNotification = useCallback((notification) => {
    // notification: { title, message, type (success/error/info), duration }
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    dispatch({ type: 'ADD_NOTIFICATION', payload: { ...notification, id, timestamp: Date.now() } });
    return id;
  }, [dispatch]);

  const removeNotification = useCallback((id) => {
    dispatch({ type: 'REMOVE_NOTIFICATION', payload: id });
  }, [dispatch]);

  const updateNotification = useCallback((id, updates) => {
    dispatch({ type: 'UPDATE_NOTIFICATION', payload: { id, ...updates } });
  }, [dispatch]);

  // Centralized Theme Management
  useEffect(() => {
    const applyTheme = () => {
      const html = document.documentElement;
      const theme = state.theme || 'dark';
      
      html.classList.remove('light', 'dark', 'retro', 'cyberpunk');
      
      if (theme === 'auto') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        html.classList.add(isDark ? 'dark' : 'light');
      } else {
        html.classList.add(theme);
      }
    };

    applyTheme();

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      if (state.theme === 'auto') applyTheme();
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [state.theme]);

  const showAlert = (message, title = 'Alert') => {
    dispatch({ type: 'SHOW_MODAL', payload: { type: 'alert', title, message } });
  };

  const showConfirm = (message, onConfirm, title = 'Confirm', confirmLabel, cancelLabel) => {
    dispatch({ type: 'SHOW_MODAL', payload: { type: 'confirm', title, message, onConfirm, confirmLabel, cancelLabel } });
  };

  const showModal = (component, title = '', options = {}) => {
    dispatch({ type: 'SHOW_MODAL', payload: { type: 'custom', component, title, ...options } });
  };

  const showPrompt = (message, onConfirm, defaultValue = '', title = 'Prompt') => {
    dispatch({ type: 'SHOW_MODAL', payload: { type: 'prompt', title, message, onConfirm, defaultValue } });
  };

  const closeModal = () => {
    dispatch({ type: 'CLOSE_MODAL' });
  };

  // Virtual desktops
  const switchDesktop = (desktopId) => {
    dispatch({ type: 'SWITCH_DESKTOP', payload: desktopId });
  };

  const switchToNextDesktop = () => {
    const currentIndex = state.desktops.findIndex(d => d.id === state.currentDesktopId);
    const nextIndex = (currentIndex + 1) % state.desktops.length;
    switchDesktop(state.desktops[nextIndex].id);
  };

  const switchToPrevDesktop = () => {
    const currentIndex = state.desktops.findIndex(d => d.id === state.currentDesktopId);
    const prevIndex = (currentIndex - 1 + state.desktops.length) % state.desktops.length;
    switchDesktop(state.desktops[prevIndex].id);
  };

  const setKeyboardShortcuts = (shortcuts) => {
    dispatch({ type: 'SET_KEYBOARD_SHORTCUTS', payload: shortcuts });
  };

  const addDesktop = () => {
    const newId = `desktop-${Date.now()}`;
    const newNumber = state.desktops.length + 1;
    dispatch({ 
      type: 'ADD_DESKTOP', 
      payload: { 
        id: newId, 
        name: `Desktop ${newNumber}`,
        wallpaper: null 
      } 
    });
  };

  const renameDesktop = (desktopId, name) => {
    dispatch({ type: 'RENAME_DESKTOP', payload: { desktopId, name } });
  };

  const removeDesktop = (desktopId) => {
    if ((state.desktops || []).length <= 1) return;

    const idx = (state.desktops || []).findIndex(d => d.id === desktopId);
    if (idx === -1) return;

    // Prefer previous desktop, otherwise fallback to first non-removed desktop
    const prev = state.desktops[idx - 1];
    const fallback = (state.desktops || []).find(d => d.id !== desktopId);
    const targetDesktopId = (prev && prev.id !== desktopId) ? prev.id : (fallback ? fallback.id : state.currentDesktopId);

    dispatch({ type: 'REMOVE_DESKTOP', payload: { desktopId, targetDesktopId } });
  };

  const reorderDesktops = (sourceId, targetId) => {
    dispatch({ type: 'REORDER_DESKTOPS', payload: { sourceId, targetId } });
  };

  const moveWindowToDesktop = (windowId, fromDesktopId, toDesktopId) => {
    dispatch({ type: 'MOVE_WINDOW_TO_DESKTOP', payload: { windowId, fromDesktopId, toDesktopId } });
  };

  // Three-finger swipe and keyboard shortcuts
  useEffect(() => {
    let touchStartX = 0;
    let touchStartY = 0;
    let touchStartTime = 0;

    const handleTouchStart = (e) => {
      if (e.touches.length === 3) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
      }
    };

    const handleTouchEnd = (e) => {
      if (e.changedTouches.length === 3 && touchStartTime) {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchStartY - touchEndY;
        const deltaTime = Date.now() - touchStartTime;

        // Swipe threshold and time limit
        if (Math.abs(deltaX) > 100 && deltaTime < 500) {
          if (deltaX > 0) {
            switchToPrevDesktop(); // Swipe right: previous desktop
          } else {
            switchToNextDesktop(); // Swipe left: next desktop
          }
        }
        touchStartTime = 0;
      }
    };

    const handleKeyDown = (e) => {
      // Prevent OS shortcuts if we're in a terminal or an input field to avoid conflicts
      const activeElement = document.activeElement;
      const isTerminal = activeElement?.classList.contains('xterm-helper-textarea') || 
                         activeElement?.closest('.xterm');
      const isInput = activeElement?.tagName === 'INPUT' || 
                      activeElement?.tagName === 'TEXTAREA' || 
                      activeElement?.isContentEditable;

      if (isTerminal || isInput) {
        // If we are in a terminal, we definitely want to skip ALL shortcuts 
        // to let the terminal handle them.
        // For inputs, we might want to allow some, but to follow the user request 
        // of "prevent keyboard shortcuts" due to conflicts, we'll skip them too.
        return;
      }

      const shortcuts = state.keyboardShortcuts || {
        prevDesktop: 'Ctrl+Cmd+Left',
        nextDesktop: 'Ctrl+Cmd+Right',
        minimizeAll: 'Ctrl+Cmd+M',
        closeAll: 'Ctrl+Cmd+W',
      };

      const isShortcutMatch = (shortcut, event) => {
        if (!shortcut) return false;
        const parts = shortcut.toLowerCase().split('+').map(p => p.trim());
        const hasCtrl = parts.includes('ctrl') && event.ctrlKey;
        const hasCmd = parts.includes('cmd') && event.metaKey;
        const hasAlt = parts.includes('alt') && event.altKey;
        const hasShift = parts.includes('shift') && event.shiftKey;
        
        // Find the main key (not a modifier)
        const mainKey = parts.find(p => !['ctrl', 'cmd', 'alt', 'shift'].includes(p));
        const eventKey = event.key.toLowerCase();
        
        // Handle common aliases
        const keyMap = {
          'up': 'arrowup',
          'down': 'arrowdown',
          'left': 'arrowleft',
          'right': 'arrowright'
        };

        const targetKey = keyMap[mainKey] || mainKey;
        const currentKey = keyMap[eventKey] || eventKey;
        
        return (
          (hasCtrl || !parts.includes('ctrl')) &&
          (hasCmd || !parts.includes('cmd')) &&
          (hasAlt || !parts.includes('alt')) &&
          (hasShift || !parts.includes('shift')) &&
          currentKey === targetKey
        );
      };

      // Previous Desktop
      if (isShortcutMatch(shortcuts.prevDesktop, e)) {
        e.preventDefault();
        switchToPrevDesktop();
      } 
      // Next Desktop
      else if (isShortcutMatch(shortcuts.nextDesktop, e)) {
        e.preventDefault();
        switchToNextDesktop();
      }
      // Minimize All
      else if (isShortcutMatch(shortcuts.minimizeAll, e)) {
        e.preventDefault();
        minimizeAll();
      }
      // Close All
      else if (isShortcutMatch(shortcuts.closeAll, e)) {
        e.preventDefault();
        // Implement close all if needed, or for now just prevent default
        // dispatch({ type: 'CLOSE_ALL_WINDOWS' });
      }
    };

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [state.currentDesktopId, state.desktops, state.keyboardShortcuts]);

  return (
    <OSContext.Provider value={{ 
      state, 
      openWindow, 
      closeWindow, 
      focusWindow, 
      toggleMinimize, 
      toggleMaximize,
      snapWindow, 
      setGlassmorphism, 
      setIconSize, 
      setIconStyle,
      setBrightness,
      setUiScale,
      setNotifications,
      saveSettings,
      addCustomWallpaper,
      removeCustomWallpaper,
      setSortBy, 
      setWallpaper, 
      updateIconPosition, 
      setLanguage, 
      setSelectedIcons, 
      updateMultipleIconPositions,
      updateWindowPosition,
      minimizeAll,
      restoreAll,
      setExportNaming,
      setAiHistory,
      setSshAiHistory,
      setSshAiPrefs,
      setDeferredPrompt,
      addNotification,
      removeNotification,
      updateNotification,
      showAlert,
      showModal,
      showConfirm,
      showPrompt,
      closeModal,
      // Virtual desktops
      switchDesktop,
      switchToNextDesktop,
      switchToPrevDesktop,
      addDesktop,
      renameDesktop,
      removeDesktop,
      reorderDesktops,
      moveWindowToDesktop,
      setKeyboardShortcuts,
      setTaskbarPosition,
      setWindowLayout,
      setTheme,
      setTerminalSettings: (settings) => dispatch({ type: 'SET_TERMINAL_SETTINGS', payload: settings }),
      dispatch,
    }}>
      {children}
    </OSContext.Provider>
  );
}

export const useOS = () => useContext(OSContext);
