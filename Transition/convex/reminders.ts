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

// Post a reminder (SUPER_ADMIN only)
export const postReminder = mutation({
  args: {
    callerEmail: v.string(),
    targetAccount: v.string(), // account id or 'ALL'
    message: v.string(),
    imageUrl: v.optional(v.union(v.string(), v.null())),
    sender: v.string(),
    durationHours: v.optional(v.number()),
    scheduledTime: v.string(),
    isRecurring: v.boolean(),
    recurrenceRule: v.optional(v.string()), // NONE | WEEKLY | MONTHLY
  },
  handler: async (ctx, { callerEmail, targetAccount, message, imageUrl, sender, durationHours, scheduledTime, isRecurring, recurrenceRule }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.includes(callerEmail)) throw new Error("Unauthorized");

    let startTime = new Date(scheduledTime && scheduledTime.trim() ? scheduledTime : Date.now());
    if (isNaN(startTime.getTime())) startTime = new Date();
    
    const hours = durationHours ?? 24;

    // Magic number 87600 = ~10 years = "forever"
    const expiryTimestamp =
      hours === 87600
        ? "9999-12-31T23:59:59Z"
        : new Date(startTime.getTime() + hours * 60 * 60 * 1000).toISOString();

    await ctx.db.insert("reminders", {
      targetAccount,
      message,
      imageUrl: imageUrl ?? null,
      sender: sender || "Admin",
      senderEmail: callerEmail,
      timestamp: new Date().toISOString(),
      scheduledTime: startTime.toISOString(),
      expiryTimestamp,
      durationHours: hours,
      isRecurring,
      recurrenceRule: recurrenceRule || "NONE",
    });

    return true;
  },
});

// Delete a reminder (sender or SUPER_ADMIN)
export const deleteReminder = mutation({
  args: { callerEmail: v.string(), reminderId: v.id("reminders") },
  handler: async (ctx, { callerEmail, reminderId }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    const reminder = await ctx.db.get(reminderId);
    if (!reminder) throw new Error("Not found");

    const isSuperAdmin = SUPER_ADMINS.includes(callerEmail);
    if (reminder.senderEmail !== callerEmail && !isSuperAdmin) {
      throw new Error("Permission denied");
    }

    await ctx.db.delete(reminderId);
    return true;
  },
});

// Get active reminders for a specific account (workspace poll)
export const getActiveReminders = query({
  args: { accountId: v.string() },
  handler: async (ctx, { accountId }) => {
    const allReminders = await ctx.db.query("reminders").collect();
    const now = new Date();

    return allReminders
      .filter((r) => {
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
      .sort((a, b) => new Date(b.scheduledTime).getTime() - new Date(a.scheduledTime).getTime());
  },
});

// Get all reminders for SUPER_ADMIN management panel
export const getRemindersForManagement = query({
  args: { callerEmail: v.string() },
  handler: async (ctx, { callerEmail }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.includes(callerEmail)) return [];

    const accounts = await ctx.db.query("accounts").collect();
    const now = Date.now();
    const allReminders = await ctx.db.query("reminders").collect();

    return allReminders
      .filter((r) => {
        if (r.isRecurring) return true;
        return r.expiryTimestamp ? new Date(r.expiryTimestamp).getTime() > now : false;
      })
      .map((r) => {
        let accName = "Global";
        if (r.targetAccount !== "ALL") {
          const acc = accounts.find((a) => a.accountId === r.targetAccount);
          if (acc) accName = acc.name;
        }
        return { ...r, targetAccountName: accName };
      });
  },
});
