import { v } from "convex/values";
import { mutation } from "./_generated/server";

const SUPER_ADMINS = [
  "jomari.garces@ececontactcenters.com",
  "salcedo@ececontactcenters.com",
  "lching@ececontactcenters.com",
  "wmt@ececontactcenters.com",
  "maganan@ececontactcenters.com",
  "erivera@ececontactcenters.com",
  "jtrias@ececontactcenters.com",
];

// Post announcement to one or all accounts
export const postAccountAnnouncement = mutation({
  args: {
    callerEmail: v.string(),
    accountId: v.string(), // account id or 'ALL'
    message: v.string(),
    severity: v.string(),
    sender: v.string(),
    imageUrl: v.optional(v.union(v.string(), v.null())),
    linkUrl: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { callerEmail, accountId, message, severity, sender, imageUrl, linkUrl }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    const isSuperAdmin = SUPER_ADMINS.includes(callerEmail);

    const annTemplate = {
      id: "ann_" + Date.now().toString(),
      globalId: null as string | null,
      message,
      timestamp: new Date().toISOString(),
      severity,
      sender: sender || callerEmail,
      senderEmail: callerEmail,
      imageUrl: imageUrl ?? null,
      linkUrl: linkUrl ?? null,
      isPinned: false,
    };

    if (accountId === "ALL") {
      if (!isSuperAdmin) return { status: "forbidden" };
      annTemplate.globalId = annTemplate.id;
      const allAccounts = await ctx.db.query("accounts").collect();
      for (const acc of allAccounts) {
        const clone = { ...annTemplate, id: annTemplate.id + "_" + acc.accountId };
        await ctx.db.patch(acc._id, {
          announcements: [...acc.announcements, clone],
        });
      }
      return { ok: true };
    }

    const acc = await ctx.db
      .query("accounts")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .first();
    if (!acc) return { status: "error", message: "Account not found" };
    await ctx.db.patch(acc._id, {
      announcements: [...acc.announcements, annTemplate],
    });
    return { ok: true, accountId };
  },
});

// Edit an existing announcement
export const editAccountAnnouncement = mutation({
  args: {
    callerEmail: v.string(),
    accountId: v.string(),
    annId: v.string(),
    newMsg: v.optional(v.string()),
    newSeverity: v.optional(v.string()),
    newImageUrl: v.optional(v.union(v.string(), v.null())),
    newLinkUrl: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { callerEmail, accountId, annId, newMsg, newSeverity, newImageUrl, newLinkUrl }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    const isSuperAdmin = SUPER_ADMINS.includes(callerEmail);

    const acc = await ctx.db
      .query("accounts")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .first();
    if (!acc) return false;

    const announcements = acc.announcements.map((a) => {
      if (a.id !== annId && a.globalId !== annId) return a;
      const senderEmail = (a.senderEmail || a.sender || "").toLowerCase();
      if (!isSuperAdmin && senderEmail !== callerEmail) return a;
      return {
        ...a,
        message: newMsg !== undefined ? newMsg : a.message,
        severity: newSeverity !== undefined ? newSeverity : a.severity,
        imageUrl: newImageUrl !== undefined ? newImageUrl : a.imageUrl,
        linkUrl: newLinkUrl !== undefined ? newLinkUrl : a.linkUrl,
        updatedAt: new Date().toISOString(),
      };
    });

    await ctx.db.patch(acc._id, { announcements });
    return true;
  },
});

// Toggle pin on an announcement
export const toggleAnnouncementPin = mutation({
  args: { callerEmail: v.string(), accountId: v.string(), annId: v.string() },
  handler: async (ctx, { callerEmail, accountId, annId }) => {
    const acc = await ctx.db
      .query("accounts")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .first();
    if (!acc) return false;

    const announcements = acc.announcements.map((a) =>
      a.id == annId ? { ...a, isPinned: !a.isPinned } : a
    );
    await ctx.db.patch(acc._id, { announcements });
    return true;
  },
});

// Delete an announcement
export const deleteAccountAnnouncement = mutation({
  args: { callerEmail: v.string(), accountId: v.string(), annId: v.string() },
  handler: async (ctx, { callerEmail, accountId, annId }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    const isSuperAdmin = SUPER_ADMINS.includes(callerEmail);

    if (accountId === "ALL") {
      const allAccounts = await ctx.db.query("accounts").collect();
      for (const acc of allAccounts) {
        const ann = acc.announcements.find((a) => a.id === annId || a.globalId === annId);
        if (!ann) continue;
        const senderEmail = (ann.senderEmail || ann.sender || "").toLowerCase();
        if (isSuperAdmin || senderEmail === callerEmail) {
          await ctx.db.patch(acc._id, {
            announcements: acc.announcements.filter((a) => a.id !== annId && a.globalId !== annId),
          });
        }
      }
      return { ok: true };
    }

    const acc = await ctx.db
      .query("accounts")
      .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
      .first();
    if (!acc) return false;

    const ann = acc.announcements.find((a) => a.id === annId || a.globalId === annId);
    if (!ann) return false;
    const senderEmail = (ann.senderEmail || ann.sender || "").toLowerCase();
    if (!isSuperAdmin && senderEmail !== callerEmail) return false;

    await ctx.db.patch(acc._id, {
      announcements: acc.announcements.filter((a) => a.id !== annId && a.globalId !== annId),
    });
    return true;
  },
});
