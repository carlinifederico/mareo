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

  const isResize = e.target.classList.contains('resize-handle');
  const taskId = bar.dataset.taskId;
  const task = Store._findTask(taskId);
  if (!task) return;

  e.preventDefault();
  bar.setPointerCapture(e.pointerId);

  dragState = {
    taskId,
    bar,
    mode: isResize ? 'resize' : 'move',
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
  } else {
    const newDuration = Math.max(1, dragState.initialDuration + deltaWeeks);
    dragState.bar.style.setProperty('--duration', newDuration);
  }
}

function onPointerUp(e) {
  if (!dragState) return;

  const deltaX = e.clientX - dragState.pointerStartX;
  const deltaWeeks = Math.round(deltaX / dragState.weekWidth);

  if (dragState.mode === 'move') {
    const newStart = Math.max(0, Math.min(52, dragState.initialStartWeek + deltaWeeks));
    Store.updateTask(dragState.taskId, { startWeek: newStart });
  } else {
    const newDuration = Math.max(1, dragState.initialDuration + deltaWeeks);
    Store.updateTask(dragState.taskId, { durationWeeks: newDuration });
  }

  dragState.bar.classList.remove('dragging');
  dragState = null;
  document.dispatchEvent(new Event('mareo:render'));
}
