/**
 * Edit an existing announcement. If `accountId` === 'ALL', will attempt
 * to update all accounts that contain an announcement with matching globalId.
 * Only the original sender or a SUPER_ADMIN may edit announcements.
 */
function editAccountAnnouncement(accountId, annId, newMsg, newSeverity, newImageUrl, newLinkUrl) {
  const session = getSessionInfo();
  const db = getFullDB();
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(30000);
    const db = getFullDB();
    const session = getSessionInfo(db);

    // Handle target resolution
    if (accountId === 'CURRENT') {
      accountId = session.assignedAccount || (Object.keys(db.accounts).length > 0 ? Object.keys(db.accounts)[0] : null);
    }

    // If editing across all accounts, require SUPER_ADMIN or allow sender edits where applicable
    if (accountId === 'ALL' && session.role !== 'SUPER_ADMIN') {
      // non-super-admins can't edit across ALL accounts
      return false;
    }

    const updated = [];

    function tryUpdateInAccount(aid) {
      const acc = db.accounts[aid];
      if (!acc || !acc.announcements) return;
      for (let i = 0; i < acc.announcements.length; i++) {
        const ann = acc.announcements[i];
        // match by id or globalId
        if (ann.id === annId || ann.globalId === annId) {
          // permission: must be original sender or super admin
          const senderEmail = (ann.sender || '').toLowerCase();
          if (session.role === 'SUPER_ADMIN' || senderEmail === session.email.toLowerCase()) {
            if (newMsg !== undefined) ann.message = newMsg;
            if (newSeverity !== undefined) ann.severity = newSeverity;
            if (newImageUrl !== undefined) ann.imageUrl = newImageUrl;
            if (newLinkUrl !== undefined) ann.linkUrl = newLinkUrl;
            ann.updatedAt = new Date().toISOString();
            updated.push({ account: aid, id: ann.id });
          }
        }
      }
    }

    if (accountId === 'ALL') {
      for (const aid in db.accounts) tryUpdateInAccount(aid);
    } else {
      tryUpdateInAccount(accountId);
    }

    if (updated.length > 0) saveFullDB(db);
    // Return the updated account data if single account update, or {ok: true} if ALL
    if (updated.length === 0) return false;
    return accountId === 'ALL' ? { ok: true } : db.accounts[accountId];
  } finally { lock.releaseLock(); }
}

const DB_FILENAME = "workforce_zeus_db_v5.json";
const CACHE_KEY = "ZEUS_DB_CACHE_V5";
const CACHE_EXPIRY = 21600; // 6 hours
const SYSTEM_TIMEZONE = "America/New_York";

const SUPER_ADMINS = [
  "jomari.garces@ececontactcenters.com",
  "salcedo@ececontactcenters.com",
  "lching@ececontactcenters.com",
  "wmt@ececontactcenters.com",
  "maganan@ececontactcenters.com",
  "erivera@ececontactcenters.com",
  "jtrias@ececontactcenters.com"
];

const ADMIN_NICKNAMES = {
  "jomari.garces@ececontactcenters.com": "Jomz",
  "salcedo@ececontactcenters.com": "Joriz",
  "lching@ececontactcenters.com": "Lem",
  "wmt@ececontactcenters.com": "Admin",
  "maganan@ececontactcenters.com": "Grayz",
  "erivera@ececontactcenters.com": "Earl",
  "jtrias@ececontactcenters.com": "JM"
};

const MAINTENANCE_KEY = "ZEUS_MAINTENANCE_MODE";
const MAINTENANCE_AUTHORIZED_EMAILS = [
  "wmt@ececontactcenters.com",
  "jomari.garces@ececontactcenters.com"
];

// --- API SERVICE ENTRY POINT ---
function doPost(e) {
  const output = { status: 'error', data: null, message: '' };
  try {
    if (!e.postData || !e.postData.contents) throw new Error("No data received");
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    
    if (action === 'test') { // Placeholder for any future actions
      output.status = 'success';
      output.data = 'API Alive';
    } else {
      throw new Error("Unknown action");
    }
  } catch (err) {
    output.message = err.toString();
  }
  return ContentService.createTextOutput(JSON.stringify(output)).setMimeType(ContentService.MimeType.JSON);
}

// --- DB HANDLER ---
function getDbFile() {
  const props = PropertiesService.getScriptProperties();
  let fileId = props.getProperty('DB_FILE_ID_V5');
  if (fileId) { try { return DriveApp.getFileById(fileId); } catch(e) { fileId = null; } }
  
  if (!fileId) {
    const defaultData = { 
      accounts: {}, 
      superAdmins: SUPER_ADMINS.map(e => e.toLowerCase()),
      reminders: [],
      userProfiles: {},
      feedbacks: []
    };
    const file = DriveApp.createFile(DB_FILENAME, JSON.stringify(defaultData));
    props.setProperty('DB_FILE_ID_V5', file.getId());
    return file;
  }
}

function getFullDB() {
  try {
    const cache = CacheService.getScriptCache();
    const cachedJson = cache.get(CACHE_KEY);
    if (cachedJson) return JSON.parse(cachedJson);
  } catch (e) {}

  try {
    const file = getDbFile();
    let db = JSON.parse(file.getBlob().getDataAsString());
    
    // Initialize Schema if missing
    if (!db.userProfiles) db.userProfiles = {}; 
    if (!db.feedbacks) db.feedbacks = [];
    
    try { CacheService.getScriptCache().put(CACHE_KEY, JSON.stringify(db), CACHE_EXPIRY); } catch(e) {}
    return db;
  } catch (e) { return {}; }
}

function saveFullDB(db) {
  const json = JSON.stringify(db);
  try { CacheService.getScriptCache().put(CACHE_KEY, json, CACHE_EXPIRY); } catch(e) {}
  const file = getDbFile();
  file.setContent(json);
}

// --- SESSION ---
function getSessionInfo(passedDb) {
  let email = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
  email = email.toLowerCase().trim();
  const db = passedDb || getFullDB();
  
  const isSuperAdmin = db.superAdmins && db.superAdmins.map(e => e.toLowerCase()).includes(email);
  let userAccounts = [];
  const allAccounts = []; 

  for (const id in db.accounts) {
    const accData = { id: db.accounts[id].id, name: db.accounts[id].name };
    allAccounts.push(accData);

    const accountUsers = db.accounts[id].users || [];
    if (accountUsers.map(e => e.toLowerCase()).includes(email)) {
      userAccounts.push(accData);
    }
  }

  const profile = (db.userProfiles && db.userProfiles[email]) ? db.userProfiles[email] : null;
  let nickname = ADMIN_NICKNAMES[email] || (profile ? profile.nickname : email.split('@')[0]);
  
  const role = isSuperAdmin ? 'SUPER_ADMIN' : (userAccounts.length > 0 ? 'ACCOUNT_USER' : 'GUEST');
  const visibleAccounts = (isSuperAdmin || role === 'GUEST') ? allAccounts : userAccounts;

  // Filter archived tasks for frontend
  let checklist = [];
  if (profile && profile.checklist) {
    checklist = profile.checklist.filter(t => !t.isArchived);
  }

  const isMaintenanceMode = PropertiesService.getScriptProperties().getProperty(MAINTENANCE_KEY) === 'true';
  const canToggleMaintenance = MAINTENANCE_AUTHORIZED_EMAILS.includes(email);

  return {
    email: email,
    nickname: nickname,
    role: role,
    userAccounts: userAccounts,                   // accounts user belongs to (regardless of role)
    assignedAccount: userAccounts.length > 0 ? userAccounts[0].id : null,
    checklist: checklist,
    notes: (profile && profile.notes) ? profile.notes : [],
    accounts: visibleAccounts,
    isMaintenanceMode: isMaintenanceMode,
    canToggleMaintenance: canToggleMaintenance
  };
}

function toggleMaintenanceMode() {
  const email = Session.getActiveUser().getEmail().toLowerCase().trim();
  if (!MAINTENANCE_AUTHORIZED_EMAILS.includes(email)) {
    throw new Error("Unauthorized: Only specific administrators can toggle maintenance mode.");
  }
  
  const props = PropertiesService.getScriptProperties();
  const currentStatus = props.getProperty(MAINTENANCE_KEY) === 'true';
  const newStatus = !currentStatus;
  props.setProperty(MAINTENANCE_KEY, newStatus ? 'true' : 'false');
  return newStatus;
}

// --- HEARTBEAT & STATUS (SPLIT) ---

