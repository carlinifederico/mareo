import { Store } from './store.js';
import { getWeekWidth } from './timeline.js';

let dragState = null;

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
  const isResize = isResizeRight || isResizeLeft;
  const taskId = bar.dataset.taskId;
  const task = Store._findTask(taskId);
  if (!task) return;

  e.preventDefault();
  bar.setPointerCapture(e.pointerId);

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
    weekWidth: getWeekWidth()
  };

  bar.classList.add('dragging');
}

function onPointerMove(e) {
  if (!dragState) return;

  const deltaX = e.clientX - dragState.pointerStartX;
  const deltaWeeks = Math.round(deltaX / dragState.weekWidth);

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
