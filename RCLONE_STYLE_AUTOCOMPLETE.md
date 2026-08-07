# Rclone-Style Autocomplete Implementation

## Overview

Updated folder autocomplete in **Sync Jobs** and **Restore Backup** tabs to match the Rclone app's autocomplete style and functionality.

---

## ✨ New Features (Rclone Style)

### 1. **Tab Key Completion** ⇥
- Press **Tab** to select the highlighted folder
- Works in addition to Enter key
- Matches standard terminal/IDE autocomplete behavior

### 2. **Auto-Select First Item**
- First item automatically highlighted when dropdown opens
- No need to press ↓ arrow first
- Immediate keyboard selection available

### 3. **Circular Navigation** 🔄
- **Arrow Down** at bottom → Wraps to top
- **Arrow Up** at top → Wraps to bottom
- Smooth navigation through long lists

### 4. **Visual Header with Hints**
```
┌─────────────────────────────────────────────┐
│ Folders (5)       Press Tab ⇥ or ↵          │ ← Header
├─────────────────────────────────────────────┤
│ 📁 backup-2026 ✨ (highlighted)             │
│ 📁 production-db                            │
└─────────────────────────────────────────────┘
```

### 5. **Folder Icons** 📁
- Amber folder icon for all folders
- Visual consistency with file browsers
- Easy to distinguish folder entries

### 6. **Mouse Hover Updates Selection**
- Hovering over item updates keyboard selection
- Seamless mouse + keyboard workflow
- Click or press Enter/Tab to confirm

### 7. **Higher Z-Index**
- `z-index: 10000` ensures dropdown is always on top
- No overlap with modals or other elements

---

## Keyboard Shortcuts Comparison

| Key | Old Behavior | New Behavior (Rclone Style) |
|-----|-------------|------------------------------|
| **Tab** | Close dropdown (blur) | ✅ Select highlighted item |
| **↓ (closed)** | Nothing | ✅ Open dropdown + select first |
| **↓ (at bottom)** | Stay at bottom | ✅ Wrap to top |
| **↑ (at top)** | Go to -1 (no selection) | ✅ Wrap to bottom |
| **Enter** | Select (if item selected) | ✅ Select highlighted item |
| **Escape** | Close dropdown | ✅ Close dropdown |
| **Type** | Filter + reset to -1 | ✅ Filter + auto-select first |

---

## Visual Design (Rclone Style)

### Header Section
```jsx
<div className="px-3 py-1 bg-[var(--bg-tertiary)] flex items-center justify-between text-[10px] text-[var(--text-muted)] font-mono">
  <span>Folders (5)</span>
  <span className="text-emerald-400 font-semibold">
    Press <kbd>Tab ⇥</kbd> or <kbd>↵</kbd>
  </span>
</div>
```

**Features:**
- Shows folder count
- Keyboard hint with styled `<kbd>` tags
- Emerald accent color
- Monospace font

### Folder Items
```jsx
<div className="px-3 py-2 flex items-center gap-2">
  <Folder size={13} className="text-amber-400 shrink-0" />
  <div className="flex-1 min-w-0">
    <div className="font-semibold truncate">{folder.name}</div>
    <div className="text-[9px] text-[var(--text-muted)] truncate">{folder.id}</div>
  </div>
</div>
```

**Features:**
- Amber folder icon (📁)
- Two-line layout: name + ID
- Truncation for long names
- Proper text overflow handling

### Selected Item Style
```css
bg-emerald-500/15 text-emerald-400 font-bold
```
- Emerald highlight (matches theme)
- Bold text for clarity
- 15% opacity background

### Hover Style
```css
hover:bg-[var(--bg-tertiary)]
```
- Subtle background change
- Works with keyboard selection

---

## Implementation Details

### Auto-Select First Item Logic

```javascript
const handleJobFolderInputChange = (value) => {
  setJobFolderName(value);
  setJobFolderInputActive(true);
  const filtered = driveFolders.filter(f => 
    f.name.toLowerCase().includes(value.toLowerCase())
  );
  setFilteredDriveFolderOptions(filtered.length > 0 ? filtered : driveFolders);
  setJobFolderSelectedIndex(filtered.length > 0 ? 0 : -1); // ✅ Auto-select first
  // ...
};
```