// 1. Personal Updates (Frequent, small payload)
function fetchPersonalUpdates(lastInteractionTime, currentAccountId) {
  // Use a shorter lock wait for heartbeats
  const lock = LockService.getScriptLock();
  try {
      lock.waitLock(1000); 

      const db = getFullDB();
      const session = getSessionInfo(db);
      
      // Update Heartbeat in Cache instead of DB file (MUCH FASTER)
      const now = lastInteractionTime || Date.now();
      const cache = CacheService.getScriptCache();
      cache.put(`ACTIVE_${session.email}`, now.toString(), 600); // 10 mins
      if (currentAccountId) {
        cache.put(`ACC_${session.email}`, currentAccountId, 600);
      }
      
      let checklist = [];
      if (db.userProfiles && db.userProfiles[session.email] && db.userProfiles[session.email].checklist) {
        checklist = db.userProfiles[session.email].checklist.filter(t => !t.isArchived);
      }

      // grab any notifications and clear them
      let notifications = [];
      if (db.userProfiles && db.userProfiles[session.email] && db.userProfiles[session.email].notifications) {
        notifications = db.userProfiles[session.email].notifications;
        db.userProfiles[session.email].notifications = [];
        saveFullDB(db);
      }

      return { checklist, notifications };
  } catch(e) { return null; } 
  finally { lock.releaseLock(); }
}

// 2. Workspace Updates (Reminders, Notes, Announcements)
function fetchWorkspaceUpdates(currentAccountId) {
  if (!currentAccountId) return null;
  const lock = LockService.getScriptLock();
  try {
      lock.waitLock(2000);

      const db = getFullDB();
      const now = new Date();
      
      // 1. Reminders
      let activeReminders = (db.reminders || []).filter(r => {
        const isTarget = (r.targetAccount === 'ALL' || r.targetAccount === currentAccountId);
        
        let isStarted = true;
        if (r.scheduledTime) {
            const sTime = new Date(r.scheduledTime);
            if (sTime > now) isStarted = false;
        }

        let isValid = false;
        if (r.isRecurring) {
            const sTime = new Date(r.scheduledTime);
            const rule = r.recurrenceRule || 'WEEKLY';
            if (isStarted) {
                if (rule === 'WEEKLY') {
                    if (now.getDay() === sTime.getDay()) isValid = true;
                } else if (rule === 'MONTHLY') {
                    if (now.getDate() === sTime.getDate()) isValid = true;
                }
            }
        } else {
            // One-time
            if (isStarted) {
                isValid = r.expiryTimestamp ? (new Date(r.expiryTimestamp) > now) : true;
            }
        }
        return isTarget && isValid;
      }).sort((a,b) => new Date(b.scheduledTime) - new Date(a.scheduledTime));

      // 2. Notes
      let notes = [];
      if (db.accounts[currentAccountId] && db.accounts[currentAccountId].notes) {
          notes = db.accounts[currentAccountId].notes;
      }

      // 3. Announcements
      let announcements = [];
      if (db.accounts[currentAccountId] && db.accounts[currentAccountId].announcements) {
          announcements = db.accounts[currentAccountId].announcements;
      }

      return { activeReminders, notes, announcements };
  } catch(e) { return null; }
  finally { lock.releaseLock(); }
}

// --- CALENDAR INTEGRATION ---

/**
 * Helper function to get a new Date object relative to the current date.
 * Used for setting event times.
 */
function getRelativeDate(daysOffset, hour) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  date.setHours(hour);
  date.setMinutes(0);
  date.setSeconds(0);
  date.setMilliseconds(0);
  return date;
}

/**
 * Fetches upcoming events from the user's primary Google Calendar.
 * Uses the Advanced Calendar Service logic (Calendar.Events.list).
 * 'primary' keyword targets the email used for login verification.
 */
function fetchUserCalendarEvents() {
  const calendarId = "primary";
  const now = new Date();
  const eventsList = [];
  
  try {
    // We use a simplified version of the sync logic: 
    // instead of syncTokens (which require persistent client storage),
    // we fetch the current 'snapshot' of upcoming events using timeMin.
    // This ensures the UI always shows the correct schedule on reload.
    
    let pageToken;
    do {
      const options = {
        timeMin: now.toISOString(),
        singleEvents: true, // Expands recurring events into individual instances
        orderBy: 'startTime',
        maxResults: 20, // Fetch top 20 to populate the sidebar
        pageToken: pageToken
      };
      
      const response = Calendar.Events.list(calendarId, options);
      if (response.items) {
        eventsList.push(...response.items);
      }
      pageToken = response.nextPageToken;
      
    } while (pageToken && eventsList.length < 20); // Safety break after 20 events
    
    // Map to a clean object for the frontend
    return eventsList.map(event => {
      let start = event.start.dateTime;
      let isAllDay = false;
      if (!start) {
        start = event.start.date;
        isAllDay = true;
      }
      
      return {
        id: event.id,
        summary: event.summary || "No Title",
        start: start,
        isAllDay: isAllDay,
        location: event.location || "",
        htmlLink: event.htmlLink,
        status: event.status
      };
    });

  } catch (e) {
    console.log("Calendar Error: " + e.toString());
    // Return empty array if service not enabled or error occurs
    return [];
  }
}

/**
 * Creates a quick event on the user's primary calendar.
 */
