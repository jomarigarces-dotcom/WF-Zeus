const fs = require('fs');
const path = require('path');

const moduleMap = {
  getSessionInfo: 'users:getSessionInfo',
  heartbeat: 'users:heartbeat',
  registerUserToAccounts: 'users:registerUserToAccounts',
  requestAccountAccess: 'users:requestAccountAccess',
  requestAccountRemoval: 'users:requestAccountRemoval',
  getAccessRequests: 'users:getAccessRequests',
  approveAccountAccess: 'users:approveAccountAccess',
  rejectAccountAccess: 'users:rejectAccountAccess',
  updateUserAuxStatus: 'users:updateUserAuxStatus',
  toggleMaintenanceMode: 'users:toggleMaintenanceMode',
  
  fetchWorkspaceUpdates: 'accounts:getAccountData', // mapped to account data fetch
  createAccount: 'accounts:createAccount',
  deleteAccount: 'accounts:deleteAccount',
  saveAccountData: 'accounts:saveAccountData',
  deleteAccountItem: 'accounts:deleteAccountItem',
  getRegistry: 'accounts:getUsersRegistry',
  unregisterUser: 'accounts:unregisterUser',

  addPersonalTask: 'tasks:addPersonalTask',
  togglePersonalTask: 'tasks:togglePersonalTask',
  deletePersonalTask: 'tasks:deletePersonalTask',
  fetchPersonalUpdates: 'tasks:fetchPersonalUpdates',
  bulkAssignTasks: 'tasks:bulkAssignTasks',
  adminAssignTask: 'tasks:adminAssignTask',
  getTaskHistory: 'tasks:getTaskHistory',

  saveNote: 'notes:saveNote',
  deleteNote: 'notes:deleteNote',

  postAnnouncement: 'announcements:postAccountAnnouncement',
  editAnnouncement: 'announcements:editAccountAnnouncement',
  togglePinAnnouncement: 'announcements:toggleAnnouncementPin',
  deleteAnnouncement: 'announcements:deleteAccountAnnouncement',

  postReminder: 'reminders:postReminder',
  deleteReminder: 'reminders:deleteReminder',
  getActiveReminders: 'reminders:getActiveReminders',
  getRemindersForManagement: 'reminders:getRemindersForManagement',

  getLiveStatus: 'status:getLiveStatus',

  submitFeedback: 'feedback:submitFeedback',
  getFeedbacks: 'feedback:getFeedbacks',
};

const queries = new Set([
  'getSessionInfo', 'getAccessRequests', 'fetchWorkspaceUpdates', 'getRegistry',
  'fetchPersonalUpdates', 'getTaskHistory', 'getActiveReminders', 'getRemindersForManagement',
  'getLiveStatus', 'getFeedbacks'
]);

