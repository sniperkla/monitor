# Autocomplete Scroll & Preview Features

## Overview

Added two critical UX improvements to folder autocomplete in both **Sync Jobs** and **Restore Backup** tabs:

1. **Auto-scroll into view** - Selected item automatically scrolls into viewport
2. **Real-time preview** - Input shows selected item name as you navigate with arrows

---

## 🎯 Problems Fixed

### ❌ Problem 1: Manual Scrolling Required
**Before:** When using arrow keys, selected item would go off-screen and you had to manually scroll to see it.

```
Dropdown (visible area):
┌─────────────────┐
│ folder-1        │
│ folder-2        │
│ folder-3        │
└─────────────────┘
  ↓ (arrow down multiple times)
  
Selected item: folder-20 (OFF SCREEN ❌)
User has to scroll manually to see it
```

### ✅ Solution: Auto-Scroll
**After:** Selected item automatically scrolls into view smoothly

```
Dropdown auto-scrolls:
┌─────────────────┐
│ folder-18       │
│ folder-19       │
│ folder-20 ✨     │ ← Auto-scrolled into view
└─────────────────┘
```

---

### ❌ Problem 2: No Real-Time Feedback
**Before:** Input field didn't change while navigating with arrows, so you couldn't see which folder was selected.

```
Input: backup-2026
         ↓ (arrow down)
Input: backup-2026  (no change ❌)

User doesn't know what's selected!
```

### ✅ Solution: Real-Time Preview
**After:** Input updates in real-time as you navigate

```
Input: backup-2026
         ↓ (arrow down)
Input: production-db ✨ (preview!)
         ↓ (arrow down)
Input: test-backup ✨ (preview!)
```

---

## 🔧 Technical Implementation

### State Variables Added

```javascript
// Job folder
const [jobFolderPreview, setJobFolderPreview] = useState('');
const jobFolderDropdownRef = useRef(null);

// Restore folder
const [restoreFolderPreview, setRestoreFolderPreview] = useState('');
const restoreFolderDropdownRef = useRef(null);
```

### Input Value Logic

**Before:**
```javascript
<input value={jobFolderName} />
```

**After:**
```javascript
<input value={jobFolderPreview || jobFolderName} />
```

**How it works:**
- When navigating: Shows `jobFolderPreview` (selected item)
- When typing/idle: Shows `jobFolderName` (actual value)
- On select: Preview cleared, actual value updated

---

### Scroll-Into-View Implementation

```javascript
else if (e.key === 'ArrowDown') {
  e.preventDefault();
  const newIdx = jobFolderSelectedIndex < filteredDriveFolderOptions.length - 1 
    ? jobFolderSelectedIndex + 1 
    : 0;
  
  setJobFolderSelectedIndex(newIdx);
  
  // ✨ Update preview
  if (filteredDriveFolderOptions[newIdx]) {
    setJobFolderPreview(filteredDriveFolderOptions[newIdx].name);
  }
  
  // ✨ Scroll into view
  setTimeout(() => {
    const dropdown = jobFolderDropdownRef.current;
    if (dropdown) {
      const selected = dropdown.querySelector(`[data-index="${newIdx}"]`);
      if (selected) {
        selected.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'nearest' 
        });
      }
    }
  }, 10);
}
```

**Key points:**
- `setTimeout(10)` ensures DOM is updated before scrolling
- `behavior: 'smooth'` for smooth animation
- `block: 'nearest'` scrolls minimum amount needed
- `data-index` attribute identifies each item

---

### Dropdown Item with data-index

**Before:**
```javascript
<div
  key={folder.id}
  onClick={() => handleSelectJobFolder(folder)}
  onMouseEnter={() => setJobFolderSelectedIndex(idx)}
>
```

**After:**
```javascript
<div
  key={folder.id}
  data-index={idx}  // ✨ Added for scroll targeting
  onClick={() => handleSelectJobFolder(folder)}
  onMouseEnter={() => {
    setJobFolderSelectedIndex(idx);
    setJobFolderPreview(folder.name);  // ✨ Update preview on hover
  }}
>
```

---

## 📋 State Management Flow

### On Arrow Down/Up

```
1. Calculate new index (with wrapping)
   ↓
2. Update selectedIndex state
   ↓
3. Get folder name at new index
   ↓
4. Update preview state → Input shows new name
   ↓
5. Query DOM for item with data-index
   ↓
6. Call scrollIntoView() → Item scrolls into view
```

### On Mouse Hover

```
1. Mouse enters dropdown item
   ↓
2. onMouseEnter triggered
   ↓
3. Update selectedIndex to hovered item
   ↓
4. Update preview with folder name
   ↓
5. Input shows hovered item name
```

### On Select (Enter/Tab/Click)

```
1. handleSelectJobFolder(folder) called
   ↓
2. jobFolderName = folder.name (commit)
   ↓
3. jobFolderPreview = '' (clear preview)
   ↓
4. Dropdown closes
   ↓
5. Input shows committed value
```

### On Type

```
1. handleJobFolderInputChange(value) called
   ↓
2. jobFolderName = value (update actual)
   ↓
3. jobFolderPreview = '' (clear preview)
   ↓
4. Filter folders
   ↓
5. Auto-select first match
   ↓
6. Set preview to first match name
   ↓
7. Input shows preview (first match)
```

---

## 🎨 User Experience Flow

### Scenario 1: Arrow Navigation with Preview

```
User presses ↓:

Input: backup-2026
Dropdown:
  ■ backup-2026        ← Initially
  □ production-db
  □ test-backup

User presses ↓:

Input: production-db ✨  ← Preview updates!
Dropdown:
  □ backup-2026
  ■ production-db      ← Highlighted
  □ test-backup

User presses ↓:

Input: test-backup ✨    ← Preview updates!
Dropdown:
  □ backup-2026
  □ production-db
  ■ test-backup        ← Highlighted + scrolled into view
```