function createQuickCalendarEvent(title, dateStr) {
  const calendarId = "primary";
  let start, end;
  
  if (dateStr) {
      start = new Date(dateStr);
      end = new Date(start.getTime() + (60 * 60 * 1000)); // Default 1 hour duration
  } else {
      // Default to tomorrow noon if no date provided
      start = getRelativeDate(1, 12);
      end = getRelativeDate(1, 13);
  }
  
  const event = {
    summary: title || "New Zeus Event",
    description: "Created via Workforce Zeus",
    start: {
      dateTime: start.toISOString(),
    },
    end: {
      dateTime: end.toISOString(),
    },
    // colorId 11 is roughly 'Tomato' red/orange in standard GCal
    colorId: "11" 
  };
  
  try {
    const result = Calendar.Events.insert(event, calendarId);
    return { success: true, id: result.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// --- STATUS & ADMIN FUNCTIONS ---

function getLiveStatus() {
  const db = getFullDB();
  const session = getSessionInfo(db);
  if (session.role !== 'SUPER_ADMIN') return [];
  
  const now = Date.now();
  const statuses = [];
  const cache = CacheService.getScriptCache();

  for (const email in db.userProfiles) {
      const p = db.userProfiles[email];
      
      // Try cache first for real-time accuracy and speed
      let lastActive = parseInt(cache.get(`ACTIVE_${email}`));
      if (isNaN(lastActive)) lastActive = p.lastActive || 0;
      
      let lastAccount = cache.get(`ACC_${email}`);
      if (!lastAccount) lastAccount = p.lastAccount || 'N/A';
      
      // Get AUX status from cache (updated by client) or profile
      let auxStatus = cache.get(`AUX_STATUS_${email}`) || p.auxStatus || 'ONLINE';

      const diffMinutes = (now - lastActive) / 1000 / 60;
      let displayStatus = auxStatus;
      
      // Override with Away/Inactive if no activity
      if (diffMinutes > 120) displayStatus = 'Inactive';
      else if (diffMinutes > 30) displayStatus = 'Away';
      
      let accName = 'Unassigned';
      for(const aid in db.accounts) {
          if(db.accounts[aid].users.includes(email)) {
              accName = db.accounts[aid].name;
              break;
          }
      }
      statuses.push({
          nickname: p.nickname || email.split('@')[0],
          email: email,
          accountName: accName,
          accountId: lastAccount,
          auxStatus: displayStatus,
          lastActive: lastActive
      });
  }
  return statuses.sort((a,b) => {
      const score = (s) => s === 'ONLINE' ? 5 : (s === 'LUNCH' ? 4 : (s === 'BREAK' ? 3 : (s === 'PRODWALK' ? 2 : 1)));
      return score(b.auxStatus) - score(a.auxStatus);
  });
}

function updateUserAuxStatus(auxStatus) {
  const session = getSessionInfo();
  const cache = CacheService.getScriptCache();
  // Store AUX status in cache for 24 hours so it persists across sessions
  cache.put(`AUX_STATUS_${session.email}`, auxStatus, 86400);
  return { ok: true };
}

// --- TASK HISTORY (ADMIN) ---
function getTaskHistory(filterAccount, filterUser, dateFrom, dateTo) {
  const session = getSessionInfo();
  if (session.role !== 'SUPER_ADMIN') return [];
  const db = getFullDB();
  let history = [];
  for (const email in db.userProfiles) {
      const profile = db.userProfiles[email];
      if (!profile.checklist) continue;
      let userAccountName = 'Unassigned';
      let userAccountId = null;
      for(const aid in db.accounts) {
          if(db.accounts[aid].users.includes(email)) {
              userAccountName = db.accounts[aid].name;
              userAccountId = db.accounts[aid].id;
              break;
          }
      }
      if (filterAccount && filterAccount !== 'ALL' && userAccountId !== filterAccount) continue;
      if (filterUser && !email.toLowerCase().includes(filterUser.toLowerCase()) && !profile.nickname.toLowerCase().includes(filterUser.toLowerCase())) continue;
      profile.checklist.forEach(task => {
          if (task.isDone) {
              const dateRef = task.completedAt || task.timestamp;
              if (dateRef) {
                  const d = new Date(dateRef);
                  if (dateFrom && d < new Date(dateFrom)) return;
                  if (dateTo) { const dt = new Date(dateTo); dt.setHours(23,59,59,999); if (d > dt) return; }
              }
              history.push({
                  taskText: task.text,
                  user: profile.nickname || email,
                  email: email,
                  account: userAccountName,
                  completedAt: task.completedAt || "Unknown",
                  createdAt: task.timestamp
              });
          }
      });
  }
  return history.sort((a, b) => {
      const da = new Date(a.completedAt === "Unknown" ? a.createdAt : a.completedAt);
      const db = new Date(b.completedAt === "Unknown" ? b.createdAt : b.completedAt);
      return db - da;
  });
}

// --- BULK TASKS ---
function bulkAssignTasks(targetType, targetId, tasks) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const session = getSessionInfo();
    if (session.role !== 'SUPER_ADMIN') throw new Error("Unauthorized");
    const db = getFullDB();
    const timestamp = new Date().toISOString();
    let targetEmails = [];
    if (targetType === 'ALL') targetEmails = Object.keys(db.userProfiles);
    else if (targetType === 'ACCOUNT') { if (db.accounts[targetId]) targetEmails = db.accounts[targetId].users || []; }
    else if (targetType === 'USER') targetEmails = [targetId.toLowerCase().trim()];
    let count = 0;
    targetEmails.forEach(email => {
        if (!db.userProfiles[email]) db.userProfiles[email] = { nickname: email.split('@')[0] };
        if (!db.userProfiles[email].checklist) db.userProfiles[email].checklist = [];
        tasks.forEach(taskText => {
            db.userProfiles[email].checklist.push({
                id: Date.now().toString() + '_' + Math.random().toString(36).substr(2,5), 
                text: taskText, 
                isDone: false, 
                timestamp: timestamp,
                sender: session.nickname // Attribution
            });
        });
        count++;
    });
    saveFullDB(db);
    return `Assigned ${tasks.length} tasks to ${count} users.`;
  } finally { lock.releaseLock(); }
}

// --- FEEDBACK ---
function submitFeedback(message) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const session = getSessionInfo();
    const db = getFullDB();
    if (!db.feedbacks) db.feedbacks = [];
    db.feedbacks.unshift({ id: Date.now().toString(), sender: session.nickname, email: session.email, message: message, timestamp: new Date().toISOString() });
    saveFullDB(db);
    try { MailApp.sendEmail({ to: "jomari.garces@ececontactcenters.com", subject: `[Zeus Feedback] from ${session.nickname}`, body: message }); } catch(e) {}
    return true;
  } finally { lock.releaseLock(); }
}

function getFeedbacks() {
  const session = getSessionInfo();
  if (session.email !== "jomari.garces@ececontactcenters.com" && session.role !== 'SUPER_ADMIN') return [];
  const db = getFullDB();
  return db.feedbacks || [];
}

// --- AI BOT ---
function askAIBot(question) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY') || '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';
  const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" + apiKey;

  // Use the SOP_DATA from SOP_Data.gs
  const context = `
    You are Zeus AI, the official AI assistant for Workforce Zeus. 
    Refer to yourself only as "AI" or "Zeus AI". 
    Do NOT refer to yourself as an "Agent", "Support", or "Assistant".
    I am an AI for your workneeds.
    
    Answer questions strictly based on the following SOP data. 
    If the information is not in the data, politely say you don't know and suggest contacting a Team Lead.
    
    RTA SOP: ${SOP_DATA.RTA || ""}
    Support SOP: ${SOP_DATA.Support || ""}
    Agent SOP: ${SOP_DATA.Agent || ""}
  `;

  const payload = {
    contents: [{
      parts: [{
        text: context + "\n\nUser Question: " + question
      }]
    }]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());
  
  if (json.candidates && json.candidates[0].content.parts[0].text) {
    return json.candidates[0].content.parts[0].text;
  } else {
    return "I'm sorry, I couldn't process that. Error: " + (json.error ? json.error.message : "Unknown error");
  }
}

// --- ACCOUNTS ---
function createAccount(accountName) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const session = getSessionInfo();
    if (session.role !== 'SUPER_ADMIN') throw new Error("Unauthorized");
    const db = getFullDB();
    const accountId = accountName.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
    db.accounts[accountId] = {
      id: accountId, name: accountName, categories: [{ id: "HOME", name: "Home" }], icons: [],
      announcements: [{ id: Date.now(), message: `Zeus Workspace for ${accountName} initialized.`, timestamp: new Date().toISOString(), severity: "info", sender: "Zeus System", isPinned: false }],
      users: [], notes: []
    };
    saveFullDB(db);
    return getSessionInfo();
  } finally { lock.releaseLock(); }
}

function deleteAccount(accountId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const session = getSessionInfo();
    if (session.role !== 'SUPER_ADMIN') throw new Error("Unauthorized");
    const db = getFullDB();
    delete db.accounts[accountId];
    saveFullDB(db);
    return getSessionInfo();
  } finally { lock.releaseLock(); }
}

function registerUserToAccounts(accountIds, nickname) {
  // Legacy immediate registration (used by SUPER_ADMIN only)
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    let email = Session.getActiveUser().getEmail().toLowerCase().trim();
    const db = getFullDB();
    if (!db.userProfiles) db.userProfiles = {};
    if(!db.userProfiles[email]) db.userProfiles[email] = {};
    db.userProfiles[email].nickname = nickname || email.split('@')[0];

    accountIds.forEach(accId => {
       if (db.accounts[accId] && !db.accounts[accId].users.includes(email)) {
          db.accounts[accId].users.push(email);
       }
    });
    saveFullDB(db);
    return getSessionInfo();
  } finally { lock.releaseLock(); }
}

// New: handle access requests from non-admin users
function requestAccountAccess(accountIds, nickname) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    let email = Session.getActiveUser().getEmail().toLowerCase().trim();
    const db = getFullDB();
    if (!db.userProfiles) db.userProfiles = {};
    if(!db.userProfiles[email]) db.userProfiles[email] = {};
    db.userProfiles[email].nickname = nickname || email.split('@')[0];

    if (!db.accessRequests) db.accessRequests = [];
    accountIds.forEach(accId => {
      if (db.accounts[accId]) {
        // avoid duplicates
        const exists = db.accessRequests.some(r => r.email === email && r.accountId === accId && r.type === 'ACCESS');
        if (!exists) {
          db.accessRequests.push({ 
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            email: email, 
            accountId: accId, 
            nickname: db.userProfiles[email].nickname, 
            timestamp: new Date().toISOString(),
            type: 'ACCESS'
          });
        }
      }
    });
    saveFullDB(db);
    return getSessionInfo(); // will still be guest
  } finally { lock.releaseLock(); }
}

function requestAccountRemoval(accountId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const db = getFullDB();
    const session = getSessionInfo(db);
    if (!db.accessRequests) db.accessRequests = [];
    
    const email = session.email;
    const nickname = session.nickname || email.split('@')[0];
    
    const exists = db.accessRequests.some(r => r.email === email && r.accountId === accountId && r.type === 'REMOVAL');
    if (!exists) {
      db.accessRequests.push({
        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
        email: email,
        nickname: nickname,
        accountId: accountId,
        timestamp: new Date().toISOString(),
        type: 'REMOVAL'
      });
      saveFullDB(db);
    }
    return true;
  } finally { lock.releaseLock(); }
}

