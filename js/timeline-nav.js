// Timeline navigation: zoom, pan, scroll and moving between years.
//
// - Ctrl/⌘ + wheel or trackpad pinch: zoom, anchored at the cursor.
// - Wheel: vertical scroll. Shift + wheel or horizontal swipe: sideways.
// - Drag on empty space (anywhere while LOCKED) or middle-drag (pan.js): pan.
// - Pushing past Jan 1 / Dec 31 moves to the previous / next year.
// - +/- buttons: zoom around the centre of the view.
//
// Zoom is smooth (multiplicative) and coalesced to one redraw per frame;
// a zoom step only redraws the header and the bars, not the sidebar.
import { Store } from './store.js';
import { getWeekWidth, setWeekWidth, getDayWidth, daysInYear, MIN_WEEK_WIDTH, MAX_WEEK_WIDTH } from './timeline.js';

const LINE_PX = 16;          // deltaMode 1 (lines) → px
const ZOOM_SPEED = 0.0022;   // per px of wheel delta: a mouse notch (~100px) ≈ ×1.25
const BUTTON_ZOOM = 1.4;
const YEAR_PUSH_PX = 220;    // overscroll needed at an edge to change year
const DRAG_THRESHOLD = 4;

function wheelPx(e, v) {
  return e.deltaMode === 1 ? v * LINE_PX : e.deltaMode === 2 ? v * 400 : v;
}

