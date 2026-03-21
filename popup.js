/* ═══════════════════════════════════════════════════════════
   FRAMERATE — Popup Controller
   Manages UI interactions, mode switching, and messaging
   ═══════════════════════════════════════════════════════════ */

(() => {
  'use strict';

  // ─── STATE ───
  const state = {
    mode: 'seq',         // seq | vid | smooth
    isRecording: false,
    isPaused: false,
    timerInterval: null,
    timerSeconds: 0,
    scrollPercent: 0,
  };

  // ─── DOM REFS ───
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const els = {
    masterDial:     $('#masterDial'),
    dialLabel:      $('#dialLabel'),
    recDot:         $('#recDot'),
    dialIcon:       $('#dialIcon'),
    freqNeedle:     $('#freqNeedle'),
    freqTicks:      $('#freqTicks'),
    acousticGrill:  $('#acousticGrill'),
    timerDisplay:   $('#timerDisplay'),
    statusMode:     $('#statusMode'),
    statusRes:      $('#statusRes'),
    statusFps:      $('#statusFps'),
    statusMsg:      $('#statusMsg'),
    statusIndicator:$('#statusIndicator'),
    qualitySelect:  $('#qualitySelect'),
    scrollSpeedSelect: $('#scrollSpeedSelect'),
    modeBtns:       $$('.mode-btn'),
  };

  // ─── INIT ───
  function init() {
    generateFreqTicks();
    generateGrillDots();
    setupModeButtons();
    setupMasterDial();
    setupSettingsVisibility();
    
    // Sync state if already recording in background
    chrome.runtime.sendMessage({ action: 'getStatus' }, (response) => {
      if (response && response.activeCapture) {
        state.mode = response.activeCapture.mode;
        els.modeBtns.forEach(b => {
          b.classList.remove('active');
          if (b.dataset.mode === state.mode) b.classList.add('active');
        });
        updateDialLabel();
        updateStatusDisplay();
        setupSettingsVisibility();
        
        state.isRecording = true;
        els.masterDial.classList.add('recording');
        els.recDot.classList.add('active');
        els.dialLabel.classList.add('active');
        els.statusIndicator.classList.remove('ready');
        els.statusIndicator.classList.add('recording');
        els.timerDisplay.classList.add('active');
        els.modeBtns.forEach(b => b.style.pointerEvents = 'none');
        els.statusMsg.textContent = 'Recording in progress... (Shortcut: Alt+S or Cmd+Shift+S to stop)';
        startTimer();
      } else {
        updateStatusDisplay();
        els.statusIndicator.classList.add('ready');
      }
    });

    // Listen for scroll updates from content script
    chrome.runtime.onMessage.addListener(handleMessage);
  }

  // ─── FREQUENCY SLIDER TICKS ───
  function generateFreqTicks() {
    const container = els.freqTicks;
    for (let i = 0; i < 80; i++) {
      const tick = document.createElement('div');
      tick.className = 'freq-tick' + (i % 10 === 0 ? ' major' : '');
      container.appendChild(tick);
    }
  }

  // ─── ACOUSTIC GRILL DOTS ───
  function generateGrillDots() {
    const container = els.acousticGrill;
    for (let i = 0; i < 56; i++) {  // 14 x 4 grid
      const dot = document.createElement('div');
      dot.className = 'grill-dot';
      container.appendChild(dot);
    }
  }

  // ─── MODE BUTTONS ───
  function setupModeButtons() {
    els.modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (state.isRecording) return; // Can't change mode while recording
        
        // Remove active from all
        els.modeBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        state.mode = btn.dataset.mode;
        updateStatusDisplay();
        updateDialLabel();
        setupSettingsVisibility();
      });
    });
  }

  // ─── SETTINGS VISIBILITY ───
  function setupSettingsVisibility() {
    const quality = els.qualitySelect.closest('.setting-group');
    const speed = els.scrollSpeedSelect.closest('.setting-group');
    
    speed.style.opacity = state.mode === 'smooth' ? '1' : '0.3';
    speed.style.pointerEvents = state.mode === 'smooth' ? 'auto' : 'none';
  }

  // ─── DIAL LABEL ───
  function updateDialLabel() {
    const labels = {
      shot:  'SHOT',
      seq:   'SEQ',
      vid:   'REC',
      smooth:'PLAY',
    };
    els.dialLabel.textContent = labels[state.mode] || 'REC';
  }

  // ─── STATUS DISPLAY ───
  function updateStatusDisplay() {
    const modeLabels = {
      shot:  'SHOT',
      fullpage: 'FULL PAGE',
      seq:   'SEQ\u00A0',
      vid:   'VIDEO',
      smooth:'FULL SCREEN VID',
    };
    
    els.statusMode.textContent = modeLabels[state.mode] || 'SEQ';
    
    const quality = els.qualitySelect.value;
    const resLabels = { max: '4K', high: '2K', medium: '1080p' };
    els.statusRes.textContent = resLabels[quality] || '4K';
    
    if (state.mode === 'vid' || state.mode === 'smooth') {
      els.statusFps.textContent = '60FPS';
    } else {
      els.statusFps.textContent = 'PNG';
    }
  }

  // ─── MASTER DIAL ───
  function setupMasterDial() {
    els.masterDial.addEventListener('click', async () => {
      if (state.isRecording) {
        stopCapture();
      } else {
        startCapture();
      }
    });
  }

  // ─── START CAPTURE ───
  async function startCapture() {
    state.isRecording = true;
    
    // Visual feedback
    els.masterDial.classList.add('recording');
    els.recDot.classList.add('active');
    els.dialLabel.classList.add('active');
    els.statusIndicator.classList.remove('ready');
    els.statusIndicator.classList.add('recording');
    els.timerDisplay.classList.add('active');
    
    // Disable mode buttons
    els.modeBtns.forEach(b => b.style.pointerEvents = 'none');
    
    const settings = {
      mode: state.mode,
      quality: els.qualitySelect.value,
      scrollSpeed: parseInt(els.scrollSpeedSelect.value),
    };

    switch (state.mode) {
      case 'shot':
        els.statusMsg.textContent = 'Capturing screenshot...';
        els.statusIndicator.classList.remove('recording');
        els.statusIndicator.classList.add('processing');
        chrome.runtime.sendMessage({ action: 'startShotCapture', settings });
        break;

      case 'seq':
        els.statusMsg.textContent = 'Capturing sequential frames...';
        els.statusIndicator.classList.remove('recording');
        els.statusIndicator.classList.add('processing');
        chrome.runtime.sendMessage({ action: 'startSeqCapture', settings });
        break;
      
      case 'vid':
        els.statusMsg.textContent = 'Recording video...';
        startTimer();
        chrome.runtime.sendMessage({ action: 'startVideoRecording', settings });
        break;
      
      case 'smooth':
        els.statusMsg.textContent = 'Recording walkthrough...';
        startTimer();
        chrome.runtime.sendMessage({ action: 'startSmoothVideo', settings });
        break;
        
      case 'fullpage':
        els.statusMsg.textContent = 'Stitching full page...';
        els.statusIndicator.classList.remove('recording');
        els.statusIndicator.classList.add('processing');
        chrome.runtime.sendMessage({ action: 'startFullPageCapture', settings });
        break;
    }
  }

  // ─── STOP CAPTURE ───
  function stopCapture() {
    state.isRecording = false;
    stopTimer();
    
    // Visual reset
    els.masterDial.classList.remove('recording');
    els.recDot.classList.remove('active');
    els.dialLabel.classList.remove('active');
    els.statusIndicator.classList.remove('recording', 'processing');
    els.statusIndicator.classList.add('ready');
    els.timerDisplay.classList.remove('active');
    
    // Re-enable mode buttons
    els.modeBtns.forEach(b => b.style.pointerEvents = 'auto');
    
    els.statusMsg.textContent = 'Processing...';
    
    chrome.runtime.sendMessage({ action: 'stopCapture', mode: state.mode });
  }

  // ─── TIMER ───
  function startTimer() {
    state.timerSeconds = 0;
    updateTimerDisplay();
    state.timerInterval = setInterval(() => {
      state.timerSeconds++;
      updateTimerDisplay();
    }, 1000);
  }

  function stopTimer() {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
  }

  function updateTimerDisplay() {
    const h = Math.floor(state.timerSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((state.timerSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = (state.timerSeconds % 60).toString().padStart(2, '0');
    els.timerDisplay.textContent = `${h}:${m}:${s}`;
  }

  // ─── SCROLL PERCENTAGE UPDATE ───
  function updateScrollNeedle(percent) {
    state.scrollPercent = Math.max(0, Math.min(100, percent));
    els.freqNeedle.style.left = `${state.scrollPercent}%`;
  }

  // ─── MESSAGE HANDLER ───
  function handleMessage(message, sender, sendResponse) {
    switch (message.action) {
      case 'scrollUpdate':
        updateScrollNeedle(message.percent);
        break;
      
      case 'captureComplete':
        state.isRecording = false;
        stopTimer();
        resetUI();
        els.statusMsg.textContent = `✓ ${message.filename || 'Capture'} saved!`;
        setTimeout(() => {
          els.statusMsg.textContent = 'Ready — Select mode & press REC';
        }, 3000);
        break;
      
      case 'captureError':
        state.isRecording = false;
        stopTimer();
        resetUI();
        els.statusMsg.textContent = `✗ Error: ${message.error}`;
        setTimeout(() => {
          els.statusMsg.textContent = 'Ready — Select mode & press REC';
        }, 4000);
        break;
      
      case 'captureProgress':
        els.statusMsg.textContent = message.text || 'Processing...';
        break;
    }
  }

  // ─── RESET UI ───
  function resetUI() {
    els.masterDial.classList.remove('recording');
    els.recDot.classList.remove('active');
    els.dialLabel.classList.remove('active');
    els.statusIndicator.classList.remove('recording', 'processing');
    els.statusIndicator.classList.add('ready');
    els.timerDisplay.classList.remove('active');
    els.modeBtns.forEach(b => b.style.pointerEvents = 'auto');
  }

  // ─── QUALITY CHANGE LISTENER ───
  els.qualitySelect.addEventListener('change', updateStatusDisplay);

  // ─── BOOT ───
  document.addEventListener('DOMContentLoaded', init);

})();