function getAccessRequests() {
  const session = getSessionInfo();
  if (session.role !== 'SUPER_ADMIN') throw new Error('Unauthorized');
  const db = getFullDB();
  const list = db.accessRequests || [];
  // enrich with account name
  return list.map(r => {
    const acc = db.accounts && db.accounts[r.accountId];
    return {
      id: r.id,
      email: r.email,
      accountId: r.accountId,
      accountName: acc ? acc.name : r.accountId,
      nickname: r.nickname,
      timestamp: r.timestamp,
      type: r.type || 'ACCESS'
    };
  });
}

function approveAccountAccess(requestId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const session = getSessionInfo();
    if (session.role !== 'SUPER_ADMIN') throw new Error('Unauthorized');
    const db = getFullDB();
    if (!db.accessRequests) db.accessRequests = [];
    
    const idx = db.accessRequests.findIndex(r => r.id === requestId);
    if (idx === -1) return false;
    
    const req = db.accessRequests[idx];
    const email = req.email;
    const accountId = req.accountId;

    if (req.type === 'REMOVAL') {
      if (db.accounts[accountId]) {
        db.accounts[accountId].users = db.accounts[accountId].users.filter(e => e.toLowerCase().trim() !== email.toLowerCase().trim());
      }
    } else {
      // add user to account
      if (db.accounts[accountId]) {
        if (!db.accounts[accountId].users) db.accounts[accountId].users = [];
        if (!db.accounts[accountId].users.includes(email)) db.accounts[accountId].users.push(email);
      }
    }

    // notify user
    if (!db.userProfiles[email]) db.userProfiles[email] = {};
    if (!db.userProfiles[email].notifications) db.userProfiles[email].notifications = [];
    db.userProfiles[email].notifications.push({ 
      type: 'access', 
      accountId: accountId, 
      approved: true, 
      requestType: req.type || 'ACCESS',
      timestamp: new Date().toISOString() 
    });
    
    db.accessRequests.splice(idx, 1);
    saveFullDB(db);
    return true;
  } finally { lock.releaseLock(); }
}

function rejectAccountAccess(requestId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const session = getSessionInfo();
    if (session.role !== 'SUPER_ADMIN') throw new Error('Unauthorized');
    const db = getFullDB();
    if (!db.accessRequests) db.accessRequests = [];
    
    const idx = db.accessRequests.findIndex(r => r.id === requestId);
    if (idx === -1) return false;
    
    const req = db.accessRequests[idx];
    const email = req.email;
    const accountId = req.accountId;

    if (!db.userProfiles[email]) db.userProfiles[email] = {};
    if (!db.userProfiles[email].notifications) db.userProfiles[email].notifications = [];
    db.userProfiles[email].notifications.push({ 
      type: 'access', 
      accountId: accountId, 
      approved: false, 
      requestType: req.type || 'ACCESS',
      timestamp: new Date().toISOString() 
    });
    
    db.accessRequests.splice(idx, 1);
    saveFullDB(db);
    return true;
  } finally { lock.releaseLock(); }
}

// --- TASKS ---
function addPersonalTask(taskText) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    let email = Session.getActiveUser().getEmail().toLowerCase().trim();
    const db = getFullDB();
    if (!db.userProfiles) db.userProfiles = {};
    if (!db.userProfiles[email]) db.userProfiles[email] = { nickname: email.split('@')[0] };
    if (!db.userProfiles[email].checklist) db.userProfiles[email].checklist = [];
    db.userProfiles[email].checklist.push({ id: Date.now().toString(), text: taskText, isDone: false, timestamp: new Date().toISOString() });
    saveFullDB(db);
    return db.userProfiles[email].checklist.filter(t => !t.isArchived);
  } finally { lock.releaseLock(); }
}

function togglePersonalTask(taskId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    let email = Session.getActiveUser().getEmail().toLowerCase().trim();
    const db = getFullDB();
    if (db.userProfiles && db.userProfiles[email] && db.userProfiles[email].checklist) {
      const task = db.userProfiles[email].checklist.find(t => t.id === taskId);
      if (task) { 
          task.isDone = !task.isDone; 
          if(task.isDone) { task.completedAt = new Date().toISOString(); } 
          else { delete task.completedAt; }
          saveFullDB(db); 
      }
      return db.userProfiles[email].checklist.filter(t => !t.isArchived);
    }
    return [];
  } finally { lock.releaseLock(); }
}

function deletePersonalTask(taskId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    let email = Session.getActiveUser().getEmail().toLowerCase().trim();
    const db = getFullDB();
    if (db.userProfiles && db.userProfiles[email] && db.userProfiles[email].checklist) {
      const task = db.userProfiles[email].checklist.find(t => t.id === taskId);
      if (task) { task.isArchived = true; saveFullDB(db); }
      return db.userProfiles[email].checklist.filter(t => !t.isArchived);
    }
    return [];
  } finally { lock.releaseLock(); }
}

function adminAssignTask(targetEmail, taskText) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const session = getSessionInfo();
    if (session.role !== 'SUPER_ADMIN') throw new Error("Unauthorized");
    const db = getFullDB();
    const email = targetEmail.toLowerCase().trim();
    if (!db.userProfiles) db.userProfiles = {};
    if (!db.userProfiles[email]) db.userProfiles[email] = { nickname: email.split('@')[0] };
    if (!db.userProfiles[email].checklist) db.userProfiles[email].checklist = [];
    db.userProfiles[email].checklist.push({
      id: Date.now().toString(), 
      text: taskText, 
      isDone: false, 
      timestamp: new Date().toISOString(),
      sender: session.nickname // Attribution
    });
    saveFullDB(db);
    return true;
  } finally { lock.releaseLock(); }
}

// --- NOTES ---
function saveNote(id, title, content, scope, accountId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const session = getSessionInfo();
    const db = getFullDB();
    let list;
    if (scope === 'TEAM') {
       if (!db.accounts[accountId]) throw new Error("Invalid Account");
       if (!db.accounts[accountId].notes) db.accounts[accountId].notes = [];
       list = db.accounts[accountId].notes;
    } else {
       if (!db.userProfiles[session.email].notes) db.userProfiles[session.email].notes = [];
       list = db.userProfiles[session.email].notes;
    }
    if (id) {
      const n = list.find(x => x.id === id);
      if (n) { n.title = title; n.content = content; n.timestamp = new Date().toISOString(); }
    } else {
      list.unshift({ id: Date.now().toString(), title, content, timestamp: new Date().toISOString(), author: session.nickname });
    }
    saveFullDB(db);
    return list;
  } finally { lock.releaseLock(); }
}

function deleteNote(id, scope, accountId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const session = getSessionInfo();
    const db = getFullDB();
    if (scope === 'TEAM') {
       db.accounts[accountId].notes = db.accounts[accountId].notes.filter(n => n.id !== id);
       saveFullDB(db);
       return db.accounts[accountId].notes;
    } else {
       db.userProfiles[session.email].notes = db.userProfiles[session.email].notes.filter(n => n.id !== id);
       saveFullDB(db);
       return db.userProfiles[session.email].notes;
    }
  } finally { lock.releaseLock(); }
}

// --- REGISTRY ---
function getUsersRegistry() {
  const session = getSessionInfo();
  if (session.role !== 'SUPER_ADMIN') throw new Error("Unauthorized");
  const db = getFullDB();
  const registry = {};
  for (const id in db.accounts) {
    const userEmails = db.accounts[id].users || [];
    registry[id] = {
      name: db.accounts[id].name,
      users: userEmails.map(e => ({ 
        email: e, 
        nickname: (db.userProfiles[e]?.nickname || ADMIN_NICKNAMES[e] || e.split('@')[0]) 
      }))
    };
  }
  return registry;
}

function unregisterUser(accountId, email) {
  const session = getSessionInfo();
  if (session.role !== 'SUPER_ADMIN') throw new Error("Unauthorized");
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const db = getFullDB();
    if (db.accounts[accountId] && db.accounts[accountId].users) {
      db.accounts[accountId].users = db.accounts[accountId].users.filter(e => e.toLowerCase().trim() !== email.toLowerCase().trim());
      saveFullDB(db);
    }
    return getUsersRegistry();
  } finally {
    lock.releaseLock();
  }
}

// --- ORG CHART SERVICE ---
const SHEET_NAME = "Roster";

const ROLE_ORDER = {
  "Manager":                         1,
  "Learning & Development Manager":  1,
  "Assistant Manager":               2,
  "Senior Team Leader":              3,
  "QA Team Leader":                  3,
  "Team Leader":                     4,
  "RTA":                             5,
  "QA":                              6,
  "Learning & Development Trainer":  7,
  "L&D Agent":                       8,
};