export function initTimelineNav({ area, renderZoom, renderYear, onZoomChange }) {
  // ---------- Zoom ----------
  let pending = null; // { factor, anchorX } waiting for the next frame

  function zoomBy(factor, anchorX) {
    if (pending) { pending.factor *= factor; pending.anchorX = anchorX; return; }
    pending = { factor, anchorX };
    requestAnimationFrame(applyZoom);
  }

  function applyZoom() {
    const { factor, anchorX } = pending;
    pending = null;
    const oldDw = getDayWidth();
    const oldWw = getWeekWidth();
    setWeekWidth(oldWw * factor);
    if (getWeekWidth() === oldWw) { onZoomChange?.(); return; }
    // Keep the day under the cursor where it is
    const day = (area.scrollLeft + anchorX) / oldDw;
    renderZoom();
    area.scrollLeft = Math.max(0, day * getDayWidth() - anchorX);
    onZoomChange?.();
  }

  function zoomAtCentre(factor) { zoomBy(factor, area.clientWidth / 2); }

  // ---------- Year edges ----------
  let push = 0, pushDir = 0, pushT = 0;

  function goToYear(dir, keepScroll) {
    const oldYear = Store.data.currentYear;
    const dw = getDayWidth();
    const left = area.scrollLeft;
    Store.setYear(oldYear + dir);
    renderYear();
    if (keepScroll) {
      // Same dates stay on screen where possible: Dec → Jan and back
      area.scrollLeft = dir > 0
        ? Math.max(0, left - daysInYear(oldYear) * dw)
        : left + daysInYear(oldYear - 1) * dw;
    }
    flashYear();
  }

  function scrollSideways(dx) {
    const max = area.scrollWidth - area.clientWidth;
    const atStart = area.scrollLeft <= 0 && dx < 0;
    const atEnd = area.scrollLeft >= max - 1 && dx > 0;
    if (!atStart && !atEnd) { push = 0; area.scrollLeft += dx; return; }
    const now = performance.now();
    const dir = Math.sign(dx);
    if (dir !== pushDir || now - pushT > 400) push = 0;
    pushDir = dir; pushT = now;
    push += Math.abs(dx);
    showEdgeHint(dir, Math.min(1, push / YEAR_PUSH_PX));
    if (push >= YEAR_PUSH_PX) {
      push = 0;
      showEdgeHint(dir, 0);
      goToYear(dir, true);
    }
  }

  // ---------- Wheel ----------
  area.addEventListener('wheel', (e) => {
    const dx = wheelPx(e, e.deltaX), dy = wheelPx(e, e.deltaY);
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+wheel, or a trackpad pinch (Chrome sends it as ctrl+wheel)
      e.preventDefault();
      const d = Math.max(-150, Math.min(150, dy));
      zoomBy(Math.exp(-d * ZOOM_SPEED), e.clientX - area.getBoundingClientRect().left);
      return;
    }
    const sideways = e.shiftKey ? (dx || dy) : (Math.abs(dx) > Math.abs(dy) ? dx : 0);
    if (!sideways) return; // plain vertical scroll: native
    e.preventDefault();
    scrollSideways(sideways);
  }, { passive: false });

  // ---------- Drag to pan (left button; middle button is pan.js) ----------
  let drag = null;
  let swallowClickUntil = 0;
  // The click that ends a pan must not open a popover or select anything
  window.addEventListener('click', (ev) => {
    if (performance.now() < swallowClickUntil) { ev.stopPropagation(); ev.preventDefault(); }
  }, true);
  area.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return; // native touch scrolling
    if (e.button !== 0) return;
    const t = e.target;
    if (t.closest('input, textarea, button, a, select, [contenteditable]')) return;
    // Task bars keep their own drag (move/resize) unless the Timeline is locked
    if (t.closest('.task-bar') && !Store.isTimelineLocked()) return;
    drag = { x: e.clientX, y: e.clientY, left: area.scrollLeft, top: area.scrollTop, id: e.pointerId, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      area.classList.add('is-panning');
      try { area.setPointerCapture(drag.id); } catch {}
    }
    area.scrollLeft = drag.left - dx;
    area.scrollTop = drag.top - dy;
  });
  const endDrag = (e) => {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    const wasMoved = drag.moved;
    drag = null;
    area.classList.remove('is-panning');
    if (wasMoved) swallowClickUntil = performance.now() + 80;
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  // ---------- Touch pinch ----------
  let pinch = null;
  const pinchInfo = (e) => {
    const [a, b] = e.touches;
    return {
      dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
      mid: (a.clientX + b.clientX) / 2 - area.getBoundingClientRect().left
    };
  };
  area.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) pinch = pinchInfo(e);
  }, { passive: true });
  area.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinch) return;
    e.preventDefault();
    const now = pinchInfo(e);
    if (pinch.dist > 0) zoomBy(now.dist / pinch.dist, now.mid);
    pinch = now;
  }, { passive: false });
  area.addEventListener('touchend', () => { pinch = null; });

  // ---------- Edge hint + year flash ----------
  const hintL = document.createElement('div');
  hintL.className = 'timeline-edge-hint left';
  const hintR = document.createElement('div');
  hintR.className = 'timeline-edge-hint right';
  area.parentElement.appendChild(hintL);
  area.parentElement.appendChild(hintR);
  let hintTimer = 0;
  function showEdgeHint(dir, amount) {
    const el = dir < 0 ? hintL : hintR;
    hintL.style.left = (area.offsetLeft + 12) + 'px';
    const year = Store.data.currentYear + dir;
    el.textContent = (dir < 0 ? '← ' : '') + year + (dir > 0 ? ' →' : '');
    el.style.opacity = amount ? String(0.35 + amount * 0.65) : '0';
    clearTimeout(hintTimer);
    if (amount) hintTimer = setTimeout(() => { hintL.style.opacity = hintR.style.opacity = '0'; }, 500);
  }
  function flashYear() {
    const y = document.getElementById('current-year');
    if (!y) return;
    y.classList.remove('year-flash');
    void y.offsetWidth;
    y.classList.add('year-flash');
  }

  return {
    zoomIn: () => zoomAtCentre(BUTTON_ZOOM),
    zoomOut: () => zoomAtCentre(1 / BUTTON_ZOOM),
    goToYear: (dir) => goToYear(dir, true),
    canZoomIn: () => getWeekWidth() < MAX_WEEK_WIDTH - 0.01,
    canZoomOut: () => getWeekWidth() > MIN_WEEK_WIDTH + 0.01,
  };
}
