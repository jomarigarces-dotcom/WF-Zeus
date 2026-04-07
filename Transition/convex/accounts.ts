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

// Helper to fetch full account data with active reminders and sanitized categories
async function fetchFullAccount(ctx: any, accountId: string) {
  const acc = await ctx.db
    .query("accounts")
    .withIndex("by_accountId", (q: any) => q.eq("accountId", accountId))
    .first();
  if (!acc) return null;

  const now = new Date();
  const allReminders = await ctx.db.query("reminders").collect();

  const activeReminders = allReminders
    .filter((r: any) => {
      const isTarget = r.targetAccount === "ALL" || r.targetAccount === accountId;
      let isStarted = true;
      if (r.scheduledTime) {
        const sTime = new Date(r.scheduledTime);
        if (sTime > now) isStarted = false;
      }
      let isValid = false;
      if (r.isRecurring) {
        const sTime = new Date(r.scheduledTime);
        const rule = r.recurrenceRule || "WEEKLY";
        if (isStarted) {
          if (rule === "WEEKLY" && now.getDay() === sTime.getDay()) isValid = true;
          if (rule === "MONTHLY" && now.getDate() === sTime.getDate()) isValid = true;
        }
      } else {
        if (isStarted) {
          isValid = r.expiryTimestamp ? new Date(r.expiryTimestamp) > now : true;
        }
      }
      return isTarget && isValid;
    })
    .sort((a: any, b: any) => new Date(b.scheduledTime).getTime() - new Date(a.scheduledTime).getTime());

  const cats = acc.categories || [];
  const sanitizedCategories = cats.map((c: any) =>
    c.id === "HOME" ? { ...c, name: "Home Dashboard" } : c
  );
  if (!sanitizedCategories.some((c: any) => c.id === "HOME")) {
    sanitizedCategories.unshift({ id: "HOME", name: "Home Dashboard" });
  }

  return {
    id: acc.accountId,
    name: acc.name,
    categories: sanitizedCategories,
    icons: acc.icons || [],
    announcements: acc.announcements || [],
    notes: acc.notes || [],
    users: acc.users || [],
    activeReminders,
  };
}

// Get full account data including active reminders
export const getAccountData = query({
  args: { accountId: v.string() },
  handler: async (ctx, { accountId }) => {
    return await fetchFullAccount(ctx, accountId);
  },
});

// Create a new workspace account (SUPER_ADMIN only)
export const createAccount = mutation({
  args: { callerEmail: v.string(), accountName: v.string() },
  handler: async (ctx, { callerEmail, accountName }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.includes(callerEmail)) throw new Error("Unauthorized");

    const accountId =
      accountName.toLowerCase().replace(/[^a-z0-9]/g, "_") + "_" + Date.now();

    await ctx.db.insert("accounts", {
      accountId,
      name: accountName,
      categories: [{ id: "HOME", name: "Home Dashboard" }],
      icons: [],
      announcements: [
        {
          id: "ann_" + Date.now(),
          globalId: null,
          message: `Zeus Workspace for ${accountName} initialized.`,
          timestamp: new Date().toISOString(),
          severity: "info",
          sender: "Zeus System",
          senderEmail: "system",
          imageUrl: null,
          linkUrl: null,
          isPinned: false,
        },
      ],
      notes: [],
      users: [],
    });

    const all = await ctx.db.query("accounts").collect();
    return {
      accountId,
      accounts: all.map(a => ({ id: a.accountId, name: a.name }))
    };
  },
});

// Delete an account (SUPER_ADMIN only)
export const deleteAccount = mutation({
  args: { callerEmail: v.string(), accountId: v.string() },
  handler: async (ctx, { callerEmail, accountId }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.includes(callerEmail)) throw new Error("Unauthorized");

    const acc = await ctx.db
      .query("accounts")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .first();
    if (acc) await ctx.db.delete(acc._id);
    return true;
  },
});

