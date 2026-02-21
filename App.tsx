import React, { useState, useEffect } from 'react';
import { ShapeType } from './types';
import { Camera, Square, Circle, RectangleHorizontal, Keyboard } from 'lucide-react';

const App: React.FC = () => {
  const [shape, setShape] = useState<ShapeType>(ShapeType.CIRCLE);
  const [blur, setBlur] = useState<number>(8);
  const [defaultAction, setDefaultAction] = useState<'save' | 'copy'>('copy');

  const [shortcutText, setShortcutText] = useState<string>('');

  // Load saved preferences and commands on mount
  useEffect(() => {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['autonateShape', 'autonateBlur', 'autonateDefaultAction'], (result: any) => {
        if (result.autonateShape) {
          setShape(result.autonateShape as ShapeType);
        }
        if (result.autonateBlur !== undefined) {
          setBlur(result.autonateBlur);
        }
        if (result.autonateDefaultAction) {
          setDefaultAction(result.autonateDefaultAction);
        }
      });
    }

    if (typeof chrome !== 'undefined' && chrome.commands) {
      chrome.commands.getAll((commands: any[]) => {
        const cmd = commands.find(c => c.name === 'take_screenshot');
        if (cmd && cmd.shortcut) {
          setShortcutText(cmd.shortcut);
        } else {
          setShortcutText('Not set');
        }
      });
    } else {
      // Dev mode fallback
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      setShortcutText(isMac ? '⌘+Shift+S' : 'Ctrl+Shift+S');
    }
  }, []);

  const handleShapeChange = (newShape: ShapeType) => {
    setShape(newShape);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ autonateShape: newShape });
    }
  };

  const handleBlurChange = (newBlur: number) => {
    setBlur(newBlur);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ autonateBlur: newBlur });
    }
  };

  const handleDefaultActionChange = (action: 'save' | 'copy') => {
    setDefaultAction(action);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ autonateDefaultAction: action });
    }
  };

  const handleCaptureClick = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ action: "TRIGGER_CAPTURE" });
      window.close();
    }
  };

  const handleConfigureShortcut = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    }
  };

  return (
    <div className="p-4 flex flex-col h-full bg-slate-900 text-slate-100">
      <header className="mb-4 border-b border-slate-700 pb-2">
        <h1 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
          Autonate
        </h1>
        <p className="text-xs text-slate-400">Capture, Focus, Annotate</p>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto">
        {/* Shape Selection */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-300">Focus Shape</label>
          <div className="flex gap-2">
            <button
              onClick={() => handleShapeChange(ShapeType.CIRCLE)}
              title="Select Circle Focus Shape"
              className={`flex-1 flex flex-col items-center justify-center p-2 rounded-lg border transition-all ${shape === ShapeType.CIRCLE
                ? 'bg-cyan-900/50 border-cyan-500 text-cyan-400'
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-750'
                }`}
            >
              <Circle size={20} />
              <span className="text-[10px] mt-1">Circle</span>
            </button>
            <button
              onClick={() => handleShapeChange(ShapeType.SQUARE)}
              title="Select Square Focus Shape"
              className={`flex-1 flex flex-col items-center justify-center p-2 rounded-lg border transition-all ${shape === ShapeType.SQUARE
                ? 'bg-cyan-900/50 border-cyan-500 text-cyan-400'
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-750'
                }`}
            >
              <Square size={20} />
              <span className="text-[10px] mt-1">Square</span>
            </button>
            <button
              onClick={() => handleShapeChange(ShapeType.RECTANGLE)}
              title="Select Rectangle Focus Shape"
              className={`flex-1 flex flex-col items-center justify-center p-2 rounded-lg border transition-all ${shape === ShapeType.RECTANGLE
                ? 'bg-cyan-900/50 border-cyan-500 text-cyan-400'
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-750'
                }`}
            >
              <RectangleHorizontal size={20} />
              <span className="text-[10px] mt-1">Rect</span>
            </button>
          </div>
        </div>

        {/* Blur Intensity Slider */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-semibold text-slate-300">Blur Intensity</label>
            <span className="text-xs font-mono text-cyan-400 bg-cyan-900/30 px-2 py-0.5 rounded">{blur}px</span>
          </div>
          <input
            type="range"
            min="0"
            max="20"
            step="1"
            value={blur}
            onChange={(e) => handleBlurChange(parseInt(e.target.value))}
            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
            title="Adjust background blur strength"
          />
        </div>

        {/* Default Action Preference */}
        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-300">On Right-Click Capture</label>
          <div className="flex gap-2">
            <button
              onClick={() => handleDefaultActionChange('copy')}
              className={`flex-1 py-1.5 px-3 rounded-lg border transition-all text-xs font-medium ${defaultAction === 'copy'
                ? 'bg-cyan-900/50 border-cyan-500 text-cyan-400'
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-750'
                }`}
            >
              📋 Copy to Clipboard
            </button>
            <button
              onClick={() => handleDefaultActionChange('save')}
              className={`flex-1 py-1.5 px-3 rounded-lg border transition-all text-xs font-medium ${defaultAction === 'save'
                ? 'bg-cyan-900/50 border-cyan-500 text-cyan-400'
                : 'bg-slate-800 border-slate-700 text-slate-500 hover:bg-slate-750'
                }`}
            >
              💾 Save to Disk
            </button>
          </div>
        </div>

        {/* Keyboard Shortcut Display */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <label className="text-sm font-semibold text-slate-300">Shortcut</label>
            <button
              onClick={handleConfigureShortcut}
              className="text-xs text-cyan-400 hover:underline"
              title="Change shortcut in Chrome extensions page"
            >
              Edit
            </button>
          </div>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-slate-800 border border-slate-700">
            <Keyboard size={18} className="text-cyan-400" />
            <kbd className="font-mono text-sm text-cyan-300 bg-slate-700 px-2 py-0.5 rounded min-w-[30px] text-center">{shortcutText}</kbd>
            <span className="text-xs text-slate-400">to capture</span>
          </div>
        </div>
      </div>

      <footer className="mt-auto pt-3">
        <button
          onClick={handleCaptureClick}
          title="Capture the current visible screen"
          className="w-full bg-cyan-600 hover:bg-cyan-500 text-white py-3 rounded-lg font-bold shadow-lg shadow-cyan-900/20 flex items-center justify-center gap-2 transition-all active:scale-95"
        >
          <Camera size={20} />
          Capture Screen
        </button>
      </footer>
    </div>
  );
};

export default App;