### Circular Navigation Logic

```javascript
// Arrow Down - wrap to top
if (e.key === 'ArrowDown') {
  e.preventDefault();
  setJobFolderSelectedIndex(prev => 
    prev < filteredDriveFolderOptions.length - 1 ? prev + 1 : 0 // ✅ Wrap
  );
}

// Arrow Up - wrap to bottom
else if (e.key === 'ArrowUp') {
  e.preventDefault();
  setJobFolderSelectedIndex(prev => 
    prev > 0 ? prev - 1 : filteredDriveFolderOptions.length - 1 // ✅ Wrap
  );
}
```

### Tab Key Selection

```javascript
if (e.key === 'Tab') {
  e.preventDefault(); // ✅ Prevent default blur
  const idxToUse = jobFolderSelectedIndex >= 0 ? jobFolderSelectedIndex : 0;
  if (filteredDriveFolderOptions[idxToUse]) {
    handleSelectJobFolder(filteredDriveFolderOptions[idxToUse]);
  }
}
```

### Open Dropdown on Tab/Arrow (When Closed)

```javascript
if (!jobFolderInputActive || filteredDriveFolderOptions.length === 0) {
  // ✅ Open dropdown on ArrowDown or Tab when closed
  if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
    e.preventDefault();
    setJobFolderInputActive(true);
    const filtered = driveFolders.filter(f => 
      f.name.toLowerCase().includes(jobFolderName.toLowerCase())
    );
    setFilteredDriveFolderOptions(filtered.length > 0 ? filtered : driveFolders);
    setJobFolderSelectedIndex(filtered.length > 0 ? 0 : -1);
  }
  return;
}
```

### Mouse Hover Updates Selection

```javascript
<div
  key={folder.id}
  onClick={() => handleSelectJobFolder(folder)}
  onMouseEnter={() => setJobFolderSelectedIndex(idx)} // ✅ Update on hover
  className={...}
>
```

---

## User Experience Flow

### Scenario 1: Tab Completion (Rclone Style)
```
1. User clicks input
   ↓ Dropdown opens, first item highlighted
   
2. User presses Tab
   ✅ First item selected, dropdown closes
   
Result: 2 keystrokes (click + Tab)
```

### Scenario 2: Arrow + Tab
```
1. User types "prod"
   ↓ Filters to production folders, first highlighted
   
2. User presses ↓ twice
   ↓ Third item now highlighted
   
3. User presses Tab
   ✅ Third item selected
   
Result: Fast keyboard-only workflow
```

### Scenario 3: Circular Navigation
```
1. Dropdown shows 5 folders
   
2. User presses ↓ repeatedly
   → Item 1, 2, 3, 4, 5, 1, 2... (wraps)
   
3. User presses ↑ from item 1
   → Jumps to item 5 (wraps backward)
   
Result: Never stuck at top/bottom
```

### Scenario 4: Mouse + Keyboard Hybrid
```
1. User types "backup"
   ↓ Filters, first item highlighted
   
2. User hovers mouse over third item
   ↓ Third item now highlighted
   
3. User presses Tab
   ✅ Third item selected (follows keyboard selection)
   
Result: Best of both input methods
```

---

## Comparison: Old vs New (Rclone Style)

### Old Behavior
```
Type → No item selected
↓ → Select first
↓↓ → Select third
Enter → Confirm
```
**4 keystrokes needed**

### New Behavior (Rclone Style)
```
Type → First item auto-selected
Tab → Confirm
```
**2 keystrokes needed** ⚡

---

## Differences from Rclone PathInputWithAutocomplete

### Same Features ✅
- Tab key completion
- Circular navigation (wrap around)
- Auto-select first item
- Mouse hover updates selection
- Keyboard hints in header
- High z-index (10000)
- Folder icons
- onMouseEnter for hover selection

