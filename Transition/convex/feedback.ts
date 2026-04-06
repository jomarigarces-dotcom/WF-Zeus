import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const FEEDBACK_VIEWER = "jomari.garces@ececontactcenters.com";

// Submit feedback
export const submitFeedback = mutation({
  args: { email: v.string(), nickname: v.string(), message: v.string() },
  handler: async (ctx, { email, nickname, message }) => {
    email = email.toLowerCase().trim();
    await ctx.db.insert("feedbacks", {
      sender: nickname || email.split("@")[0],
      email,
      message,
      timestamp: new Date().toISOString(),
    });
    return true;
  },
});

// Get all feedbacks (restricted to FEEDBACK_VIEWER / SUPER_ADMIN)
export const getFeedbacks = query({
  args: { callerEmail: v.string() },
  handler: async (ctx, { callerEmail }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    const SUPER_ADMINS = [
      "jomari.garces@ececontactcenters.com",
      "salcedo@ececontactcenters.com",
      "lching@ececontactcenters.com",
      "wmt@ececontactcenters.com",
      "maganan@ececontactcenters.com",
      "erivera@ececontactcenters.com",
      "jtrias@ececontactcenters.com",
    ];
    if (callerEmail !== FEEDBACK_VIEWER && !SUPER_ADMINS.includes(callerEmail)) return [];
    const feedbacks = await ctx.db.query("feedbacks").collect();
    return feedbacks.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  },
});
