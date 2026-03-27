import { Store } from './store.js';
import { getWeekWidth, isDayMode, taskToPixels } from './timeline.js';

let dragState = null;
const DRAG_THRESHOLD = 8;

export function initDragDrop() {
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
}

function getSnapWidth() {
  // In day mode, snap to days (weekWidth/7); in week mode, snap to weeks
  return isDayMode() ? getWeekWidth() / 7 : getWeekWidth();
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

  let mode = 'move';
  if (isResizeRight) mode = 'resize-right';
  else if (isResizeLeft) mode = 'resize-left';

  const pos = taskToPixels(task.startWeek, task.durationWeeks);

  dragState = {
    taskId,
    bar,
    mode,
    initialStartWeek: task.startWeek,
    initialDuration: task.durationWeeks,
    initialLeft: pos.left,
    initialWidth: pos.width,
    pointerStartX: e.clientX,
    snapWidth: getSnapWidth(),
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
  const snap = dragState.snapWidth;

  if (dragState.dayMode) {
    // Day mode: move in day increments, convert back to week fractions
    const deltaDays = Math.round(dx / snap);

    if (dragState.mode === 'move') {
      const newLeft = Math.max(0, dragState.initialLeft + deltaDays * snap);
      dragState.bar.style.left = newLeft + 'px';
    } else if (dragState.mode === 'resize-right') {
      const newWidth = Math.max(snap, dragState.initialWidth + deltaDays * snap);
      dragState.bar.style.width = newWidth + 'px';
    } else if (dragState.mode === 'resize-left') {
      const maxDeltaDays = Math.round(dragState.initialWidth / snap) - 1;
      const minDeltaDays = -Math.round(dragState.initialLeft / snap);
      const clamped = Math.max(minDeltaDays, Math.min(maxDeltaDays, deltaDays));
      dragState.bar.style.left = (dragState.initialLeft + clamped * snap) + 'px';
      dragState.bar.style.width = (dragState.initialWidth - clamped * snap) + 'px';
    }
  } else {
    // Week mode
    const deltaWeeks = Math.round(dx / snap);

    if (dragState.mode === 'move') {
      const newLeft = Math.max(0, dragState.initialLeft + deltaWeeks * snap);
      dragState.bar.style.left = newLeft + 'px';
    } else if (dragState.mode === 'resize-right') {
      const newWidth = Math.max(snap, dragState.initialWidth + deltaWeeks * snap);
      dragState.bar.style.width = newWidth + 'px';
    } else if (dragState.mode === 'resize-left') {
      const maxDelta = dragState.initialDuration - 1;
      const clamped = Math.max(-dragState.initialStartWeek, Math.min(maxDelta, deltaWeeks));
      dragState.bar.style.left = (dragState.initialLeft + clamped * snap) + 'px';
      dragState.bar.style.width = (dragState.initialWidth - clamped * snap) + 'px';
    }
  }
}

function onPointerUp(e) {
  if (!dragState) return;

  if (!dragState.started) {
    dragState = null;
    return;
  }

  const dx = e.clientX - dragState.pointerStartX;
  const snap = dragState.snapWidth;

  if (dragState.dayMode) {
    const deltaDays = Math.round(dx / snap);
    const daysPerWeek = 7;

    if (dragState.mode === 'move') {
      const startDays = Math.round(dragState.initialLeft / snap) + deltaDays;
      const newStartWeek = Math.max(0, Math.min(52, Math.round(startDays / daysPerWeek)));
      Store.updateTask(dragState.taskId, { startWeek: newStartWeek });
    } else if (dragState.mode === 'resize-right') {
      const widthDays = Math.round(dragState.initialWidth / snap) + deltaDays;
      const newDuration = Math.max(1, Math.round(widthDays / daysPerWeek));
      Store.updateTask(dragState.taskId, { durationWeeks: newDuration });
    } else if (dragState.mode === 'resize-left') {
      const maxDeltaDays = Math.round(dragState.initialWidth / snap) - daysPerWeek;
      const minDeltaDays = -Math.round(dragState.initialLeft / snap);
      const clamped = Math.max(minDeltaDays, Math.min(maxDeltaDays, deltaDays));
      const clampedWeeks = Math.round(clamped / daysPerWeek);
      Store.updateTask(dragState.taskId, {
        startWeek: Math.max(0, dragState.initialStartWeek + clampedWeeks),
        durationWeeks: Math.max(1, dragState.initialDuration - clampedWeeks)
      });
    }
  } else {
    const deltaWeeks = Math.round(dx / snap);

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
  }

  dragState.bar.classList.remove('dragging');
  dragState = null;
  document.dispatchEvent(new Event('mareo:render'));
}