### Different Features
| Feature | Rclone | MongoBackup |
|---------|--------|-------------|
| **Purpose** | File/directory paths | Folder selection |
| **Icons** | Folder/File icons | Folder icons only |
| **Path parsing** | Complex (remote:path) | Simple (folder names) |
| **API calls** | Browse filesystem | List Drive folders |
| **Debouncing** | 150ms debounce | Instant filter |
| **Caching** | Client-side cache | No cache (loads once) |
| **Loading state** | Spinner in input | No loader (fast) |

### Styling Differences
| Element | Rclone | MongoBackup |
|---------|--------|-------------|
| **Accent color** | Indigo or Emerald | Emerald only |
| **Selected bg** | `${color}-500/15` | `emerald-500/15` |
| **Folder icon** | Amber (same) | Amber (same) |
| **Header font** | Mono (same) | Mono (same) |
| **kbd style** | Black/40 border | Black/40 border (same) |

---

## Benefits

### For Power Users ⚡
- **Tab completion** feels natural (like terminal)
- **Auto-select** means immediate action
- **Circular nav** prevents dead ends
- **Fast keyboard-only workflow**

### For Mouse Users 🖱️
- **Hover to select** still works
- **Click to confirm** still works
- **Visual hints** show keyboard shortcuts
- **Folder icons** aid visual scanning

### For All Users 😊
- **Consistent UX** across Sync & Restore tabs
- **Matches Rclone** app behavior
- **Clear visual feedback** (header, icons, highlighting)
- **No learning curve** for Rclone users

---

## Testing Checklist

### Tab Key
- [ ] Tab selects highlighted item
- [ ] Tab works when dropdown is closed (opens + selects first)
- [ ] Shift+Tab moves focus to previous field (not intercepted)

### Circular Navigation
- [ ] Arrow Down at bottom wraps to top
- [ ] Arrow Up at top wraps to bottom
- [ ] Works with filtered results
- [ ] Works with full list

### Auto-Select
- [ ] First item highlighted on open
- [ ] First item highlighted after typing
- [ ] First item highlighted after Arrow Down (when closed)
- [ ] Selection visible (emerald highlight)

### Visual Elements
- [ ] Header shows folder count
- [ ] Header shows keyboard hints
- [ ] Folder icons display (amber)
- [ ] Selected item bold + highlighted
- [ ] Hover updates selection
- [ ] Dropdown on top of all elements (z-index)

### Both Tabs
- [ ] Sync Jobs folder input works
- [ ] Restore Backup folder input works
- [ ] Same behavior in both tabs
- [ ] Consistent styling

---

## Files Modified

### `src/apps/MongoBackupApp.js`

**Handler Functions (lines ~1506-1605):**
- Updated `handleJobFolderInputChange` - auto-select first
- Updated `handleJobFolderKeyDown` - Tab key + circular navigation
- Updated `handleRestoreFolderInputChange` - auto-select first
- Updated `handleRestoreFolderKeyDown` - Tab key + circular navigation

**UI Components:**
- Updated Job folder dropdown (~line 2900) - Rclone style
- Updated Restore folder dropdown (~line 3170) - Rclone style

**Changes:**
- Added header with count + keyboard hints
- Added folder icons (Folder component)
- Changed onMouseDown → onClick + onMouseEnter
- Updated z-index to 10000
- Changed button → div for items
- Added divide-y for separators

---

## Summary

✅ **Tab key completion** - Select with Tab key (Rclone style)  
✅ **Auto-select first** - Immediate keyboard access  
✅ **Circular navigation** - Wrap around top/bottom  
✅ **Visual header** - Shows count + keyboard hints  
✅ **Folder icons** - Amber folder icons  
✅ **Hover selection** - Mouse hover updates keyboard selection  
✅ **High z-index** - Always on top  
✅ **Both tabs updated** - Sync Jobs + Restore Backup  

**User benefit:** Faster, more intuitive folder selection matching Rclone's proven UX pattern.

---

**Status:** ✅ Complete  
**Style:** Matches Rclone PathInputWithAutocomplete  
**Keyboard shortcuts:** Tab ⇥, ↓, ↑, Enter, Escape  
**Date:** 2026-08-06