const HORIZONTAL_ROLES = new Set([
  "manager",
  "learning & development manager",
  "assistant manager",
  "senior team leader",
  "qa team leader",
]);

const DEPT_ORDER = ["Operations", "Learning & Development", "Workforce"];

function getOrgChartSpreadsheet() {
  // 1. ALWAYS try the specific ID first to ensure we connect to "Walmart Support List"
  const SPREADSHEET_ID = "1-6Cz-OewjcQuOLFTqWNsBqss7y9A3-BrXp62qx7j58s";
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    if (ss) return ss;
    throw new Error("Spreadsheet opened as null");
  } catch (e) {
    const errorMsg = "ID Access Failed: " + e.toString();
    console.warn(errorMsg);
    
    // 2. Fallback to active spreadsheet only if ID fails
    try {
      const activeSs = SpreadsheetApp.getActiveSpreadsheet();
      if (activeSs) return activeSs;
    } catch (e2) {
      console.error("Active Access Failed: " + e2.toString());
    }
    
    return { error: "Could not connect to spreadsheet. Error: " + e.toString() };
  }
}

/**
 * RUN THIS FUNCTION IN THE APPS SCRIPT EDITOR TO FORCE AUTHORIZATION
 * Select 'DEBUG_forceAuthorize' in the toolbar and click 'Run'.
 */
function DEBUG_forceAuthorize() {
  const ss = getOrgChartSpreadsheet();
  if (ss.error) {
    throw new Error(ss.error);
  }
  const name = ss.getName();
  const sheet = ss.getSheetByName(SHEET_NAME);
  Logger.log("Successfully connected to: " + name);
  Logger.log("Roster sheet exists: " + (sheet !== null));
  
  if (!sheet) {
    Logger.log("Creating Roster sheet...");
    initializeRosterSheet();
  }
  
  return "Connected to " + name;
}

/**
 * Run this function in the Apps Script editor to test the connection
 * and see detailed logs in the Execution Log.
 */
function testSpreadsheetConnection() {
  console.log("--- Starting Connection Test ---");
  const ssResult = getOrgChartSpreadsheet();
  
  if (ssResult && ssResult.error) {
    console.error("❌ Connection Failed: " + ssResult.error);
    throw new Error(ssResult.error);
  }
  
  if (!ssResult) {
    console.error("❌ Connection Failed: SpreadsheetApp returned null");
    throw new Error("SpreadsheetApp returned null");
  }
  
  console.log("✅ Successfully connected to Spreadsheet: " + ssResult.getName());
  console.log("URL: " + ssResult.getUrl());
  
  const sheets = ssResult.getSheets();
  console.log("Available Sheets: " + sheets.map(s => s.getName()).join(", "));
  
  const rosterSheet = ssResult.getSheetByName(SHEET_NAME);
  if (rosterSheet) {
    console.log("✅ Found '" + SHEET_NAME + "' sheet.");
    const range = rosterSheet.getDataRange();
    console.log("Data Range: " + range.getA1Notation());
    console.log("Row Count: " + range.getNumRows());
  } else {
    console.warn("⚠️ '" + SHEET_NAME + "' sheet NOT found. You may need to run initializeRosterSheet().");
  }
  
  console.log("--- Test Complete ---");
  return "Success! Check the Execution Log for details.";
}