// Save account data: add/edit category or icon
export const saveAccountData = mutation({
  args: {
    accountId: v.string(),
    type: v.string(), // 'cat' | 'icon' | 'account'
    item: v.object({
      id: v.string(),
      name: v.optional(v.string()),
      title: v.optional(v.string()),
      url: v.optional(v.string()),
      iconType: v.optional(v.string()),
      catId: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { accountId, type, item }) => {
    const acc = await ctx.db
      .query("accounts")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .first();
    if (!acc) throw new Error("Account not found");

    if (type === "account") {
      // Rename account
      await ctx.db.patch(acc._id, { name: item.name ?? acc.name });
    } else {
      const key = type === "cat" ? "categories" : "icons";
      const existingData = (acc as any)[key];
      const list: any[] = Array.isArray(existingData) ? [...existingData] : [];
      const idx = list.findIndex((i) => String(i.id) === String(item.id));

      if (type === "cat") {
        const catItem = { id: item.id, name: item.name ?? "" };
        if (idx !== -1) list[idx] = catItem;
        else list.push(catItem);
        await ctx.db.patch(acc._id, { categories: list });
      } else {
        const validCatIds = new Set((acc.categories || []).map((c: any) => c.id));
        const iconItem = {
          id: item.id,
          title: item.title ?? item.name ?? "",
          url: item.url ?? "",
          iconType: item.iconType ?? "🔗",
          catId: item.catId && item.catId.length > 0 ? item.catId : "HOME",
        };
        if (idx !== -1) list[idx] = iconItem;
        else list.push(iconItem);
        // Self-heal: fix any existing icons with invalid catId
        const healedList = list.map((icon: any) => {
          if (!icon.catId || !validCatIds.has(icon.catId)) {
            return { ...icon, catId: "HOME" };
          }
          return icon;
        });
        await ctx.db.patch(acc._id, { icons: healedList });
      }
    }

    return await fetchFullAccount(ctx, accountId);
  },
});

// Repair any icons with missing/invalid catId — reassign to HOME (SUPER_ADMIN only)
export const repairAccountIcons = mutation({
  args: { callerEmail: v.string(), accountId: v.string() },
  handler: async (ctx, { callerEmail, accountId }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.includes(callerEmail)) throw new Error("Unauthorized");

    const acc = await ctx.db
      .query("accounts")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .first();
    if (!acc) throw new Error("Account not found");

    const validCatIds = new Set((acc.categories || []).map((c) => c.id));
    const repairedIcons = (acc.icons || []).map((icon: any) => {
      if (!icon.catId || !validCatIds.has(icon.catId)) {
        return { ...icon, catId: "HOME" };
      }
      return icon;
    });

    await ctx.db.patch(acc._id, { icons: repairedIcons });
    return await fetchFullAccount(ctx, accountId);
  },
});



export const deleteAccountItem = mutation({
  args: { accountId: v.string(), type: v.string(), itemId: v.string() },
  handler: async (ctx, { accountId, type, itemId }) => {
    const acc = await ctx.db
      .query("accounts")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .first();
    if (!acc) throw new Error("Account not found");

    if (type === "cat") {
      await ctx.db.patch(acc._id, {
        categories: (acc.categories || []).filter((c) => c.id !== itemId),
        icons: (acc.icons || []).filter((i) => i.catId !== itemId),
      });
    } else {
      await ctx.db.patch(acc._id, {
        icons: (acc.icons || []).filter((i) => i.id !== itemId),
      });
    }

    return await fetchFullAccount(ctx, accountId);
  },
});

// Get users registry (SUPER_ADMIN only)
export const getUsersRegistry = query({
  args: { callerEmail: v.string() },
  handler: async (ctx, { callerEmail }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.includes(callerEmail)) throw new Error("Unauthorized");

    const accounts = await ctx.db.query("accounts").collect();
    const registry: Record<string, { name: string; users: { email: string; nickname: string }[] }> = {};

    for (const acc of accounts) {
      const users = [];
      for (const email of acc.users) {
        const profile = await ctx.db
          .query("userProfiles")
          .withIndex("by_email", (q) => q.eq("email", email))
          .first();
        users.push({ email, nickname: profile?.nickname ?? email.split("@")[0] });
      }
      registry[acc.accountId] = { name: acc.name, users };
    }
    return registry;
  },
});

// Admin direct-assign a user to one or more accounts (SUPER_ADMIN only, no approval needed)
export const adminAssignUser = mutation({
  args: {
    callerEmail: v.string(),
    targetEmail: v.string(),
    accountIds: v.array(v.string()),
  },
  handler: async (ctx, { callerEmail, targetEmail, accountIds }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    targetEmail = targetEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.includes(callerEmail)) throw new Error("Unauthorized");

    for (const accId of accountIds) {
      const acc = await ctx.db
        .query("accounts")
        .withIndex("by_accountId", (q) => q.eq("accountId", accId))
        .first();
      if (acc && !acc.users.map((u) => u.toLowerCase()).includes(targetEmail)) {
        await ctx.db.patch(acc._id, { users: [...acc.users, targetEmail] });
      }
    }

    // Return updated registry
    const allAccs = await ctx.db.query("accounts").collect();
    const registry: Record<string, { name: string; users: { email: string; nickname: string }[] }> = {};
    for (const a of allAccs) {
      const usersList = [];
      for (const uEmail of a.users) {
        const profile = await ctx.db
          .query("userProfiles")
          .withIndex("by_email", (q) => q.eq("email", uEmail))
          .first();
        usersList.push({ email: uEmail, nickname: profile?.nickname ?? uEmail.split("@")[0] });
      }
      registry[a.accountId] = { name: a.name, users: usersList };
    }
    return registry;
  },
});

// Remove user from account (SUPER_ADMIN only)
export const unregisterUser = mutation({
  args: { callerEmail: v.string(), accountId: v.string(), email: v.string() },
  handler: async (ctx, { callerEmail, accountId, email }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    email = email.toLowerCase().trim();
    if (!SUPER_ADMINS.includes(callerEmail)) throw new Error("Unauthorized");

    const acc = await ctx.db
      .query("accounts")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .first();
    if (acc) {
      await ctx.db.patch(acc._id, {
        users: acc.users.filter((u) => u.toLowerCase() !== email),
      });
    }
    
    // Return full registry after unregistering user
    const allAccs = await ctx.db.query("accounts").collect();
    const registry: Record<string, { name: string; users: { email: string; nickname: string }[] }> = {};
    for (const a of allAccs) {
      const usersList = [];
      for (const uEmail of a.users) {
        const profile = await ctx.db
          .query("userProfiles")
          .withIndex("by_email", (q) => q.eq("email", uEmail))
          .first();
        usersList.push({ email: uEmail, nickname: profile?.nickname ?? uEmail.split("@")[0] });
      }
      registry[a.accountId] = { name: a.name, users: usersList };
    }
    return registry;
  },
});
