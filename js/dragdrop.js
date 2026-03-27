import { Store } from './store.js';
import { getWeekWidth } from './timeline.js';

let dragState = null;
const DRAG_THRESHOLD = 8; // px before drag starts

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

  let mode = 'move';
  if (isResizeRight) mode = 'resize-right';
  else if (isResizeLeft) mode = 'resize-left';

  dragState = {
    taskId,
    bar,
    mode,
    initialStartWeek: task.startWeek,
    initialDuration: task.durationWeeks,
    pointerStartX: e.clientX,
    weekWidth: getWeekWidth(),
    started: false,   // drag hasn't visually started yet
    isTouch,
    pointerId: e.pointerId
  };

  // Don't preventDefault or capture yet — allow scrolling until threshold met
}

function onPointerMove(e) {
  if (!dragState) return;

  const deltaX = Math.abs(e.clientX - dragState.pointerStartX);

  // Haven't exceeded threshold yet — let the browser scroll
  if (!dragState.started) {
    const threshold = dragState.isTouch ? DRAG_THRESHOLD * 2 : DRAG_THRESHOLD;
    if (deltaX < threshold) return;

    // Threshold exceeded — start drag
    dragState.started = true;
    dragState.bar.setPointerCapture(dragState.pointerId);
    dragState.bar.classList.add('dragging');
  }

  const dx = e.clientX - dragState.pointerStartX;
  const deltaWeeks = Math.round(dx / dragState.weekWidth);

  if (dragState.mode === 'move') {
    const newStart = Math.max(0, Math.min(52, dragState.initialStartWeek + deltaWeeks));
    dragState.bar.style.setProperty('--start-week', newStart);
  } else if (dragState.mode === 'resize-right') {
    const newDuration = Math.max(1, dragState.initialDuration + deltaWeeks);
    dragState.bar.style.setProperty('--duration', newDuration);
  } else if (dragState.mode === 'resize-left') {
    const maxDelta = dragState.initialDuration - 1;
    const clampedDelta = Math.max(-dragState.initialStartWeek, Math.min(maxDelta, deltaWeeks));
    dragState.bar.style.setProperty('--start-week', dragState.initialStartWeek + clampedDelta);
    dragState.bar.style.setProperty('--duration', dragState.initialDuration - clampedDelta);
  }
}

function onPointerUp(e) {
  if (!dragState) return;

  // If drag never started (threshold not met), just clean up
  if (!dragState.started) {
    dragState = null;
    return;
  }

  const deltaX = e.clientX - dragState.pointerStartX;
  const deltaWeeks = Math.round(deltaX / dragState.weekWidth);

  if (dragState.mode === 'move') {
    const newStart = Math.max(0, Math.min(52, dragState.initialStartWeek + deltaWeeks));
    Store.updateTask(dragState.taskId, { startWeek: newStart });
  } else if (dragState.mode === 'resize-right') {
    const newDuration = Math.max(1, dragState.initialDuration + deltaWeeks);
    Store.updateTask(dragState.taskId, { durationWeeks: newDuration });
  } else if (dragState.mode === 'resize-left') {
    const maxDelta = dragState.initialDuration - 1;
    const clampedDelta = Math.max(-dragState.initialStartWeek, Math.min(maxDelta, deltaWeeks));
    Store.updateTask(dragState.taskId, {
      startWeek: dragState.initialStartWeek + clampedDelta,
      durationWeeks: dragState.initialDuration - clampedDelta
    });
  }

  dragState.bar.classList.remove('dragging');
  dragState = null;
  document.dispatchEvent(new Event('mareo:render'));
}
