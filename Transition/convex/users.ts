import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const SUPER_ADMINS = [
  "jomari.garces@ececontactcenters.com",
  "salcedo@ececontactcenters.com",
  "lching@ececontactcenters.com",
  "wmt@ececontactcenters.com",
  "maganan@ececontactcenters.com",
  "erivera@ececontactcenters.com",
  "jtrias@ececontactcenters.com",
];

const ADMIN_NICKNAMES: Record<string, string> = {
  "jomari.garces@ececontactcenters.com": "Jomz",
  "salcedo@ececontactcenters.com": "Joriz",
  "lching@ececontactcenters.com": "Lem",
  "wmt@ececontactcenters.com": "Admin",
  "maganan@ececontactcenters.com": "Grayz",
  "erivera@ececontactcenters.com": "Earl",
  "jtrias@ececontactcenters.com": "JM",
};

const MAINTENANCE_AUTHORIZED = [
  "wmt@ececontactcenters.com",
  "jomari.garces@ececontactcenters.com",
];

// Core session info query — frontend calls this on load with email from localStorage
export const getSessionInfo = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    email = email.toLowerCase().trim();
    const isSuperAdmin = SUPER_ADMINS.map((e) => e.toLowerCase()).includes(email);

    const allAccounts = await ctx.db.query("accounts").collect();

    const visibleAccounts = allAccounts.map((a) => ({ id: a.accountId, name: a.name }));
    const userAccounts = allAccounts
      .filter((a) => a.users.map((u) => u.toLowerCase()).includes(email))
      .map((a) => ({ id: a.accountId, name: a.name }));

    let profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    const nickname = ADMIN_NICKNAMES[email] || (profile ? profile.nickname : email.split("@")[0]);
    const role = isSuperAdmin ? "SUPER_ADMIN" : userAccounts.length > 0 ? "ACCOUNT_USER" : "GUEST";
    const checklist = profile?.checklist?.filter((t) => !t.isArchived) ?? [];

    // Grab notifications (do NOT clear in a query)
    let notifications: any[] = [];
    if (profile?.notifications?.length) {
      notifications = [...profile.notifications];
    }

    // Maintenance mode
    const maintenance = await ctx.db.query("maintenanceMode").first();
    const isMaintenanceMode = maintenance?.enabled ?? false;
    const canToggleMaintenance = MAINTENANCE_AUTHORIZED.includes(email);

    return {
      email,
      nickname,
      role,
      accounts: isSuperAdmin || role === "GUEST" ? visibleAccounts : userAccounts,
      userAccounts,
      assignedAccount: userAccounts.length > 0 ? userAccounts[0].id : null,
      checklist,
      notes: profile?.notes ?? [],
      notifications,
      isMaintenanceMode,
      canToggleMaintenance,
    };
  },
});

// Update user's heartbeat + currentAccount
export const heartbeat = mutation({
  args: { email: v.string(), currentAccountId: v.optional(v.string()) },
  handler: async (ctx, { email, currentAccountId }) => {
    email = email.toLowerCase().trim();
    const now = Date.now();
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    if (profile) {
      await ctx.db.patch(profile._id, {
        lastActive: now,
        ...(currentAccountId ? { lastAccount: currentAccountId } : {}),
      });
    }
  },
});

// Register existing user to accounts (SUPER_ADMIN direct assign)
export const registerUserToAccounts = mutation({
  args: { callerEmail: v.string(), accountIds: v.array(v.string()), nickname: v.string() },
  handler: async (ctx, { callerEmail, accountIds, nickname }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    const isSuperAdminCaller = SUPER_ADMINS.map(e => e.toLowerCase()).includes(callerEmail);
    if (!isSuperAdminCaller) throw new Error("Unauthorized");

    // Ensure profile exists
    let profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", callerEmail))
      .first();
    if (!profile) {
      await ctx.db.insert("userProfiles", {
        email: callerEmail,
        nickname: nickname || callerEmail.split("@")[0],
      });
    } else {
      await ctx.db.patch(profile._id, { nickname });
    }

    for (const accId of accountIds) {
      const acc = await ctx.db
        .query("accounts")
        .withIndex("by_accountId", (q) => q.eq("accountId", accId))
        .first();
      if (acc && !acc.users.map((u) => u.toLowerCase()).includes(callerEmail)) {
        await ctx.db.patch(acc._id, { users: [...acc.users, callerEmail] });
      }
    }

    // Return the updated session info
    const allAccounts = await ctx.db.query("accounts").collect();
    const visibleAccounts = allAccounts.map((a) => ({ id: a.accountId, name: a.name }));
    const userAccounts = allAccounts
      .filter((a) => a.users.map((u) => u.toLowerCase()).includes(callerEmail))
      .map((a) => ({ id: a.accountId, name: a.name }));

    const isSuperAdminUser = SUPER_ADMINS.map((e) => e.toLowerCase()).includes(callerEmail);
    const role = isSuperAdminUser ? "SUPER_ADMIN" : userAccounts.length > 0 ? "ACCOUNT_USER" : "GUEST";
    const checklist = profile?.checklist?.filter((t) => !t.isArchived) ?? [];
    
    // Maintenance mode
    const maintenance = await ctx.db.query("maintenanceMode").first();
    const isMaintenanceMode = maintenance?.enabled ?? false;
    const canToggleMaintenance = MAINTENANCE_AUTHORIZED.includes(callerEmail);

    return {
      email: callerEmail,
      nickname: nickname,
      role,
      accounts: isSuperAdminUser || role === "GUEST" ? visibleAccounts : userAccounts,
      userAccounts,
      assignedAccount: userAccounts.length > 0 ? userAccounts[0].id : null,
      checklist,
      notes: profile?.notes ?? [],
      notifications: [],
      isMaintenanceMode,
      canToggleMaintenance,
    };
  },
});

