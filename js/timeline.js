const MONTH_NAMES = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

export function getWeekWidth() {
  return 40;
}

export function getTotalWeeks() {
  return 53;
}

export function getMonthWeekMap(year) {
  const months = [];
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(year, m, 1);
    const lastDay = new Date(year, m + 1, 0);
    const startWeek = getWeekOfYear(firstDay);
    const endWeek = getWeekOfYear(lastDay);
    months.push({
      name: MONTH_NAMES[m],
      startWeek,
      endWeek,
      weekCount: endWeek - startWeek + 1
    });
  }
  return months;
}

export function getWeekOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const diff = date - start;
  return Math.floor(diff / (7 * 86400000));
}

export function getTodayWeekIndex(year) {
  const now = new Date();
  if (now.getFullYear() !== year) return -1;
  return getWeekOfYear(now);
}

export function renderTimelineHeader(container, year) {
  container.innerHTML = '';
  const weekWidth = getWeekWidth();
  const months = getMonthWeekMap(year);
  const todayWeek = getTodayWeekIndex(year);

  // Month row
  const monthRow = document.createElement('div');
  monthRow.className = 'timeline-month-row';

  // Week row
  const weekRow = document.createElement('div');
  weekRow.className = 'timeline-week-row';

  for (const month of months) {
    const monthCell = document.createElement('div');
    monthCell.className = 'timeline-month-cell';
    monthCell.style.width = (month.weekCount * weekWidth) + 'px';
    monthCell.textContent = month.name;

    // Highlight current month
    if (todayWeek >= 0 && todayWeek >= month.startWeek && todayWeek <= month.endWeek) {
      monthCell.classList.add('current-month');
    }

    monthRow.appendChild(monthCell);

    for (let w = month.startWeek; w <= month.endWeek; w++) {
      const weekCell = document.createElement('div');
      weekCell.className = 'timeline-week-cell';
      weekCell.style.width = weekWidth + 'px';
      weekCell.textContent = 'W' + (w + 1);

      // Highlight current week
      if (w === todayWeek) {
        weekCell.classList.add('current-week');
      }

      weekRow.appendChild(weekCell);
    }
  }

  container.appendChild(monthRow);
  container.appendChild(weekRow);
}