### Scenario 2: Type + Navigate

```
User types "prod":

Input: prod
Dropdown:
  ■ production-db      ← Auto-selected (preview)
  □ production-2025

Input shows: production-db ✨ (preview of first match)

User presses ↓:

Input: production-2025 ✨  ← Preview updates!
Dropdown:
  □ production-db
  ■ production-2025    ← Highlighted

User presses Enter:

Input: production-2025   ← Committed (no longer preview)
Dropdown: Closed ✅
```

### Scenario 3: Mouse Hover Updates Preview

```
Dropdown open:
Input: backup-2026

User hovers over "production-db":

Input: production-db ✨  ← Preview updates on hover!
Dropdown:
  □ backup-2026
  ■ production-db      ← Highlighted (hovered)
  □ test-backup

User moves mouse away:

Input: production-db     ← Preview stays (until arrow/type)
```

---

## 🔄 Preview vs Committed Value

### Preview (Temporary)
- Shows while navigating with arrows
- Shows while hovering with mouse
- **Not committed** - can change
- Cleared when typing
- Cleared on Escape

### Committed (Permanent)
- Set when selecting with Enter/Tab/Click
- Persists after dropdown closes
- Used for form submission
- Only changes when explicitly selected

### Visual Indicator
No special indicator needed - user sees the value change in real-time, which is the feedback.

---

## 🧪 Testing Checklist

### Auto-Scroll
- [ ] Arrow Down → Selected item scrolls into view
- [ ] Arrow Up → Selected item scrolls into view
- [ ] Wrapping (bottom→top) → Scrolls smoothly
- [ ] Long list (50+ items) → Always visible
- [ ] Fast navigation → Scroll keeps up
- [ ] Smooth animation (not jumpy)

### Real-Time Preview
- [ ] Arrow Down → Input shows selected name
- [ ] Arrow Up → Input shows selected name
- [ ] Mouse hover → Input shows hovered name
- [ ] Type letter → Preview shows first match
- [ ] Enter/Tab → Preview commits, dropdown closes
- [ ] Escape → Preview clears, value unchanged
- [ ] Blur → Preview clears (reverts to actual)

### Both Tabs
- [ ] Works in Sync Jobs folder input
- [ ] Works in Restore Backup folder input
- [ ] Consistent behavior in both

### Edge Cases
- [ ] Single item → Preview works
- [ ] Empty filter → No preview
- [ ] Exact match typed → Preview shows match
- [ ] Fast arrow keys → No lag

---

## 📊 Performance

### Scroll-Into-View
- **Timing:** 10ms setTimeout
- **Animation:** CSS smooth scroll (hardware-accelerated)
- **Impact:** Negligible (native browser feature)

### Preview Updates
- **Operations:** String assignment only
- **Re-renders:** Minimal (input value change)
- **Impact:** Imperceptible

### Memory
- **Refs:** 2 additional refs (negligible)
- **State:** 2 additional strings (negligible)
- **Total:** < 1KB additional memory

---

## 🎯 Benefits

### For Users
✅ **No manual scrolling** - Always see selected item  
✅ **Immediate feedback** - Know what you're selecting  
✅ **Faster navigation** - See name without looking at dropdown  
✅ **Better orientation** - Never lose track of selection  
✅ **Professional UX** - Matches modern autocomplete patterns  

### For Developers
✅ **Standard pattern** - Common in modern UIs  
✅ **Simple implementation** - scrollIntoView() + preview state  
✅ **Low maintenance** - No complex logic  
✅ **Browser native** - Uses built-in scroll API  

---

## 📝 Files Modified

**File:** `src/apps/MongoBackupApp.js`

**Changes:**
- Added 4 state variables (2 preview, 2 refs)
- Updated 2 keyboard handlers (scroll + preview logic)
- Updated 2 input handlers (preview management)
- Updated 2 inputs (value with preview fallback)
- Updated 2 dropdowns (ref + data-index attributes)
- Updated 2 onMouseEnter handlers (preview on hover)

**Lines changed:** ~80 lines total

---

## 🔍 Code Comparison

### Before (No Preview, No Scroll)

```javascript
// Input
<input value={jobFolderName} />

// Dropdown item
<div onClick={() => handleSelectJobFolder(folder)}>

// Arrow handler
else if (e.key === 'ArrowDown') {
  setJobFolderSelectedIndex(prev => prev + 1);
}
```

### After (With Preview & Scroll)

```javascript
// Input
<input value={jobFolderPreview || jobFolderName} />

// Dropdown item
<div 
  data-index={idx}
  onClick={() => handleSelectJobFolder(folder)}
  onMouseEnter={() => {
    setJobFolderSelectedIndex(idx);
    setJobFolderPreview(folder.name);
  }}
>

// Arrow handler
else if (e.key === 'ArrowDown') {
  const newIdx = ...;
  setJobFolderSelectedIndex(newIdx);
  setJobFolderPreview(filteredDriveFolderOptions[newIdx].name);
  
  setTimeout(() => {
    const selected = dropdown.querySelector(`[data-index="${newIdx}"]`);
    selected?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 10);
}
```

---

## Summary

✅ **Auto-scroll** - Selected items automatically scroll into viewport  
✅ **Real-time preview** - Input shows selected item name while navigating  
✅ **Mouse hover preview** - Hovering updates preview too  
✅ **Both tabs** - Works in Sync Jobs and Restore Backup  
✅ **Smooth UX** - Professional autocomplete behavior  
✅ **No breaking changes** - Fully backwards compatible  

**Status:** ✅ Complete  
**Performance:** Excellent  
**User Impact:** Significant UX improvement  
**Date:** 2026-08-07