function convertArgsToObj(methodName, rawArgsStr) {
  const parts = rawArgsStr.split(',').map(s => s.trim()).filter(p => p !== '');
  
  // Custom mapping for each function based on schema
  if (methodName === 'getSessionInfo') return `{ email: state.userEmail || localStorage.getItem('zeus_user_email') || "" }`;
  if (methodName === 'heartbeat') return `{ email: state.userEmail, currentAccountId: state.currentAccount?.id }`;
  if (methodName === 'requestAccountAccess') return `{ email: state.userEmail, accountIds: ${parts[0]}, nickname: state.userNickname }`;
  if (methodName === 'requestAccountRemoval') return `{ email: state.userEmail, accountId: ${parts[0]} }`;
  if (methodName === 'fetchPersonalUpdates') return `{ email: state.userEmail }`;
  if (methodName === 'fetchWorkspaceUpdates') return `{ accountId: ${parts[0]} }`;
  if (methodName === 'getRegistry') return `{ callerEmail: state.userEmail }`;
  if (methodName === 'getTaskHistory') return `{ callerEmail: state.userEmail, filterAccount: ${parts[0] || 'null'}, filterUser: ${parts[1] || 'null'}, dateFrom: ${parts[2] || 'null'}, dateTo: ${parts[3] || 'null'} }`;
  if (methodName === 'getLiveStatus') return `{ callerEmail: state.userEmail }`;
  if (methodName === 'getFeedbacks') return `{ callerEmail: state.userEmail }`;
  if (methodName === 'updateUserAuxStatus') return `{ email: state.userEmail, auxStatus: ${parts[0]} }`;
  if (methodName === 'toggleMaintenanceMode') return `{ callerEmail: state.userEmail }`;
  
  if (methodName === 'createAccount') return `{ callerEmail: state.userEmail, accountName: ${parts[0]} }`;
  if (methodName === 'deleteAccount') return `{ callerEmail: state.userEmail, accountId: ${parts[0]} }`;
  if (methodName === 'saveAccountData') return `{ accountId: ${parts[4] || 'state.currentAccount?.id'}, type: ${parts[3]}, item: { id: ${parts[0] || 'null'}, name: ${parts[1] || 'null'}, title: ${parts[1] || 'null'}, url: ${parts[2] || 'null'}, iconType: ${parts[5] || 'null'}, catId: ${parts[6] || 'null'} } }`;
  if (methodName === 'deleteAccountItem') return `{ accountId: state.currentAccount?.id, type: ${parts[1]}, itemId: ${parts[0]} }`;
  if (methodName === 'unregisterUser') return `{ callerEmail: state.userEmail, accountId: ${parts[0]}, email: ${parts[1]} }`;
  
  if (methodName === 'addPersonalTask') return `{ email: state.userEmail, taskText: ${parts[0]} }`;
  if (methodName === 'togglePersonalTask') return `{ email: state.userEmail, taskId: ${parts[0]} }`;
  if (methodName === 'deletePersonalTask') return `{ email: state.userEmail, taskId: ${parts[0]} }`;
  if (methodName === 'bulkAssignTasks') return `{ callerEmail: state.userEmail, targetType: ${parts[0]}, targetId: ${parts[1]}, tasks: ${parts[2]}, senderNickname: state.userNickname }`;
  if (methodName === 'adminAssignTask') return `{ callerEmail: state.userEmail, targetEmail: ${parts[0]}, taskText: ${parts[1]}, senderNickname: state.userNickname }`;
  
  if (methodName === 'saveNote') return `{ email: state.userEmail, noteId: ${parts[0] || 'null'}, title: ${parts[1]}, content: ${parts[2]}, scope: ${parts[3]}, accountId: ${parts[4] || 'null'}, nickname: state.userNickname }`;
  if (methodName === 'deleteNote') return `{ email: state.userEmail, noteId: ${parts[0]}, scope: ${parts[1]}, accountId: ${parts[2] || 'null'} }`;
  
  if (methodName === 'postAnnouncement') return `{ callerEmail: state.userEmail, accountId: ${parts[0]}, message: ${parts[1]}, severity: ${parts[2]}, sender: state.userNickname, imageUrl: ${parts[3] || 'null'}, linkUrl: ${parts[4] || 'null'} }`;
  if (methodName === 'editAnnouncement') return `{ callerEmail: state.userEmail, accountId: ${parts[0]}, annId: ${parts[1]}, newMsg: ${parts[2] || 'undefined'}, newSeverity: ${parts[3] || 'undefined'}, newImageUrl: ${parts[4] || 'undefined'}, newLinkUrl: ${parts[5] || 'undefined'} }`;
  if (methodName === 'togglePinAnnouncement') return `{ callerEmail: state.userEmail, accountId: ${parts[0]}, annId: ${parts[1]} }`;
  if (methodName === 'deleteAnnouncement') return `{ callerEmail: state.userEmail, accountId: ${parts[0]}, annId: ${parts[1]} }`;
  
  if (methodName === 'postReminder') return `{ callerEmail: state.userEmail, targetAccount: ${parts[0]}, message: ${parts[1]}, imageUrl: ${parts[2] || 'null'}, sender: ${parts[3]}, durationHours: ${parts[4]}, scheduledTime: ${parts[5]}, isRecurring: ${parts[7] || 'false'}, recurrenceRule: ${parts[8] || 'null'} }`;
  if (methodName === 'deleteReminder') return `{ callerEmail: state.userEmail, reminderId: ${parts[0]} }`;
  
  if (methodName === 'submitFeedback') return `{ email: state.userEmail, nickname: state.userNickname, message: ${parts[0]} }`;
  if (methodName === 'approveAccountAccess') return `{ callerEmail: state.userEmail, requestId: ${parts[0]} }`;
  if (methodName === 'rejectAccountAccess') return `{ callerEmail: state.userEmail, requestId: ${parts[0]} }`;

  if (parts.length === 0) return `{}`;

  // Fallback
  return `{ args: [${rawArgsStr}] }`;
}

let code = fs.readFileSync('../Appscript/JS.html', 'utf8');
code = code.replace(/<script.*?>|<\/script>/g, '');
code = `import { convex, runQuery, runMutation } from './convex-client.js';\n` + code;


