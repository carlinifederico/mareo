import { Store } from './store.js';
import { getDayWidth, isDayMode, taskToPixels, taskToDisplayPixels, getWeekWidth } from './timeline.js';

let dragState = null;
const DRAG_THRESHOLD = 8;

export function initDragDrop() {
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
}

function onPointerDown(e) {
  const bar = e.target.closest('.task-bar');
  if (!bar) return;

  const isResizeRight = e.target.classList.contains('resize-handle-right');
  const isResizeLeft = e.target.classList.contains('resize-handle-left');
  const taskId = bar.dataset.taskId;
  const task = Store._findTask(taskId);
  if (!task) return;

  const isTouch = e.pointerType === 'touch';
  const dayMode = isDayMode();
  const dw = getDayWidth();
  const ww = getWeekWidth();
  const pos = taskToDisplayPixels(task.startDay, task.durationDays);
  // In week mode, snap unit is a week (7 days); in day mode, snap unit is 1 day
  const snapDays = dayMode ? 1 : 7;

  let mode = 'move';
  if (isResizeRight) mode = 'resize-right';
  else if (isResizeLeft) mode = 'resize-left';

  dragState = {
    taskId, bar, mode,
    initialStartDay: task.startDay || 0,
    initialDuration: task.durationDays || 7,
    initialLeft: pos.left,
    initialWidth: pos.width,
    pointerStartX: e.clientX,
    dayWidth: dw,
    snapDays,
    snapWidth: dayMode ? dw : ww,
    dayMode,
    started: false,
    isTouch,
    pointerId: e.pointerId
  };
}

function onPointerMove(e) {
  if (!dragState) return;

  const deltaX = Math.abs(e.clientX - dragState.pointerStartX);
  if (!dragState.started) {
    const threshold = dragState.isTouch ? DRAG_THRESHOLD * 2 : DRAG_THRESHOLD;
    if (deltaX < threshold) return;
    dragState.started = true;
    dragState.bar.setPointerCapture(dragState.pointerId);
    dragState.bar.classList.add('dragging');
  }

  const dx = e.clientX - dragState.pointerStartX;
  const sw = dragState.snapWidth;
  const deltaSnaps = Math.round(dx / sw);
  const pxDelta = deltaSnaps * sw;

  if (dragState.mode === 'move') {
    dragState.bar.style.left = Math.max(0, dragState.initialLeft + pxDelta) + 'px';
  } else if (dragState.mode === 'resize-right') {
    dragState.bar.style.width = Math.max(sw, dragState.initialWidth + pxDelta) + 'px';
  } else if (dragState.mode === 'resize-left') {
    const maxPx = dragState.initialWidth - sw;
    const minPx = -dragState.initialLeft;
    const clamped = Math.max(minPx, Math.min(maxPx, pxDelta));
    dragState.bar.style.left = (dragState.initialLeft + clamped) + 'px';
    dragState.bar.style.width = (dragState.initialWidth - clamped) + 'px';
  }
}

function onPointerUp(e) {
  if (!dragState) return;
  if (!dragState.started) { dragState = null; return; }

  const dx = e.clientX - dragState.pointerStartX;
  const snap = dragState.snapDays;
  const deltaSnaps = Math.round(dx / dragState.snapWidth);
  const deltaDays = deltaSnaps * snap;

  if (dragState.mode === 'move') {
    let newStart;
    if (dragState.dayMode) {
      newStart = Math.max(0, dragState.initialStartDay + deltaDays);
    } else {
      // In week mode, move by whole weeks but keep within-week offset
      const initialWeek = Math.floor(dragState.initialStartDay / 7);
      const offset = dragState.initialStartDay - initialWeek * 7;
      const newWeek = Math.max(0, initialWeek + deltaSnaps);
      newStart = newWeek * 7 + offset;
    }
    Store.updateTask(dragState.taskId, { startDay: newStart });
  } else if (dragState.mode === 'resize-right') {
    const newDuration = Math.max(snap, dragState.initialDuration + deltaDays);
    Store.updateTask(dragState.taskId, { durationDays: newDuration });
  } else if (dragState.mode === 'resize-left') {
    const maxDelta = dragState.initialDuration - snap;
    const clamped = Math.max(-dragState.initialStartDay, Math.min(maxDelta, deltaDays));
    Store.updateTask(dragState.taskId, {
      startDay: dragState.initialStartDay + clamped,
      durationDays: dragState.initialDuration - clamped
    });
  }

  dragState.bar.classList.remove('dragging');
  dragState = null;
  document.dispatchEvent(new Event('mareo:render'));
}
