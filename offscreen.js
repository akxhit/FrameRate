/* ═══════════════════════════════════════════════════════════
   FRAMERATE — Offscreen Document
   Heavy processing: video encoding using MediaRecorder.
   Passes video chunks out to be saved by the Background.
   ═══════════════════════════════════════════════════════════ */

'use strict';

// ─── STATE ───
let mediaRecorder = null;
let recordedChunks = [];
let mediaStream = null;

// ─── MESSAGE HANDLER ───
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target && message.target !== 'offscreen') return;

  (async () => {
    try {
      switch (message.action) {
        case 'startRecording':
          await startRecording(message.streamId, message.settings);
          break;

        case 'stopRecording':
          stopRecording();
          break;
      }
    } catch (error) {
      console.error('[FrameRate Offscreen] Error:', error);
      chrome.runtime.sendMessage({
        action: 'processingError',
        error: error.message
      });
    }
  })();

  return true;
});

// ═══════════════════════════════════════════════════════════
// VIDEO RECORDING
// ═══════════════════════════════════════════════════════════

async function startRecording(streamId, settings) {
  try {
    const quality = settings.quality || 'max';
    const constraints = getVideoConstraints(quality);

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
        }
      },
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
          ...constraints
        }
      }
    });

    recordedChunks = [];
    const mimeType = getSupportedMimeType();
    const bitrate = getBitrate(quality);

    mediaRecorder = new MediaRecorder(mediaStream, {
      mimeType: mimeType,
      videoBitsPerSecond: bitrate
    });

    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordedChunks, { type: mimeType });
      const blobUrl = URL.createObjectURL(blob);

      const ext = (mimeType.includes('mp4') || mimeType.includes('h264')) ? 'mp4' : 'webm';
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

      chrome.runtime.sendMessage({
        action: 'videoComplete',
        blob: blobUrl,
        filename: `framerate-${timestamp}.${ext}`
      });

      if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
      }
    };

    mediaRecorder.onerror = (event) => {
      console.error('[FrameRate] MediaRecorder error:', event);
      chrome.runtime.sendMessage({
        action: 'processingError',
        error: 'Recording failed: ' + (event.error?.message || 'Unknown error')
      });
    };

    mediaRecorder.start(1000);

  } catch (error) {
    console.error('[FrameRate] Recording start error:', error);
    chrome.runtime.sendMessage({
      action: 'processingError',
      error: 'Failed to start recording: ' + error.message
    });
  }
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function getVideoConstraints(quality) {
  switch (quality) {
    case 'max':
      return {
        minWidth: 1920,
        minHeight: 1080,
        maxWidth: 3840,
        maxHeight: 2160,
        minFrameRate: 30,
        maxFrameRate: 60
      };
    case 'high':
      return {
        minWidth: 1280,
        minHeight: 720,
        maxWidth: 2560,
        maxHeight: 1440,
        minFrameRate: 30,
        maxFrameRate: 60
      };
    case 'medium':
    default:
      return {
        minWidth: 1280,
        minHeight: 720,
        maxWidth: 1920,
        maxHeight: 1080,
        minFrameRate: 24,
        maxFrameRate: 30
      };
  }
}

function getBitrate(quality) {
  // Optimized for screen recordings (high redundancy)
  // Provides excellent UI text clarity at much smaller file sizes
  switch (quality) {
    case 'max':    return 8_000_000;  // 8 Mbps for 4K
    case 'high':   return 5_000_000;  // 5 Mbps for 2K
    case 'medium': return 2_500_000;  // 2.5 Mbps for 1080p
    default:       return 5_000_000;
  }
}

function getSupportedMimeType() {
  const types = [
    'video/mp4;codecs=avc3', // Native MP4 if supported by Chrome (avc3 handles dynamic resolution changes better)
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=h264', // H.264 video inside WebM container
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];

  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }

  return 'video/webm';
}
