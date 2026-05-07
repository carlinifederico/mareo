// Share dialog: invite collaborators by email, manage roles, remove
// members. Reads/writes /projects/{id}.members.* via ProjectsRepo and
// resolves emails through ProfilesRepo. Owner-only: viewers/editors who
// open it see a read-only members list.

import { Auth } from './auth.js';
import { ProjectsRepo } from './projects-repo.js?v=9';
import { ProfilesRepo } from './profiles-repo.js?v=9';
import { icon } from './icons.js';

let overlay = null;
let currentProjectId = null;

export async function showShareModal(project) {
  if (!project || !project.id) return;
  currentProjectId = project.id;
  build();
  overlay.classList.add('open');
  overlay.querySelector('.share-title').textContent = `Share "${project.name || 'project'}"`;
  overlay.querySelector('.share-status').textContent = '';
  overlay.querySelector('.share-status').className = 'share-status';
  await renderMembers();
  overlay.querySelector('.share-email-input')?.focus();
}

function build() {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'share-overlay';
  overlay.innerHTML = `
    <div class="share-modal" role="dialog" aria-label="Share project">
      <div class="share-header">
        <span class="share-title"></span>
        <button class="share-close" aria-label="Close">${icon('close')}</button>
      </div>
      <div class="share-body">
        <div class="share-section-title">MEMBERS</div>
        <div class="share-members"></div>
        <div class="share-section-title share-invite-title">INVITE BY EMAIL</div>
        <div class="share-invite-row">
          <input type="email" class="share-email-input" placeholder="someone@example.com" autocomplete="off" />
          <select class="share-invite-role">
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
          <button class="share-add-btn">Add</button>
        </div>
        <div class="share-status"></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener('mousedown', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.share-close').addEventListener('click', close);
  overlay.querySelector('.share-add-btn').addEventListener('click', onAdd);
  overlay.querySelector('.share-email-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); onAdd(); }
    if (e.key === 'Escape') close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) close();
  });
}

function close() {
  if (!overlay) return;
  overlay.classList.remove('open');
  currentProjectId = null;
}

async function renderMembers() {
  const list = overlay.querySelector('.share-members');
  list.innerHTML = '<div class="share-loading">Loading…</div>';

  // Always pull a fresh project doc — members may have changed elsewhere.
  let fresh;
  try {
    fresh = await ProjectsRepo.load(currentProjectId);
  } catch (err) {
    list.innerHTML = `<div class="share-empty">Error loading: ${err.message || err}</div>`;
    return;
  }
  if (!fresh) {
    list.innerHTML = '<div class="share-empty">Project not found.</div>';
    return;
  }

  const myUid = Auth.getUid();
  const iAmOwner = ProjectsRepo.roleOf(fresh, myUid) === 'owner';

  const members = fresh.members || {};
  const memberUids = Object.keys(members);
  const profiles = await ProfilesRepo.loadMany(memberUids);
  const profById = new Map(profiles.map(p => [p.uid, p]));

  list.innerHTML = '';
  // Owner first, then editors, then viewers
  const order = { owner: 0, editor: 1, viewer: 2 };
  const sortedUids = memberUids.sort((a, b) => (order[members[a]] ?? 9) - (order[members[b]] ?? 9));

  for (const uid of sortedUids) {
    const role = members[uid];
    const prof = profById.get(uid);
    const row = document.createElement('div');
    row.className = 'share-member-row';

    const avatar = document.createElement('div');
    avatar.className = 'share-member-avatar';
    if (prof?.photoURL) {
      avatar.style.backgroundImage = `url('${prof.photoURL}')`;
    } else {
      avatar.textContent = (prof?.displayName || prof?.email || '?').slice(0, 1).toUpperCase();
    }

    const info = document.createElement('div');
    info.className = 'share-member-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'share-member-name';
    nameEl.textContent = prof?.displayName || (prof?.email || uid.slice(0, 12));
    if (uid === myUid) nameEl.textContent += ' (you)';
    const emailEl = document.createElement('div');
    emailEl.className = 'share-member-email';
    emailEl.textContent = prof?.email || '';
    info.appendChild(nameEl);
    info.appendChild(emailEl);

    row.appendChild(avatar);
    row.appendChild(info);

    // Role + actions
    if (role === 'owner') {
      const badge = document.createElement('span');
      badge.className = 'share-role-badge share-role-owner';
      badge.textContent = 'owner';
      row.appendChild(badge);
    } else if (iAmOwner) {
      const select = document.createElement('select');
      select.className = 'share-role-pick';
      select.innerHTML = '<option value="editor">editor</option><option value="viewer">viewer</option>';
      select.value = role;
      select.addEventListener('change', async () => {
        try {
          await ProjectsRepo.updateMemberRole(currentProjectId, uid, select.value);
          showStatus(`Role updated.`, 'success');
          await renderMembers();
        } catch (err) {
          showStatus(`Error: ${err.message || err}`, 'error');
        }
      });
      row.appendChild(select);

      const rm = document.createElement('button');
      rm.className = 'share-remove-btn';
      rm.title = 'Remove';
      rm.innerHTML = icon('close');
      rm.addEventListener('click', async () => {
        if (!confirm(`Remove ${prof?.email || uid} from this project?`)) return;
        try {
          await ProjectsRepo.removeMember(currentProjectId, uid);
          showStatus(`Removed.`, 'success');
          await renderMembers();
        } catch (err) {
          showStatus(`Error: ${err.message || err}`, 'error');
        }
      });
      row.appendChild(rm);
    } else {
      const badge = document.createElement('span');
      badge.className = 'share-role-badge';
      badge.textContent = role;
      row.appendChild(badge);
    }

    list.appendChild(row);
  }

  // Hide invite row if I'm not the owner
  const inviteSection = overlay.querySelectorAll('.share-invite-title, .share-invite-row');
  for (const el of inviteSection) {
    el.style.display = iAmOwner ? '' : 'none';
  }
}

async function onAdd() {
  const input = overlay.querySelector('.share-email-input');
  const select = overlay.querySelector('.share-invite-role');
  const email = input.value.trim();
  const role = select.value;
  if (!email) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showStatus(`That doesn't look like an email.`, 'error');
    return;
  }
  showStatus('Looking up user…', 'info');
  try {
    const uid = await ProfilesRepo.findUidByEmail(email);
    if (!uid) {
      showStatus(`No MAREO account found for "${email}". They have to sign in once first.`, 'error');
      return;
    }
    if (uid === Auth.getUid()) {
      showStatus(`That's your own email.`, 'error');
      return;
    }
    await ProjectsRepo.addMember(currentProjectId, uid, role);
    showStatus(`Added ${email} as ${role}.`, 'success');
    input.value = '';
    await renderMembers();
  } catch (err) {
    console.error('share add error:', err);
    showStatus(`Error: ${err.code || err.message || err}`, 'error');
  }
}

function showStatus(text, kind) {
  const el = overlay?.querySelector('.share-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'share-status ' + (kind || '');
}
