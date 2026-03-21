/* ═══════════════════════════════════════════════════════════
   FRAMERATE — Background Service Worker
   Orchestrates capture workflows, manages offscreen document,
   and coordinates downloads.
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ─── STATE ───
let activeCapture = null;   // { mode, tabId, streamId, settings, folder }

// ─── DOWNLOAD QUEUE MANAGER ───
const downloadQueue = {
  queue: [],
  isProcessing: false,
  push: function(dataUrl, filename) {
    this.queue.push({ dataUrl, filename });
    if (!this.isProcessing) this.process();
  },
  process: async function() {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }
    this.isProcessing = true;
    const task = this.queue.shift();
    try {
      await new Promise((resolve) => {
        chrome.downloads.download({
          url: task.dataUrl,
          filename: task.filename,
          saveAs: false
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
             console.warn("[FrameRate] Download warn:", chrome.runtime.lastError);
          }
          resolve(downloadId);
        });
      });
      // Small pause to prevent browser locking during burst IO
      await delay(150); 
    } catch(e) { console.error(e); }
    this.process();
  }
};

// ─── OFFSCREEN DOCUMENT MANAGEMENT ───
const OFFSCREEN_URL = 'offscreen.html';

async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });

  if (existingContexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['BLOBS', 'WORKERS', 'DOM_PARSER'],
    justification: 'Video encoding for FrameRate'
  });
}

async function closeOffscreenDocument() {
  try {
    await chrome.offscreen.closeDocument();
  } catch (e) {
    // Already closed — ignore
  }
}

// ─── COMMAND ROUTER ───
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'stop-capture') {
    if (activeCapture) {
      await handleStopCapture(activeCapture.mode);
    }
  }
});

// ─── MESSAGE ROUTER ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.action) {
        // ── From Popup ──
        case 'startShotCapture':
          await handleShotCapture(message.settings);
          break;

        case 'startSeqCapture':
          await handleSeqCapture(message.settings);
          break;

        case 'startVideoRecording':
          await handleVideoRecording(message.settings);
          break;

        case 'startSmoothVideo':
          await handleSmoothVideo(message.settings);
          break;

        case 'stopCapture':
          await handleStopCapture(message.mode);
          break;

        case 'getStatus':
          sendResponse({ activeCapture });
          break;

        // ── From Content Script ──
        case 'scrollSegmentReady':
          await captureSeqFrame(message);
          break;

        case 'fullPageScrollComplete':
          await finalizeSeqCapture();
          break;

        case 'smoothScrollComplete':
          await handleStopCapture('smooth');
          break;

        case 'scrollProgress':
          chrome.runtime.sendMessage({
            action: 'scrollUpdate',
            percent: message.percent
          });
          break;

        // ── From Offscreen ──
        case 'videoComplete':
          await downloadBlob(message.blob, message.filename || 'framerate-video.mp4');
          notifyComplete(message.filename || 'framerate-video.mp4');
          break;

        case 'processingError':
          notifyError(message.error);
          break;
      }
    } catch (error) {
      console.error('[FrameRate] Error:', error);
      notifyError(error.message);
    }
  })();
});


// ═══════════════════════════════════════════════════════════
// CAPTURE MODE HANDLERS
// ═══════════════════════════════════════════════════════════

// ─── SINGLE SCREENSHOT (Shot Mode) ───
async function handleShotCapture(settings) {
  try {
    // A small delay to let the popup processing UI establish
    await delay(100);

    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 100
    });
    
    chrome.runtime.sendMessage({
      action: 'captureProgress',
      text: 'Saving screenshot...'
    });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `FrameRate_Shot_${timestamp}.png`;
    
    await downloadBlob(dataUrl, filename);
    notifyComplete(filename);
  } catch(e) {
    console.error('[FrameRate] Shot error:', e);
    notifyError('Failed to capture screen: ' + e.message);
  }
}

// ─── SEQUENTIAL FRAME CAPTURE ───
async function handleSeqCapture(settings) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return notifyError('No active tab found');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  activeCapture = { 
    mode: 'seq', 
    tabId: tab.id, 
    settings,
    folder: `FrameRate_Seq_${timestamp}`
  };

  // Inject content script for scrolling
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['content.js']
  });

  // Begin scroll capture with a longer delay for lazy-loading
  chrome.tabs.sendMessage(tab.id, {
    action: 'beginFullPageCapture',
    quality: settings.quality,
    delay: 500
  });
}

async function captureSeqFrame(message) {
  if (!activeCapture || activeCapture.mode !== 'seq') return;

  // Wait extra frames for lazy-loading and quota limits
  await delay(200);

  let dataUrl = null;
  let retries = 5;

  while (retries > 0) {
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: 'png',
        quality: 100
      });
      break; 
    } catch (e) {
      if (e.message && e.message.includes('MAX_CAPTURE_VISIBLE_TAB_CALLS')) {
        retries--;
        await delay(350); // Chrome enforces strict limits per second, throttle it
      } else {
        throw e;
      }
    }
  }

  if (!dataUrl) {
    throw new Error("Failed to capture screen segment after multiple quota retries.");
  }

  try {
    const frameNum = String(message.index + 1).padStart(3, '0');
    const filename = `${activeCapture.folder}/frame_${frameNum}.png`;
    downloadQueue.push(dataUrl, filename);

    chrome.runtime.sendMessage({
      action: 'captureProgress',
      text: `Captured segment ${message.index + 1}/${message.totalSegments}...`
    });

    // Tell content script to scroll to next segment
    chrome.tabs.sendMessage(activeCapture.tabId, { action: 'captureNextSegment' });
  } catch (e) {
    console.error('[FrameRate] Capture segment error:', e);
    notifyError('Failed to capture page segment');
  }
}

async function finalizeSeqCapture() {
  if (!activeCapture || activeCapture.mode !== 'seq') return;

  chrome.runtime.sendMessage({
    action: 'captureProgress',
    text: 'Finalizing downloads...'
  });
  
  // Wait for the download queue to empty
  const flushCheck = setInterval(() => {
    if (!downloadQueue.isProcessing) {
      clearInterval(flushCheck);
      notifyComplete('Sequence saved');
      activeCapture = null;
    }
  }, 500);
}


// ─── VIDEO RECORDING (Tab Capture) ───
async function handleVideoRecording(settings) {
  if (activeCapture) return notifyError('A capture is already in progress');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return notifyError('No active tab found');

  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id
    });

    activeCapture = { mode: 'vid', tabId: tab.id, streamId, settings };

    await ensureOffscreenDocument();

    chrome.runtime.sendMessage({
      action: 'startRecording',
      streamId: streamId,
      settings: settings,
      target: 'offscreen'
    });

    // Inject script (may fail on chrome:// pages)
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (err) {
      console.warn('Could not inject script on this page:', err.message);
    }
  } catch (e) {
    console.error('[FrameRate] Tab capture error:', e);
    notifyError('Failed to start tab capture: ' + e.message);
  }
}


// ─── SMOOTH VIDEO (Auto-scroll + Record) ───
async function handleSmoothVideo(settings) {
  if (activeCapture) return notifyError('A capture is already in progress');
  
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return notifyError('No active tab found');

  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id
    });

    activeCapture = { mode: 'smooth', tabId: tab.id, streamId, settings };

    await ensureOffscreenDocument();

    chrome.runtime.sendMessage({
      action: 'startRecording',
      streamId: streamId,
      settings: settings,
      target: 'offscreen'
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });

    chrome.tabs.sendMessage(tab.id, {
      action: 'beginSmoothScroll',
      speed: settings.scrollSpeed || 2
    });
  } catch (e) {
    console.error('[FrameRate] Smooth video error:', e);
    notifyError('Failed to start smooth video: ' + e.message);
  }
}


// ─── STOP CAPTURE ───
async function handleStopCapture(mode) {
  if (!activeCapture) return;

  switch (mode || activeCapture.mode) {
    case 'seq':
      // Just clear out early
      activeCapture = null;
      break;

    case 'vid':
    case 'smooth':
      if (mode === 'smooth' && activeCapture.tabId) {
        try {
          chrome.tabs.sendMessage(activeCapture.tabId, { action: 'stopScroll' });
        } catch (e) { /* Tab may have closed */ }
      }
      chrome.runtime.sendMessage({
        action: 'stopRecording',
        target: 'offscreen'
      });
      activeCapture = null;
      break;
  }
}


// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadBlob(blobUrl, filename) {
  try {
    await chrome.downloads.download({
      url: blobUrl,
      filename: filename,
      saveAs: true
    });
  } catch (e) {
    console.error('[FrameRate] Download error:', e);
  }
}

function notifyComplete(filename) {
  chrome.runtime.sendMessage({
    action: 'captureComplete',
    filename: filename
  });
  setTimeout(() => closeOffscreenDocument(), 2000);
}

function notifyError(error) {
  chrome.runtime.sendMessage({
    action: 'captureError',
    error: error
  });
  setTimeout(() => closeOffscreenDocument(), 1000);
}
