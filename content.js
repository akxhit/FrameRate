/* ═══════════════════════════════════════════════════════════
   FRAMERATE — Content Script
   Handles in-page scrolling for full-page capture and
   smooth walkthrough video recording.
   ═══════════════════════════════════════════════════════════ */

'use strict';

(() => {
  // Guard against multiple injections
  if (window.__frameRateInjected) return;
  window.__frameRateInjected = true;

  // ─── STATE ───
  let scrollState = {
    isScrolling: false,
    segmentIndex: 0,
    totalHeight: 0,
    viewportHeight: 0,
    totalSegments: 0,
    originalScrollY: 0,
    animationFrameId: null,
    renderDelay: 250,
  };

  // ─── MESSAGE HANDLER ───
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.action) {
      case 'beginFullPageCapture':
        beginFullPageCapture(message.delay || 250);
        break;

      case 'captureNextSegment':
        captureNextSegment();
        break;

      case 'beginSmoothScroll':
        beginSmoothScroll(message.speed || 2);
        break;

      case 'stopScroll':
        stopScroll();
        break;

      case 'getScrollPercent':
        sendResponse({ percent: getScrollPercent() });
        break;
    }
    // Synchronous response, do not return true to avoid promise channel errors
  });

  // ─── SCROLL PERCENTAGE ───
  function getScrollPercent() {
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop;
    const scrollHeight = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollHeight <= 0) return 100;
    return Math.round((scrollTop / scrollHeight) * 100);
  }

  // Track scroll for frequency slider updates
  let scrollThrottle = null;
  window.addEventListener('scroll', () => {
    if (scrollThrottle) return;
    scrollThrottle = setTimeout(() => {
      scrollThrottle = null;
      try {
        chrome.runtime.sendMessage({
          action: 'scrollProgress',
          percent: getScrollPercent()
        });
      } catch (e) { /* Extension context may be invalidated */ }
    }, 100);
  }, { passive: true });


  // ═══════════════════════════════════════════════════════════
  // FULL-PAGE SCREENSHOT (Scroll & Capture)
  // ═══════════════════════════════════════════════════════════

  function beginFullPageCapture(delayParam) {
    const totalHeight = Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );
    const viewportHeight = window.innerHeight;

    scrollState = {
      isScrolling: true,
      segmentIndex: 0,
      totalHeight: totalHeight,
      viewportHeight: viewportHeight,
      totalSegments: Math.ceil(totalHeight / viewportHeight),
      originalScrollY: window.scrollY,
      animationFrameId: null,
      renderDelay: delayParam || 250
    };

    // Scroll to top first
    window.scrollTo({ top: 0, behavior: 'instant' });

    // Wait for scroll to settle, then capture first segment
    setTimeout(() => {
      notifySegmentReady();
    }, scrollState.renderDelay);
  }

  function notifySegmentReady() {
    if (!scrollState.isScrolling) return;

    chrome.runtime.sendMessage({
      action: 'scrollSegmentReady',
      scrollY: window.scrollY,
      viewportHeight: scrollState.viewportHeight,
      totalHeight: scrollState.totalHeight,
      index: scrollState.segmentIndex,
      totalSegments: scrollState.totalSegments,
      devicePixelRatio: window.devicePixelRatio || 1
    });
  }

  function captureNextSegment() {
    scrollState.segmentIndex++;

    if (scrollState.segmentIndex >= scrollState.totalSegments) {
      // All segments captured
      scrollState.isScrolling = false;

      // Restore original scroll position
      window.scrollTo({ top: scrollState.originalScrollY, behavior: 'instant' });

      chrome.runtime.sendMessage({ action: 'fullPageScrollComplete' });
      return;
    }

    // Scroll to next segment position
    const nextScrollY = scrollState.segmentIndex * scrollState.viewportHeight;
    
    // For the last segment, adjust to capture the bottom perfectly
    const maxScroll = scrollState.totalHeight - scrollState.viewportHeight;
    const targetScroll = Math.min(nextScrollY, maxScroll);

    window.scrollTo({ top: targetScroll, behavior: 'instant' });

    // Wait for scroll to settle and any lazy-loaded content
    setTimeout(() => {
      notifySegmentReady();
    }, scrollState.renderDelay);
  }

  // ═══════════════════════════════════════════════════════════
  // SMOOTH SCROLL (Walkthrough Video)
  // ═══════════════════════════════════════════════════════════

  function beginSmoothScroll(speed) {
    // Scroll to top first
    window.scrollTo({ top: 0, behavior: 'instant' });

    const totalHeight = Math.max(
      document.body.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight
    );
    const maxScroll = totalHeight - window.innerHeight;

    if (maxScroll <= 0) {
      // Page doesn't need scrolling
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: 'smoothScrollComplete' });
      }, 2000); // Record 2 seconds anyway
      return;
    }

    scrollState.isScrolling = true;

    // Speed: pixels per frame (at 60fps)
    // speed 1 = 0.5px/frame (~30px/s), speed 2 = 1px/frame (~60px/s), speed 4 = 2px/frame (~120px/s)
    const pixelsPerFrame = speed * 0.5;

    let currentScroll = 0;

    // Wait 1 second at top before starting scroll
    setTimeout(() => {
      function smoothScrollStep() {
        if (!scrollState.isScrolling) return;

        currentScroll += pixelsPerFrame;

        if (currentScroll >= maxScroll) {
          // Reached bottom
          window.scrollTo({ top: maxScroll, behavior: 'instant' });

          // Hold at bottom for 1 second before completing
          setTimeout(() => {
            scrollState.isScrolling = false;
            chrome.runtime.sendMessage({ action: 'smoothScrollComplete' });
          }, 1000);
          return;
        }

        window.scrollTo({ top: currentScroll, behavior: 'instant' });

        // Report progress
        const percent = Math.round((currentScroll / maxScroll) * 100);
        try {
          chrome.runtime.sendMessage({
            action: 'scrollProgress',
            percent: percent
          });
        } catch (e) { /* ignore */ }

        scrollState.animationFrameId = requestAnimationFrame(smoothScrollStep);
      }

      scrollState.animationFrameId = requestAnimationFrame(smoothScrollStep);
    }, 1000);
  }

  function stopScroll() {
    scrollState.isScrolling = false;
    if (scrollState.animationFrameId) {
      cancelAnimationFrame(scrollState.animationFrameId);
      scrollState.animationFrameId = null;
    }
  }

})();
