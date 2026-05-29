// Minimal cursor-positioned context menu. Reuses the existing
// .context-menu / .context-menu-item CSS. Used by the Board and Gantt
// right-click handlers (the sidebar keeps its own bespoke menu).
//
// items: [{ label, danger?, onClick }]
export function openContextMenu(x, y, items) {
  document.querySelectorAll('.context-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'context-menu-item' + (it.danger ? ' danger' : '');
    el.textContent = it.label;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
      it.onClick();
    });
    menu.appendChild(el);
  }

  menu.style.position = 'fixed';
  menu.style.zIndex = '10000';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  document.body.appendChild(menu);

  // Clamp to the viewport so a right-click near an edge stays on-screen.
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = Math.max(4, window.innerWidth - rect.width - 4) + 'px';
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = Math.max(4, window.innerHeight - rect.height - 4) + 'px';
  }

  setTimeout(() => {
    document.addEventListener('click', () => menu.remove(), { once: true });
  }, 0);
}
