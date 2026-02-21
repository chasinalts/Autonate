// background.ts
declare var chrome: any;

/**
 * Capture the current active tab and inject the content script.
 */
async function triggerCapture() {
  if (typeof chrome === 'undefined') return;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.id) return;

    // 1. Capture Visible Tab
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });

    // 2. Inject Content Script (if not already there)
    // In production, you might declare content scripts in manifest, 
    // but doing it programmatically ensures we can pass the dataUrl immediately.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    // 3. Send the DataURL to the content script
    // We add a small delay to ensure the script is parsed and listener is ready
    setTimeout(() => {
      chrome.tabs.sendMessage(tab.id!, {
        action: "INIT_AUTONATE",
        payload: dataUrl
      });
    }, 100);

  } catch (err) {
    console.error("Autonate Capture Error:", err);
  }
}

// Listener for Keyboard Shortcut
if (typeof chrome !== 'undefined' && chrome.commands) {
  chrome.commands.onCommand.addListener((command: string) => {
    if (command === "take_screenshot") {
      triggerCapture();
    }
  });
}

// Listener for Messages (from Popup)
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onMessage.addListener((request: any, sender: any, sendResponse: any) => {
    if (request.action === "TRIGGER_CAPTURE") {
      triggerCapture();
    }
  });
}