function getBalanced(str, startChar, endChar, startIndex) {
  let depth = 0;
  for (let i = startIndex; i < str.length; i++) {
    if (str[i] === startChar) depth++;
    else if (str[i] === endChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

while (true) {
  const startIdx = code.indexOf('google.script.run');
  if (startIdx === -1) break;

  let currentIdx = startIdx + 'google.script.run'.length;
  let successCallback = null;
  let failureCallback = null;
  let methodName = null;
  let rawArgs = null;
  let fullMatchEnd = -1;

  while (true) {
    const dotMatch = code.substring(currentIdx).match(/^\s*\.\s*/);
    if (!dotMatch) break;
    const afterDot = currentIdx + dotMatch[0].length;

    if (code.startsWith('withSuccessHandler', afterDot)) {
      const openParen = code.indexOf('(', afterDot);
      const closeParen = getBalanced(code, '(', ')', openParen);
      successCallback = code.substring(openParen + 1, closeParen);
      currentIdx = closeParen + 1;
    } else if (code.startsWith('withFailureHandler', afterDot)) {
      const openParen = code.indexOf('(', afterDot);
      const closeParen = getBalanced(code, '(', ')', openParen);
      failureCallback = code.substring(openParen + 1, closeParen);
      currentIdx = closeParen + 1;
    } else {
      const methodMatch = code.substring(afterDot).match(/^([a-zA-Z0-9_]+)\s*\(/);
      if (methodMatch) {
        methodName = methodMatch[1];
        const openParen = code.indexOf('(', afterDot);
        const closeParen = getBalanced(code, '(', ')', openParen);
        rawArgs = code.substring(openParen + 1, closeParen);
        fullMatchEnd = closeParen + 1;
        break;
      } else break;
    }
  }

  if (methodName && fullMatchEnd !== -1) {
    const funcPath = moduleMap[methodName] || ('unknown:' + methodName);
    if (methodName === 'getRosterData') {
        const repl = `fetch('/orgchart.json').then(r=>r.json()).then(data => { Promise.resolve().then(() => { const _cb = (${successCallback}); if(typeof _cb === 'function') _cb(data); }); }).catch(err => { Promise.resolve().then(() => { const _fc = (${failureCallback}); if(typeof _fc === 'function') _fc(err); }); })`;
        code = code.substring(0, startIdx) + repl + code.substring(fullMatchEnd);
        continue;
    }
    const isQuery = queries.has(methodName);
    const convexType = isQuery ? 'runQuery' : 'runMutation';
    const argsObj = convertArgsToObj(methodName, rawArgs);

    let repl = `(async () => { try { const res = await ${convexType}("${funcPath}", ${argsObj});`;
    if (successCallback) repl += ` Promise.resolve().then(() => { const _cb = (${successCallback}); if(typeof _cb === 'function') _cb(res); });`;
    repl += ` } catch(err) { console.error(err);`;
    if (failureCallback) repl += ` Promise.resolve().then(() => { const _fc = (${failureCallback}); if(typeof _fc === 'function') _fc(err); else alert(err.message || String(err)); });`;
    else repl += ` alert(err.message || String(err));`;
    repl += ` } })()`;

    code = code.substring(0, startIdx) + repl + code.substring(fullMatchEnd);
  } else {
    // If not a valid method call, replace 'google.script.run' with 'console.warn("Invalid GS call")' to avoid infinite loop
    code = code.substring(0, startIdx) + '/* google.script.run skip */' + code.substring(startIdx + 17);
  }
}

// Remove // TODO-CONVEX annotations
code = code.replace(/\s*\/\/ TODO-CONVEX:.*?\n/g, '\n');

// Additional fixes for `initSession` -> `getSessionInfo` login flow
// AppScript relied on Session.getActiveUser(). Convex requires an email from localStorage.
// We will patch initSession() to show an email prompt if not logged in.
const initPatch = `
function initSession() {
  let email = localStorage.getItem('zeus_user_email');
  if (!email) {
    email = prompt("Enter your email address to sign in to Workforce Zeus:");
    if (!email) {
      document.body.innerHTML = "<div style='padding:20px; text-align:center;'>Access Denied. Please refresh and enter your email.</div>";
      return;
    }
    localStorage.setItem('zeus_user_email', email.toLowerCase().trim());
  }
  state.userEmail = email.toLowerCase().trim();
  
  // Now we fire the original getSessionInfo convex query (which the script wrapped)
  (async () => {
    try {
      const info = await runQuery("users:getSessionInfo", { email: state.userEmail });
      
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

      const lastAccountId = localStorage.getItem('zeus_last_account');
      if (info.role === 'SUPER_ADMIN') {
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
    } catch(err) {
      console.error(err);
      alert("Error initializing session: " + err.message);
    }
  })();
}
`;
code = code.replace(/function initSession\(\).*?}\)\.getSessionInfo\(\);\s*}/s, initPatch.trim());

fs.writeFileSync('app.js', code, 'utf8');
console.log('App.js replaced successfully.');

