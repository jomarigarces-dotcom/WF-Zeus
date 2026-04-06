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

// Add a personal task to the user's checklist
export const addPersonalTask = mutation({
  args: { email: v.string(), taskText: v.string() },
  handler: async (ctx, { email, taskText }) => {
    email = email.toLowerCase().trim();
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();

    const newTask = {
      id: Date.now().toString(),
      text: taskText,
      isDone: false,
      isArchived: false,
      timestamp: new Date().toISOString(),
    };

    if (profile) {
      const checklist = [...(profile.checklist ?? []), newTask];
      await ctx.db.patch(profile._id, { checklist });
      return checklist.filter((t) => !t.isArchived);
    } else {
      await ctx.db.insert("userProfiles", {
        email,
        nickname: email.split("@")[0],
        checklist: [newTask],
      });
      return [newTask];
    }
  },
});

// Toggle a personal task done/undone
export const togglePersonalTask = mutation({
  args: { email: v.string(), taskId: v.string() },
  handler: async (ctx, { email, taskId }) => {
    email = email.toLowerCase().trim();
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!profile?.checklist) return [];

    const checklist = profile.checklist.map((t) => {
      if (t.id !== taskId) return t;
      const isDone = !t.isDone;
      return { ...t, isDone, completedAt: isDone ? new Date().toISOString() : undefined };
    });

    await ctx.db.patch(profile._id, { checklist });
    return checklist.filter((t) => !t.isArchived);
  },
});

// Archive (soft-delete) a personal task
export const deletePersonalTask = mutation({
  args: { email: v.string(), taskId: v.string() },
  handler: async (ctx, { email, taskId }) => {
    email = email.toLowerCase().trim();
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!profile?.checklist) return [];

    const checklist = profile.checklist.map((t) =>
      t.id === taskId ? { ...t, isArchived: true } : t
    );
    await ctx.db.patch(profile._id, { checklist });
    return checklist.filter((t) => !t.isArchived);
  },
});

// Personal updates poll: checklist + notifications
export const fetchPersonalUpdates = query({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    email = email.toLowerCase().trim();
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!profile) return { checklist: [], notifications: [] };

    const checklist = (profile.checklist ?? []).filter((t) => !t.isArchived);
    const notifications = profile.notifications ?? [];

    return { checklist, notifications };
  },
});

// Bulk assign tasks to ALL users, an account, or a specific user (SUPER_ADMIN only)
export const bulkAssignTasks = mutation({
  args: {
    callerEmail: v.string(),
    targetType: v.string(), // ALL | ACCOUNT | USER
    targetId: v.optional(v.string()),
    tasks: v.array(v.string()),
    senderNickname: v.string(),
  },
  handler: async (ctx, { callerEmail, targetType, targetId, tasks, senderNickname }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.includes(callerEmail)) throw new Error("Unauthorized");

    let targetEmails: string[] = [];

    if (targetType === "ALL") {
      const profiles = await ctx.db.query("userProfiles").collect();
      targetEmails = profiles.map((p) => p.email);
    } else if (targetType === "ACCOUNT" && targetId) {
      const acc = await ctx.db
        .query("accounts")
        .withIndex("by_accountId", (q) => q.eq("accountId", targetId))
        .first();
      targetEmails = acc?.users ?? [];
    } else if (targetType === "USER" && targetId) {
      targetEmails = [targetId.toLowerCase().trim()];
    }

    const timestamp = new Date().toISOString();
    let count = 0;

    for (const email of targetEmails) {
      const profile = await ctx.db
        .query("userProfiles")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();

      const newTasks = tasks.map((text) => ({
        id: Date.now().toString() + "_" + Math.random().toString(36).substr(2, 5),
        text,
        isDone: false,
        isArchived: false,
        timestamp,
        sender: senderNickname,
      }));

      if (profile) {
        await ctx.db.patch(profile._id, {
          checklist: [...(profile.checklist ?? []), ...newTasks],
        });
      } else {
        await ctx.db.insert("userProfiles", {
          email,
          nickname: email.split("@")[0],
          checklist: newTasks,
        });
      }
      count++;
    }

    return `Assigned ${tasks.length} tasks to ${count} users.`;
  },
});

// Admin assign task to single user
export const adminAssignTask = mutation({
  args: {
    callerEmail: v.string(),
    targetEmail: v.string(),
    taskText: v.string(),
    senderNickname: v.string(),
  },
  handler: async (ctx, { callerEmail, targetEmail, taskText, senderNickname }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.includes(callerEmail)) throw new Error("Unauthorized");

    targetEmail = targetEmail.toLowerCase().trim();
    const profile = await ctx.db
      .query("userProfiles")
      .withIndex("by_email", (q) => q.eq("email", targetEmail))
      .first();

    const newTask = {
      id: Date.now().toString(),
      text: taskText,
      isDone: false,
      isArchived: false,
      timestamp: new Date().toISOString(),
      sender: senderNickname,
    };

    if (profile) {
      await ctx.db.patch(profile._id, {
        checklist: [...(profile.checklist ?? []), newTask],
      });
    } else {
      await ctx.db.insert("userProfiles", {
        email: targetEmail,
        nickname: targetEmail.split("@")[0],
        checklist: [newTask],
      });
    }
    return true;
  },
});

// Get task history (SUPER_ADMIN only)
export const getTaskHistory = query({
  args: {
    callerEmail: v.string(),
    filterAccount: v.optional(v.string()),
    filterUser: v.optional(v.string()),
    dateFrom: v.optional(v.string()),
    dateTo: v.optional(v.string()),
  },
  handler: async (ctx, { callerEmail, filterAccount, filterUser, dateFrom, dateTo }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.includes(callerEmail)) return [];

    const profiles = await ctx.db.query("userProfiles").collect();
    const accounts = await ctx.db.query("accounts").collect();

    const history: any[] = [];

    for (const profile of profiles) {
      if (!profile.checklist) continue;

      let userAccountName = "Unassigned";
      let userAccountId: string | null = null;
      for (const acc of accounts) {
        if (acc.users.includes(profile.email)) {
          userAccountName = acc.name;
          userAccountId = acc.accountId;
          break;
        }
      }

      if (filterAccount && filterAccount !== "ALL" && userAccountId !== filterAccount) continue;
      if (
        filterUser &&
        !profile.email.toLowerCase().includes(filterUser.toLowerCase()) &&
        !profile.nickname.toLowerCase().includes(filterUser.toLowerCase())
      )
        continue;

      for (const task of profile.checklist) {
        if (!task.isDone) continue;
        const dateRef = task.completedAt || task.timestamp;
        if (dateRef) {
          const d = new Date(dateRef);
          if (dateFrom && d < new Date(dateFrom)) continue;
          if (dateTo) {
            const dt = new Date(dateTo);
            dt.setHours(23, 59, 59, 999);
            if (d > dt) continue;
          }
        }
        history.push({
          taskText: task.text,
          user: profile.nickname || profile.email,
          email: profile.email,
          account: userAccountName,
          completedAt: task.completedAt || "Unknown",
          createdAt: task.timestamp,
        });
      }
    }

    return history.sort((a, b) => {
      const da = new Date(a.completedAt === "Unknown" ? a.createdAt : a.completedAt);
      const db = new Date(b.completedAt === "Unknown" ? b.createdAt : b.completedAt);
      return db.getTime() - da.getTime();
    });
  },
});