function getRosterData() {
  const ssResult = getOrgChartSpreadsheet();
  if (ssResult.error) return { error: ssResult.error };
  
  const ss = ssResult;
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    // Fallback to the first sheet if "Roster" is not found
    sheet = ss.getSheets()[0];
  }
  if (!sheet) return { error: `No sheets found in spreadsheet.` };

  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return { departments: [] };

  const headers = rows[0].map(h => h.toString().trim().toLowerCase());
  const findCol = (name) => {
    let idx = headers.indexOf(name);
    if (idx !== -1) return idx;
    // Try matching without spaces or with underscores
    const normalized = name.replace(/\s+/g, '');
    return headers.findIndex(h => h.replace(/\s+/g, '') === normalized);
  };

  const col = {
    name:          findCol("name"),
    department:    findCol("department"),
    role:          findCol("role"),
    manager:       findCol("manager"),
    email:         findCol("email"),
    lob:           findCol("lob"),
    scheduleHours: findCol("schedule hours"),
    scheduleDays:  findCol("schedule days"),
    lastUpdated:   findCol("last updated"),
  };

  const required = ["name", "department", "role", "manager", "email"];
  const missing  = required.filter(k => col[k] < 0);
  if (missing.length) return { error: `Missing columns: ${missing.join(", ")}` };

  const people = [];
  for (let i = 1; i < rows.length; i++) {
    const name = rows[i][col.name]?.toString().trim();
    if (!name) continue;

    let lastUpdated = "";
    if (col.lastUpdated >= 0) {
      const raw = rows[i][col.lastUpdated];
      if (raw instanceof Date) {
        lastUpdated = Utilities.formatDate(raw, SYSTEM_TIMEZONE, "MMM dd, yyyy");
      } else if (raw) {
        lastUpdated = raw.toString().trim();
      }
    }

    const role   = rows[i][col.role]?.toString().trim() || "";
    const format = HORIZONTAL_ROLES.has(role.toLowerCase()) ? "Horizontal" : "Vertical";
    
    const sHours = col.scheduleHours >= 0 ? (rows[i][col.scheduleHours]?.toString().trim() || "") : "";
    const sDays  = col.scheduleDays >= 0 ? (rows[i][col.scheduleDays]?.toString().trim() || "") : "";

    people.push({
      name,
      department:    rows[i][col.department]?.toString().trim() || "",
      role,
      manager:       rows[i][col.manager]?.toString().trim()    || "",
      email:         rows[i][col.email]?.toString().trim()      || "",
      lob:           col.lob >= 0 ? (rows[i][col.lob]?.toString().trim() || "") : "",
      scheduleHours: sHours,
      scheduleDays:  sDays,
      isActive:      isUserActiveInternal(sHours, sDays),
      lastUpdated,
      format,
    });
  }

  const deptMap = {};
  people.forEach(p => {
    if (!deptMap[p.department]) deptMap[p.department] = [];
    deptMap[p.department].push(p);
  });

  const sortedDepts = Object.keys(deptMap).sort((a, b) => {
    const ai = DEPT_ORDER.indexOf(a), bi = DEPT_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  const departments = sortedDepts.map(deptName => {
    const members = deptMap[deptName];
    const nodeMap = {};
    members.forEach(p => { nodeMap[p.name] = { ...p, children: [] }; });

    const roots = [];
    members.forEach(p => {
      const node   = nodeMap[p.name];
      const isRoot = !p.manager || p.manager === p.name || !nodeMap[p.manager];
      if (isRoot) roots.push(node);
      else nodeMap[p.manager].children.push(node);
    });

    const sortChildren = node => {
      node.children.sort((a, b) => (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99));
      node.children.forEach(sortChildren);
    };
    roots.sort((a, b) => (ROLE_ORDER[a.role] ?? 99) - (ROLE_ORDER[b.role] ?? 99));
    roots.forEach(sortChildren);

    return { name: deptName, roots };
  });

  return { departments };
}

function initializeRosterSheet() {
  const ssResult = getOrgChartSpreadsheet();
  if (!ssResult || ssResult.error) return "❌ Error: " + (ssResult?.error || "Could not access the spreadsheet.");
  
  const ss = ssResult;
  let sheet = ss.getSheetByName(SHEET_NAME);

  if (sheet) {
    // In Web App context, we can't use SpreadsheetApp.getUi().alert easily for confirmation
    // So we just clear it if called.
    sheet.clearContents();
    sheet.clearFormats();
  } else {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  const headers = ["Name", "Department", "Role", "Manager", "Email", "LOB", "Schedule Hours", "Schedule Days", "Last Updated"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight("bold").setFontColor("#ffffff")
    .setBackground("#0d2137").setFontSize(11)
    .setHorizontalAlignment("center").setVerticalAlignment("middle");
  sheet.setRowHeight(1, 36);

  const today = Utilities.formatDate(new Date(), SYSTEM_TIMEZONE, "MM/dd/yyyy");

  const data = [
    ["Wendy Tangpuz Pastoral",            "Operations", "Manager",                        "",                              "wendy@ececonsultinggroup.com",                  "", today],
    ["Larry Bird Laranjo Villaverde",     "Operations", "Assistant Manager",              "Wendy Tangpuz Pastoral",        "lvillaverde@ececonsultinggroup.net",            "", today],
    ["Jerico Ilas Triñanes",              "Operations", "Assistant Manager",              "Wendy Tangpuz Pastoral",        "jerico@ececonsultinggroup.com",                 "", today],
    ["Margie Carulla Tuñacao",            "Operations", "Senior Team Leader",             "Jerico Ilas Triñanes",          "mtunacao@ececonsultinggroup.com",               "", today],
    ["Liberty Gonzales Legaspi",          "Operations", "Senior Team Leader",             "Larry Bird Laranjo Villaverde", "llegaspi@ececonsultinggroup.net",               "", today],
    ["Klarissa Mae Dayap Baldovino",      "Operations", "Senior Team Leader",             "Larry Bird Laranjo Villaverde", "kmbaldovino@ececonsultinggroup.link",           "", today],
    ["Ana Crenessa Manuel Raymundo",      "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "crenessa@ececonsultinggroup.com",               "", today],
    ["Cherry Ann Mariano Dela Ganar",     "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "cdelaganar@ececonsultinggroup.com",             "", today],
    ["Faustino III Bardelosa Valera",     "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "fvalera@ececonsultinggroup.net",                "", today],
    ["Gemma Vergara Nuñez",               "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "gnunez@ececonsultinggroup.link",                "", today],
    ["Grace Celis Amaba",                 "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "gamaba@ececonsultinggroup.com",                 "", today],
    ["Jasmine Eborde Muyco",              "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "jmuyco@ececonsultinggroup.link",                "", today],
    ["Levlie Jade Jaramilla Ignacio",     "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "lignacio@ececonsultinggroup.link",              "", today],
    ["Maria Lucia Silverio Bernardo",     "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "marialucia@ececonsultinggroup.com",             "", today],
    ["Marjorie Benemerito Copino",        "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "mcopino@ececonsultinggroup.net",                "", today],
    ["Mary Grace Cajel Jorge",            "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "mjorge@ececonsultinggroup.com",                 "", today],
    ["Mat Cyrus Padre Arceo",             "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "marceo@ececonsultinggroup.link",                "", today],
    ["Quennie Mamiit Masangkay",          "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "qmasangkay@ececonsultinggroup.com",             "", today],
    ["Ramil Santiago Cantor",             "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "ramil@ececonsultinggroup.com",                  "", today],
    ["Raymond Sagun Guerrero",            "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "raymond@ececonsultinggroup.com",                "", today],
    ["Reuel Elishama Dingal Blanco",      "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "rblanco@ececonsultinggroup.link",               "", today],
    ["Ritchelyn Fausto Arbon",            "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "rarbon@ececonsultinggroup.link",                "", today],
    ["Robby Jay Enriquez Mance",          "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "rmance@ececonsultinggroup.com",                 "", today],
    ["Rovie Rebutazo Gonzales",           "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "rgonzales@ececonsultinggroup.link",             "", today],
    ["Rowella Cruz Cruz",                 "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "rowella@ececonsultinggroup.net",                "", today],
    ["Alda Lequiron Ranile",              "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "aranile@ececonsultinggroup.net",                "", today],
    ["Catherine Serote Jugbo",            "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "cjugbo@ececonsultinggroup.com",                 "", today],
    ["Cristine Bernadette Maranan Hinkle","Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "chinkle@ececonsultinggroup.link",               "", today],
    ["Felci Gumapac Palopalo",            "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "felci.palopalo@ececontactcenters.net",          "", today],
    ["Geneva Castillo Hutalla",           "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "ghutalla@ececonsultinggroup.link",              "", today],
    ["Irvin Joseph Bilason Dy",           "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "idy@ececonsultinggroup.com",                    "", today],
    ["Jemma Macasukit Asumbrado",         "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "jasumbrado@ececonsultinggroup.net",             "", today],
    ["Joemar Maquiling Adling",           "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "jadling@ececonsultinggroup.link",               "", today],
    ["Julie Fe Tuballa Maquiling",        "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "julie.maquiling@ececontactcenters.net",         "", today],
    ["Keisan Mark Carpina Agcopra",       "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "kagcopra@ececonsultinggroup.link",              "", today],
    ["Kyline Nicole Rivera Villanueva",   "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "kyline.villanueva@ececontactcenters.net",       "", today],
    ["Ralf Macasaet",                     "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "rmacasaet@ececonsultinggroup.net",              "", today],
    ["Ronald Jr Acierto Subido",          "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "ronald.subido@ececontactcenters.net",           "", today],
    ["Roxanne Damaso",                    "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "roxanne.damaso@ececontactcenters.net",          "", today],
    ["Al Yamuta Buenaventura",            "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "al.buenaventura@ececontactcenters.net",         "", today],
    ["Mhara Vanessa Sabellano Saga",      "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "mhara.saga@ececontactcenters.net",              "", today],
    ["Prence Philip Elopre Quillo",       "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "pquillo@ececonsultinggroup.link",               "", today],
    ["Nicolle John Basilio Domingo",      "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "nicolle.domingo@ececontactcenters.net",         "", today],
    ["Aireen Zaide De Los Santos",        "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "aireen.delossantos@ececontactcenters.net",      "", today],
    ["Danica Mae Manalili Datin",         "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "danica.datin@ececontactcenters.net",            "", today],
    ["Elena Grace Torres Chichirita",     "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "echichirita@ececonsultinggroup.link",           "", today],
    ["Francesca Aris Tan Silva",          "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "fsilva@ececonsultinggroup.net",                 "", today],
    ["Jemarie Palon Villanueva",          "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "jemarie.villanueva@ececontactcenters.net",      "", today],
    ["John Paulo Pasahol Dela Cruz",      "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "john.delacruz@ececontactcenters.net",           "", today],
    ["Joseph-romulo Amante Mapue",        "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "jmapue@ececonsultinggroup.link",                "", today],
    ["Keith John Visagas Cadallo",        "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "keith@ececonsultinggroup.com",                  "", today],
    ["Macvin Herald Lubat Bermudez",      "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "macvin@ececonsultinggroup.com",                 "", today],
    ["Mellanie Bautista Santos",          "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "mellanie.santos@ececonsultinggroup.com",        "", today],
    ["Michaela Suety Rose Chua",          "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "mchua@ececonsultinggroup.link",                 "", today],
    ["Paul Mark Pipo Umbac",              "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "paul.umbac@ececontactcenters.net",              "", today],
    ["Rhimzil Aguilar Culi",              "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "rculi@ececonsultinggroup.link",                 "", today],
    ["Samantha Jane Gallardo Culi",       "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "sculi@ececonsultinggroup.net",                  "", today],
    ["Sher Nicole Fullero Juatas",        "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "sjuatas@ececonsultinggroup.link",               "", today],
    ["Wennaliza Pagdato Alabar",          "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "walabar@ececonsultinggroup.net",                "", today],
    ["Ronnel Santillan Camilo",           "Operations", "Team Leader",                    "Margie Carulla Tuñacao",        "rcamilo@ececonsultinggroup.net",                "", today],
    ["Liza Marie Epana Ragusta",          "Learning & Development", "Learning & Development Manager", "",                       "lragusta@ececonsultinggroup.com",              "", today],
    ["Jackie Lyn Belaro Olbes",           "Learning & Development", "QA Team Leader",                 "Liza Marie Epana Ragusta","jackielyn@ececonsultinggroup.com",             "", today],
    ["Ellaine Dueñas Raagas",             "Learning & Development", "QA Team Leader",                 "Liza Marie Epana Ragusta","eraagas@ececonsultinggroup.link",              "", today],
    ["Abigail Bobadilla Natividad",       "Learning & Development", "Learning & Development Trainer", "Liza Marie Epana Ragusta","abigail.natividad@ececontactcenters.net",      "", today],
    ["Maria Elizabeth Orale Valdez",      "Learning & Development", "QA",                             "Liza Marie Epana Ragusta","mvaldez@ececonsultinggroup.link",              "", today],
    ["Crystal Kate Limbaga Clemente",     "Learning & Development", "QA",                             "Ellaine Dueñas Raagas",   "crystal.clemente@ececontactcenters.net",       "", today],
    ["Arvie Farizah Baldemor Sasa",       "Learning & Development", "QA",                             "Ellaine Dueñas Raagas",   "asasa@ececonsultinggroup.net",                 "", today],
    ["Carla Mae Balajadia Caridad",       "Learning & Development", "QA",                             "Ellaine Dueñas Raagas",   "ccaridad@ececonsultinggroup.link",             "", today],
    ["Danna Buena Aro Mesina",            "Learning & Development", "QA",                             "Ellaine Dueñas Raagas",   "dmesina@ececonsultinggroup.link",              "", today],
    ["Denlor Joseph Doctolero Ang",       "Learning & Development", "QA",                             "Ellaine Dueñas Raagas",   "dang@ececonsultinggroup.link",                 "", today],
    ["Emmanuel Lumabas Balitaan",         "Learning & Development", "QA",                             "Ellaine Dueñas Raagas",   "ebalitaan@ececonsultinggroup.link",            "", today],
    ["Eunice Jomieh Barnido",             "Learning & Development", "QA",                             "Ellaine Dueñas Raagas",   "eunice@ececonsultinggroup.com",                "", today],
    ["Juan Alfredo Leaño Requiron",       "Learning & Development", "QA",                             "Jackie Lyn Belaro Olbes", "jrequiron@ececonsultinggroup.link",            "", today],
    ["Ma. Veronica May Ramilo Ilagan",    "Learning & Development", "QA",                             "Jackie Lyn Belaro Olbes", "veronica@ececonsultinggroup.com",              "", today],
    ["Mary Jane Matias Magtanum",         "Learning & Development", "QA",                             "Jackie Lyn Belaro Olbes", "mmagtanum@ececonsultinggroup.net",             "", today],
    ["Micuil Beltran Guiuan",             "Learning & Development", "QA",                             "Jackie Lyn Belaro Olbes", "mguiuan@ececonsultinggroup.net",               "", today],
    ["Reymar Lecciones Manalansan",       "Learning & Development", "QA",                             "Jackie Lyn Belaro Olbes", "reymar@ececonsultinggroup.com",                "", today],
    ["Richelieu So Cardenas",             "Learning & Development", "QA",                             "Jackie Lyn Belaro Olbes", "rcardenas@ececonsultinggroup.link",            "", today],
    ["Ronel Hular Liao",                  "Learning & Development", "QA",                             "Jackie Lyn Belaro Olbes", "rliao@ececonsultinggroup.link",                "", today],
    ["Salcedo Joriz Cometa Cruz",         "Workforce", "Manager",            "",                       "",                                                                 "", today],
    ["Lemuel De Leon Ching",              "Workforce", "Senior Team Leader", "Salcedo Joriz Cometa Cruz","",                                                              "", today],
    ["John Mark Bigtas Trias",            "Workforce", "Team Leader",        "Lemuel De Leon Ching",   "",                                                                 "", today],
    ["Eduard Quintana Compra",            "Workforce", "RTA",                "John Mark Bigtas Trias", "ecompra@ececonsultinggroup.link",                                  "", today],
    ["John Michael Jatap Vergara",        "Workforce", "RTA",                "John Mark Bigtas Trias", "jmvergara@ececonsultinggroup.link",                                "", today],
    ["Jomari Urfe Ponpon Garces",         "Workforce", "RTA",                "John Mark Bigtas Trias", "jomari.garces@ececontactcenters.com",                              "", today],
    ["Julhian Mark Hormillosa Cabarloc",  "Workforce", "RTA",                "John Mark Bigtas Trias", "jcabarloc@ececonsultinggroup.net",                                 "", today],
    ["Julie Ann Irene Gaviola Gumahad",   "Workforce", "RTA",                "John Mark Bigtas Trias", "jgumahad@ececontactcenters.com",                                   "", today],
    ["Mary Grace Dela Cruz Aganan",       "Workforce", "RTA",                "John Mark Bigtas Trias", "maganan@ececontactcenters.com",                                    "", today],
    ["Patricia Ann Salas Bautista",       "Workforce", "RTA",                "John Mark Bigtas Trias", "patricia.bautista@ececontactcenters.com",                          "", today],
    ["Sheena Rose Villegas Bolongaita",   "Workforce", "RTA",                "John Mark Bigtas Trias", "sbolongaita@ececontactcenters.com",                                "", today],
    ["Jabbar Angantap Minalang",          "Workforce", "RTA",                "John Mark Bigtas Trias", "jabbar.minalang@ececontactcenters.com",                            "", today],
    ["Shania Amores Espina",              "Workforce", "RTA",                "John Mark Bigtas Trias", "sespina@ececonsultinggroup.com",                                   "", today],
  ];

  sheet.getRange(2, 1, data.length, headers.length).setValues(data);

  for (let r = 0; r < data.length; r++) {
    sheet.getRange(r+2, 1, 1, headers.length).setBackground(r%2===0 ? "#f0f4f8" : "#ffffff");
  }
  const DC = { "Operations":"#bfdbfe", "Learning & Development":"#ddd6fe", "Workforce":"#bbf7d0" };
  for (let r = 0; r < data.length; r++) {
    const c = DC[data[r][1]]; if (c) sheet.getRange(r+2, 2, 1, 1).setBackground(c);
  }

  sheet.getRange(2, 7, data.length+300, 1).setNumberFormat("MM/dd/yyyy");
  sheet.setColumnWidth(1, 220); sheet.setColumnWidth(2, 185); sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 220); sheet.setColumnWidth(5, 240); sheet.setColumnWidth(6, 200);
  sheet.setColumnWidth(7, 130);
  sheet.setFrozenRows(1);

  return "✅ Roster sheet initialized!";
}

function getAccountData(accountId) {
  const db = getFullDB();
  const account = db.accounts[accountId];
  if (!account) return null;
  const now = new Date();
  
  const reminders = (db.reminders || []).filter(r => {
    const isTarget = (r.targetAccount === 'ALL' || r.targetAccount === accountId);
    
    // Check Start
    let isStarted = true;
    if (r.scheduledTime) {
        const sTime = new Date(r.scheduledTime);
        if (sTime > now) isStarted = false;
    }

    // Check Validity (Normal vs Recurring)
    let isValid = false;
    if (r.isRecurring) {
        const sTime = new Date(r.scheduledTime);
        const rule = r.recurrenceRule || 'WEEKLY';
        
        // Only valid if start date has passed AND day/date matches
        if (isStarted) {
            if (rule === 'WEEKLY') {
                if (now.getDay() === sTime.getDay()) isValid = true;
            } else if (rule === 'MONTHLY') {
                if (now.getDate() === sTime.getDate()) isValid = true;
            }
        }
    } else {
        // Normal One-time
        if (isStarted) {
            isValid = r.expiryTimestamp ? (new Date(r.expiryTimestamp) > now) : true;
        }
    }

    return isTarget && isValid;
  });
  
  account.activeReminders = reminders.sort((a,b) => new Date(b.scheduledTime) - new Date(a.scheduledTime));
  return account;
}

function saveAccountData(accountId, type, newItem) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const db = getFullDB();
    const account = db.accounts[accountId];
    const key = type === 'cat' ? 'categories' : 'icons';
    
    // Check if item already exists
    const index = account[key].findIndex(i => String(i.id) === String(newItem.id));
    if (index !== -1) {
      // Update existing item
      account[key][index] = newItem;
    } else {
      // Add new item
      account[key].push(newItem);
    }
    
    saveFullDB(db);
    return account;
  } finally { lock.releaseLock(); }
}

function deleteAccountItem(accountId, type, itemId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const db = getFullDB();
    const account = db.accounts[accountId];
    const key = type === 'cat' ? 'categories' : 'icons';
    account[key] = account[key].filter(i => i.id != itemId);
    if(key==='categories') account.icons = account.icons.filter(i => i.catId != itemId);
    saveFullDB(db);
    return account;
  } finally { lock.releaseLock(); }
}

function postAccountAnnouncement(accountId, msg, severity, sender, imageUrl, linkUrl) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const db = getFullDB();
    const session = getSessionInfo(db);

    const id = 'ann_' + Date.now().toString();
    const annTemplate = {
      id: id,
      globalId: null,
      message: msg,
      timestamp: new Date().toISOString(),
      severity: severity,
      sender: (sender || session.email || 'Admin'),
      imageUrl: imageUrl || null,
      linkUrl: linkUrl || null,
      isPinned: false
    };

    // Handle target resolution
    if (accountId === 'CURRENT') {
      accountId = session.assignedAccount || (Object.keys(db.accounts).length > 0 ? Object.keys(db.accounts)[0] : null);
    }

    // Global announcement to ALL accounts - only SUPER_ADMIN allowed
    if (accountId === 'ALL' || accountId === null) {
      if (session.role !== 'SUPER_ADMIN') return { status: 'forbidden' };
      annTemplate.globalId = id;
      for (const aid in db.accounts) {
        db.accounts[aid].announcements = db.accounts[aid].announcements || [];
        const clone = JSON.parse(JSON.stringify(annTemplate));
        // keep the original id distinct per-account but reference globalId
        clone.id = id + '_' + aid;
        db.accounts[aid].announcements.push(clone);
      }
      saveFullDB(db);
      return { ok: true };
    }

    // Single-account announcement
    if (!db.accounts[accountId]) return { status: 'error', message: 'Account not found: ' + accountId };
    db.accounts[accountId].announcements = db.accounts[accountId].announcements || [];
    db.accounts[accountId].announcements.push(annTemplate);
    saveFullDB(db);
    return db.accounts[accountId];
  } finally { lock.releaseLock(); }
}

function toggleAnnouncementPin(accountId, annId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const db = getFullDB();
    const session = getSessionInfo(db);
    if (accountId === 'CURRENT') {
      accountId = session.assignedAccount || (Object.keys(db.accounts).length > 0 ? Object.keys(db.accounts)[0] : null);
    }
    if (!db.accounts[accountId]) return { status: 'error', message: 'Account not found: ' + accountId };
    const ann = db.accounts[accountId].announcements.find(a => a.id == annId);
    if (ann) { ann.isPinned = !ann.isPinned; saveFullDB(db); }
    return db.accounts[accountId];
  } finally { lock.releaseLock(); }
}

function deleteAccountAnnouncement(accountId, annId) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const db = getFullDB();
    const session = getSessionInfo(db);

    function tryDeleteInAccount(aid) {
      const acc = db.accounts[aid];
      if (!acc || !acc.announcements) return false;
      const idx = acc.announcements.findIndex(a => a.id === annId || a.globalId === annId);
      if (idx === -1) return false;
      const ann = acc.announcements[idx];
      const senderEmail = (ann.sender || '').toLowerCase();
      if (session.role === 'SUPER_ADMIN' || senderEmail === session.email.toLowerCase()) {
        acc.announcements.splice(idx, 1);
        return true;
      }
      return false;
    }

    let deleted = false;
    if (accountId === 'CURRENT') {
      accountId = session.assignedAccount || (Object.keys(db.accounts).length > 0 ? Object.keys(db.accounts)[0] : null);
    }

    if (accountId === 'ALL') {
      for (const aid in db.accounts) {
        if (tryDeleteInAccount(aid)) deleted = true;
      }
    } else {
      if (tryDeleteInAccount(accountId)) deleted = true;
    }

    if (deleted) saveFullDB(db);
    if (accountId === 'ALL') return { ok: deleted };
    if (!db.accounts[accountId]) return { status: 'error', message: 'Account not found: ' + accountId };
    return db.accounts[accountId];
  } finally { lock.releaseLock(); }
}

function postReminder(targetAccount, message, imageUrl, sender, durationHours, scheduledTimeStr, extraDates, isRecurring, recurrenceRule) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const session = getSessionInfo();
    if (session.role !== 'SUPER_ADMIN') throw new Error("Unauthorized");
    const db = getFullDB();
    if (!db.reminders) db.reminders = [];
    
    // Process main date and extra dates
    let datesToProcess = [];
    if (scheduledTimeStr) datesToProcess.push(scheduledTimeStr);
    if (extraDates && Array.isArray(extraDates)) datesToProcess = datesToProcess.concat(extraDates);
    if (datesToProcess.length === 0) datesToProcess.push(new Date().toISOString());
    
    datesToProcess.forEach(dateStr => {
        let startTime = new Date(dateStr);
        if (isNaN(startTime.getTime())) startTime = new Date();
        
        let hours = durationHours ? parseInt(durationHours) : 24;
        let expiry = null;
        
        // FOREVER LOGIC (Magic number 87600 = 10 years)
        if (hours === 87600) {
            expiry = new Date("9999-12-31T23:59:59Z");
        } else {
            expiry = new Date(startTime.getTime() + (hours * 60 * 60 * 1000));
        }
        
        db.reminders.push({
          id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
          targetAccount: targetAccount,
          message: message,
          imageUrl: imageUrl || null,
          sender: sender || "Admin",
          senderEmail: session.email,
          timestamp: new Date().toISOString(),
          scheduledTime: startTime.toISOString(),
          expiryTimestamp: expiry.toISOString(),
          durationHours: hours,
          isRecurring: isRecurring === true,
          recurrenceRule: recurrenceRule || 'NONE'
        });
    });
    
    saveFullDB(db);
    return true;
  } finally { lock.releaseLock(); }
}

function deleteReminder(id) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const session = getSessionInfo();
    const db = getFullDB();
    const reminder = (db.reminders || []).find(r => r.id === id);
    if (!reminder) throw new Error("Not found");
    // Admin can delete any, user only their own (user logic handled in frontend visibility)
    // But this API endpoint is generic. Let's allow deletion if sender matches OR super admin.
    if (reminder.senderEmail !== session.email && session.role !== 'SUPER_ADMIN') throw new Error("Permission denied.");
    
    db.reminders = db.reminders.filter(r => r.id !== id);
    saveFullDB(db);
    return true;
  } finally { lock.releaseLock(); }
}

function getRemindersForManagement() {
    const session = getSessionInfo();
    if (session.role !== 'SUPER_ADMIN') return [];
    const db = getFullDB();
    const now = Date.now();
    // Return all reminders that are active or recurring
    return (db.reminders || []).filter(r => {
        if(r.isRecurring) return true;
        return r.expiryTimestamp ? (new Date(r.expiryTimestamp).getTime() > now) : false;
    }).map(r => {
        // Enrich with Account Name if specific
        let accName = 'Global';
        if(r.targetAccount !== 'ALL' && db.accounts[r.targetAccount]) {
            accName = db.accounts[r.targetAccount].name;
        }
        r.targetAccountName = accName;
        return r;
    });
}


// --- HELPER: Active Status Logic ---
function isUserActiveInternal(scheduleHours, scheduleDays) {
  if (!scheduleHours || !scheduleDays) return false;
  
  try {
    const now = new Date();
    const timeZone = SYSTEM_TIMEZONE;
    const dayNames = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const currentDay = Utilities.formatDate(now, timeZone, "EEE").toLowerCase();
    const currentDayIdx = dayNames.indexOf(currentDay);
    
    // 1. Check Day
    const days = scheduleDays.toLowerCase();
    let dayMatch = false;
    if (days.includes(currentDay)) {
      dayMatch = true;
    } else if (days.includes('-')) {
      const parts = days.split('-').map(d => d.trim().substring(0, 3));
      if (parts.length === 2) {
        const startIdx = dayNames.indexOf(parts[0]);
        const endIdx = dayNames.indexOf(parts[1]);
        if (startIdx !== -1 && endIdx !== -1) {
          if (startIdx <= endIdx) {
            if (currentDayIdx >= startIdx && currentDayIdx <= endIdx) dayMatch = true;
          } else {
            if (currentDayIdx >= startIdx || currentDayIdx <= endIdx) dayMatch = true;
          }
        }
      }
    }
    
    if (!dayMatch) return false;
    
    // 2. Check Time
    const timeParts = scheduleHours.split(/[–—\-]| to /i).map(t => t.trim());
    if (timeParts.length !== 2) return false;
    
    const parseTime = (tStr) => {
      let hours, minutes = 0;
      const match = tStr.match(/(\d+)(?::(\d+))?\s*(am|pm)?/i);
      if (!match) return null;
      hours = parseInt(match[1]);
      if (match[2]) minutes = parseInt(match[2]);
      const ampm = match[3] ? match[3].toLowerCase() : null;
      
      if (ampm === 'pm' && hours < 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;
      
      return hours * 60 + minutes;
    };
    
    const startMinutes = parseTime(timeParts[0]);
    const endMinutes = parseTime(timeParts[1]);
    
    if (startMinutes === null || endMinutes === null) return false;
    
    const currentTimeStr = Utilities.formatDate(now, timeZone, "HH:mm");
    const [currH, currM] = currentTimeStr.split(':').map(Number);
    const currentMinutes = currH * 60 + currM;
    
    if (startMinutes <= endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    } else {
      // Night shift
      return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
    }
  } catch (e) {
    return false;
  }
}

/* askAIBot consolidated above */