// Non-admin: request access
export const requestAccountAccess = mutation({
  args: { email: v.string(), accountIds: v.array(v.string()), nickname: v.string() },
  handler: async (ctx, { email, accountIds, nickname }) => {
    email = email.toLowerCase().trim();

    let profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!profile) {
      await ctx.db.insert("userProfiles", { email, nickname: nickname || email.split("@")[0] });
    } else {
      await ctx.db.patch(profile._id, { nickname });
    }

    for (const accId of accountIds) {
      const existing = await ctx.db
        .query("accessRequests")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect();
      const alreadyRequested = existing.some((r) => r.accountId === accId && r.type === "ACCESS");
      if (!alreadyRequested) {
        await ctx.db.insert("accessRequests", {
          email,
          accountId: accId,
          nickname,
          type: "ACCESS",
          timestamp: new Date().toISOString(),
        });
      }
    }
  },
});

// Request removal from account
export const requestAccountRemoval = mutation({
  args: { email: v.string(), accountId: v.string() },
  handler: async (ctx, { email, accountId }) => {
    email = email.toLowerCase().trim();
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    const nickname = profile?.nickname ?? email.split("@")[0];

    const existing = await ctx.db
      .query("accessRequests")
      .withIndex("by_email", (q) => q.eq("email", email))
      .collect();
    const alreadyRequested = existing.some((r) => r.accountId === accountId && r.type === "REMOVAL");
    if (!alreadyRequested) {
      await ctx.db.insert("accessRequests", {
        email,
        accountId,
        nickname,
        type: "REMOVAL",
        timestamp: new Date().toISOString(),
      });
    }
  },
});

// Get pending access requests (SUPER_ADMIN only)
export const getAccessRequests = query({
  args: { callerEmail: v.string() },
  handler: async (ctx, { callerEmail }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.map(e => e.toLowerCase()).includes(callerEmail)) throw new Error("Unauthorized");

    const requests = await ctx.db.query("accessRequests").collect();
    const result = [];
    for (const r of requests) {
      const acc = await ctx.db
        .query("accounts")
        .withIndex("by_accountId", (q) => q.eq("accountId", r.accountId))
        .first();
      result.push({
        _id: r._id,
        email: r.email,
        accountId: r.accountId,
        accountName: acc ? acc.name : r.accountId,
        nickname: r.nickname,
        timestamp: r.timestamp,
        type: r.type,
      });
    }
    return result;
  },
});

// Approve or reject access request (SUPER_ADMIN only)
export const approveAccountAccess = mutation({
  args: { callerEmail: v.string(), requestId: v.id("accessRequests") },
  handler: async (ctx, { callerEmail, requestId }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.map(e => e.toLowerCase()).includes(callerEmail)) throw new Error("Unauthorized");

    const req = await ctx.db.get(requestId);
    if (!req) return false;

    const acc = await ctx.db
      .query("accounts")
      .withIndex("by_accountId", (q) => q.eq("accountId", req.accountId))
      .first();

    if (req.type === "REMOVAL") {
      if (acc) {
        await ctx.db.patch(acc._id, {
          users: acc.users.filter((u) => u.toLowerCase() !== req.email.toLowerCase()),
        });
      }
    } else {
      if (acc && !acc.users.map((u) => u.toLowerCase()).includes(req.email.toLowerCase())) {
        await ctx.db.patch(acc._id, { users: [...acc.users, req.email] });
      }
    }

    // Notify the user
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", req.email))
      .first();
    if (profile) {
      const existing = profile.notifications ?? [];
      await ctx.db.patch(profile._id, {
        notifications: [
          ...existing,
          {
            type: "access",
            accountId: req.accountId,
            approved: true,
            requestType: req.type,
            timestamp: new Date().toISOString(),
          },
        ],
      });
    }

    await ctx.db.delete(requestId);
    return true;
  },
});

export const rejectAccountAccess = mutation({
  args: { callerEmail: v.string(), requestId: v.id("accessRequests") },
  handler: async (ctx, { callerEmail, requestId }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.map(e => e.toLowerCase()).includes(callerEmail)) throw new Error("Unauthorized");

    const req = await ctx.db.get(requestId);
    if (!req) return false;

    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", req.email))
      .first();
    if (profile) {
      const existing = profile.notifications ?? [];
      await ctx.db.patch(profile._id, {
        notifications: [
          ...existing,
          {
            type: "access",
            accountId: req.accountId,
            approved: false,
            requestType: req.type,
            timestamp: new Date().toISOString(),
          },
        ],
      });
    }

    await ctx.db.delete(requestId);
    return true;
  },
});

// AUX status update
export const updateUserAuxStatus = mutation({
  args: { email: v.string(), auxStatus: v.string() },
  handler: async (ctx, { email, auxStatus }) => {
    email = email.toLowerCase().trim();
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (profile) {
      await ctx.db.patch(profile._id, { auxStatus, lastActive: Date.now() });
    }
  },
});

// Maintenance mode
export const toggleMaintenanceMode = mutation({
  args: { callerEmail: v.string() },
  handler: async (ctx, { callerEmail }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!MAINTENANCE_AUTHORIZED.includes(callerEmail)) throw new Error("Unauthorized");

    const existing = await ctx.db.query("maintenanceMode").first();
    const newStatus = existing ? !existing.enabled : true;

    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: newStatus,
        updatedBy: callerEmail,
        updatedAt: new Date().toISOString(),
      });
    } else {
      await ctx.db.insert("maintenanceMode", {
        enabled: newStatus,
        updatedBy: callerEmail,
        updatedAt: new Date().toISOString(),
      });
    }
    return newStatus;
  },
});
