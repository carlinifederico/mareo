import { Store } from './store.js';
import { getWeekWidth, getDayWidth, isDayMode, taskToPixels } from './timeline.js';

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
  const pos = taskToPixels(task.startWeek, task.durationWeeks);

  let mode = 'move';
  if (isResizeRight) mode = 'resize-right';
  else if (isResizeLeft) mode = 'resize-left';

  // In day mode snap to days, in week mode snap to weeks
  const snapPx = isDayMode() ? getDayWidth() : getWeekWidth();

  dragState = {
    taskId, bar, mode,
    initialStartWeek: task.startWeek,
    initialDuration: task.durationWeeks,
    initialLeft: pos.left,
    initialWidth: pos.width,
    pointerStartX: e.clientX,
    snapPx,
    weekWidth: getWeekWidth(),
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
  const snaps = Math.round(dx / dragState.snapPx);
  const pxDelta = snaps * dragState.snapPx;

  if (dragState.mode === 'move') {
    dragState.bar.style.left = Math.max(0, dragState.initialLeft + pxDelta) + 'px';
  } else if (dragState.mode === 'resize-right') {
    dragState.bar.style.width = Math.max(dragState.snapPx, dragState.initialWidth + pxDelta) + 'px';
  } else if (dragState.mode === 'resize-left') {
    const maxPx = dragState.initialWidth - dragState.snapPx;
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
  // Always convert back to whole weeks for storage
  const deltaWeeks = Math.round(dx / dragState.weekWidth);

  if (dragState.mode === 'move') {
    const newStart = Math.max(0, Math.min(52, dragState.initialStartWeek + deltaWeeks));
    Store.updateTask(dragState.taskId, { startWeek: newStart });
  } else if (dragState.mode === 'resize-right') {
    const newDuration = Math.max(1, dragState.initialDuration + deltaWeeks);
    Store.updateTask(dragState.taskId, { durationWeeks: newDuration });
  } else if (dragState.mode === 'resize-left') {
    const maxDelta = dragState.initialDuration - 1;
    const clamped = Math.max(-dragState.initialStartWeek, Math.min(maxDelta, deltaWeeks));
    Store.updateTask(dragState.taskId, {
      startWeek: dragState.initialStartWeek + clamped,
      durationWeeks: dragState.initialDuration - clamped
    });
  }

  dragState.bar.classList.remove('dragging');
  dragState = null;
  document.dispatchEvent(new Event('mareo:render'));
}
