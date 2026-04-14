import { convex, runQuery, runMutation, runAction, watchQuery } from './convex-client.js';

  /* ------------------------------------------------------------------
     STATE MANAGEMENT
     ------------------------------------------------------------------ */
  let state = {
    view: 'LOADING',
    role: 'GUEST',
    userEmail: '',
    userNickname: '',
    checklist: [],
    notes: [],
    currentAccount: null,
    availableAccounts: [],
    currentCat: localStorage.getItem('zeus_last_cat') || 'HOME',
    selectedSite: 'METRO MANILA',
    weatherRisk: JSON.parse(localStorage.getItem('zeus_weather_cache')) || null,
    isRestoring: true,
    isManage: false,
    isDark: localStorage.getItem('theme') === 'dark',
    isOnline: false,
    currentImageBase64: null,
    currentReminderImageBase64: null,
    context: { type: null, id: null },
    awraUrl: 'https://script.google.com/a/macros/ececontactcenters.com/s/AKfycbyb-WPlhrGMJH-xaTs8dFCdL2Hd57ny5DslnLeuzH-ZPrytn6-y_m0sIMxyJ999ZZvKdQ/exec',
    userAccounts: [],
    selectedRegistrationAccounts: new Set(),
    notesOpen: false,
    notesMode: 'PERSONAL',
    currentNoteId: null,
    taskView: 'PENDING',
    // Render Cache to prevent flickering
    htmlCache: {
      reminders: null,
      checklist: null,
      notes: null,
      announcements: null
    },
    // New States
    lastInteractionTime: Date.now(),
    bulkTaskQueue: [],
    bulkTargetType: 'ALL', // ALL, ACCOUNT, USER
    systemTimeZone: 'America/New_York',
    lastEmojis: JSON.parse(localStorage.getItem('zeus_last_emojis') || '["👍", "❤️", "😂"]'),
    isMaintenanceMode: false,
    canToggleMaintenance: false,
    subscriptions: {
      personal: null,
      account: null
    }
  };
  // helper to update assign button in header
  window.updateAssignButton = function () {
    const btn = document.getElementById('assign-account-btn');
    if (!btn) return;
    if (state.role === 'SUPER_ADMIN') {
      if (state.userAccounts && state.userAccounts.length > 0) {
        btn.innerText = 'Assigned';
        btn.onclick = () => showAssignedPopup();
      } else {
        btn.innerText = 'Assign Account';
        btn.onclick = () => showRegistration();
      }
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  };
  // show list of assigned accounts with unassign buttons
  window.showAssignedPopup = function () {
    const modal = document.getElementById('assigned-modal');
    if (!modal) return;
    const list = modal.querySelector('#assigned-list');
    list.innerHTML = '';
    state.userAccounts.forEach(acc => {
      const row = document.createElement('div');
      row.className = 'flex justify-between items-center my-2 bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-100 dark:border-slate-700';
      row.innerHTML = `<span class="text-xs font-bold uppercase tracking-tight">${acc.name}</span><button class="text-red-500 text-[10px] font-black uppercase px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 transition-colors" onclick="unassignAccount('${acc.id}')">Remove</button>`;
      list.appendChild(row);
    });
    document.getElementById('overlay').classList.remove('hidden');
    modal.classList.remove('hidden');
  };
  window.unassignAccount = function (accId) {
    if (!confirm('Send a request to remove this account?')) return;
    (async () => { try { const res = await runMutation("users:requestAccountRemoval", { email: state.userEmail, accountId: accId }); Promise.resolve().then(() => { const _cb = (() => {
      alert('Removal request sent to super admins.');
      closeModals();
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.filterAccounts = function () {
    const query = document.getElementById('account-search-input').value.toLowerCase();
    const cards = document.querySelectorAll('#icon-grid .tool-card');
    cards.forEach(card => {
      const name = card.querySelector('h3').innerText.toLowerCase();
      const id = card.querySelector('p').innerText.toLowerCase();
      if (name.includes(query) || id.includes(query)) {
        card.classList.remove('hidden');
      } else {
        card.classList.add('hidden');
      }
    });
  };
  window.showAssignLoader = function () {
    const l = document.getElementById('assign-loading-modal');
    if (l) l.classList.remove('hidden');
  };
  window.hideAssignLoader = function () {
    const l = document.getElementById('assign-loading-modal');
    if (l) l.classList.add('hidden');
  };
  /* ------------------------------------------------------------------
     INITIALIZATION
     ------------------------------------------------------------------ */
  window.onload = function () {
    // Start animation immediately
    const animPromise = triggerPortalAnimation("Workforce Zeus");
    initSession();
    // OPTIMIZED POLLING INTERVALS
    // Staggered to prevent hitting Google Apps Script burst quotas
    // 1. Workspace Data (Reminders, Notes, Announcements): Handled by Subscription in loadAccount
    // 3. Personal Tasks (Checklist, Status Heartbeat): Handled by Subscription in initSession

    // 4. Weather Analysis: Refresh every 30 minutes
    setInterval(() => {
      if (state.currentCat === 'HOME') window.fetchWeatherRisk();
    }, 30 * 60 * 1000);
    document.addEventListener('click', handleGlobalClick);
    // Activity Trackers - Update last activity time when user interacts
    window.updateActivity = function () {
      if (!state.userEmail) return;
      const k = `zeus_aux_status_${state.userEmail}`;
      const s = JSON.parse(localStorage.getItem(k)) || { status: 'ONLINE', timestamp: Date.now() };
      const now = Date.now();
      const lastActivity = s.lastActivityTime || s.timestamp;
      const timeDiff = now - lastActivity;
      const awayTime = 1 * 60 * 60 * 1000; // 1 hour
      // Auto-Online Logic:
      // Marked online if there is activity on tool if status is away or inactive.
      // If marked offline, even tho there is activity on tool, aux must not automatically mark them online unless switched.
      if (s.status !== 'OFFLINE' && timeDiff > awayTime) {
        s.status = 'ONLINE';
        // Sync to server
        (async () => { try { const res = await runMutation("users:updateUserAuxStatus", { email: state.userEmail, auxStatus: 'ONLINE' }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
      }
      s.lastActivityTime = now;
      state.lastInteractionTime = now;
      localStorage.setItem(k, JSON.stringify(s));
      checkOnlineStatus();
    };
    document.addEventListener('mousemove', window.updateActivity);
    document.addEventListener('keydown', window.updateActivity);
    document.addEventListener('click', window.updateActivity);
    // Chat input: send on Enter, allow Shift+Enter for newline
    window.syncSOPs();
  };
  // Global error handler to surface runtime errors in the UI for debugging
  window.onerror = function (message, source, lineno, colno, error) {
    try {
      console.error('Runtime error', message, source, lineno, colno, error);
      const overlay = document.getElementById('overlay');
      if (overlay) overlay.classList.remove('hidden');
      let dbg = document.getElementById('zeus-error-debug');
      // create or reuse debug box
      if (!dbg) {
        dbg = document.createElement('div');
        dbg.id = 'zeus-error-debug';
        dbg.style.position = 'fixed'; dbg.style.right = '20px'; dbg.style.bottom = '20px'; dbg.style.zIndex = 99999;
        dbg.style.maxWidth = '480px'; dbg.style.padding = '12px'; dbg.style.borderRadius = '12px'; dbg.style.background = 'rgba(0,0,0,0.85)'; dbg.style.color = 'white'; dbg.style.fontSize = '12px';
        dbg.style.boxShadow = '0 8px 24px rgba(0,0,0,0.4)';
        dbg.style.opacity = '0'; dbg.style.transition = 'opacity 0.35s ease';
        document.body.appendChild(dbg);
      }
      // populate content and show
      dbg.innerText = `${message} -- ${source}:${lineno}:${colno}` + (error && error.stack ? '\n' + error.stack : '');
      // ensure visible
      requestAnimationFrame(() => { dbg.style.opacity = '1'; });
      // auto-hide after 8s (clear previous timer if present)
      if (window.__zeusErrorHideTimer) { clearTimeout(window.__zeusErrorHideTimer); window.__zeusErrorHideTimer = null; }
      window.__zeusErrorHideTimer = setTimeout(() => {
        try {
          dbg.style.opacity = '0';
          setTimeout(() => { if (dbg && dbg.parentNode) dbg.parentNode.removeChild(dbg); }, 450);
          if (overlay) overlay.classList.add('hidden');
        } catch (e) { console.error('Error hiding debug overlay', e); }
      }, 8000);
    } catch (e) { console.error('Error rendering debug overlay', e); }
    return false;
  };
  window.addEventListener('unhandledrejection', function (e) {
    const msg = e.reason && e.reason.message ? e.reason.message : String(e.reason);
    window.onerror(msg, location.href, 0, 0, e.reason);
  });

  function handleGlobalClick(event) {
    const contextMenu = document.getElementById('context-menu');
    if (contextMenu && !contextMenu.contains(event.target)) contextMenu.classList.add('hidden');
    if (state.notesOpen) {
      const ns = document.getElementById('notes-sidebar');
      const nt = document.querySelector('.notes-trigger');
      const nm = document.getElementById('note-modal');
      const nd = document.getElementById('notes-dashboard-modal');
      const ne = document.getElementById('note-editor-modal');
      const isModalOpen = (nm && !nm.classList.contains('hidden')) ||
        (nd && !nd.classList.contains('hidden')) ||
        (ne && !ne.classList.contains('hidden'));
      if (ns && nt && !ns.contains(event.target) && !nt.contains(event.target) && !isModalOpen) {
        window.toggleNotes();
      }
    }
    const sb = document.getElementById('sidebar');
    const st = document.getElementById('sidebar-toggle');
    if (sb && st && sb.classList.contains('left-0') && !sb.contains(event.target) && !st.contains(event.target)) window.toggleSidebar();
  }

  // --- REACTIVE SUBSCRIPTIONS ---
  window.subscribePersonalUpdates = function () {
    if (!state.userEmail) return;
    if (state.subscriptions.personal) state.subscriptions.personal(); // Unsubscribe existing
    
    state.subscriptions.personal = watchQuery("tasks:fetchPersonalUpdates", { email: state.userEmail }, (data) => {
      if (!data) return;
      
      // 1. Checklist
      if (Array.isArray(data.checklist)) {
        const oldJson = JSON.stringify(state.checklist);
        const newJson = JSON.stringify(data.checklist);
        if (oldJson !== newJson) {
          state.checklist = data.checklist;
          if (state.currentCat === 'HOME') updateChecklistUI();
        }
      }
      
      // 2. Notifications
      if (Array.isArray(data.notifications) && data.notifications.length) {
        data.notifications.forEach(n => {
          if (n.type === 'access') {
            const typeLabel = n.requestType === 'REMOVAL' ? 'removal' : 'access';
            if (n.approved) {
              const accName = state.availableAccounts.find(a => a.id === n.accountId)?.name || n.accountId;
              if (n.requestType === 'REMOVAL' && state.currentAccount && state.currentAccount.id === n.accountId) {
                alert(`Your removal request for workspace ${accName} has been approved.`);
                window.location.reload(); // Hard reload on removal approval to clear state
              } else if (n.requestType === 'ACCESS' || !n.requestType) {
                alert(`Your access request for workspace ${accName} has been approved.`);
                window.loadAccount(n.accountId);
              } else {
                initSession();
              }
            } else {
              const accName = state.availableAccounts.find(a => a.id === n.accountId)?.name || n.accountId;
              alert(`Your ${typeLabel} request for workspace ${accName} was denied.`);
            }
          }
        });
      }
    }, (err) => {
      console.error("[Zeus] Personal subscription error:", err);
    });
  };

  window.subscribeAccountUpdates = function (accountId) {
    if (!state.userEmail || !accountId) return;
    if (state.subscriptions.account) state.subscriptions.account(); // Unsubscribe existing
    
    state.subscriptions.account = watchQuery("accounts:getAccountData", { accountId: accountId }, (data) => {
      if (!data || !data.id || !state.currentAccount || state.currentAccount.id !== data.id) return;
      
      // 1. Reminders
      if (Array.isArray(data.activeReminders)) {
        const oldRem = state.currentAccount ? JSON.stringify(state.currentAccount.activeReminders) : '';
        const newRem = JSON.stringify(data.activeReminders);
        if (oldRem !== newRem) {
          state.currentAccount.activeReminders = data.activeReminders;
          if (state.currentCat === 'HOME') updateRemindersUI();
        }
      }
      
      // 2. Notes (Team)
      if (Array.isArray(data.notes)) {
        const oldNotes = state.currentAccount ? JSON.stringify(state.currentAccount.notes) : '';
        const newNotes = JSON.stringify(data.notes);
        if (oldNotes !== newNotes) {
          state.currentAccount.notes = data.notes;
          if (state.notesOpen && state.notesMode === 'TEAM') renderNotes();
        }
      }
      
      // 3. Broadcasts
      if (Array.isArray(data.announcements)) {
        const oldAnn = state.currentAccount ? JSON.stringify(state.currentAccount.announcements) : '';
        const newAnn = JSON.stringify(data.announcements);
        if (oldAnn !== newAnn) {
          state.currentAccount.announcements = data.announcements;
          if (state.currentCat === 'HOME') renderAnnouncements();
        }
      }
    }, (err) => {
      console.error("[Zeus] Account subscription error:", err);
    });
  };

  window.refreshDashboard = function () {
    const icons = document.querySelectorAll('.refresh-spin-icon');
    icons.forEach(i => i.classList.add('animate-spin'));
    // Clear cache to force re-render
    state.htmlCache = { reminders: null, checklist: null, notes: null, announcements: null };
    
    // Re-trigger subscriptions to force a fresh fetch
    window.subscribePersonalUpdates();
    if (state.currentAccount && state.currentAccount.id) {
       window.subscribeAccountUpdates(state.currentAccount.id);
    }

    // Minimum spin time of 0.8s for visual feedback
    setTimeout(() => {
      icons.forEach(i => i.classList.remove('animate-spin'));
    }, 800);
  };
  // Granular Reminders Update with HTML Caching to Stop Flickering & Attribution
  window.updateRemindersUI = function () {
    const container = document.getElementById('reminders-container');
    if (!container) return;
    const reminders = state.currentAccount.activeReminders || [];
    let newHTML = '';
    if (reminders.length === 0) {
      newHTML = `<div class="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-[1.5rem] p-6 text-slate-400"><span class="material-icons text-3xl mb-2 opacity-50">notifications_off</span><span class="text-[10px] font-black uppercase tracking-widest">No Active Reminders</span></div>`;
    } else {
      const cards = reminders.map(r => {
        const canDelete = r.senderEmail === state.userEmail;
        const deleteBtn = canDelete ? `<span class="material-icons text-lg text-slate-300 hover:text-red-500 cursor-pointer transition-colors" onclick="deleteReminder('${r._id}')">delete</span>` : '';
        // Avatar fallback
        const initial = r.sender ? r.sender.charAt(0) : 'A';
        return `
               <div class="bg-white dark:bg-slate-800 p-5 rounded-2xl border border-slate-100 dark:border-slate-700 shadow-sm flex flex-col gap-3 relative group transition-transform hover:scale-[1.01] shrink-0">
                  <div class="flex justify-between items-start">
                     <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center text-primary-600 font-bold text-xs uppercase shadow-sm">${initial}</div>
                        <div><span class="text-[10px] font-black uppercase text-primary-600 tracking-wider block">${r.sender}</span><span class="text-[9px] text-slate-400 block font-medium">${new Date(r.scheduledTime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: state.systemTimeZone })}</span></div>
                     </div>
                     ${deleteBtn}
                  </div>
                  <p class="text-sm font-semibold text-slate-700 dark:text-slate-200 leading-snug">${r.message}</p>
                  ${r.imageUrl ? `<div class="w-full h-32 rounded-xl overflow-hidden cursor-zoom-in border border-slate-100 dark:border-slate-700 relative group/img" onclick="openImageZoom('${r.imageUrl}')"><img src="${r.imageUrl}" class="w-full h-full object-cover transition-transform duration-500 group-hover/img:scale-105"><div class="absolute inset-0 bg-black/20 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center"><span class="material-icons text-white drop-shadow-lg">zoom_in</span></div></div>` : ''}
                  <div class="mt-auto pt-2 border-t border-slate-50 dark:border-slate-700/50 flex justify-between items-center"><span class="text-[9px] font-bold uppercase text-slate-300 tracking-widest">${r.isRecurring ? 'Recurring: ' + r.recurrenceRule : 'Expires in ' + (r.durationHours || 24) + 'h'}</span></div>
               </div>`;
      }).join('');
      newHTML = `<div class="flex flex-col gap-4 overflow-y-auto custom-scrollbar pb-4 pr-1 h-full">${cards}</div>`;
    }
    // CHECK CACHE: If HTML is identical to last render, skip DOM update entirely (Prevents Flickering)
    if (state.htmlCache.reminders === newHTML) return;
    // Capture scroll position before update
    const scrollable = container.querySelector('.custom-scrollbar');
    const savedScrollTop = scrollable ? scrollable.scrollTop : 0;
    // Apply Update
    container.innerHTML = newHTML;
    // Update Cache
    state.htmlCache.reminders = newHTML;
    // Restore scroll position
    const newScrollable = container.querySelector('.custom-scrollbar');
    if (newScrollable) newScrollable.scrollTop = savedScrollTop;
  };
  // Granular Checklist Update with HTML Caching to Stop Flickering & Added Attribution
  window.updateChecklistUI = function () {
    const wrapper = document.getElementById('checklist-wrapper');
    if (!wrapper) return;
    const isPendingView = state.taskView === 'PENDING';
    const filteredTasks = state.checklist.filter(t => isPendingView ? !t.isDone : t.isDone).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    const taskItems = filteredTasks.map(task => {
      // Task Attribution Logic
      let senderBadge = '';
      if (task.sender) {
        senderBadge = `<span class="text-[8px] font-black uppercase text-primary-500 bg-primary-50 dark:bg-primary-900/30 px-1.5 py-0.5 rounded ml-2 whitespace-nowrap">BY ${task.sender}</span>`;
      }
      return `
        <div class="group flex items-start gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border border-transparent hover:border-slate-100 dark:hover:border-slate-700">
            <div onclick="toggleTaskAction('${task.id}')" class="cursor-pointer w-5 h-5 rounded-md border-2 shrink-0 mt-0.5 ${task.isDone ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 dark:border-slate-600'} flex items-center justify-center transition-all">
                ${task.isDone ? '<span class="material-icons text-white text-[14px] font-bold">check</span>' : ''}
            </div>
            <div class="flex-1 min-w-0">
                <span class="text-xs font-semibold ${task.isDone ? 'text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200'} block break-words">${task.text}</span>
                ${senderBadge}
            </div>
            ${!task.isDone ? `<button onclick="deleteTaskAction('${task.id}')" class="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all shrink-0"><span class="material-icons text-sm">close</span></button>` : ''}
        </div>`;
    }).join('');
    const emptyState = `<div class="flex flex-col items-center justify-center h-full text-slate-400 opacity-60"><span class="material-icons text-2xl mb-1">${isPendingView ? 'checklist' : 'history'}</span><span class="text-[9px] font-black uppercase tracking-widest">${isPendingView ? 'All caught up' : 'No history yet'}</span></div>`;
    // REFRESH BUTTON ADDED HERE
    const newHTML = `<div class="flex items-center justify-between mb-3"><div class="flex items-center gap-2"><h2 class="text-[9px] font-black text-slate-400 tracking-[0.2em] uppercase flex items-center gap-2"><span class="material-icons text-xs text-emerald-500">task_alt</span> My Tasks</h2><button onclick="refreshDashboard()" class="text-slate-400 hover:text-primary-600 transition-colors" title="Refresh"><span class="material-icons text-sm refresh-spin-icon">refresh</span></button></div><div class="flex bg-slate-200 dark:bg-slate-800 p-0.5 rounded-lg"><button onclick="setTaskView('PENDING')" class="px-3 py-1 text-[8px] font-black uppercase tracking-widest rounded-md transition-all ${isPendingView ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : 'text-slate-500'}">Pending</button><button onclick="setTaskView('HISTORY')" class="px-3 py-1 text-[8px] font-black uppercase tracking-widest rounded-md transition-all ${!isPendingView ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : 'text-slate-500'}">History</button></div></div><div class="flex-1 bg-white dark:bg-slate-900 rounded-[1.5rem] border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden">${isPendingView ? `<div class="p-4 border-b border-slate-100 dark:border-slate-800"><input type="text" id="new-task-input" placeholder="Add personal task..." class="w-full bg-slate-50 dark:bg-slate-800 dark:text-white text-xs font-semibold px-4 py-2 rounded-xl outline-none focus:ring-2 focus:ring-primary-100 transition-all" onkeypress="if(event.key === 'Enter') addPersonalTaskAction()"></div>` : ''}<div class="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">${filteredTasks.length > 0 ? taskItems : emptyState}</div></div>`;
    // CHECK CACHE: If HTML is identical to last render, skip DOM update entirely (Prevents Flickering)
    if (state.htmlCache.checklist === newHTML) return;
    // Capture scroll position
    const scrollable = wrapper.querySelector('.custom-scrollbar');
    const savedScrollTop = scrollable ? scrollable.scrollTop : 0;
    // Apply Update
    wrapper.innerHTML = newHTML;
    // Update Cache
    state.htmlCache.checklist = newHTML;
    // Restore scroll
    const newScrollable = wrapper.querySelector('.custom-scrollbar');
    if (newScrollable) newScrollable.scrollTop = savedScrollTop;
  };
  /* ------------------------------------------------------------------
     ADMIN DASHBOARD LOGIC
     ------------------------------------------------------------------ */
  window.openAdminDashboard = function () {
    document.getElementById('admin-dashboard-modal').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
    const sel = document.getElementById('task-target-select');
    const statusFilter = document.getElementById('status-filter-acc');
    const histFilter = document.getElementById('history-filter-acc');
    sel.innerHTML = '';
    statusFilter.innerHTML = '<option value="ALL">All Servers</option>';
    histFilter.innerHTML = '<option value="ALL">All Servers</option>';
    state.availableAccounts.forEach(acc => {
      sel.innerHTML += `<option value="${acc.id}">${acc.name}</option>`;
      statusFilter.innerHTML += `<option value="${acc.name}">${acc.name}</option>`;
      histFilter.innerHTML += `<option value="${acc.id}">${acc.name}</option>`;
    });
    switchAdminTab('tasks');
  };
  window.switchAdminTab = function (tab) {
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.getElementById('admin-view-tasks').classList.add('hidden');
    document.getElementById('admin-view-status').classList.add('hidden');
    document.getElementById('admin-view-history').classList.add('hidden');
    document.getElementById(`admin-view-${tab}`).classList.remove('hidden');
    if (tab === 'status') fetchLiveStatus();
    if (tab === 'history') fetchTaskHistory();
  };
  window.setTaskTargetType = function (type) {
    state.bulkTargetType = type;
    ['all', 'acc', 'user'].forEach(k => {
      const btn = document.getElementById(`tt-${k}`);
      if (k === type.toLowerCase() || (k === 'acc' && type === 'ACCOUNT')) {
        btn.classList.remove('bg-slate-100', 'text-slate-500', 'dark:bg-slate-800');
        btn.classList.remove('bg-white', 'border-slate-200');
        btn.classList.add('bg-primary-600', 'text-white', 'border-primary-600');
      } else {
        btn.classList.add('bg-white', 'text-slate-500', 'dark:bg-slate-800', 'border-slate-200');
        btn.classList.remove('bg-primary-600', 'text-white', 'border-primary-600', 'bg-slate-100');
      }
    });
    const inp = document.getElementById('task-target-input');
    const sel = document.getElementById('task-target-select');
    if (type === 'ALL') {
      inp.classList.add('hidden');
      sel.classList.add('hidden');
    } else if (type === 'ACCOUNT') {
      inp.classList.add('hidden');
      sel.classList.remove('hidden');
    } else {
      inp.classList.remove('hidden');
      sel.classList.add('hidden');
    }
  };
  window.addToTaskQueue = function () {
    const inp = document.getElementById('bulk-task-input');
    const txt = inp.value.trim();
    if (!txt) return;
    state.bulkTaskQueue.push(txt);
    inp.value = '';
    renderTaskQueue();
  };
  window.renderTaskQueue = function () {
    const c = document.getElementById('task-queue-list');
    const btn = document.getElementById('dispatch-tasks-btn');
    if (state.bulkTaskQueue.length === 0) {
      c.innerHTML = '<div class="flex h-full items-center justify-center text-slate-400 text-xs italic">Queue empty</div>';
      btn.disabled = true;
    } else {
      c.innerHTML = state.bulkTaskQueue.map((t, idx) => `
            <div class="flex justify-between items-center bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm group">
                <span class="text-xs font-bold text-slate-700 dark:text-slate-200 truncate flex-1">${t}</span>
                <button onclick="removeFromQueue(${idx})" class="text-slate-300 hover:text-red-500"><span class="material-icons text-sm">close</span></button>
            </div>
        `).join('');
      btn.disabled = false;
    }
  };
  window.removeFromQueue = function (idx) {
    state.bulkTaskQueue.splice(idx, 1);
    renderTaskQueue();
  };
  window.dispatchBulkTasks = function () {
    if (state.bulkTaskQueue.length === 0) return;
    let targetId = null;
    if (state.bulkTargetType === 'ACCOUNT') {
      targetId = document.getElementById('task-target-select').value;
    } else if (state.bulkTargetType === 'USER') {
      targetId = document.getElementById('task-target-input').value;
      if (!targetId) { alert("Enter User Email"); return; }
    }
    const btn = document.getElementById('dispatch-tasks-btn');
    window.setBtnLoading('dispatch-tasks-btn', true);
    (async () => { try { const res = await runMutation("tasks:bulkAssignTasks", { callerEmail: state.userEmail, targetType: state.bulkTargetType, targetId: targetId, tasks: state.bulkTaskQueue, senderNickname: state.userNickname }); Promise.resolve().then(() => { const _cb = (msg => {
      alert(msg);
      state.bulkTaskQueue = [];
      renderTaskQueue();
      window.setBtnLoading('dispatch-tasks-btn', false, "Dispatch Tasks");
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.fetchLiveStatus = function () {
    (async () => { try { const res = await runQuery("status:getLiveStatus", { callerEmail: state.userEmail }); Promise.resolve().then(() => { const _cb = (renderLiveStatus); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.renderLiveStatus = function (users) {
    const tbody = document.getElementById('status-table-body');
    const filter = document.getElementById('status-filter-acc').value;
    const countEl = document.getElementById('live-online-count');
    let onlineCount = 0;
    let html = '';
    const statusConfig = {
      'ONLINE': { text: 'Online', color: 'emerald', dot: 'bg-emerald-500' },
      'LUNCH': { text: 'Lunch', color: 'yellow', dot: 'bg-yellow-500' },
      'BREAK': { text: 'Break', color: 'blue', dot: 'bg-blue-500' },
      'AFK': { text: 'AFK', color: 'orange', dot: 'bg-orange-500' },
      'PRODWALK': { text: 'Prod Walk', color: 'purple', dot: 'bg-purple-500' },
      'BIO': { text: 'Bio', color: 'pink', dot: 'bg-pink-500' },
      'OFFLINE': { text: 'Offline', color: 'slate', dot: 'bg-slate-400' },
      'Away': { text: 'Away', color: 'amber', dot: 'bg-amber-500' },
      'Inactive': { text: 'Inactive', color: 'slate', dot: 'bg-slate-400' }
    };
    users.forEach(u => {
      if (filter !== 'ALL' && u.accountName !== filter) return;
      // Get user's AUX status from localStorage
      const auxStatus = u.auxStatus || 'ONLINE';
      const statusInfo = statusConfig[auxStatus] || statusConfig['ONLINE'];
      if (auxStatus === 'ONLINE') onlineCount++;
      html += `
            <tr class="hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800">
                <td class="p-4">
                    <div class="flex flex-col">
                        <span class="text-xs font-black uppercase text-slate-700 dark:text-slate-200">${u.nickname}</span>
                        <span class="text-[9px] text-slate-400 font-bold tracking-widest">${u.email}</span>
                    </div>
                </td>
                <td class="p-4">
                    <span class="bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-1 rounded text-[9px] font-black uppercase tracking-widest">${u.accountName}</span>
                </td>
                <td class="p-4 text-right">
                    <div class="flex items-center justify-end gap-2">
                        <span class="text-[9px] font-bold uppercase text-${statusInfo.color}-600 dark:text-${statusInfo.color}-400">${statusInfo.text}</span>
                        <div class="w-2.5 h-2.5 rounded-full ${statusInfo.dot} shadow-[0_0_6px_rgba(0,0,0,0.2)]"></div>
                    </div>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html || '<tr><td colspan="3" class="p-4 text-center text-slate-400 text-xs italic">No active users found.</td></tr>';
    countEl.innerText = onlineCount;
  };
  window.fetchTaskHistory = function () {
    const acc = document.getElementById('history-filter-acc').value;
    const usr = document.getElementById('history-filter-user').value.trim();
    const dFrom = document.getElementById('history-filter-date-from').value;
    const dTo = document.getElementById('history-filter-date-to').value;
    document.getElementById('history-table-body').innerHTML = '<tr><td colspan="4" class="p-8 text-center"><span class="material-icons animate-spin text-slate-400">sync</span></td></tr>';
    (async () => { try { const res = await runQuery("tasks:getTaskHistory", { callerEmail: state.userEmail, filterAccount: acc, filterUser: usr, dateFrom: dFrom, dateTo: dTo }); Promise.resolve().then(() => { const _cb = (renderTaskHistory); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.renderTaskHistory = function (tasks) {
    const tbody = document.getElementById('history-table-body');
    if (tasks.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="p-8 text-center text-xs text-slate-400 font-bold uppercase tracking-widest">No history found</td></tr>';
      return;
    }
    tbody.innerHTML = tasks.map(t => {
      const completedDate = t.completedAt && t.completedAt !== "Unknown" ? new Date(t.completedAt).toLocaleString([], { timeZone: state.systemTimeZone }) : "Unknown Date";
      return `
            <tr class="hover:bg-slate-100 dark:hover:bg-slate-800/50 transition-colors border-b border-slate-100 dark:border-slate-800">
                <td class="p-3">
                    <span class="text-xs font-bold text-slate-700 dark:text-slate-200">${t.taskText}</span>
                </td>
                <td class="p-3">
                    <div class="flex flex-col">
                        <span class="text-[10px] font-black uppercase text-slate-600 dark:text-slate-300">${t.user}</span>
                        <span class="text-[8px] text-slate-400 tracking-wider">${t.email}</span>
                    </div>
                </td>
                <td class="p-3">
                    <span class="bg-primary-50 dark:bg-slate-800 text-primary-600 dark:text-primary-400 px-2 py-1 rounded text-[8px] font-black uppercase tracking-widest">${t.account}</span>
                </td>
                <td class="p-3 text-right">
                    <span class="text-[9px] font-bold text-slate-400">${completedDate}</span>
                </td>
            </tr>
        `;
    }).join('');
  };
  /* ------------------------------------------------------------------
     FEEDBACK LOGIC
     ------------------------------------------------------------------ */
  window.openFeedback = function () {
    const isJomz = state.userEmail === 'jomari.garces@ececontactcenters.com' || state.role === 'SUPER_ADMIN';
    const isViewer = state.userEmail === 'jomari.garces@ececontactcenters.com';
    document.getElementById('feedback-modal').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
    if (isViewer) {
      document.getElementById('feedback-form-view').classList.add('hidden');
      document.getElementById('feedback-list-view').classList.remove('hidden');
      loadFeedbacks();
    } else {
      document.getElementById('feedback-list-view').classList.add('hidden');
      document.getElementById('feedback-form-view').classList.remove('hidden');
    }
  };
  window.sendFeedback = function () {
    const msg = document.getElementById('feedback-input').value.trim();
    if (!msg) return;
    window.setBtnLoading('send-feedback-btn', true);
    (async () => { try { const res = await runMutation("feedback:submitFeedback", { email: state.userEmail, nickname: state.userNickname, message: msg }); Promise.resolve().then(() => { const _cb = (() => {
      alert("Feedback sent! Thank you.");
      document.getElementById('feedback-input').value = '';
      document.getElementById('feedback-modal').classList.add('hidden');
      document.getElementById('overlay').classList.add('hidden');
      window.setBtnLoading('send-feedback-btn', false, "Submit Feedback");
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.loadFeedbacks = function () {
    const list = document.getElementById('feedback-list-view');
    list.innerHTML = '<div class="text-center text-slate-400 text-xs py-10"><span class="material-icons animate-spin">sync</span></div>';
    (async () => { try { const res = await runQuery("feedback:getFeedbacks", { callerEmail: state.userEmail }); Promise.resolve().then(() => { const _cb = (feedbacks => {
      if (feedbacks.length === 0) {
        list.innerHTML = '<div class="text-center text-slate-400 text-xs py-10 font-bold uppercase tracking-widest">No feedbacks yet</div>';
        return;
      }
      list.innerHTML = feedbacks.map(f => `
            <div class="bg-slate-50 dark:bg-slate-800 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                <div class="flex justify-between items-start mb-2">
                    <span class="text-[10px] font-black uppercase text-primary-600 tracking-widest">${f.sender}</span>
                    <span class="text-[8px] font-bold text-slate-400 uppercase">${new Date(f.timestamp).toLocaleString([], { timeZone: state.systemTimeZone })}</span>
                </div>
                <p class="text-xs text-slate-700 dark:text-slate-300 font-medium leading-relaxed">${f.message}</p>
                <div class="mt-2 text-[8px] text-slate-400">${f.email}</div>
            </div>
        `).join('');
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  /* ------------------------------------------------------------------
     ANIMATION & NAVIGATION
     ------------------------------------------------------------------ */
  window.triggerPortalAnimation = function (text) {
    return new Promise(resolve => {
      let displayText = "Server";
      if (text && text !== "Workforce Zeus") {
        displayText = text;
      }
      let overlay = document.querySelector('.portal-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'portal-overlay';
        document.body.appendChild(overlay);
      }
      overlay.innerHTML = `<div class="portal-text">${displayText}</div>`;
      overlay.style.display = 'flex';
      setTimeout(() => {
        overlay.style.display = 'none';
        resolve();
      }, 800);
    });
  };
  function initSession() {
    (async () => { try { const res = await runQuery("users:getSessionInfo", { email: state.userEmail || localStorage.getItem('zeus_user_email') || "" }); Promise.resolve().then(() => { const _cb = (function (info) {
      state.role = info.role;
      state.userEmail = info.email;
      state.userNickname = info.nickname;
      state.checklist = info.checklist || [];
      state.notes = info.notes || [];
      state.availableAccounts = info.accounts;
      state.userAccounts = info.userAccounts || [];
      state.isMaintenanceMode = info.isMaintenanceMode;
      state.canToggleMaintenance = info.canToggleMaintenance;

      const nickEl = document.getElementById('header-nickname-display');
      if (nickEl) nickEl.innerText = info.nickname;

      renderMaintenanceUI();
      updateAssignButton();
      checkOnlineStatus();
      window.subscribePersonalUpdates();

      const lastAccountId = localStorage.getItem('zeus_last_account');
      if (info.role === 'SUPER_ADMIN') {
        // super admins get notification button refreshed
        fetchAccessRequests();
        if (lastAccountId && info.accounts.some(a => a.id === lastAccountId)) { window.loadAccount(lastAccountId); }
        else { state.isRestoring = false; window.showAccountSelector(); }
      } else if (info.role === 'ACCOUNT_USER') {
        if (lastAccountId && info.accounts.some(a => a.id === lastAccountId)) { window.loadAccount(lastAccountId); }
        else if (info.assignedAccount) { window.loadAccount(info.assignedAccount); }
        else { showRegistration(); }
      } else if (info.role === 'GUEST') {
        state.isRestoring = false;
        showRegistration();
      }
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  }

  window.toggleMaintenanceMode = function () {
    const action = state.isMaintenanceMode ? 'Deactivate' : 'Activate';
    if (!confirm(`Are you sure you want to ${action} Maintenance Mode? This will affect all users.`)) return;

    (async () => { try { const res = await runMutation("users:toggleMaintenanceMode", { callerEmail: state.userEmail }); Promise.resolve().then(() => { const _cb = (status => {
      state.isMaintenanceMode = status;
      renderMaintenanceUI();
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };

  function renderMaintenanceUI() {
    const overlay = document.getElementById('maintenance-overlay');
    const toggleBtn = document.getElementById('maintenance-toggle-btn');
    const offBtn = document.getElementById('maintenance-off-btn');

    if (state.canToggleMaintenance) {
      if (toggleBtn) {
        toggleBtn.classList.remove('hidden');
        toggleBtn.innerText = state.isMaintenanceMode ? "OFF MAINT." : "MAINTENANCE";
        toggleBtn.classList.toggle('bg-rose-600', !state.isMaintenanceMode);
        toggleBtn.classList.toggle('bg-slate-600', state.isMaintenanceMode);
      }
      if (offBtn) offBtn.classList.toggle('hidden', !state.isMaintenanceMode);
    } else {
      if (toggleBtn) toggleBtn.classList.add('hidden');
      if (offBtn) offBtn.classList.add('hidden');
    }

    if (state.isMaintenanceMode && !state.canToggleMaintenance) {
      overlay.classList.remove('hidden');
    } else {
      overlay.classList.add('hidden');
    }
  }

  window.showAccountSelector = async function () {
    if (state.view !== 'SELECTOR') await window.triggerPortalAnimation("Server");
    state.view = 'SELECTOR';
    state.currentAccount = null;
    state.isManage = false;
    localStorage.removeItem('zeus_last_account');
    document.getElementById('account-filter-container').classList.add('hidden');
    document.getElementById('account-search-input').value = '';
    document.getElementById('account-switcher-trigger').classList.add('hidden');
    document.getElementById('nav-back-to-selector').classList.add('hidden');
    document.getElementById('manageBtn').classList.add('hidden');
    document.getElementById('announceBtn').classList.add('hidden');
    document.getElementById('orgChartBtn').classList.add('hidden');
    // Show announcement button ONLY for SUPER_ADMIN on selector
    const serverBtn = document.getElementById('server-announce-btn');
    if (serverBtn) {
      if (state.role === 'SUPER_ADMIN') serverBtn.classList.remove('hidden');
      else serverBtn.classList.add('hidden');
    }
    document.getElementById('sidebar-toggle').classList.remove('invisible');
    document.getElementById('sidebar').classList.add('left-[-260px]');
    document.getElementById('add-cat-btn').classList.add('hidden');
    document.getElementById('category-header').classList.add('hidden');
    document.getElementById('category-list').innerHTML = '';
    if (state.role === 'SUPER_ADMIN') {
      document.getElementById('admin-registry-header').classList.remove('hidden');
      document.getElementById('admin-registry').classList.remove('hidden');
      fetchRegistry();
    } else {
      document.getElementById('admin-registry-header').classList.add('hidden');
      document.getElementById('admin-registry').classList.add('hidden');
    }
    renderContent();
  };
  window.loadAccount = async function (accountId) {
    // only allow if user actually belongs to that account (or is super admin)
    const hasAccess = state.role === 'SUPER_ADMIN' || state.userAccounts.some(a => a.id === accountId);
    if (!hasAccess) {
      state.selectedRegistrationAccounts.clear();
      state.selectedRegistrationAccounts.add(accountId);
      window.proceedToNickname();
      return;
    }
    const acc = state.availableAccounts.find(a => a.id === accountId);
    const name = acc ? acc.name : "Loading...";
    await window.triggerPortalAnimation(name);
    closeModals();
    const grid = document.getElementById('icon-grid');
    grid.innerHTML = '<div class="flex items-center justify-center min-h-[50vh]"><span class="material-icons text-4xl text-primary-600 animate-spin">sync</span></div>';
    localStorage.setItem('zeus_last_account', accountId);
    (async () => { try { const res = await runQuery("accounts:getAccountData", { accountId: accountId }); Promise.resolve().then(() => { const _cb = (function (data) {
      if (!data) { window.showAccountSelector(); return; }
      state.currentAccount = data;
      state.view = 'PORTAL';
      state.isManage = false;
      if (state.isRestoring) {
        state.currentCat = localStorage.getItem('zeus_last_cat') || 'HOME';
        state.isRestoring = false;
      } else {
        state.currentCat = 'HOME';
        localStorage.setItem('zeus_last_cat', 'HOME');
      }
      document.getElementById('sidebar-toggle').classList.remove('invisible');
      document.getElementById('admin-registry-header').classList.add('hidden');
      document.getElementById('admin-registry').classList.add('hidden');
      document.getElementById('category-header').classList.remove('hidden');
      document.getElementById('add-cat-btn').classList.add('hidden');
      const switcher = document.getElementById('account-switcher-trigger');
      const backBtn = document.getElementById('nav-back-to-selector');
      const display = document.getElementById('current-account-display');
      if (state.role === 'SUPER_ADMIN' || state.availableAccounts.length > 1) {
        switcher.classList.remove('hidden'); switcher.classList.add('flex');
        backBtn.classList.remove('hidden'); display.innerText = data.name;
      } else {
        switcher.classList.add('hidden'); backBtn.classList.add('hidden');
      }
      document.getElementById('manageBtn').classList.remove('hidden');
      document.getElementById('manageBtn').innerText = "Manage";
      document.getElementById('manageBtn').className = "bg-primary-600 hover:bg-primary-700 text-white text-[10px] font-black tracking-widest px-4 py-2 rounded-full transition-all uppercase shadow-md shadow-primary-500/20";
      document.getElementById('announceBtn').classList.remove('hidden');
      // Hide server button when on account portal (not selector)
      const srv = document.getElementById('server-announce-btn');
      if (srv) srv.classList.add('hidden');
      // Org Chart Button Visibility (Walmart Only)
      const isWalmart = data.name.toLowerCase().includes('walmart');
      document.getElementById('orgChartBtn').classList.toggle('hidden', !isWalmart);
      
      window.subscribeAccountUpdates(accountId);
      
      renderCategories();
      renderContent();
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  /* ------------------------------------------------------------------
     MAIN CONTENT RENDERER
     ------------------------------------------------------------------ */
  function renderContent() {
    const grid = document.getElementById('icon-grid');
    const main = document.getElementById('main-content');
    const filterContainer = document.getElementById('account-filter-container');
    // Hide filter by default, only show in SELECTOR view
    if (filterContainer) filterContainer.classList.add('hidden');
    if (state.view !== 'PORTAL') {
      grid.innerHTML = '';
    } else if (state.currentCat !== 'HOME') {
      grid.innerHTML = '';
    }
    if (state.view === 'REGISTRATION') {
      const hasSelection = state.selectedRegistrationAccounts.size > 0;
      if (!state.availableAccounts || state.availableAccounts.length === 0) {
        grid.innerHTML = `<div class="max-w-4xl mx-auto pt-20 text-center"><span class="material-icons text-6xl text-slate-300 mb-4">dns</span><h1 class="text-2xl font-black italic tracking-tighter mb-2 uppercase text-slate-700 dark:text-slate-200">No Servers Online</h1><p class="text-slate-500 font-medium text-xs">Please contact your administrator to initialize a workspace.</p></div>`;
        return;
      }
      grid.innerHTML = `<div class="max-w-4xl mx-auto pt-12 pb-24"><div class="mb-12 text-center"><h1 class="text-4xl font-black italic tracking-tighter mb-4 uppercase">Initialize Zeus</h1><p class="text-slate-500 font-medium">Select your authorized workspaces to begin operations.</p></div><div class="grid grid-cols-1 md:grid-cols-2 gap-8">${state.availableAccounts.map(acc => { const isSelected = state.selectedRegistrationAccounts.has(acc.id); return `<div onclick="window.toggleRegistrationSelection('${acc.id}')" class="reg-card tool-card group cursor-pointer p-8 border-2 border-transparent hover:border-primary-500 ${isSelected ? 'selected' : ''}"><div class="checkbox-indicator"><span class="material-icons">check</span></div><div class="w-16 h-16 bg-primary-100 rounded-3xl flex items-center justify-center mb-6 group-hover:bg-primary-600 group-hover:text-white transition-colors"><span class="material-icons text-3xl">bolt</span></div><h3 class="text-xl font-black mb-1 uppercase tracking-tight">${acc.name}</h3><p class="text-[10px] font-black uppercase text-slate-400">Request Dashboard Connect</p></div>`; }).join('')}</div></div><div class="fixed bottom-0 left-0 w-full bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-4 flex justify-center transition-transform duration-300 ${hasSelection ? 'translate-y-0' : 'translate-y-full'}"><button onclick="window.proceedToNickname()" class="bg-primary-600 text-white font-black text-xs uppercase tracking-widest px-12 py-4 rounded-full shadow-xl hover:bg-primary-700 hover:scale-105 transition-all">Continue with ${state.selectedRegistrationAccounts.size} Selection${state.selectedRegistrationAccounts.size > 1 ? 's' : ''}</button></div>`;
      return;
    }
    if (state.view === 'SELECTOR') {
      main.classList.remove('overflow-hidden');
      if (filterContainer) filterContainer.classList.remove('hidden');
      let cardsHtml = state.availableAccounts.map(acc => `<div onclick="window.loadAccount('${acc.id}')" class="tool-card group cursor-pointer p-8 border-2 border-transparent hover:border-primary-500"><div class="w-16 h-16 bg-primary-100 dark:bg-primary-900/40 rounded-3xl flex items-center justify-center mb-6 group-hover:bg-primary-600 group-hover:text-white"><span class="material-icons text-3xl">hub</span></div><h3 class="text-xl font-black mb-1 group-hover:text-primary-600 transition-colors uppercase tracking-tight">${acc.name}</h3><p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Workspace Server: ${acc.id}</p><div class="mt-6 flex items-center gap-2 text-primary-600 font-bold text-xs uppercase tracking-widest">Navigating Server <span class="material-icons text-sm">bolt</span></div></div>`).join('');
      const adminActions = state.role === 'SUPER_ADMIN' ? `
        <div class="flex justify-center mt-12 gap-4 pb-12">
            <button onclick="openReminderCreator()" class="bg-slate-800 text-white dark:bg-slate-700 px-6 py-3 rounded-full font-black text-xs uppercase tracking-widest hover:bg-primary-600 transition-colors flex items-center gap-2 shadow-lg"><span class="material-icons text-sm">notifications_active</span> Send Global Reminder</button>
            <button onclick="openAdminDashboard()" class="bg-emerald-600 text-white px-6 py-3 rounded-full font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-colors flex items-center gap-2 shadow-lg"><span class="material-icons text-sm">admin_panel_settings</span> Command Center</button>
        </div>` : '';
      grid.innerHTML = `<div class="max-w-4xl mx-auto pt-12"><div class="mb-12 text-center"><h1 class="text-4xl font-black italic tracking-tighter mb-2 uppercase">Zeus Control Node</h1><p class="text-slate-500 font-medium italic">Administrator Access: <span class="text-primary-600 font-bold tracking-tight">${state.userEmail}</span></p></div><div class="grid grid-cols-1 md:grid-cols-2 gap-8">${cardsHtml}</div>${adminActions}</div>`;
      return;
    }
    if (!state.currentAccount) return;
    if (state.currentCat === 'HOME') {
      main.classList.add('overflow-hidden');
      grid.className = 'max-w-7xl mx-auto h-full overflow-hidden';
      let homeLayout = document.getElementById('home-layout-container');
      if (!homeLayout) {
        grid.innerHTML = `<div class="home-watermark">${state.currentAccount.id.toUpperCase()}</div>`;
        homeLayout = document.createElement('div');
        homeLayout.className = 'flex flex-col gap-4 w-full h-full overflow-hidden pb-4';
        homeLayout.id = 'home-layout-container';
        // --- ADDED CACHE RESET TO FIX DISAPPEARING BUG ---
        state.htmlCache.reminders = null;
        state.htmlCache.checklist = null;
        state.htmlCache.announcements = null;
        // -------------------------------------------------
        const heroSection = document.createElement('div'); heroSection.className = 'w-full h-[120px] shrink-0';
        heroSection.innerHTML = `<div class="tool-card bg-slate-900 border-none p-5 text-white relative overflow-hidden h-full flex items-center shadow-2xl shadow-slate-500/30"><div class="absolute -right-20 -top-20 w-64 h-64 bg-primary-600/20 rounded-full blur-3xl"></div><div class="absolute -left-20 -bottom-20 w-64 h-64 bg-slate-700/50 rounded-full blur-3xl"></div><div class="relative z-10 flex w-full items-center justify-between"><div><h1 class="text-2xl font-black italic tracking-tighter mb-1 leading-tight uppercase">${state.currentAccount.name}</h1><p class="text-slate-400 text-[9px] font-medium max-w-sm mb-3 uppercase tracking-wide">Unified Workspace Management.</p><div class="flex items-center gap-3"><button onclick="window.open('https://notebooklm.google.com/', '_blank')" class="bg-white text-slate-900 px-3 py-1.5 rounded-lg text-[8px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-slate-200 transition-colors"><span class="material-icons text-xs">auto_stories</span> Notebook LM</button></div></div><div class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center hidden lg:block"><div class="text-[10px] font-black uppercase text-primary-400 tracking-widest mb-1">Welcome</div><div class="text-xl font-black italic text-white tracking-tight">${state.userNickname || "Agent"}</div></div><div class="hidden md:flex flex-col items-end gap-1"><span class="text-[9px] font-black uppercase text-primary-500 tracking-widest">Zeus Node Online</span><span class="text-[8px] font-bold text-slate-500 uppercase">${state.userEmail}</span></div></div></div>`;
        const splitContent = document.createElement('div'); splitContent.className = 'flex gap-6 flex-1 min-h-0';
        const announcementsCol = document.createElement('div'); announcementsCol.className = 'w-[28%] flex flex-col h-full overflow-hidden';
        announcementsCol.innerHTML = `<h2 class="text-[9px] font-black text-slate-400 mb-2 tracking-[0.2em] uppercase flex items-center gap-2"><span class="material-icons text-xs">campaign</span> Announcements</h2><div class="broadcast-scroll-area custom-scrollbar" id="ann-scroll-area"></div>`;
        const rightCol = document.createElement('div'); rightCol.className = 'flex-1 flex flex-col gap-4 h-full overflow-hidden';
        const weatherSection = document.createElement('div');
        weatherSection.className = 'w-full h-[220px] shrink-0 flex flex-col';
        weatherSection.id = 'weather-section';
        rightCol.appendChild(weatherSection);
        const bottomRow = document.createElement('div'); bottomRow.className = 'flex gap-6 flex-1 min-h-0';
        const remindersCol = document.createElement('div');
        remindersCol.className = 'flex-1 flex flex-col overflow-hidden min-h-0';
        // REFRESH BUTTON ADDED HERE
        remindersCol.innerHTML = `<div class="flex items-center justify-between mb-3"><div class="flex items-center gap-2"><h2 class="text-[9px] font-black text-slate-400 tracking-[0.2em] uppercase flex items-center gap-2"><span class="material-icons text-xs">edit_notifications</span> Team Reminders</h2><button onclick="refreshDashboard()" class="text-slate-400 hover:text-primary-600 transition-colors" title="Refresh"><span class="material-icons text-sm refresh-spin-icon">refresh</span></button></div></div><div id="reminders-container" class="h-full overflow-hidden flex flex-col"></div>`;
        const checklistCol = document.createElement('div'); checklistCol.className = 'w-[35%] flex flex-col h-full overflow-hidden min-w-[300px]';
        checklistCol.id = 'checklist-wrapper';
        
        bottomRow.appendChild(remindersCol); bottomRow.appendChild(checklistCol); 
        
        rightCol.appendChild(bottomRow);
        splitContent.appendChild(announcementsCol); splitContent.appendChild(rightCol);
        homeLayout.appendChild(heroSection); homeLayout.appendChild(splitContent);
        grid.appendChild(homeLayout);
        renderSOPChat(); // Initial render of the chat box
      }
      updateWeatherUI();
      if (!state.weatherRisk) window.fetchWeatherRisk();
      updateRemindersUI();
      updateChecklistUI();
      renderAnnouncements();
      renderSOPChat();
    } else {
      main.classList.remove('overflow-hidden');
      const filteredIcons = (state.currentAccount.icons || []).filter(i => i.catId == state.currentCat);
      if (filteredIcons.length === 0 && !state.isManage) {
        grid.innerHTML = `<div class="flex flex-col items-center justify-center min-h-[40vh] text-center opacity-40"><span class="material-icons text-6xl mb-4 text-slate-200">grid_view</span><p class="font-black uppercase text-xs tracking-[0.2em] text-slate-400">Blank Workspace. Initialize tools via Manage Mode.</p></div>`;
        return;
      }
      
      try {
        const iconContainer = document.createElement('div');
        iconContainer.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 pb-20';
        
        filteredIcons.forEach(icon => {
          try {
            const card = document.createElement('div'); 
            card.className = 'tool-card group cursor-pointer'; 
            card.onclick = () => window.open(icon.url || '#', '_blank'); 
            if (state.isManage) card.oncontextmenu = (e) => showContextMenu(e, 'icon', icon.id); 
            
            const displayUrl = (icon.url || '').replace('https://', '');
            const title = icon.title || icon.name || 'Untitled Tool';
            const iconType = icon.iconType || '🔗';
            
            card.innerHTML = `<div class="w-12 h-12 bg-primary-50 dark:bg-primary-900/20 rounded-2xl flex items-center justify-center text-2xl mb-5 group-hover:bg-primary-600 group-hover:text-white shadow-sm"><span>${iconType}</span></div><h3 class="font-black text-slate-800 dark:text-white text-base mb-1 tracking-tight group-hover:text-primary-600 transition-colors uppercase">${title}</h3><p class="text-[10px] text-slate-400 dark:text-slate-500 truncate uppercase font-bold tracking-widest">${displayUrl}</p>`; 
            
            iconContainer.appendChild(card); 
          } catch(errIcon) {
            console.error('[Zeus] Failed to render individual tool card', errIcon, icon);
          }
        });
        
        if (state.isManage) { 
          const addBtn = document.createElement('div'); 
          addBtn.className = 'tool-card border-dashed border-2 border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-slate-300 py-12 cursor-pointer hover:border-primary-600'; 
          addBtn.innerHTML = '<span class="material-icons mb-2">add_circle_outline</span><span class="font-black text-[10px] uppercase tracking-widest">Register Zeus Tool</span>'; 
          addBtn.onclick = () => { state.context = { type: 'icon', id: null }; window.openModal(); }; 
          iconContainer.appendChild(addBtn); 
        }
        
        grid.appendChild(iconContainer);
      } catch (errGrid) {
        console.error('[Zeus] Tool Grid render failure:', errGrid);
        grid.innerHTML = `<div class="p-8 text-center text-red-500"><span class="material-icons text-4xl">error</span><p class="mt-2 font-bold uppercase text-xs tracking-widest">Error populating workspace views. Please contact support.</p></div>`;
      }
    }
  }

  window.updateWeatherUI = function () {
    const weatherSection = document.getElementById('weather-section');
    if (!weatherSection) return;
    let weatherContent = '';
    if (!state.weatherRisk) {
      weatherContent = `<div class="w-full h-full flex flex-col items-center justify-center gap-3 opacity-60"><span class="material-icons text-3xl animate-spin text-primary-500">donut_large</span><span class="text-[10px] font-black uppercase tracking-widest text-slate-500">Analyzing Weather Data...</span></div>`;
    } else {
      const w = state.weatherRisk;
      const impacts = w.impacts.map(i => `<div class="flex justify-between items-center text-[9px] border-b border-slate-100 dark:border-slate-800 pb-1"><span class="font-bold text-slate-600 dark:text-slate-300">${new Date(i.time).toLocaleTimeString([], { hour: 'numeric', hour12: true, timeZone: state.systemTimeZone })}</span><span class="font-black ${i.rain > 1.5 ? 'text-red-500' : 'text-slate-400'}">${i.rain}mm rain</span></div>`).join('') || '<div class="text-[9px] text-slate-400 italic">No significant peak impacts</div>';
      weatherContent = `<div class="flex h-full"><div class="flex-1 p-5 flex flex-col justify-center border-r border-slate-100 dark:border-slate-800"><div class="flex items-center gap-2 mb-2"><span class="w-2 h-2 rounded-full ${w.bgClass} animate-pulse"></span><span class="text-[10px] font-black uppercase tracking-widest ${w.colorClass}">${w.riskLevel} RISK DETECTED</span></div><p class="text-xs font-semibold leading-snug text-slate-700 dark:text-slate-200 mb-3">${w.message}</p><div class="flex items-center gap-4 text-[9px] text-slate-400 font-bold uppercase tracking-wider"><span>Updated: ${w.timestamp}</span><span class="text-primary-500">Zeus Predictive Model</span></div></div><div class="w-1/3 bg-slate-50 dark:bg-slate-800/50 p-4 flex flex-col justify-center"><div class="mb-3"><h4 class="text-[8px] font-black uppercase text-slate-400 mb-2 tracking-widest">Impact Window</h4><div class="space-y-1">${impacts}</div></div><button onclick="window.open('${state.awraUrl}', '_blank')" class="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-primary-600 w-full py-2 rounded-lg text-[8px] font-black uppercase tracking-widest hover:bg-primary-50 dark:hover:bg-slate-700 transition-colors flex items-center justify-center gap-2 shadow-sm">Project AWRA <span class="material-icons text-[10px]">open_in_new</span></button></div></div>`;
    }
    const newHTML = `<div class="flex items-center justify-between mb-2 px-1"><h2 class="text-[10px] font-black text-slate-400 tracking-[0.2em] uppercase flex items-center gap-2"><span class="material-icons text-sm text-blue-400">psychology</span> Zeus Shrinkage Analysis</h2><div class="flex p-0.5 bg-slate-200 dark:bg-slate-800 rounded-lg"><button onclick="window.setSite('METRO MANILA')" class="px-4 py-1 text-[8px] font-black uppercase tracking-widest rounded-md transition-all ${state.selectedSite === 'METRO MANILA' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}">Manila</button><button onclick="window.setSite('DUMAGUETE')" class="px-4 py-1 text-[8px] font-black uppercase tracking-widest rounded-md transition-all ${state.selectedSite === 'DUMAGUETE' ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}">Dumaguete</button></div></div><div class="flex-1 w-full bg-white dark:bg-slate-900 rounded-[1.5rem] border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden group">${weatherContent}</div>`;
    if (weatherSection.innerHTML !== newHTML) { weatherSection.innerHTML = newHTML; }
  };
  window.fetchRegistry = function () {
    if (state.role !== 'SUPER_ADMIN') return;
    (async () => { try { const res = await runQuery("accounts:getUsersRegistry", { callerEmail: state.userEmail }); Promise.resolve().then(() => { const _cb = (function (registry) {
      renderAdminRegistry(registry);
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.renderAdminRegistry = function (registry) {
    const h = document.getElementById('admin-registry-header');
    const l = document.getElementById('admin-registry');
    if (!h || !l) return;
    h.classList.remove('hidden');
    l.classList.remove('hidden');
    l.innerHTML = '';
    // super admins see the access requests button
    const reqBtn = document.getElementById('access-requests-btn');
    if (reqBtn) reqBtn.classList.toggle('hidden', state.role !== 'SUPER_ADMIN');
    // refresh requests count whenever registry rendered (super admins)
    if (state.role === 'SUPER_ADMIN') fetchAccessRequests();
    for (const id in registry) {
      const a = registry[id];
      const ad = document.createElement('div');
      ad.className = 'px-4 py-2 mt-2 text-[11px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-tight flex items-center gap-2';
      ad.innerHTML = `<span class="material-icons text-sm">hub</span> ${a.name}`;
      l.appendChild(ad);
      if (a.users.length === 0) {
        const n = document.createElement('div');
        n.className = 'px-8 py-1 text-[9px] italic text-slate-400 uppercase';
        n.innerText = 'No users';
        l.appendChild(n);
      } else {
        a.users.forEach(u => {
          const ud = document.createElement('div');
          ud.className = 'group flex items-center justify-between px-8 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-default';
          ud.innerHTML = `
          <div class="flex flex-col">
            <span class="text-xs font-black text-slate-800 dark:text-white uppercase tracking-tight">${u.nickname}</span>
            <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest truncate max-w-[140px]">${u.email}</span>
          </div>
          <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all">
            <button class="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-700 hover:bg-primary-500 hover:text-white flex items-center justify-center text-slate-400 transition-colors" title="Assign Task" onclick="promptAdminTask('${u.email}', '${u.nickname}')">
              <span class="material-icons text-[12px]">playlist_add</span>
            </button>
            <span class="material-icons text-red-400 text-sm cursor-pointer hover:text-red-600 transition-all" title="Unregister" onclick="unregisterAction('${id}', '${u.email}')">delete_outline</span>
          </div>
        `;
          l.appendChild(ud);
        });
      }
    }
  };
  window.unregisterAction = function (aid, email) {
    if (confirm(`Remove ${email}?`)) {
      (async () => { try { const res = await runMutation("accounts:unregisterUser", { callerEmail: state.userEmail, accountId: aid, email: email.trim().toLowerCase() }); Promise.resolve().then(() => { const _cb = (r => renderAdminRegistry(r)); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
    }
  };
  // Access request UI
  window.openAccessRequests = function () {
    document.getElementById('access-requests-modal').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
    fetchAccessRequests();
  };
  window.closeAccessRequests = function () {
    document.getElementById('access-requests-modal').classList.add('hidden');
    document.getElementById('overlay').classList.add('hidden');
  };
  window.fetchAccessRequests = function () {
    (async () => { try { const res = await runQuery("users:getAccessRequests", { callerEmail: state.userEmail }); Promise.resolve().then(() => { const _cb = (renderAccessRequests); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.renderAccessRequests = function (reqs) {
    const c = document.getElementById('access-requests-list');
    const btn = document.getElementById('access-requests-btn');
    if (btn) btn.innerText = `Requests${reqs && reqs.length ? ' (' + reqs.length + ')' : ''}`;
    if (!c) return;
    if (!reqs || reqs.length === 0) {
      c.innerHTML = '<div class="text-center text-xs text-slate-400">No pending requests.</div>';
      return;
    }
    c.innerHTML = reqs.map(r => `
    <div class="flex flex-col gap-2 bg-slate-100 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700">
      <div class="flex justify-between items-start">
        <div class="flex flex-col">
          <span class="text-[10px] font-black uppercase tracking-widest ${r.type === 'REMOVAL' ? 'text-red-500' : 'text-primary-600'}">${r.type || 'ACCESS'} REQUEST</span>
          <span class="text-xs font-bold">${r.nickname}</span>
          <span class="text-[9px] text-slate-400">${r.email}</span>
        </div>
        <div class="text-right">
          <span class="text-[9px] font-black uppercase text-slate-500">${r.accountName}</span>
        </div>
      </div>
      <div class="flex gap-2 mt-1">
        <button onclick="approveRequest('${r._id}')" class="flex-1 py-1.5 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-emerald-700 transition-colors">Approve</button>
        <button onclick="rejectRequest('${r._id}')" class="flex-1 py-1.5 bg-red-500 text-white text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-red-600 transition-colors">Decline</button>
      </div>
    </div>`).join('');
  };
  window.approveRequest = function (requestId) {
    (async () => { try { const res = await runMutation("users:approveAccountAccess", { callerEmail: state.userEmail, requestId: requestId }); Promise.resolve().then(() => { const _cb = (() => {
      fetchAccessRequests();
      fetchRegistry();
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.rejectRequest = function (requestId) {
    (async () => { try { const res = await runMutation("users:rejectAccountAccess", { callerEmail: state.userEmail, requestId: requestId }); Promise.resolve().then(() => { const _cb = (() => {
      fetchAccessRequests();
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.showRegistration = function () {
    state.view = 'REGISTRATION';
    renderContent();
  };
  window.toggleRegistrationSelection = function (id) {
    if (state.selectedRegistrationAccounts.has(id)) state.selectedRegistrationAccounts.delete(id);
    else state.selectedRegistrationAccounts.add(id);
    renderContent();
  };
  window.proceedToNickname = function () {
    if (state.selectedRegistrationAccounts.size === 0) {
      alert("Select a workspace.");
      return;
    }
    document.getElementById('new-user-nickname').value = '';
    document.getElementById('nickname-modal').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
  };
  window.submitRegistration = function () {
    const n = document.getElementById('new-user-nickname').value;
    if (!n) {
      alert("Nickname required.");
      return;
    }
    const ids = Array.from(state.selectedRegistrationAccounts);
    window.setBtnLoading('join-workspace-btn', true);
    const callback = info => {
      state.role = info.role;
      state.userEmail = info.email;
      state.userNickname = info.nickname;
      state.checklist = info.checklist || [];
      state.notes = info.notes || [];
      state.availableAccounts = info.accounts;
      // UPDATE HEADER NICKNAME
      const nickEl = document.getElementById('header-nickname-display');
      if (nickEl) nickEl.innerText = info.nickname;
      document.getElementById('nickname-modal').classList.add('hidden');
      document.getElementById('overlay').classList.add('hidden');
      window.setBtnLoading('join-workspace-btn', false);
      if (state.role === 'GUEST') {
        alert('Your access request has been sent. A super admin will review and grant approval shortly.');
        // Clear selection so user doesn't accidentally re-submit same request
        state.selectedRegistrationAccounts.clear();
        renderContent();
      } else if (ids.length > 0) {
        // If already has access (e.g. super admin), just load it
        window.loadAccount(ids[0]);
      }
      // refresh userAccounts from returned info
      state.userAccounts = info.userAccounts || [];
      updateAssignButton();
    };
    if (state.role === 'SUPER_ADMIN') {
      (async () => { try { const res = await runMutation("users:registerUserToAccounts", { callerEmail: state.userEmail, accountIds: ids, nickname: n }); Promise.resolve().then(() => { const _cb = (callback); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
    } else {
      // send approval request instead
      (async () => { try { const res = await runMutation("users:requestAccountAccess", { email: state.userEmail, accountIds: ids, nickname: n }); Promise.resolve().then(() => { const _cb = (callback); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
    }
  };
  window.openAccountSwitcher = function () {
    if (state.role !== 'SUPER_ADMIN' && state.availableAccounts.length <= 1) return;
    const c = document.getElementById('account-list-container');
    c.innerHTML = '';
    state.availableAccounts.forEach(acc => {
      const isActive = state.currentAccount && state.currentAccount.id === acc.id;
      const b = document.createElement('div');
      b.className = `p-4 rounded-2xl cursor-pointer transition-all border-2 flex items-center justify-between ${isActive ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-500' : 'bg-slate-50 dark:bg-slate-800 border-transparent hover:border-slate-200 dark:hover:border-slate-700'}`;
      b.onclick = () => {
        state.isRestoring = false;
        window.loadAccount(acc.id);
      };
      if (state.role === 'SUPER_ADMIN') b.oncontextmenu = (e) => showContextMenu(e, 'account', acc.id);
      b.innerHTML = `<div class="flex items-center gap-3"><span class="material-icons text-primary-600 ${isActive ? '' : 'opacity-40'}">hub</span><span class="text-sm font-black ${isActive ? 'text-primary-600' : 'text-slate-600 dark:text-slate-300'}">${acc.name}</span></div>${isActive ? '<span class="material-icons text-primary-600 text-sm">check_circle</span>' : ''}`;
      c.appendChild(b);
    });
    document.getElementById('add-account-btn-trigger').classList.toggle('hidden', state.role !== 'SUPER_ADMIN');
    document.getElementById('account-switcher-modal').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
  };
  window.openAccountCreator = function () {
    document.getElementById('new-account-name').value = '';
    document.getElementById('account-creator-modal').classList.remove('hidden');
  };
  window.submitNewAccount = function () {
    const n = document.getElementById('new-account-name').value;
    if (!n) return;
    window.setBtnLoading('create-account-btn', true);
    (async () => { try { const res = await runMutation("accounts:createAccount", { callerEmail: state.userEmail, accountName: n }); Promise.resolve().then(() => { const _cb = (info => {
      state.availableAccounts = info.accounts;
      document.getElementById('account-creator-modal').classList.add('hidden');
      window.setBtnLoading('create-account-btn', false);
      window.openAccountSwitcher();
      if (state.view === 'SELECTOR') fetchRegistry();
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.toggleManageMode = function () {
    state.isManage = !state.isManage;
    const b = document.getElementById('manageBtn');
    b.innerText = state.isManage ? "Exit" : "Manage";
    b.className = state.isManage ? "bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-white text-[10px] font-black tracking-widest px-4 py-2 rounded-full uppercase" : "bg-primary-600 hover:bg-primary-700 text-white text-[10px] font-black tracking-widest px-4 py-2 rounded-full shadow-md uppercase";
    document.getElementById('add-cat-btn')?.classList.toggle('hidden', !state.isManage);
    renderCategories();
    renderContent();
  };
  window.renderCategories = function () {
    const l = document.getElementById('category-list');
    if (!l) return;
    l.innerHTML = '';
    if (!state.currentAccount || !state.currentAccount.categories) return;
    state.currentAccount.categories.forEach(cat => {
      const d = document.createElement('div');
      const a = state.currentCat === cat.id;
      d.className = `side-item ${a ? 'active' : ''}`;
      const i = cat.id === 'HOME' ? 'dashboard' : 'folder';
      d.innerHTML = `<span class="material-icons text-[18px] opacity-60">${i}</span><span>${cat.name}</span>`;
      d.onclick = () => {
        state.currentCat = cat.id;
        localStorage.setItem('zeus_last_cat', cat.id);
        renderContent();
        renderCategories();
      };
      if (cat.id !== 'HOME' && state.isManage) d.oncontextmenu = (e) => showContextMenu(e, 'cat', cat.id);
      l.appendChild(d);
    });
  };
  window.saveEdit = function () {
    const n = document.getElementById('edit-name').value;
    const u = document.getElementById('edit-url').value;
    const i = document.getElementById('edit-icon').value;
    const targetCat = document.getElementById('edit-category-select')?.value;
    if (!n) return;
    const itemId = state.context.id || Date.now().toString();
    const contextType = state.context.type; // 'icon', 'cat', or 'account'
    window.setBtnLoading('modal-apply-btn', true);
    if (contextType === 'account') {
      const accId = state.context.id;
      if (!accId) return;
      (async () => {
        try {
          const res = await runMutation("accounts:saveAccountData", { accountId: accId, type: 'account', item: { id: accId, name: n } });
          const d = res;
          if (!d || !d.id) throw new Error("Invalid account data returned from server.");
          const accIdx = state.availableAccounts.findIndex(a => a.id === d.id);
          if (accIdx !== -1) state.availableAccounts[accIdx].name = d.name;
          if (state.currentAccount && state.currentAccount.id === d.id) state.currentAccount = d;
          window.showAccountSelector();
          window.setBtnLoading('modal-apply-btn', false);
          closeModals();
        } catch (err) {
          console.error('[Zeus] Account save error:', err);
          alert(err.message || String(err));
          window.setBtnLoading('modal-apply-btn', false);
        }
      })();
    } else if (contextType === 'cat') {
      if (!state.currentAccount) return;
      (async () => {
        try {
          const res = await runMutation("accounts:saveAccountData", { accountId: state.currentAccount.id, type: 'cat', item: { id: itemId, name: n } });
          if (!res || !res.id || !res.categories) {
            console.error("[Zeus] Invalid category response:", res);
            throw new Error(`Server returned incomplete data (categories missing: ${!res?.categories}). Please refresh.`);
          }
          state.currentAccount = res; 
          renderCategories();
          renderContent();
          window.setBtnLoading('modal-apply-btn', false);
          closeModals();
        } catch (err) {
          console.error('[Zeus] Category save error:', err);
          alert(err.message || String(err));
          window.setBtnLoading('modal-apply-btn', false);
        }
      })();
    } else {
      if (!state.currentAccount) return;
      (async () => {
        try {
          const finalCatId = (targetCat && targetCat.length > 0) ? targetCat : (state.currentCat || 'HOME');
          const res = await runMutation("accounts:saveAccountData", { accountId: state.currentAccount.id, type: 'icon', item: { id: itemId, title: n, url: u, iconType: i || '🔗', catId: finalCatId } });
          if (!res || !res.id || !res.categories) {
            console.error("[Zeus] Invalid icon response:", res);
            throw new Error(`Server returned incomplete data (id/categories missing). Details in console.`);
          }
          state.currentAccount = res;
          renderCategories();
          renderContent();
          window.setBtnLoading('modal-apply-btn', false);
          closeModals();
        } catch (err) {
          console.error('[Zeus] Icon save error:', err);
          alert(err.message || String(err));
          window.setBtnLoading('modal-apply-btn', false);
        }
      })();
    }
  };
  window.deleteItemAction = function () {
    if (state.context.type === 'account') {
      if (confirm(`Delete ${state.context.id}?`)) (async () => { try { const res = await runMutation("accounts:deleteAccount", { callerEmail: state.userEmail, accountId: state.context.id }); Promise.resolve().then(() => { const _cb = (() => {
        // Remove from available accounts list
        state.availableAccounts = state.availableAccounts.filter(a => a.id !== state.context.id);
        window.showAccountSelector();
        closeModals();
      }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
      return;
    }
    if (confirm("Remove item?")) {
      (async () => {
        try {
          const res = await runMutation("accounts:deleteAccountItem", { 
            accountId: state.currentAccount?.id, 
            type: state.context.type, 
            itemId: state.context.id 
          });
          if (!res || !res.id || !res.categories) {
            console.error("[Zeus] Invalid delete response:", res);
            throw new Error("Server communication failure (invalid delete response). Details in console.");
          }
          state.currentAccount = res;
          renderCategories();
          renderContent();
        } catch (err) {
          console.error('[Zeus] Delete item error:', err);
          alert(err.message || String(err));
        }
      })();
    }
  };
  window.renderAnnouncements = function () {
    const c = document.getElementById('ann-scroll-area');
    if (!c) return;
    // Safely check if currentAccount and announcements exist
    if (!state.currentAccount || !state.currentAccount.announcements || state.currentAccount.announcements.length === 0) {
      c.innerHTML = '<div class="flex h-full items-center justify-center text-slate-400 text-xs italic">No announcements</div>';
      return;
    }
    const all = [...state.currentAccount.announcements].reverse();
    const p = all.filter(a => a.isPinned);
    const o = all.filter(a => !a.isPinned);
    const MAX_PIN_DISPLAY = 3;
    const mk = (a) => {
      let mb = '';
      if (state.isManage) {
        const parts = [];
        parts.push(`<button onclick="event.stopPropagation(); window.togglePinAction('${a.id}')" class="w-6 h-6 rounded-full bg-slate-100 text-slate-400 hover:text-yellow-500 flex items-center justify-center shadow-md"><span class="material-icons text-[14px]">push_pin</span></button>`);
        parts.push(`<button onclick="event.stopPropagation(); window.deleteAnnAction('${a.id}')" class="w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center shadow-lg"><span class="material-icons text-[14px]">delete</span></button>`);
        const canEdit = (state.role === 'SUPER_ADMIN') || (state.userEmail && a.sender && a.sender.toLowerCase() === state.userEmail.toLowerCase());
        if (canEdit) parts.unshift(`<button onclick="event.stopPropagation(); window.editAnnAction('${a.id}')" class="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md"><span class="material-icons text-[14px]">edit</span></button>`);
        mb = `<div class="absolute top-2 right-2 flex gap-1 z-20">${parts.join('')}</div>`;
      }
      let pi = a.isPinned ? `<span class="absolute -top-3 -right-2 bg-yellow-400 text-yellow-900 w-6 h-6 rounded-full flex items-center justify-center shadow-md"><span class="material-icons text-sm">push_pin</span></span>` : '';
      let imgHtml = '';
      const img = a.imageUrl || a.imageBase64;
      if (img) {
        imgHtml = `<div class="group relative mb-3 rounded-xl overflow-hidden cursor-zoom-in border border-slate-100 dark:border-slate-700 shadow-sm" onclick="window.openImageZoom('${img}')">
            <img src="${img}" class="w-full h-auto object-cover transition-transform duration-500 group-hover:scale-105">
            <div class="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <span class="material-icons text-white drop-shadow-md">zoom_in</span>
            </div>
        </div>`;
      }
      // Link Detection Logic
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const detectedLink = a.linkUrl || (a.message.match(urlRegex) ? a.message.match(urlRegex)[0] : null);
      let linkIndicator = '';
      let ctxFn = '';
      if (detectedLink) {
        linkIndicator = `<span class="inline-flex items-center gap-1 text-[8px] font-black text-blue-500 uppercase tracking-widest bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-md ml-2 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/50" onclick="window.open('${detectedLink}', '_blank'); event.stopPropagation();"><span class="material-icons text-[10px]">link</span> Open Link</span>`;
        // Pass the detected link to the context menu
        ctxFn = `window.showContextMenu(event, 'announcement', '${a.id}', '${detectedLink}')`;
      }
      return `<div class="announcement-card ${a.severity} ${a.isPinned ? 'pinned' : ''} relative" oncontextmenu="${ctxFn}">${!state.isManage ? pi : ''}<div class="flex justify-between items-start mb-2"><div class="flex flex-col"><span class="text-[8px] font-black uppercase text-slate-400">${a.sender} • ${new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: state.systemTimeZone })}</span>${linkIndicator}</div>${mb}</div>${imgHtml}<div class="text-xs font-semibold leading-relaxed">${parseMarkdown(a.message)}</div></div>`;
    };
    let newHTML = '';
    if (p.length > 0) {
      // Header with optional view all button
      newHTML += `<div class="flex items-center justify-between mb-2 mt-1 px-1">
      <div class="text-[9px] font-black uppercase text-yellow-500 flex items-center gap-1"><span class="material-icons text-xs">push_pin</span> Pinned</div>`;
      if (p.length > MAX_PIN_DISPLAY) {
        newHTML += `<button onclick="openPinnedAnnouncements()" class="text-[10px] font-bold text-slate-600 dark:text-slate-300 px-2 py-1 rounded-md bg-slate-100 dark:bg-slate-800">View All Pinned (${p.length})</button>`;
      }
      newHTML += `</div>`;
      // Show only up to MAX_PIN_DISPLAY in the main feed
      p.slice(0, MAX_PIN_DISPLAY).forEach(a => newHTML += mk(a));
      if (p.length > MAX_PIN_DISPLAY) newHTML += `<div class="h-px bg-slate-200 dark:bg-slate-800 my-4 mx-2"></div>`;
    }
    o.forEach(a => newHTML += mk(a));
    // CACHE CHECK
    if (state.htmlCache.announcements === newHTML) return;
    // Apply
    c.innerHTML = newHTML;
    state.htmlCache.announcements = newHTML;
  };
  window.deleteAnnAction = function (id) {
    if (confirm("Delete announcement?")) {
      // If we're viewing an account, use its ID. Otherwise find the announcement's account
      let accountId = state.currentAccount ? state.currentAccount.id : null;
      if (!accountId) {
        alert('Error: Cannot determine account context for deletion');
        return;
      }
      (async () => { try { const res = await runMutation("announcements:deleteAccountAnnouncement", { callerEmail: state.userEmail, accountId: accountId, annId: id }); Promise.resolve().then(() => { const _cb = (async (d) => {
        try {
          const updated = await runQuery("accounts:getAccountData", { accountId: accountId });
          if (updated) {
            state.currentAccount = updated;
            renderAnnouncements();
          }
        } catch (e) {
          console.error('[Zeus] Failed to refetch account after announcement deletion', e);
        }
      }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
    }
  };
  window.editAnnAction = function (id) {
    // Find announcement and prefill broadcaster modal for editing
    if (!state.currentAccount) {
      alert('Error: No account context found for editing');
      return;
    }
    const ann = (state.currentAccount.announcements || []).find(a => a.id === id || a.globalId === id);
    if (!ann) return alert('Announcement not found');
    state.currentEditingAnn = { id: ann.id, globalId: ann.globalId || null, accountId: state.currentAccount.id };
    document.getElementById('ann-message').value = ann.message || '';
    document.getElementById('ann-severity').value = ann.severity || 'info';
    document.getElementById('ann-sender').value = ann.sender || state.userNickname || state.userEmail || '';
    document.getElementById('ann-link').value = ann.linkUrl || '';
    const img = ann.imageUrl || ann.imageBase64;
    if (img) { state.currentImageBase64 = img; document.getElementById('ann-image-preview').src = img; document.getElementById('ann-image-preview-container').classList.remove('hidden'); }
    // Call openBroadcaster to properly set up the modal UI (button text, target selector, etc.)
    openBroadcaster();
  };
  window.openPinnedAnnouncements = function () {
    const list = document.getElementById('pinned-ann-list');
    if (!list || !state.currentAccount) return;
    list.innerHTML = '';
    const allPinned = (state.currentAccount.announcements || []).filter(a => a.isPinned).reverse();
    if (!allPinned.length) list.innerHTML = '<div class="text-sm text-slate-500">No pinned broadcasts.</div>';
    allPinned.forEach(a => {
      const el = document.createElement('div');
      el.className = 'announcement-card p-3 border rounded-lg';
      el.innerHTML = `<div class="flex justify-between items-start"><div><div class="text-[10px] font-black">${a.sender} • ${new Date(a.timestamp).toLocaleString()}</div><div class="mt-2 text-sm">${parseMarkdown(a.message)}</div></div><div class="ml-4 text-right"><button onclick="event.stopPropagation(); window.togglePinAction('${a.id}', renderPinnedAnnouncements);" class="text-xs px-2 py-1 bg-slate-100 rounded">Unpin</button></div></div>`;
      list.appendChild(el);
    });
    document.getElementById('pinned-ann-modal').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
  };
  window.renderPinnedAnnouncements = function () {
    const list = document.getElementById('pinned-ann-list');
    if (!list) return;
    // repopulate if modal is open
    const wasOpen = !document.getElementById('pinned-ann-modal').classList.contains('hidden');
    if (wasOpen) openPinnedAnnouncements();
  };
  window.togglePinAction = function (id, cb) {
    // Toggle pin on the server, update state and re-render. Optional callback runs after update.
    const accId = state.currentAccount ? state.currentAccount.id : null;
    if (!accId) return;
    (async () => { try { const res = await runMutation("announcements:toggleAnnouncementPin", { callerEmail: state.userEmail, accountId: accId, annId: id }); Promise.resolve().then(() => { const _cb = (async (d) => {
      try {
        const updated = await runQuery("accounts:getAccountData", { accountId: accId });
        if (updated) state.currentAccount = updated;
        renderAnnouncements();
        if (typeof cb === 'function') cb();
      } catch (e) {
        console.error('Error in togglePinAction success handler', e);
      }
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); Promise.resolve().then(() => { const _fc = (err => {
      console.error('Failed to toggle pin', err);
      alert('Failed to toggle pin (server error)');
    }); if(typeof _fc === 'function') _fc(err); else alert(err.message || String(err)); }); } })();
  };
  window.releaseAnnouncement = function () {
    const m = document.getElementById('ann-message').value;
    const s = document.getElementById('ann-severity').value;
    const snd = document.getElementById('ann-sender').value;
    const link = document.getElementById('ann-link').value; // Get Link
    if (!m) return;
    window.setBtnLoading('ann-post-btn', true);
    // Check if editing existing announcement
    if (state.currentEditingAnn) {
      const accId = state.currentEditingAnn.accountId;
      (async () => { try { const res = await runMutation("announcements:editAccountAnnouncement", { callerEmail: state.userEmail, accountId: accId, annId: state.currentEditingAnn.id, newMsg: m, newSeverity: s, newImageUrl: state.currentImageBase64, newLinkUrl: link }); Promise.resolve().then(() => { const _cb = (async (d) => {
        if (d === false) {
          alert('Failed to authorize update to the announcement.');
          return;
        }
        try {
          const updated = await runQuery("accounts:getAccountData", { accountId: accId });
          if (updated) state.currentAccount = updated;
          state.currentEditingAnn = null;
          renderAnnouncements();
          closeModals();
        } catch (err) {
          console.error('Error handling edit announcement response', err);
          alert('An error occurred while updating the announcement.');
        } finally {
          window.setBtnLoading('ann-post-btn', false);
        }
      }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); Promise.resolve().then(() => { const _fc = (err => {
        console.error('RPC failure editing announcement', err);
        alert('Failed to update announcement (server error)');
        window.setBtnLoading('ann-post-btn', false);
      }); if(typeof _fc === 'function') _fc(err); else alert(err.message || String(err)); }); } })();
      return;
    }
    // Otherwise, post new announcement
    const targetSel = document.getElementById('ann-target');
    let target = state.currentAccount ? state.currentAccount.id : null;
    if (targetSel) {
      const v = targetSel.value;
      if (v) target = v;
    }
    if (!target) return;
    (async () => { try { const res = await runMutation("announcements:postAccountAnnouncement", { callerEmail: state.userEmail, accountId: target, message: m, severity: s, sender: snd, imageUrl: state.currentImageBase64, linkUrl: link }); Promise.resolve().then(() => { const _cb = (async (d) => {
      try {
        if (d && d.status === 'forbidden') {
          alert('Unauthorized to post global announcement');
          window.setBtnLoading('ann-post-btn', false);
          return;
        }
        if (d && d.status === 'error') {
          alert('Error: ' + d.message);
          window.setBtnLoading('ann-post-btn', false);
          return;
        }
        if (target === 'ALL' || (d && d.ok)) {
          try {
            if (state.currentAccount && state.currentAccount.id) {
               const updated = await runQuery("accounts:getAccountData", { accountId: state.currentAccount.id });
               if (updated) state.currentAccount = updated;
            }
            renderAnnouncements();
            closeModals();
          } catch (e) {
            console.error('Failed to sync global broadcast locally', e);
          }
          return;
        }
        // fallback
        if (state.currentAccount && state.currentAccount.id) {
            const updated = await runQuery("accounts:getAccountData", { accountId: state.currentAccount.id });
            if (updated) state.currentAccount = updated;
        }
        renderAnnouncements();
        closeModals();
      } catch (err) {
        console.error('Error handling announcement response', err);
        alert('An error occurred while processing the announcement response.');
      } finally {
        window.setBtnLoading('ann-post-btn', false);
      }
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); Promise.resolve().then(() => { const _fc = (err => {
      console.error('RPC failure posting announcement', err);
      alert('Failed to post announcement (server error)');
      window.setBtnLoading('ann-post-btn', false);
    }); if(typeof _fc === 'function') _fc(err); else alert(err.message || String(err)); }); } })();
  };
  window.toggleTheme = function () {
    state.isDark = !state.isDark;
    localStorage.setItem('theme', state.isDark ? 'dark' : 'light');
    document.documentElement.classList.toggle('dark', state.isDark);
    window.updateThemeIcon();
  };
  window.updateThemeIcon = function () {
    const i = document.getElementById('theme-icon');
    if (i) i.innerText = state.isDark ? 'light_mode' : 'dark_mode';
  };
  window.toggleSidebar = function () {
    const s = document.getElementById('sidebar');
    s.classList.toggle('left-0');
    s.classList.toggle('left-[-260px]');
  };
  window.openModal = function () {
    const ic = state.context.type === 'cat';
    const isAcc = state.context.type === 'account';
    document.getElementById('modal-title').innerText = state.context.id ? "Modify" : "New";
    document.getElementById('url-field').classList.toggle('hidden', ic || isAcc);
    document.getElementById('icon-type-field').classList.toggle('hidden', ic || isAcc);
    // Reset Fields
    document.getElementById('edit-name').value = '';
    document.getElementById('edit-url').value = '';
    document.getElementById('edit-icon').value = '';
    // Populate Category Select — include ALL categories including HOME
    const catSelect = document.getElementById('edit-category-select');
    catSelect.innerHTML = '';
    if (state.currentAccount && state.currentAccount.categories) {
      state.currentAccount.categories.forEach(cat => {
        catSelect.innerHTML += `<option value="${cat.id}">${cat.name}</option>`;
      });
    }
    // Hide category selector if creating a new category itself or an account
    document.getElementById('category-select-container').classList.toggle('hidden', ic || isAcc);
    if (state.context.id) {
      let it;
      if (ic) it = state.currentAccount.categories.find(c => c.id === state.context.id);
      else if (isAcc) it = state.availableAccounts.find(a => a.id === state.context.id);
      else it = state.currentAccount.icons.find(i => i.id === state.context.id);
      if (it) {
        document.getElementById('edit-name').value = it.name || it.title || '';
        document.getElementById('edit-url').value = it.url || '';
        document.getElementById('edit-icon').value = it.iconType || '';
        if (!ic && !isAcc && it.catId) catSelect.value = it.catId;
      }
    } else if (state.context.link) {
      // Pre-fill from Context Menu (Save Link)
      document.getElementById('edit-url').value = state.context.link;
      document.getElementById('edit-name').value = "Broadcast Link";
      document.getElementById('edit-icon').value = "🔗";
    } else {
      // Default new item behavior: pre-select the current active category
      if (!ic && !isAcc) catSelect.value = state.currentCat || 'HOME';
    }
    document.getElementById('modal').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
  };
  window.closeModals = function () {
    ['modal', 'broadcaster-modal', 'overlay', 'account-switcher-modal', 'account-creator-modal', 'reminder-modal', 'nickname-modal', 'image-lightbox', 'admin-dashboard-modal', 'feedback-modal', 'notes-dashboard-modal', 'note-editor-modal', 'assigned-modal', 'access-requests-modal', 'verification-modal'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
    // clear any editing state
    state.currentEditingAnn = null;
    state.currentImageBase64 = null;
    state.context = Object.assign(state.context || {}, { id: null });
    const preview = document.getElementById('ann-image-preview-container'); if (preview) preview.classList.add('hidden');
  };
  window.openBroadcaster = function (forceServer) {
    // Reset fields for new broadcast (unless already editing)
    if (!state.currentEditingAnn) {
      document.getElementById('ann-message').value = '';
      document.getElementById('ann-severity').value = 'info';
      document.getElementById('ann-sender').value = state.userNickname || state.userEmail || '';
      document.getElementById('ann-link').value = '';
      state.currentImageBase64 = null;
      document.getElementById('ann-image-preview-container').classList.add('hidden');
    }
    // Update button text based on editing state
    const postBtn = document.getElementById('ann-post-btn');
    if (postBtn) {
      postBtn.innerText = state.currentEditingAnn ? 'Update Announcement' : 'Post Announcement';
    }
    // Populate target selector (always show available accounts; include ALL only when forced by Server Broadcast)
    const sel = document.getElementById('ann-target');
    if (sel) {
      sel.innerHTML = '';
      const currLabel = state.currentAccount ? (state.currentAccount.name || state.currentAccount.title || state.currentAccount.id) : 'Current Account';
      // Add global option only when explicitly forced by the Server Broadcast button for SUPER_ADMIN
      if (state.role === 'SUPER_ADMIN' && forceServer === true) {
        const optAll = document.createElement('option'); optAll.value = 'ALL'; optAll.innerText = 'All Accounts (Global Announcement)'; sel.appendChild(optAll);
      }
      // Populate accounts list
      if (state.availableAccounts && state.availableAccounts.length) {
        const seen = new Set();
        state.availableAccounts.forEach(acc => {
          const base = acc.name || acc.title || acc.id;
          if (seen.has(base)) return;
          seen.add(base);
          const o = document.createElement('option'); o.value = acc.id; o.innerText = base; sel.appendChild(o);
        });
      }
      // Preselect current account when present
      try { if (state.currentAccount && state.currentAccount.id) sel.value = state.currentAccount.id; } catch (e) { }
      // Hide target selector if not forced by server (homepage broadcast)
      if (sel.parentElement) {
        sel.parentElement.classList.toggle('hidden', !forceServer);
      }
    }
    // Prefill sender
    const sndEl = document.getElementById('ann-sender'); if (sndEl && !state.currentEditingAnn) sndEl.value = state.userNickname || state.userEmail || '';
    // If forced server, select ALL
    if (forceServer && document.getElementById('ann-target')) document.getElementById('ann-target').value = 'ALL';
    document.getElementById('broadcaster-modal').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
  };
  window.showContextMenu = function (e, t, i, extraData) {
    e.preventDefault();
    state.context = { type: t, id: i, link: extraData }; // Store detected link
    const m = document.getElementById('context-menu');
    // Toggle visibility of Save Link button
    const saveLinkBtn = document.getElementById('ctx-save-link');
    if (t === 'announcement' && extraData) {
      saveLinkBtn.classList.remove('hidden');
    } else {
      saveLinkBtn.classList.add('hidden');
    }
    // Hide Edit/Remove for announcements unless in manage mode (optional, but keep consistent)
    const editBtn = document.getElementById('ctx-edit-btn');
    const delBtn = document.getElementById('ctx-del-btn');
    if (t === 'announcement') {
      editBtn.classList.add('hidden');
      delBtn.classList.add('hidden');
    } else {
      editBtn.classList.remove('hidden');
      delBtn.classList.remove('hidden');
    }
    m.classList.remove('hidden');
    m.style.left = e.pageX + 'px';
    m.style.top = e.pageY + 'px';
  };
  window.saveLinkFromContext = function () {
    state.context.type = 'icon'; // Switch context to creating an icon
    state.context.id = null; // New item
    window.openModal(); // Open modal, logic inside openModal handles state.context.link
    document.getElementById('context-menu').classList.add('hidden');
  };
  window.previewAnnImage = function (e) {
    const f = e.target.files[0];
    if (f) {
      // Limit image size to 5MB to prevent RPC payload issues
      if (f.size > 5 * 1024 * 1024) {
        alert("Image too large. Please select an image smaller than 5MB.");
        e.target.value = '';
        return;
      }
      const r = new FileReader();
      r.onload = function (ev) {
        state.currentImageBase64 = ev.target.result;
        const i = document.getElementById('ann-image-preview');
        if (i) i.src = ev.target.result;
        document.getElementById('ann-image-preview-container').classList.remove('hidden');
      };
      r.readAsDataURL(f);
    }
  };
  window.clearAnnImage = function () {
    state.currentImageBase64 = null;
    document.getElementById('ann-image-preview').src = '';
    document.getElementById('ann-image-preview-container').classList.add('hidden');
  };
  window.promptAddCategory = function () {
    state.context = { type: 'cat', id: null };
    window.openModal();
  };
  window.editItem = function () {
    window.openModal();
  };
  window.setSite = function (s) {
    state.selectedSite = s;
    state.weatherRisk = null; // Explicitly clear for new context
    if (state.currentCat === 'HOME') updateWeatherUI(); // Show spinner
    window.fetchWeatherRisk();
  };
  window.openImageZoom = function (u) {
    let lightbox = document.getElementById('image-lightbox');
    if (!lightbox) {
      lightbox = document.createElement('div');
      lightbox.id = 'image-lightbox';
      lightbox.className = 'fixed inset-0 z-[9999] bg-black/90 hidden items-center justify-center p-4 cursor-zoom-out';
      lightbox.onclick = window.closeLightbox;
      lightbox.innerHTML = `<img id="lightbox-img" class="max-w-full max-h-full object-contain shadow-2xl" src="">`;
      document.body.appendChild(lightbox);
    }
    const i = document.getElementById('lightbox-img');
    if (i) i.src = u;
    lightbox.classList.remove('hidden');
    lightbox.style.display = 'flex';
  };
  window.closeLightbox = function () {
    const lightbox = document.getElementById('image-lightbox');
    if (lightbox) {
      lightbox.classList.add('hidden');
      lightbox.style.display = 'none';
    }
    const img = document.getElementById('lightbox-img');
    if (img) img.src = '';
  };
  window.setTaskView = function (v) {
    state.taskView = v;
    if (state.currentCat === 'HOME') updateChecklistUI();
  };
  window.addPersonalTaskAction = function () {
    const i = document.getElementById('new-task-input');
    if (!i) return;
    const t = i.value.trim();
    if (!t) return;
    i.value = '';
    state.checklist.unshift({
      id: 'temp_' + Date.now(),
      text: t,
      isDone: false,
      timestamp: new Date().toISOString()
    });
    state.taskView = 'PENDING';
    if (state.currentCat === 'HOME') updateChecklistUI();
    (async () => { try { const res = await runMutation("tasks:addPersonalTask", { email: state.userEmail, taskText: t }); Promise.resolve().then(() => { const _cb = (l => {
      state.checklist = l || [];
      if (state.currentCat === 'HOME') updateChecklistUI();
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.toggleTaskAction = function (id) {
    const t = state.checklist.find(x => x.id === id);
    if (t) {
      t.isDone = !t.isDone;
      if (state.currentCat === 'HOME') updateChecklistUI();
      (async () => { try { const res = await runMutation("tasks:togglePersonalTask", { email: state.userEmail, taskId: id }); Promise.resolve().then(() => { const _cb = (l => state.checklist = l || []); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
    }
  };
  window.deleteTaskAction = function (id) {
    if (!confirm("Delete?")) return;
    state.checklist = state.checklist.filter(x => x.id !== id);
    if (state.currentCat === 'HOME') updateChecklistUI();
    (async () => { try { const res = await runMutation("tasks:deletePersonalTask", { email: state.userEmail, taskId: id }); Promise.resolve().then(() => { const _cb = (l => {
      state.checklist = l || [];
      if (state.currentCat === 'HOME') updateChecklistUI();
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.promptAdminTask = function (email, nickname) {
    // Open task assignment modal instead of browser prompt
    document.getElementById('task-assignment-modal').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
    document.getElementById('task-input').value = '';
    document.getElementById('task-input').focus();
    document.getElementById('task-target-name').innerText = `Target: ${nickname}`;
    // Store context for when task is submitted - including email for server dispatch
    state.currentTaskTarget = { email: email, nickname: nickname };
    state.bulkTargetType = 'USER';  // Set target type to USER for individual assignment
  };
  window.closeTaskAssignmentModal = function () {
    document.getElementById('task-assignment-modal').classList.add('hidden');
    document.getElementById('overlay').classList.add('hidden');
    document.getElementById('task-input').value = '';
    // If there are tasks queued and a target is set, auto-dispatch them
    if (state.bulkTaskQueue.length > 0 && state.currentTaskTarget && state.currentTaskTarget.email) {
      dispatchTasksToUser(state.currentTaskTarget.email);
    }
    state.currentTaskTarget = null;
    state.bulkTargetType = null;
  };
  window.addTaskFromModal = function () {
    // Safety check: ensure modal context exists
    if (!state.currentTaskTarget) {
      return;
    }
    const taskText = document.getElementById('task-input').value.trim();
    if (!taskText) {
      return;
    }
    // Add to task queue
    state.bulkTaskQueue.push(taskText);
    renderTaskQueue();
    // Clear input and keep modal open for adding another task to same user
    document.getElementById('task-input').value = '';
    document.getElementById('task-input').focus();
    // Show subtle notification
    const btn = document.getElementById('task-submit-btn');
    const originalText = btn.innerText;
    btn.innerText = '✓ Added';
    setTimeout(() => { btn.innerText = originalText; }, 1000);
  };
  window.handleTaskInputKeydown = function (e) {
    if (e.key === 'Escape') {
      closeTaskAssignmentModal();
      e.preventDefault();
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      addTaskFromModal();
    }
  };
  window.dispatchTasksToUser = function (userEmail) {
    // Send queued tasks to a specific user
    if (!state.bulkTaskQueue || state.bulkTaskQueue.length === 0) {
      return;
    }
    const taskList = [...state.bulkTaskQueue];  // Copy the queue
    // Call server function to assign tasks
    (async () => { try { const res = await runMutation("tasks:bulkAssignTasks", { callerEmail: state.userEmail, targetType: 'USER', targetId: userEmail, tasks: taskList, senderNickname: state.userNickname }); Promise.resolve().then(() => { const _cb = (() => {
      // Clear queue after successful dispatch
      state.bulkTaskQueue = [];
      renderTaskQueue();
      // Refresh personal updates to show new tasks


    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); Promise.resolve().then(() => { const _fc = (err => {
      console.error('Failed to dispatch tasks', err);
    }); if(typeof _fc === 'function') _fc(err); else alert(err.message || String(err)); }); } })();
  };
  window.toggleNotes = function () {
    state.notesOpen = !state.notesOpen;
    const s = document.getElementById('notes-sidebar');
    const m = document.getElementById('main-content');
    const l = document.getElementById('logo-text-span');
    if (state.notesOpen) {
      s.classList.add('open');
      m.classList.add('blur-bg');
      l.innerHTML = `<span class="font-black text-slate-800 dark:text-white tracking-tight text-lg">WORKFORCE</span><span class="font-black text-primary-600 tracking-tight text-lg ml-1">ZEUS</span><span class="font-black text-yellow-500 tracking-tight text-lg ml-1">x NOTES</span>`;
      renderNotes();
    } else {
      s.classList.remove('open');
      m.classList.remove('blur-bg');
      l.innerHTML = `<span class="font-black text-slate-800 dark:text-white tracking-tight text-lg">WORKFORCE</span><span class="font-black text-primary-600 tracking-tight text-lg ml-1">ZEUS</span>`;
    }
  };
  window.formatDoc = function (cmd, value) {
    document.execCommand(cmd, false, value);
  };
  window.openNotesDashboard = function () {
    document.getElementById('notes-dashboard-modal').classList.remove('hidden');
    updateDashboardModeButtons();
    renderFullScreenNotes();
  };
  window.closeNotesDashboard = function () {
    document.getElementById('notes-dashboard-modal').classList.add('hidden');
  };
  window.setDashboardMode = function (mode) {
    state.notesMode = mode;
    // Update sidebar toggle UI as well
    document.getElementById('notes-mode-switch').dataset.mode = mode;
    document.getElementById('note-tab-personal').classList.toggle('active', mode === 'PERSONAL');
    document.getElementById('note-tab-team').classList.toggle('active', mode === 'TEAM');
    updateDashboardModeButtons();
    renderNotes(); // Update sidebar
    renderFullScreenNotes(); // Update dashboard
  };
  function updateDashboardModeButtons() {
    const pBtn = document.getElementById('dash-mode-personal');
    const tBtn = document.getElementById('dash-mode-team');
    const activeClass = ['bg-primary-600', 'text-white', 'shadow-md', 'shadow-primary-500/20'];
    const inactiveClass = ['text-slate-500', 'dark:text-slate-400', 'hover:bg-slate-200', 'dark:hover:bg-slate-700'];
    if (state.notesMode === 'PERSONAL') {
      pBtn.classList.add(...activeClass);
      pBtn.classList.remove(...inactiveClass);
      tBtn.classList.remove(...activeClass);
      tBtn.classList.add(...inactiveClass);
    } else {
      tBtn.classList.add(...activeClass);
      tBtn.classList.remove(...inactiveClass);
      pBtn.classList.remove(...activeClass);
      pBtn.classList.add(...inactiveClass);
    }
  }
  window.expandDashCreate = function () {
    document.getElementById('dash-create-collapsed').classList.add('hidden');
    document.getElementById('dash-create-expanded').classList.remove('hidden');
    document.getElementById('dash-new-title').focus();
  };
  window.saveDashNote = function () {
    const t = document.getElementById('dash-new-title').value.trim();
    const b = document.getElementById('dash-new-body').innerHTML.trim();
    if (t || b) {
      if (state.notesMode === 'TEAM' && !state.currentAccount) {
        alert("Join workspace first.");
        return;
      }
      const tmpId = 'temp_' + Date.now();
      const obj = {
        id: tmpId,
        title: t,
        content: b,
        timestamp: new Date().toISOString(),
        author: state.userNickname
      };
      if (state.notesMode === 'TEAM') {
        if (!state.currentAccount.notes) state.currentAccount.notes = [];
        state.currentAccount.notes.unshift(obj);
      } else {
        state.notes.unshift(obj);
      }
      const aid = state.currentAccount ? state.currentAccount.id : null;
      (async () => { try { const res = await runMutation("notes:saveNote", { email: state.userEmail, noteId: undefined, title: t, content: b, scope: state.notesMode, accountId: aid || undefined, nickname: state.userNickname || undefined }); Promise.resolve().then(() => { const _cb = (n => {
        if (state.notesMode === 'TEAM') state.currentAccount.notes = n;
        else state.notes = n;
        renderNotes();
        renderFullScreenNotes();
      }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
    }
    // Reset UI
    document.getElementById('dash-new-title').value = '';
    document.getElementById('dash-new-body').innerHTML = '';
    document.getElementById('dash-create-expanded').classList.add('hidden');
    document.getElementById('dash-create-collapsed').classList.remove('hidden');
    renderNotes();
    renderFullScreenNotes();
  };
  window.renderFullScreenNotes = function () {
    const grid = document.getElementById('fs-notes-grid');
    if (!grid) return;
    let list = [];
    if (state.notesMode === 'TEAM') {
      if (!state.currentAccount) {
        grid.innerHTML = '<div class="col-span-full text-center text-slate-500 mt-20 font-black uppercase tracking-widest text-[10px]">Join a workspace to view team notes.</div>';
        return;
      }
      list = state.currentAccount.notes || [];
    } else {
      list = state.notes || [];
    }
    if (list.length === 0) {
      grid.innerHTML = '<div class="col-span-full text-center text-slate-500 mt-20 flex flex-col items-center"><span class="material-icons text-6xl opacity-20 mb-4">note_add</span><span class="text-[10px] font-black uppercase tracking-widest opacity-40">Notes you add appear here</span></div>';
      return;
    }
    grid.innerHTML = list.map(n => {
      const auth = (state.notesMode === 'TEAM' && n.author) ? `<div class="mb-4 flex items-center gap-2 font-black text-[9px] uppercase tracking-widest text-slate-400 dark:text-slate-400"><div class="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-primary-600 border border-slate-200 dark:border-slate-700 shadow-sm transition-transform group-hover:scale-110">${n.author.charAt(0)}</div><span>${n.author}</span></div>` : '';
      return `
      <div class="break-inside-avoid mb-6 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl p-8 hover:shadow-2xl hover:shadow-primary-500/10 transition-all cursor-default group border-b-4 border-b-transparent hover:border-b-primary-500 flex flex-col" onclick="openNoteEditor('${n.id}')">
          ${auth}
          ${n.title ? `<h3 class="font-black text-xl text-slate-800 dark:text-white mb-4 leading-tight uppercase tracking-tight group-hover:text-primary-600 transition-colors">${n.title}</h3>` : ''}
          <div class="note-content-area text-sm text-slate-600 dark:text-slate-200 leading-relaxed font-medium whitespace-pre-wrap break-all overflow-hidden line-clamp-[12]">${n.content}</div>
          <div class="mt-8 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
             <span class="text-[8px] font-black uppercase text-slate-400 tracking-[0.2em]">${new Date(n.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
             <div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-primary-600 transition-colors"><span class="material-icons text-sm">edit</span></div>
          </div>
      </div>
      `;
    }).join('');
  };
  window.openNoteEditor = function (id) {
    state.currentNoteId = id;
    const l = state.notesMode === 'TEAM' ? (state.currentAccount ? state.currentAccount.notes : []) : state.notes;
    const n = id ? (l || []).find(x => x.id === id) : { title: '', content: '' };
    if (id && !n) return;
    document.getElementById('editor-title').value = n.title || '';
    document.getElementById('editor-body').innerHTML = n.content || '';
    document.getElementById('note-editor-modal').classList.remove('hidden');
  };
  window.closeNoteEditor = function () {
    document.getElementById('note-editor-modal').classList.add('hidden');
    state.currentNoteId = null;
  };
  window.saveNoteFromEditor = function () {
    const t = document.getElementById('editor-title').value.trim();
    const b = document.getElementById('editor-body').innerHTML.trim();
    if (!t && !b) return;
    const isNew = !state.currentNoteId;
    const l = state.notesMode === 'TEAM' ? (state.currentAccount ? state.currentAccount.notes : []) : state.notes;
    const n = isNew ? null : (l || []).find(x => x.id === state.currentNoteId);
    if (n) {
      n.title = t;
      n.content = b;
    }
    const aid = state.currentAccount ? state.currentAccount.id : null;
    (async () => { try { const res = await runMutation("notes:saveNote", { email: state.userEmail, noteId: state.currentNoteId || undefined, title: t, content: b, scope: state.notesMode, accountId: aid || undefined, nickname: state.userNickname || undefined }); Promise.resolve().then(() => { const _cb = (nx => {
      if (state.notesMode === 'TEAM') state.currentAccount.notes = nx;
      else state.notes = nx;
      renderNotes();
      renderFullScreenNotes();
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
    renderNotes();
    renderFullScreenNotes();
    closeNoteEditor();
  };
  window.deleteNoteFromEditor = function () {
    if (!state.currentNoteId) return;
    if (!confirm("Delete this note?")) return;
    const id = state.currentNoteId;
    if (state.notesMode === 'TEAM') state.currentAccount.notes = state.currentAccount.notes.filter(n => n.id !== id);
    else state.notes = state.notes.filter(n => n.id !== id);
    const aid = state.currentAccount ? state.currentAccount.id : null;
    (async () => { try { const res = await runMutation("notes:deleteNote", { email: state.userEmail, noteId: id, scope: state.notesMode, accountId: aid }); Promise.resolve().then(() => { const _cb = (n => {
      if (state.notesMode === 'TEAM') state.currentAccount.notes = n;
      else state.notes = n;
      renderNotes();
      renderFullScreenNotes();
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
    renderNotes();
    renderFullScreenNotes();
    closeNoteEditor();
  };
  window.toggleNotesMode = function () {
    state.notesMode = state.notesMode === 'PERSONAL' ? 'TEAM' : 'PERSONAL';
    document.getElementById('notes-mode-switch').dataset.mode = state.notesMode;
    document.getElementById('note-tab-personal').classList.toggle('active', state.notesMode === 'PERSONAL');
    document.getElementById('note-tab-team').classList.toggle('active', state.notesMode === 'TEAM');
    renderNotes();
    // Update Dashboard if open
    if (!document.getElementById('notes-dashboard-modal').classList.contains('hidden')) {
      updateDashboardModeButtons();
      renderFullScreenNotes();
    }
  };
  window.renderNotes = function () {
    const c = document.getElementById('notes-list');
    if (!c) return;
    let list = [];
    if (state.notesMode === 'TEAM') {
      if (!state.currentAccount) {
        c.innerHTML = '<div class="text-center text-xs opacity-50 p-4">Join workspace for team notes</div>';
        return;
      }
      list = state.currentAccount.notes || [];
    } else {
      list = state.notes || [];
    }
    let newHTML = '';
    if (list.length === 0) {
      newHTML = '<div class="text-center text-xs opacity-50 p-4">No notes yet</div>';
    } else {
      newHTML = list.map(n => {
        let auth = state.notesMode === 'TEAM' && n.author ? `<span class="text-[9px] font-bold text-slate-400 dark:text-slate-400 uppercase block mb-1">${n.author}</span>` : '';
        return `<div class="bg-white dark:bg-slate-800/80 mb-2 p-3 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm hover:shadow-md hover:border-primary-500/30 transition-all cursor-pointer group" onclick="openNoteEditor('${n.id}')">${auth}<div class="flex justify-between items-start mb-1"><h4 class="font-black text-[10px] text-slate-800 dark:text-slate-100 uppercase tracking-tight line-clamp-1">${n.title || 'Untitled'}</h4><button onclick="event.stopPropagation(); deleteNoteAction('${n.id}')" class="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-colors"><span class="material-icons text-[14px]">close</span></button></div><p class="note-content-area text-[10px] text-slate-500 dark:text-slate-200 line-clamp-2 leading-relaxed break-all">${n.content}</p></div>`;
      }).join('');
    }
    // CACHE CHECK (Only if Team mode, as personal updates less frequently via poll, but good practice for both)
    c.innerHTML = newHTML;
  };
  window.saveNoteAction = function () {
    const t = document.getElementById('quick-note-title');
    const b = document.getElementById('quick-note-body');
    const tv = t.value.trim();
    const bv = b.innerHTML.trim();
    if (!bv && !tv) return;
    if (state.notesMode === 'TEAM' && !state.currentAccount) {
      alert("Join workspace first.");
      return;
    }
    const tmpId = 'temp_' + Date.now();
    const obj = {
      id: tmpId,
      title: tv,
      content: bv,
      timestamp: new Date().toISOString(),
      author: state.userNickname
    };
    if (state.notesMode === 'TEAM') {
      if (!state.currentAccount.notes) state.currentAccount.notes = [];
      state.currentAccount.notes.unshift(obj);
    } else {
      state.notes.unshift(obj);
    }
    t.value = '';
    b.innerHTML = '';
    renderNotes();
    const aid = state.currentAccount ? state.currentAccount.id : null;
    (async () => { try { const res = await runMutation("notes:saveNote", { email: state.userEmail, noteId: undefined, title: tv, content: bv, scope: state.notesMode, accountId: aid || undefined, nickname: state.userNickname || undefined }); Promise.resolve().then(() => { const _cb = (n => {
      if (state.notesMode === 'TEAM') state.currentAccount.notes = n;
      else state.notes = n;
      renderNotes();
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.deleteNoteAction = function (id) {
    if (!confirm("Delete note?")) return;
    if (state.notesMode === 'TEAM') state.currentAccount.notes = state.currentAccount.notes.filter(n => n.id !== id);
    else state.notes = state.notes.filter(n => n.id !== id);
    renderNotes();
    const aid = state.currentAccount ? state.currentAccount.id : null;
    (async () => { try { const res = await runMutation("notes:deleteNote", { email: state.userEmail, noteId: id, scope: state.notesMode, accountId: aid || undefined }); Promise.resolve().then(() => { const _cb = (n => {
      if (state.notesMode === 'TEAM') state.currentAccount.notes = n;
      else state.notes = n;
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  /* ------------------------------------------------------------------
     ORG CHART LOGIC
     ------------------------------------------------------------------ */
  window.openOrgChart = function () {
    document.getElementById('org-chart-modal').classList.remove('hidden');
    updateOrgClock();
    loadOrgChartData(false);
  };
  let orgNav = { scale: 1, x: 0, y: 0, isDragging: false, startX: 0, startY: 0 };
  function initOrgChartNavigation() {
    const main = document.getElementById('org-chart-main');
    if (!main) return;
    const depts = main.querySelector('.org-depts');
    if (!depts) return;
    orgNav = { scale: 1, x: 0, y: 0, isDragging: false, startX: 0, startY: 0 };
    updateOrgTransform();
    const onMouseMove = (e) => {
      if (!orgNav.isDragging) return;
      orgNav.x = e.clientX - orgNav.startX;
      orgNav.y = e.clientY - orgNav.startY;
      updateOrgTransform();
    };
    const onMouseUp = () => {
      orgNav.isDragging = false;
      main.style.cursor = 'grab';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    main.onmousedown = (e) => {
      if (e.target.closest('.org-card')) return;
      orgNav.isDragging = true;
      orgNav.startX = e.clientX - orgNav.x;
      orgNav.startY = e.clientY - orgNav.y;
      main.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };
    main.onwheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const newScale = Math.min(Math.max(0.2, orgNav.scale + delta), 3);
      const rect = main.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const dx = (mouseX - orgNav.x) / orgNav.scale;
      const dy = (mouseY - orgNav.y) / orgNav.scale;
      orgNav.scale = newScale;
      orgNav.x = mouseX - dx * orgNav.scale;
      orgNav.y = mouseY - dy * orgNav.scale;
      updateOrgTransform();
    };
  }

  function updateOrgTransform() {
    const main = document.getElementById('org-chart-main');
    if (!main) return;
    const depts = main.querySelector('.org-depts');
    if (depts) {
      depts.style.transform = `translate(${orgNav.x}px, ${orgNav.y}px) scale(${orgNav.scale})`;
    }
  }

  function updateOrgClock() {
    const el = document.getElementById('org-current-time');
    const modal = document.getElementById('org-chart-modal');
    if (el && modal && !modal.classList.contains('hidden')) {
      el.textContent = 'Current EST: ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: state.systemTimeZone });
      setTimeout(updateOrgClock, 1000);
    }
  }

  window.closeOrgChart = function () {
    document.getElementById('org-chart-modal').classList.add('hidden');
    hideOrgTip();
  };
  window.loadOrgChartData = function (isRefresh) {
    const main = document.getElementById('org-chart-main');
    const btn = document.getElementById('org-refresh-btn');
    const icon = btn.querySelector('.org-spin-icon');
    if (!isRefresh) {
      main.innerHTML = '<div class="flex flex-col items-center justify-center h-full text-slate-500"><span class="material-icons text-4xl animate-spin mb-4">sync</span><span class="text-xs font-bold uppercase tracking-widest">Loading Roster...</span></div>';
    }
    icon.classList.add('animate-spin');
    fetch('/orgchart.json').then(r=>r.json()).then(data => { Promise.resolve().then(() => { const _cb = (data => {
      icon.classList.remove('animate-spin');
      if (data.error) {
        main.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-red-400 p-8 text-center"><span class="material-icons text-4xl mb-4">error_outline</span><h3 class="font-bold mb-2">Error Loading Roster</h3><p class="text-xs opacity-70">${data.error}</p></div>`;
        return;
      }
      renderOrgChart(data);
    }); if(typeof _cb === 'function') _cb(data); }); }).catch(err => { Promise.resolve().then(() => { const _fc = (err => {
      icon.classList.remove('animate-spin');
      main.innerHTML = `<div class="flex flex-col items-center justify-center h-full text-red-400 p-8 text-center"><span class="material-icons text-4xl mb-4">error_outline</span><h3 class="font-bold mb-2">Failed to Fetch Data</h3><p class="text-xs opacity-70">${err.message || String(err)}</p></div>`;
    }); if(typeof _fc === 'function') _fc(err); }); });
  };
  function renderOrgChart(data) {
    const main = document.getElementById('org-chart-main');
    main.innerHTML = '';
    if (!data.departments || data.departments.length === 0) {
      main.innerHTML = '<div class="flex flex-col items-center justify-center h-full text-slate-500"><span class="material-icons text-4xl mb-4">person_off</span><span class="text-xs font-bold uppercase tracking-widest">No data found. Initialize the Roster sheet first.</span></div>';
      return;
    }
    const container = document.createElement('div');
    container.className = 'org-depts';
    data.departments.forEach(dept => {
      const deptColor = getDeptColor(dept.name);
      const col = document.createElement('div');
      col.className = 'org-dc';
      const badge = document.createElement('div');
      badge.className = 'org-dbadge';
      badge.style.color = deptColor;
      badge.style.borderColor = deptColor;
      badge.style.background = `color-mix(in srgb, ${deptColor} 12%, transparent)`;
      badge.textContent = dept.name;
      col.appendChild(badge);
      const rootContainer = document.createElement('div');
      rootContainer.className = 'org-tr';
      dept.roots.forEach(r => rootContainer.appendChild(buildOrgNode(r)));
      col.appendChild(rootContainer);
      container.appendChild(col);
    });
    main.appendChild(container);
    document.getElementById('org-last-updated').textContent = 'Last Updated Data: ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: state.systemTimeZone });
    // Initialize navigation after content is rendered
    setTimeout(initOrgChartNavigation, 100);
  }

  function getDeptColor(name) {
    const d = (name || '').toLowerCase();
    if (d.includes('operation')) return '#3b82f6';
    if (d.includes('learning')) return '#a855f7';
    if (d.includes('workforce')) return '#10b981';
    return '#64748b';
  }

  function buildOrgNode(node) {
    const roleClass = getOrgRoleClass(node.role);
    const wrap = document.createElement('div');
    wrap.className = 'org-tn';
    const card = document.createElement('div');
    card.className = `org-card ${roleClass}`;
    const activeDot = node.isActive ? '<div class="org-active-dot" title="Currently Active"></div>' : '';
    card.innerHTML = `<div class="org-crole">${escHtml(node.role)}</div><div class="org-cname">${activeDot}${escHtml(node.name)}</div>`;
    card.addEventListener('mouseenter', e => showOrgTip(e, node));
    card.addEventListener('mousemove', e => moveOrgTip(e));
    card.addEventListener('mouseleave', hideOrgTip);
    wrap.appendChild(card);
    if (!node.children || node.children.length === 0) return wrap;
    const isHoriz = (node.format || '').toLowerCase() === 'horizontal';
    const gridRoles = new Set(['team leader', 'rta', 'qa']);
    const firstChildRole = (node.children[0]?.role || '').toLowerCase();
    const isGrid = gridRoles.has(firstChildRole) && node.children.length > 1;
    const vl = document.createElement('div');
    vl.className = 'org-vl';
    vl.style.height = '18px';
    wrap.appendChild(vl);
    if (isGrid) {
      const grid = document.createElement('div');
      grid.className = 'org-ch-grid';
      node.children.forEach(child => grid.appendChild(buildOrgNode(child)));
      wrap.appendChild(grid);
    } else if (isHoriz) {
      if (node.children.length === 1) {
        wrap.appendChild(buildOrgNode(node.children[0]));
      } else {
        const row = document.createElement('div');
        row.className = 'org-ch-h';
        node.children.forEach(child => {
          const sc = document.createElement('div');
          sc.className = 'org-sc';
          const drop = document.createElement('div');
          drop.className = 'org-vl';
          drop.style.height = '18px';
          sc.appendChild(drop);
          sc.appendChild(buildOrgNode(child));
          row.appendChild(sc);
        });
        wrap.appendChild(row);
        // Draw horizontal bar
        requestAnimationFrame(() => {
          const cols = row.querySelectorAll(':scope > .org-sc');
          if (cols.length < 2) return;
          const rr = row.getBoundingClientRect();
          const fr = cols[0].getBoundingClientRect();
          const lr = cols[cols.length - 1].getBoundingClientRect();
          const left = fr.left + fr.width / 2 - rr.left;
          const right = lr.left + lr.width / 2 - rr.left;
          const bar = document.createElement('div');
          bar.className = 'org-hbar';
          bar.style.left = left + 'px';
          bar.style.width = (right - left) + 'px';
          row.appendChild(bar);
        });
      }
    } else {
      const vWrap = document.createElement('div');
      vWrap.className = 'org-ch-v';
      node.children.forEach(child => {
        const vl2 = document.createElement('div');
        vl2.className = 'org-vl';
        vl2.style.height = '16px';
        vWrap.appendChild(vl2);
        vWrap.appendChild(buildOrgNode(child));
      });
      wrap.appendChild(vWrap);
    }
    return wrap;
  }

  function getOrgRoleClass(role) {
    if (!role) return 'org-rc-o';
    const r = role.toLowerCase();
    if (r === 'manager' || r === 'learning & development manager') return 'org-rc-m';
    if (r.includes('assistant')) return 'org-rc-a';
    if (r === 'senior team leader') return 'org-rc-s';
    if (r === 'qa team leader') return 'org-rc-qt';
    if (r === 'team leader') return 'org-rc-t';
    if (r === 'rta') return 'org-rc-r';
    if (r === 'qa') return 'org-rc-q';
    if (r.includes('trainer')) return 'org-rc-tr';
    return 'org-rc-o';
  }

  function showOrgTip(e, node) {
    const tt = document.getElementById('org-tt');
    const tti = document.getElementById('org-tti');
    const roleClass = getOrgRoleClass(node.role);
    const colors = {
      'org-rc-m': '#f59e0b', 'org-rc-a': '#3b82f6', 'org-rc-s': '#8b5cf6',
      'org-rc-qt': '#a855f7', 'org-rc-t': '#10b981', 'org-rc-r': '#06b6d4',
      'org-rc-q': '#ec4899', 'org-rc-tr': '#f97316', 'org-rc-o': '#64748b'
    };
    const color = colors[roleClass] || '#64748b';
    const initials = (node.name || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
    const lobs = node.lob ? node.lob.split(',').map(l => l.trim()).filter(Boolean) : [];
    const lobHtml = lobs.length ? lobs.map(l => `<span class="org-ttp">${escHtml(l)}</span>`).join('') : '<span class="text-slate-600 italic">—</span>';
    tti.innerHTML = `
    <div class="org-tth">
      <div class="org-ttav" style="background:color-mix(in srgb, ${color} 15%, transparent); color: ${color}">${escHtml(initials)}</div>
      <div>
        <div class="org-ttn">${escHtml(node.name)}</div>
        <span class="org-ttb" style="background:color-mix(in srgb, ${color} 15%, transparent); color: ${color}">${escHtml(node.role)}</span>
      </div>
    </div>
    <div class="org-ttd"></div>
    <div class="org-ttr">
      <span class="material-icons org-ttic text-sm">email</span>
      <div class="org-ttv">${node.email ? `<a href="mailto:${node.email}" class="text-primary-600 dark:text-primary-400 hover:underline">${escHtml(node.email)}</a>` : '<span class="italic">—</span>'}</div>
    </div>
    <div class="org-ttr">
      <span class="material-icons org-ttic text-sm">business</span>
      <div class="org-ttv">${lobHtml}</div>
    </div>
    <div class="org-ttr">
      <span class="material-icons org-ttic text-sm">schedule</span>
      <div class="org-ttv">${escHtml(node.scheduleHours || '—')}</div>
    </div>
    <div class="org-ttr">
      <span class="material-icons org-ttic text-sm">calendar_today</span>
      <div class="org-ttv">${escHtml(node.scheduleDays || '—')}</div>
    </div>
  `;
    tt.classList.add('on');
    tt.style.opacity = '1';
    moveOrgTip(e);
  }

  function moveOrgTip(e) {
    const tt = document.getElementById('org-tt');
    const tw = tt.offsetWidth || 240;
    const th = tt.offsetHeight || 160;
    let x = e.clientX + 14;
    let y = e.clientY + 14;
    if (x + tw > window.innerWidth - 10) x = e.clientX - tw - 14;
    if (y + th > window.innerHeight - 10) y = e.clientY - th - 14;
    tt.style.left = x + 'px';
    tt.style.top = y + 'px';
  }

  function hideOrgTip() {
    const tt = document.getElementById('org-tt');
    tt.classList.remove('on');
    tt.style.opacity = '0';
  }

  function parseMarkdown(text) {
    if (!text) return '';
    // Simple markdown parsing for announcements: bold, italic, underline, newlines
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    html = html.replace(/__(.*?)__/g, '<u>$1</u>');
    html = html.replace(/\*(.*?)\*/g, '<i>$1</i>');
    html = html.replace(/_(.*?)_/g, '<i>$1</i>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  function escHtml(s) {
    return (s || '').toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }


  window.openReminderCreator = function () {
    const s = document.getElementById('reminder-target');
    s.innerHTML = '<option value="ALL">Global</option>';
    state.availableAccounts.forEach(a => {
      s.innerHTML += `<option value="${a.id}">${a.name}</option>`;
    });
    document.getElementById('reminder-sender').value = '';
    document.getElementById('reminder-text').value = '';
    document.getElementById('reminder-schedule').value = '';
    document.getElementById('reminder-recurrence').value = 'NONE'; // Reset recurrence
    document.getElementById('reminder-image').value = '';
    document.getElementById('reminder-image-preview').src = '';
    document.getElementById('reminder-image-preview-container').classList.add('hidden');
    state.currentReminderImageBase64 = null;
    document.getElementById('reminder-modal').classList.remove('hidden');
    document.getElementById('overlay').classList.remove('hidden');
  };
  window.sendReminder = function () {
    const t = document.getElementById('reminder-target').value;
    const m = document.getElementById('reminder-text').value;
    const s = document.getElementById('reminder-sender').value;
    const d = parseFloat(document.getElementById('reminder-duration').value) || 24;
    const sc = document.getElementById('reminder-schedule').value;
    const rec = document.getElementById('reminder-recurrence').value;
    if (!m) return;
    window.setBtnLoading('reminder-send-btn', true);
    const isRecurring = rec !== 'NONE';
    (async () => { try { const res = await runMutation("reminders:postReminder", { callerEmail: state.userEmail, targetAccount: t, message: m, imageUrl: state.currentReminderImageBase64, sender: s, durationHours: d, scheduledTime: sc, isRecurring: isRecurring, recurrenceRule: rec }); Promise.resolve().then(() => { const _cb = (() => {
      window.setBtnLoading('reminder-send-btn', false);
      closeModals();
      if (state.currentAccount) window.loadAccount(state.currentAccount.id);
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.previewReminderImage = function (e) {
    const f = e.target.files[0];
    if (f) {
      const r = new FileReader();
      r.onload = function (ev) {
        state.currentReminderImageBase64 = ev.target.result;
        const i = document.getElementById('reminder-image-preview');
        if (i) i.src = ev.target.result;
        document.getElementById('reminder-image-preview-container').classList.remove('hidden');
      };
      r.readAsDataURL(f);
    }
  };
  window.clearReminderImage = function () {
    state.currentReminderImageBase64 = null;
    document.getElementById('reminder-image-preview').src = '';
    document.getElementById('reminder-image-preview-container').classList.add('hidden');
    document.getElementById('reminder-image').value = '';
  };
  window.deleteReminder = function (id) {
    if (!confirm("Delete this reminder?")) return;
    (async () => { try { const res = await runMutation("reminders:deleteReminder", { callerEmail: state.userEmail, reminderId: id }); Promise.resolve().then(() => { const _cb = (() => {
      if (state.currentAccount) window.loadAccount(state.currentAccount.id);
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
  };
  window.setBtnLoading = function (id, l, txt) {
    const b = document.getElementById(id);
    if (!b) return;
    if (l) {
      b.dataset.og = b.innerText;
      b.disabled = true;
      b.innerHTML = '<span class="material-icons animate-spin text-sm">sync</span>';
      b.classList.add('opacity-50');
    } else {
      b.disabled = false;
      b.innerText = txt || b.dataset.og || "OK";
      b.classList.remove('opacity-50');
    }
  };
  window.checkOnlineStatus = function () {
    if (!state.userEmail) return;
    const k = `zeus_aux_status_${state.userEmail}`;
    const s = JSON.parse(localStorage.getItem(k)) || { status: 'ONLINE', timestamp: Date.now() };
    const i = document.getElementById('status-indicator');
    const t = document.getElementById('status-text');
    if (!i || !t) return;
    const timeDiff = Date.now() - (s.lastActivityTime || s.timestamp);
    const inactiveTime = 4 * 60 * 60 * 1000; // 4 hours
    const awayTime = 1 * 60 * 60 * 1000; // 1 hour
    let displayStatus = s.status;
    let displayColor = 'emerald';
    let indicatorColor = 'bg-emerald-500';
    let textColor = 'text-emerald-600 dark:text-emerald-400';
    const statusMap = {
      'ONLINE': { text: 'Online', color: 'emerald', indicator: 'bg-emerald-500', textClass: 'text-emerald-600 dark:text-emerald-400' },
      'LUNCH': { text: 'Lunch', color: 'yellow', indicator: 'bg-yellow-500', textClass: 'text-yellow-600 dark:text-yellow-400' },
      'BREAK': { text: 'Break', color: 'blue', indicator: 'bg-blue-500', textClass: 'text-blue-600 dark:text-blue-400' },
      'AFK': { text: 'AFK', color: 'orange', indicator: 'bg-orange-500', textClass: 'text-orange-600 dark:text-orange-400' },
      'PRODWALK': { text: 'Prod Walk', color: 'purple', indicator: 'bg-purple-500', textClass: 'text-purple-600 dark:text-purple-400' },
      'BIO': { text: 'Bio', color: 'pink', indicator: 'bg-pink-500', textClass: 'text-pink-600 dark:text-pink-400' },
      'OFFLINE': { text: 'Offline', color: 'slate', indicator: 'bg-slate-400', textClass: 'text-slate-600 dark:text-slate-400' }
    };
    // Check inactivity/away ONLY if not Offline
    if (s.status !== 'OFFLINE' && timeDiff > inactiveTime) {
      displayStatus = 'Inactive';
      displayColor = 'slate';
      indicatorColor = 'bg-slate-400';
      textColor = 'text-slate-500';
    } else if (s.status !== 'OFFLINE' && timeDiff > awayTime) {
      displayStatus = 'Away';
      displayColor = 'amber';
      indicatorColor = 'bg-amber-500';
      textColor = 'text-amber-600 dark:text-amber-400';
    } else {
      // Display the current AUX status
      const statusInfo = statusMap[s.status] || statusMap['ONLINE'];
      displayStatus = statusInfo.text;
      indicatorColor = statusInfo.indicator;
      textColor = statusInfo.textClass;
    }
    i.className = `w-2.5 h-2.5 rounded-full ${indicatorColor} transition-all duration-300 shadow-[0_0_8px_rgba(16,185,129,0.8)]`;
    t.className = `text-[10px] font-black uppercase tracking-widest ${textColor} transition-colors`;
    t.innerText = displayStatus;
  };
  window.setAuxStatus = function (status) {
    const k = `zeus_aux_status_${state.userEmail}`;
    localStorage.setItem(k, JSON.stringify({
      status: status,
      timestamp: Date.now(),
      lastActivityTime: Date.now()
    }));
    // Sync AUX status to server
    (async () => { try { const res = await runMutation("users:updateUserAuxStatus", { email: state.userEmail, auxStatus: status }); Promise.resolve().then(() => { const _cb = (() => {
      checkOnlineStatus();
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); alert(err.message || String(err)); } })();
    // Close dropdown
    const dd = document.getElementById('aux-dropdown');
    if (dd) dd.classList.add('hidden');
  };
  window.toggleAuxDropdown = function (e) {
    e.stopPropagation();
    const dd = document.getElementById('aux-dropdown');
    if (dd) dd.classList.toggle('hidden');
  };
  // Close dropdown on click outside
  document.addEventListener('click', () => {
    const dd = document.getElementById('aux-dropdown');
    if (dd) dd.classList.add('hidden');
  });
  window.fetchWeatherRisk = async function () {
    const c = state.selectedSite === 'DUMAGUETE' ? {
      lat: 9.3055,
      lon: 123.3080
    } : {
      lat: 14.5568,
      lon: 121.0211
    };
    try {
      // UPDATED API URL with cloud_cover and showers
      const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lon}&hourly=rain,showers,wind_speed_10m,cloud_cover&current=rain,showers,cloud_cover,wind_speed_10m&timezone=America%2FNew_York&forecast_days=2`);
      if (!r.ok) throw new Error();
      const d = await r.json();
      // Check Current Conditions first
      let currentScore = 0;
      let currentMsg = "";
      if (d.current) {
        const cr = d.current.rain + (d.current.showers || 0);
        const cc = d.current.cloud_cover;
        const cw = d.current.wind_speed_10m;
        if (cr > 0.0) currentScore += 30; // Any rain right now = Moderate
        if (cr > 1.0) currentScore += 30; // Heavy rain = High
        if (cc > 70) currentScore += 10; // Lightly cloudy
        if (cc > 90) currentScore += 20; // Very Gloomy
        if (cw > 20) currentScore += 10;
      }
      // Hourly Forecast Analysis
      const h = d.hourly;
      let max = 0;
      let imp = [];
      const now = new Date();
      for (let i = 0; i < h.time.length; i++) {
        let sc = 0;
        const rn = h.rain[i];
        const sh = h.showers ? h.showers[i] : 0;
        const totalRain = rn + sh;
        const wd = h.wind_speed_10m[i];
        const cc = h.cloud_cover ? h.cloud_cover[i] : 0;
        const ft = new Date(h.time[i]);
        if (ft < now) continue;
        if ((ft - now) > 86400000) break;
        if (totalRain > 0.1) sc += 30; // Sensitive to rain
        else if (totalRain > 0.0) sc += 15; // Trace rain
        if (totalRain > 2.0) sc += 40;
        if (cc > 70) sc += 15; // Gloomy
        if (cc > 90) sc += 15; // Very Gloomy
        if (wd > 25) sc += 20;
        // Rush hour weighting
        const hr = ft.getHours();
        if ((hr >= 6 && hr <= 10) || (hr >= 15 && hr <= 20)) {
          sc *= 1.2;
        }
        if (sc > 25) imp.push({
          time: h.time[i],
          rain: totalRain.toFixed(1),
          wind: wd,
          desc: (totalRain > 0 ? "Rain" : (cc > 80 ? "Gloomy" : "Windy"))
        });
        if (sc > max) max = sc;
      }
      // Merge Current Score with Max Forecast Score for overall risk
      max = Math.max(max, currentScore);
      let lv = 'LOW';
      let msg = 'Conditions stable.';
      let cl = 'text-emerald-500';
      let bg = 'bg-emerald-500';
      if (max > 80) {
        lv = 'CRITICAL';
        cl = 'text-red-500';
        bg = 'bg-red-500';
        msg = 'Storm conditions likely.';
      } else if (max > 50) {
        lv = 'HIGH';
        cl = 'text-orange-500';
        bg = 'bg-orange-500';
        msg = 'Significant shrinkage risk.';
      } else if (max > 25) {
        lv = 'MODERATE';
        cl = 'text-yellow-500';
        bg = 'bg-yellow-500';
        msg = 'Showers/Gloomy. Monitor queues.';
      } else if (max > 15) {
        lv = 'UNSTABLE';
        cl = 'text-slate-500';
        bg = 'bg-slate-400';
        msg = 'Overcast/Gloomy.';
      }
      state.weatherRisk = {
        site: state.selectedSite,
        riskLevel: lv,
        message: msg,
        colorClass: cl,
        bgClass: bg,
        impacts: imp.slice(0, 2),
        timestamp: new Date().toLocaleTimeString([], { timeZone: state.systemTimeZone })
      };
      localStorage.setItem('zeus_weather_cache', JSON.stringify(state.weatherRisk));
    } catch (e) {
      if (!state.weatherRisk) {
        state.weatherRisk = {
          site: state.selectedSite,
          riskLevel: 'OFFLINE',
          message: "API Unreachable",
          colorClass: 'text-slate-400',
          bgClass: 'bg-slate-400',
          impacts: [],
          timestamp: new Date().toLocaleTimeString([], { timeZone: state.systemTimeZone })
        };
      }
    }
    if (state.currentCat === 'HOME') updateWeatherUI();
  };
  // Keyboard shortcuts for formatting: Ctrl/Cmd+B, I, U
  document.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = (e.key || '').toLowerCase();
    if (!['b', 'i', 'u'].includes(key)) return;
    const el = document.activeElement;
    if (!el) return;
    // If contenteditable element, use execCommand
    if (el.isContentEditable) {
      e.preventDefault();
      if (key === 'b') document.execCommand('bold');
      if (key === 'i') document.execCommand('italic');
      if (key === 'u') document.execCommand('underline');
      return;
    }
    // For textareas/inputs, wrap selection with markers
    if (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start == null || end == null) return;
      e.preventDefault();
      const val = el.value;
      const selected = val.slice(start, end);
      let wrapped;
      if (key === 'b') wrapped = `**${selected}**`;
      if (key === 'i') wrapped = `_${selected}_`;
      if (key === 'u') wrapped = `<u>${selected}</u>`;
      const newVal = val.slice(0, start) + wrapped + val.slice(end);
      el.value = newVal;
      // restore selection around original text
      const cursorStart = start + (key === 'b' ? 2 : (key === 'i' ? 1 : 3));
      el.selectionStart = cursorStart;
      el.selectionEnd = cursorStart + selected.length;
    }
  });
  // --- AI BOT LOGIC ---
  let aiChatState = {
    isOpen: false,
    isWaiting: false,
    messages: []
  };
  window.toggleAIChat = function () {
    const win = document.getElementById('ai-chat-window');
    if (aiChatState.isOpen) {
      win.classList.add('hidden');
      win.classList.remove('flex');
      aiChatState.isOpen = false;
    } else {
      win.classList.remove('hidden');
      win.classList.add('flex');
      aiChatState.isOpen = true;
      setTimeout(() => {
        document.getElementById('ai-chat-input').focus();
      }, 100);
    }
  }

  window.sendQuestionToAI = function () {
    if (aiChatState.isWaiting) return;
    const inputEl = document.getElementById('ai-chat-input');
    const question = inputEl.value.trim();
    if (!question) return;
    // Add user message to UI
    window.addAIMessageToUI('user', question);
    inputEl.value = '';
    inputEl.style.height = 'auto'; // reset height
    aiChatState.isWaiting = true;
    window.showAITypingIndicator();
    (async () => { try { const res = await runMutation("ai:askAIBot", { question: question }); Promise.resolve().then(() => { const _cb = ((response) => {
      window.removeAITypingIndicator();
      aiChatState.isWaiting = false;
      window.addAIMessageToUI('ai', response);
    }); if(typeof _cb === 'function') _cb(res); }); } catch(err) { console.error(err); Promise.resolve().then(() => { const _fc = ((err) => {
      window.removeAITypingIndicator();
      aiChatState.isWaiting = false;
      window.addAIMessageToUI('ai', 'Error: ' + err.message);
    }); if(typeof _fc === 'function') _fc(err); else alert(err.message || String(err)); }); } })();
  window.formatZeusMarkdown = function (text) {
    if (!text) return '';
    return text
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Bold + Italic: ***text***
      .replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
      // Bold: **text**
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      // Italic: *text*
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      // Citations: ([filename.pdf])
      .replace(/\(\[(.*?)\]\)/g, '<span class="sop-citation">$1</span>')
      // Newlines
      .replace(/\n/g, '<br/>');
  };

  window.addAIMessageToUI = function (role, text) {
    const container = document.getElementById('ai-chat-messages');
    const msgDiv = document.createElement('div');
    if (role === 'user') {
      msgDiv.className = 'flex justify-end';
      // simple escape
      let safeText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
      msgDiv.innerHTML = `<div class="max-w-[85%] bg-primary-600 text-white p-3 text-xs rounded-2xl rounded-tr-sm shadow-md whitespace-pre-wrap break-words flex-shrink-0">${safeText}</div>`;
    } else {
      msgDiv.className = 'flex justify-start';
      let formattedText = window.formatZeusMarkdown(text);
      msgDiv.innerHTML = `<div class="max-w-[85%] bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 p-3 text-xs rounded-2xl rounded-tl-sm shadow-sm whitespace-pre-wrap break-words border border-slate-200 dark:border-slate-700">${formattedText}</div>`;
    }
    container.appendChild(msgDiv);
    container.scrollTop = container.scrollHeight;
  }

  window.showAITypingIndicator = function () {
    const container = document.getElementById('ai-chat-messages');
    const typingDiv = document.createElement('div');
    typingDiv.id = 'ai-typing-indicator';
    typingDiv.className = 'flex justify-start';
    typingDiv.innerHTML = `<div class="bg-slate-100 dark:bg-slate-800 p-3 rounded-2xl rounded-tl-sm flex gap-1.5 items-center h-9 px-4 border border-slate-200 dark:border-slate-700 shadow-sm">
        <div class="w-1.5 h-1.5 bg-primary-500 rounded-full animate-bounce" style="animation-delay: 0s"></div>
        <div class="w-1.5 h-1.5 bg-primary-500 rounded-full animate-bounce" style="animation-delay: 0.15s"></div>
        <div class="w-1.5 h-1.5 bg-primary-500 rounded-full animate-bounce" style="animation-delay: 0.3s"></div>
    </div>`;
    container.appendChild(typingDiv);
    container.scrollTop = container.scrollHeight;
  }

  window.removeAITypingIndicator = function () {
    const ind = document.getElementById('ai-typing-indicator');
    if (ind) ind.remove();
  }

  // --- END AI BOT LOGIC ---

  /* ------------------------------------------------------------------
     SOP ASSISTANT LOGIC
     ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------
     SOP ASSISTANT LOGIC (FLOATING)
     ------------------------------------------------------------------ */
  window.renderSOPChat = function() {
    // 1. Ensure FAB exists
    let fab = document.getElementById('sop-chat-fab');
    if (!fab) {
      fab = document.createElement('div');
      fab.id = 'sop-chat-fab';
      fab.className = 'sop-chat-fab hover-pop active-shrink';
      fab.innerHTML = `<span class="material-icons">bolt</span>`;
      fab.onclick = (e) => {
        e.stopPropagation();
        window.toggleSOPChat();
      };
      document.body.appendChild(fab);
    }

    // 2. Ensure Window exists
    let win = document.getElementById('sop-chat-window');
    if (!win) {
      win = document.createElement('div');
      win.id = 'sop-chat-window';
      win.className = 'sop-chat-window hidden';
      win.innerHTML = `
        <div class="sop-chat-header-floating">
          <div class="flex items-center gap-2">
            <span class="material-icons text-blue-500 text-sm">bolt</span>
            <span class="text-[10px] font-black uppercase tracking-widest text-slate-500">Zeus AI</span>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="window.toggleZeusAIFullscreen()" class="text-slate-400 hover:text-primary-600 transition-colors" id="sop-fs-btn">
              <span class="material-icons text-sm" id="sop-fs-icon">open_in_full</span>
            </button>
            <button onclick="window.toggleSOPChat()" class="text-slate-400 hover:text-red-500 transition-colors">
              <span class="material-icons text-sm">close</span>
            </button>
          </div>
        </div>
        <div id="sop-messages" class="custom-scrollbar overflow-y-auto p-4 space-y-3">
           <div class="sop-message ai">
              Hi ${state.userNickname || 'Agent'}! I'm Zeus AI. Ask me anything about our procedures.
           </div>
        </div>
        <div class="sop-input-area">
           <input type="text" id="sop-input" placeholder="Ask a question..." onkeypress="if(event.key === 'Enter') sendMessageToSOP()">
           <div class="sop-send-btn" onclick="sendMessageToSOP()">
              <span class="material-icons text-sm">send</span>
           </div>
        </div>
      `;
      document.body.appendChild(win);
      
      // Prevent clicks inside window from bubbling to body (which might close it if we added a global listener)
      win.onclick = (e) => e.stopPropagation();
    }
  };

  window.toggleSOPChat = function() {
    const win = document.getElementById('sop-chat-window');
    const fab = document.getElementById('sop-chat-fab');
    if (!win) return;
    
    const isHidden = win.classList.contains('hidden');
    if (isHidden) {
      win.classList.remove('hidden');
      fab.classList.add('active');
      // Pop-in animation only on first open
      win.classList.add('pop-in');
      win.addEventListener('animationend', () => win.classList.remove('pop-in'), { once: true });
      // Focus input
      setTimeout(() => document.getElementById('sop-input')?.focus(), 100);
    } else {
      win.classList.add('hidden');
      fab.classList.remove('active');
      // Ensure we clean up expanded mode if closed
      if (win.classList.contains('expanded')) window.toggleZeusAIFullscreen();
    }
  };

  window.toggleZeusAIFullscreen = function() {
    const win = document.getElementById('sop-chat-window');
    const icon = document.getElementById('sop-fs-icon');
    if (!win) return;
    
    const isExpanded = win.classList.toggle('expanded');
    
    // Toggle Overlay
    let overlay = document.getElementById('sop-chat-overlay');
    if (isExpanded) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sop-chat-overlay';
        overlay.className = 'sop-chat-overlay';
        overlay.onclick = () => window.toggleZeusAIFullscreen();
        document.body.appendChild(overlay);
        // Trigger fade-in on next frame for smooth transition
        requestAnimationFrame(() => overlay.classList.add('visible'));
      }
      if (icon) icon.innerText = 'close_fullscreen';
    } else {
      if (overlay) {
        overlay.classList.remove('visible');
        // Wait for overlay fade-out before removing from DOM
        overlay.addEventListener('transitionend', () => {
          if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, { once: true });
      }
      if (icon) icon.innerText = 'open_in_full';
    }
  };

  let sopChatHistory = [];

  window.sendMessageToSOP = async function() {
    const inp = document.getElementById('sop-input');
    const msg = inp.value.trim();
    if (!msg) return;
    
    inp.value = '';
    const msgContainer = document.getElementById('sop-messages');
    
    // 1. Add User Message
    const userDiv = document.createElement('div');
    userDiv.className = 'sop-message user';
    userDiv.innerText = msg;
    msgContainer.appendChild(userDiv);
    msgContainer.scrollTop = msgContainer.scrollHeight;
    
    // 2. Add Typing Indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'sop-message ai sop-typing-box';
    typingDiv.innerHTML = `<div class="sop-typing"><div class="sop-dot"></div><div class="sop-dot"></div><div class="sop-dot"></div></div>`;
    msgContainer.appendChild(typingDiv);
    msgContainer.scrollTop = msgContainer.scrollHeight;
    
    try {
        const response = await runAction("sopActions:chatWithSOPs", {
            message: msg,
            history: sopChatHistory.slice(-10) // Keep last 10 messages for context
        });
        
        // Remove typing indicator
        if (typingDiv.parentNode) msgContainer.removeChild(typingDiv);
        
        // 3. Add AI Response
        const aiDiv = document.createElement('div');
        aiDiv.className = 'sop-message ai';
        aiDiv.innerHTML = window.formatZeusMarkdown(response);
        msgContainer.appendChild(aiDiv);
        
        // Update history
        sopChatHistory.push({ role: 'user', content: msg });
        sopChatHistory.push({ role: 'assistant', content: response });
        
        msgContainer.scrollTop = msgContainer.scrollHeight;
        
    } catch (err) {
        console.error("SOP Chat Error:", err);
        if (typingDiv.parentNode) msgContainer.removeChild(typingDiv);
        const errDiv = document.createElement('div');
        errDiv.className = 'sop-message ai text-red-500';
        errDiv.innerText = "Error: " + (err.message || "Failed to get response.");
        msgContainer.appendChild(errDiv);
    }
  };

  window.syncSOPs = async function() {
    console.log("[Zeus] Checking SOP sync...");
    // Per user request, this runs on refresh.
    // In a real scenario, this could trigger a backend sync if needed.
  };
