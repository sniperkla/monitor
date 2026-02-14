'use client';

import { createContext, useContext, useReducer, useEffect, useState, useRef } from 'react';
import { useSession } from 'next-auth/react';
import i18n from '@/lib/i18n';
import { AppRegistry } from '@/apps/AppRegistry';

const OSContext = createContext();

const initialState = {
  windows: [], // Array of open windows { id, title, component, isMinimized, isMaximized, zIndex }
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
  customWallpapers: [], // Array of URL strings
  taskbarPosition: 'bottom', // top, bottom, left, right
  selectedIconIds: [], // IDs of currently selected icons
  windows: [], // Array of open windows { id, title, component, isMinimized, isMaximized, zIndex, x, y, width, height, appType, props }
  timestamp: 0, // Last modified timestamp for conflict resolution
};

function osReducer(state, action) {
  switch (action.type) {
    case 'OPEN_WINDOW': {
      // Check if window with same ID already exists (e.g. settings)
      const existing = state.windows.find(w => w.id === action.payload.id);
      if (existing) {
        return {
          ...state,
          activeWindowId: existing.id,
          windows: state.windows.map(w =>
            w.id === existing.id ? { ...w, isMinimized: false, zIndex: state.nextZIndex } : w
          ),
          nextZIndex: state.nextZIndex + 1,
        };
      }
      const cascadeOffset = (state.windows.length % 10) * 30;
      const defaultX = 100 + cascadeOffset;
      const defaultY = 40 + cascadeOffset;

      return {
        ...state,
        windows: [
          ...state.windows, 
          { 
            ...action.payload, 
            x: action.payload.x ?? defaultX, 
            y: action.payload.y ?? defaultY,
            width: action.payload.width ?? 800,
            height: action.payload.height ?? 600,
            isMinimized: false, 
            isMaximized: false, 
            zIndex: state.nextZIndex 
          }
        ],
        activeWindowId: action.payload.id,
        nextZIndex: state.nextZIndex + 1,
      };
    }
    case 'CLOSE_WINDOW':
      return {
        ...state,
        windows: state.windows.filter(w => w.id !== action.payload),
        activeWindowId: state.activeWindowId === action.payload ? null : state.activeWindowId,
      };
    case 'MINIMIZE_WINDOW':
      return {
        ...state,
        windows: state.windows.map(w =>
          w.id === action.payload ? { ...w, isMinimized: true } : w
        ),
        activeWindowId: null,
      };
    case 'MINIMIZE_ALL':
      return {
        ...state,
        windows: state.windows.map(w => ({ ...w, isMinimized: true })),
        activeWindowId: null,
      };
    case 'RESTORE_ALL':
      return {
        ...state,
        windows: state.windows.map(w => ({ ...w, isMinimized: false })),
        activeWindowId: state.windows.length > 0 ? state.windows[state.windows.length - 1].id : null,
      };
    case 'MAXIMIZE_WINDOW':
      return {
        ...state,
        windows: state.windows.map(w =>
          w.id === action.payload ? { ...w, isMaximized: !w.isMaximized, snapSide: null } : w
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
      };
    case 'FOCUS_WINDOW':
      return {
        ...state,
        activeWindowId: action.payload,
        windows: state.windows.map(w =>
          w.id === action.payload ? { ...w, zIndex: state.nextZIndex, isMinimized: false } : w
        ),
        nextZIndex: state.nextZIndex + 1,
      };
    case 'SET_WALLPAPER':
      return {
        ...state,
        wallpaper: action.payload,
      };
    case 'ADD_CUSTOM_WALLPAPER': {
      const current = state.customWallpapers || [];
      if (current.includes(action.payload)) return state;
      return {
        ...state,
        customWallpapers: [...current, action.payload],
      };
    }
    case 'REMOVE_CUSTOM_WALLPAPER': {
      const current = state.customWallpapers || [];
      return {
        ...state,
        customWallpapers: current.filter(w => w !== action.payload),
      };
    }
    case 'TOGGLE_GLASS':
      return {
        ...state,
        glassmorphism: action.payload,
      };
    case 'UPDATE_ICON_POSITIONS':
      return {
        ...state,
        iconPositions: { ...state.iconPositions, ...action.payload },
      };
    case 'SET_ICON_SIZE':
      return { ...state, iconSize: action.payload };
    case 'SET_ICON_STYLE':
      return { ...state, iconStyle: action.payload };
    case 'SET_SORT_BY':
      return { ...state, sortBy: action.payload };
    case 'SET_BRIGHTNESS':
      return { ...state, brightness: action.payload };
    case 'SET_UI_SCALE':
      return { ...state, uiScale: action.payload };
    case 'SET_NOTIFICATIONS':
      return { ...state, notifications: { ...state.notifications, ...action.payload } };
    case 'SET_LANGUAGE':
      return { ...state, language: action.payload };
    case 'SET_TASKBAR_POSITION':
      return { ...state, taskbarPosition: action.payload };
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
    case 'UPDATE_WINDOW_POSITION':
      return {
        ...state,
        windows: state.windows.map(w =>
          w.id === action.payload.id 
            ? { ...w, ...action.payload.position } 
            : w
        ),
      };
    case 'SET_INITIAL_STATE':
      // Hydrate windows if they exist in payload
      let hydratedWindows = state.windows;
      if (action.payload.openWindows && Array.isArray(action.payload.openWindows)) {
        hydratedWindows = action.payload.openWindows.map(w => {
          let Component = null;
          let Icon = null;
          
          // 1. Try to find by explicit appType
          if (w.appType && AppRegistry[w.appType]) {
            Component = AppRegistry[w.appType].component;
            Icon = AppRegistry[w.appType].icon;
          } 
          // 2. Try to find by ID (legacy/simple apps)
          else if (AppRegistry[w.id]) {
             Component = AppRegistry[w.id].component;
             Icon = AppRegistry[w.id].icon;
          }
          // 3. Special case for Standalone Terminal
          else if (w.id.startsWith('term-') || w.id.startsWith('standalone-term-')) {
             Component = AppRegistry['terminal'].component;
             Icon = AppRegistry['terminal'].icon;
          }

          if (Component) {
            return {
              ...w,
              component: <Component {...(w.props || {})} />,
              icon: Icon,
              // Ensure we have Component instance, but we can't save it to DB.
              // So on hydrate we recreate it.
            };
          }
          return null;
        }).filter(Boolean);
      }

      return {
        ...state,
        ...action.payload,
        windows: hydratedWindows.length > 0 ? hydratedWindows : state.windows
      };
    default:
      return state;
  }
}

export function OSProvider({ children }) {
  const [state, dispatch] = useReducer(osReducer, initialState);

  const { data: session } = useSession();
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // 1. Initial Load from LocalStorage (for fast boot/guests)
  useEffect(() => {
    const saved = localStorage.getItem('webtop_os_state');
    if (saved && isInitialLoad) {
      try {
        const parsed = JSON.parse(saved);
        dispatch({ type: 'SET_INITIAL_STATE', payload: {
          wallpaper: parsed.wallpaper || initialState.wallpaper,
          glassmorphism: parsed.glassmorphism !== undefined ? parsed.glassmorphism : initialState.glassmorphism,
          iconPositions: parsed.iconPositions || initialState.iconPositions,
          iconSize: parsed.iconSize || initialState.iconSize,
          iconStyle: parsed.iconStyle || initialState.iconStyle,
          sortBy: parsed.sortBy || initialState.sortBy,
          brightness: parsed.brightness !== undefined ? parsed.brightness : initialState.brightness,
          uiScale: parsed.uiScale || initialState.uiScale,
          notifications: parsed.notifications || initialState.notifications,
          language: parsed.language || initialState.language,
          customWallpapers: parsed.customWallpapers || initialState.customWallpapers,
          taskbarPosition: parsed.taskbarPosition || initialState.taskbarPosition,
          openWindows: parsed.openWindows || [],
          timestamp: parsed.timestamp || 0,
        }});
      } catch (e) {
        console.error('Failed to load OS state', e);
      }
    }
  }, []);

  // 2. Fetch from DB if logged in
  useEffect(() => {
    if (session) {
      const fetchSettings = async () => {
        try {
          const res = await fetch('/api/user/settings');
          const data = await res.json();
          if (data.success && data.settings) {
            // Timestamp collision detection
            const localTimestamp = stateRef.current.timestamp || 0;
            const dbTimestamp = data.settings.timestamp || 0;

            console.log(`State Sync - Local: ${localTimestamp}, DB: ${dbTimestamp}`);

            if (dbTimestamp > localTimestamp) {
              console.log('DB is newer, hydrating from DB');
              dispatch({ type: 'SET_INITIAL_STATE', payload: data.settings });
            } else if (localTimestamp > dbTimestamp) {
              console.log('Local is newer, pushing local state to DB');
              // Don't hydrate, but ensure DB gets updated eventually
              // Trigger a save immediately to correct the DB
              await saveSettings();
            } else {
              // Same timestamp, prefer DB or do nothing.
              // If we have no local state (fresh login), typically localTimestamp is 0 (unless localStorage loaded).
              // If localStorage loaded, we have valid timestamp.
              // If equal, assume synced.
              if (!isInitialLoad && (!stateRef.current.windows || stateRef.current.windows.length === 0)) {
                 // If local is empty but DB has data (and timestamps match/missing), load DB
                 dispatch({ type: 'SET_INITIAL_STATE', payload: data.settings });
              }
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
      setIsInitialLoad(false);
    }
  }, [session]);

  // 3. Persist to LocalStorage
  useEffect(() => {
    localStorage.setItem('webtop_os_state', JSON.stringify({
      wallpaper: state.wallpaper,
      glassmorphism: state.glassmorphism,
      iconPositions: state.iconPositions,
      iconSize: state.iconSize,
      iconStyle: state.iconStyle,
      sortBy: state.sortBy,
      brightness: state.brightness,
      uiScale: state.uiScale,
      notifications: state.notifications,
      language: state.language,
      customWallpapers: state.customWallpapers,
      taskbarPosition: state.taskbarPosition,
      openWindows: state.windows.map(w => ({
        id: w.id,
        title: w.title,
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height,
        isMaximized: w.isMaximized,
        isMinimized: w.isMinimized,
        snapSide: w.snapSide,
        zIndex: w.zIndex,
        appType: w.appType,
        props: w.props
      })),
      timestamp: Date.now(),
    }));
  }, [
    state.wallpaper, 
    state.glassmorphism, 
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
    state.windows // Add windows dependency
  ]);

  // 3b. Ref to hold latest state synchronously
  const stateRef = useRef(state);
  stateRef.current = state; // Update on every render to ensure freshness

  // Save on tab close or visibility hidden
  useEffect(() => {
    const saveOnUnload = () => {
      if (!session) return;
      
      const currentState = stateRef.current;
      
      // Safety: Don't wipe DB if initial load pending and no windows
      if (isInitialLoad && currentState.windows.length === 0) return;

      const payload = JSON.stringify({
        wallpaper: currentState.wallpaper,
        glassmorphism: currentState.glassmorphism,
        iconPositions: currentState.iconPositions,
        iconSize: currentState.iconSize,
        iconStyle: currentState.iconStyle,
        sortBy: currentState.sortBy,
        brightness: currentState.brightness,
        uiScale: currentState.uiScale,
        notifications: currentState.notifications,
        language: currentState.language,
        customWallpapers: currentState.customWallpapers,
        taskbarPosition: currentState.taskbarPosition,
        openWindows: currentState.windows.map(w => ({
          id: w.id,
          title: w.title,
          x: w.x,
          y: w.y,
          width: w.width,
          height: w.height,
          isMaximized: w.isMaximized,
          isMinimized: w.isMinimized,
          snapSide: w.snapSide,
          zIndex: w.zIndex,
          appType: w.appType,
          props: w.props
        })),
        timestamp: Date.now(),
      });

      // Use sendBeacon for reliable delivery on unload
      const blob = new Blob([payload], { type: 'application/json' });
      const success = navigator.sendBeacon('/api/user/settings', blob);

      if (!success) {
        // Fallback
        fetch('/api/user/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(err => console.error('Save on unload failed', err));
      }
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
  }, [session, isInitialLoad]);

  // 4. Sync to DB if logged in (Debounced)
  useEffect(() => {
    if (session && !isInitialLoad) {
      const timer = setTimeout(async () => {
        try {
          await fetch('/api/user/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              wallpaper: state.wallpaper,
              glassmorphism: state.glassmorphism,
              iconPositions: state.iconPositions,
              iconSize: state.iconSize,
              iconStyle: state.iconStyle,
              sortBy: state.sortBy,
              brightness: state.brightness,
              uiScale: state.uiScale,
              notifications: state.notifications,
              language: state.language,
              customWallpapers: state.customWallpapers,
              taskbarPosition: state.taskbarPosition,
              openWindows: state.windows.map(w => ({
                id: w.id,
                title: w.title,
                x: w.x,
                y: w.y,
                width: w.width,
                height: w.height,
                isMaximized: w.isMaximized,
                isMinimized: w.isMinimized,
                snapSide: w.snapSide, // Persist snap state (left/right/top)
                zIndex: w.zIndex,
                appType: w.appType,
                props: w.props
              })),
              timestamp: Date.now(),
            })
          });
        } catch (error) {
          console.error('Failed to sync settings to DB', error);
        }
      }, 500); // 500ms debounce
      
      return () => clearTimeout(timer);
    }
  }, [
    session, 
    state.wallpaper, 
    state.glassmorphism, 
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
    state.windows, // Add windows dependency
    isInitialLoad
  ]);

  const saveSettings = async () => {
    if (!session) return;
    try {
      await fetch('/api/user/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallpaper: state.wallpaper,
          glassmorphism: state.glassmorphism,
          iconPositions: state.iconPositions,
          iconSize: state.iconSize,
          iconStyle: state.iconStyle,
          sortBy: state.sortBy,
          brightness: state.brightness,
          uiScale: state.uiScale,
          notifications: state.notifications,
          language: state.language,
          customWallpapers: state.customWallpapers,
          taskbarPosition: state.taskbarPosition,
          openWindows: state.windows.map(w => ({
            id: w.id,
            title: w.title,
            x: w.x,
            y: w.y,
            width: w.width,
            height: w.height,
            isMaximized: w.isMaximized,
            isMinimized: w.isMinimized,
            snapSide: w.snapSide,
            zIndex: w.zIndex,
            appType: w.appType,
            props: w.props
          })),
          timestamp: Date.now(),
        })
      });
      console.log('Settings saved manually');
    } catch (error) {
      console.error('Failed to save settings manually', error);
    }
  };

  // 5. Sync i18n with state language
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

  const setSortBy = (sort) => {
    dispatch({ type: 'SET_SORT_BY', payload: sort });
  };

  const updateWindowPosition = (id, position) => {
    dispatch({ type: 'UPDATE_WINDOW_POSITION', payload: { id, position } });
  };

  return (
    <OSContext.Provider value={{ 
      state, 
      openWindow, 
      closeWindow, 
      focusWindow, 
      toggleMinimize, 
      toggleMaximize,
      snapWindow, 
      setWallpaper, 
      setGlassmorphism,
      updateIconPosition,
      setIconSize,
      setIconStyle: (s) => dispatch({ type: 'SET_ICON_STYLE', payload: s }),
      setSortBy,
      setBrightness: (v) => dispatch({ type: 'SET_BRIGHTNESS', payload: v }),
      setUiScale: (v) => dispatch({ type: 'SET_UI_SCALE', payload: v }),
      setNotifications: (v) => dispatch({ type: 'SET_NOTIFICATIONS', payload: v }),
      setLanguage: (l) => dispatch({ type: 'SET_LANGUAGE', payload: l }),
      addCustomWallpaper: (url) => dispatch({ type: 'ADD_CUSTOM_WALLPAPER', payload: url }),
      removeCustomWallpaper: (url) => dispatch({ type: 'REMOVE_CUSTOM_WALLPAPER', payload: url }),
      minimizeAll: () => dispatch({ type: 'MINIMIZE_ALL' }),
      restoreAll: () => dispatch({ type: 'RESTORE_ALL' }),
      setTaskbarPosition: (pos) => dispatch({ type: 'SET_TASKBAR_POSITION', payload: pos }),
      setSelectedIcons: (ids) => dispatch({ type: 'SET_SELECTED_ICONS', payload: ids }),
      toggleIconSelection: (id) => dispatch({ type: 'TOGGLE_ICON_SELECTION', payload: id }),
      moveSelectedIcons: (deltaX, deltaY, basePositions) => dispatch({ type: 'MOVE_SELECTED_ICONS', payload: { deltaX, deltaY, basePositions } }),
      updateMultipleIconPositions: (positions) => dispatch({ type: 'UPDATE_ICON_POSITIONS', payload: positions }),
      updateWindowPosition,
      saveSettings,
    }}>
      {children}
    </OSContext.Provider>
  );
}

export const useOS = () => useContext(OSContext);
