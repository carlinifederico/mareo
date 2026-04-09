// Middle-click pan for all scrollable views
export function initPan() {
  let panState = null;

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 1) return; // middle click only
    const target = findScrollableParent(e.target);
    if (!target) return;
    e.preventDefault();
    panState = {
      target,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: target.scrollLeft,
      scrollTop: target.scrollTop
    };
    document.body.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (!panState) return;
    e.preventDefault();
    const dx = e.clientX - panState.startX;
    const dy = e.clientY - panState.startY;
    panState.target.scrollLeft = panState.scrollLeft - dx;
    panState.target.scrollTop = panState.scrollTop - dy;
  });

  document.addEventListener('mouseup', (e) => {
    if (!panState) return;
    if (e.button === 1) {
      panState = null;
      document.body.style.cursor = '';
    }
  });

  // Prevent default middle-click auto-scroll
  document.addEventListener('auxclick', (e) => {
    if (e.button === 1) e.preventDefault();
  });
}

function findScrollableParent(el) {
  let node = el;
  while (node && node !== document.body) {
    if (
      node.id === 'timeline-area' ||
      node.id === 'sidebar-scroll' ||
      node.id === 'board-canvas' ||
      node.id === 'expenses-body'
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}
