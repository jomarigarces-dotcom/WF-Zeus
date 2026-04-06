import { v } from "convex/values";
import { mutation } from "./_generated/server";

// Save or update a note (personal or team)
export const saveNote = mutation({
  args: {
    email: v.string(),
    noteId: v.optional(v.string()),
    title: v.string(),
    content: v.string(),
    scope: v.string(), // PERSONAL | TEAM
    accountId: v.optional(v.string()),
    nickname: v.optional(v.string()),
  },
  handler: async (ctx, { email, noteId, title, content, scope, accountId, nickname }) => {
    email = email.toLowerCase().trim();

    if (scope === "TEAM") {
      if (!accountId) throw new Error("accountId required for team notes");
      const acc = await ctx.db
        .query("accounts")
        .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
        .first();
      if (!acc) throw new Error("Account not found");

      const notes = [...acc.notes];
      const ts = new Date().toISOString();

      if (noteId) {
        const idx = notes.findIndex((n) => n.id === noteId);
        if (idx !== -1) {
          notes[idx] = { ...notes[idx], title, content, timestamp: ts };
        }
      } else {
        notes.unshift({
          id: Date.now().toString(),
          title,
          content,
          timestamp: ts,
          author: nickname ?? email.split("@")[0],
        });
      }
      await ctx.db.patch(acc._id, { notes });
      return notes;
    } else {
      // Personal note
      const profile = await ctx.db
        .query("userProfiles")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      const existingNotes = profile?.notes ?? [];
      const ts = new Date().toISOString();
      let notes;

      if (noteId) {
        notes = existingNotes.map((n) =>
          n.id === noteId ? { ...n, title, content, timestamp: ts } : n
        );
      } else {
        notes = [
          {
            id: Date.now().toString(),
            title,
            content,
            timestamp: ts,
            author: nickname ?? email.split("@")[0],
          },
          ...existingNotes,
        ];
      }

      if (profile) {
        await ctx.db.patch(profile._id, { notes });
      } else {
        await ctx.db.insert("userProfiles", {
          email,
          nickname: nickname ?? email.split("@")[0],
          notes,
        });
      }
      return notes;
    }
  },
});

// Delete a note (personal or team)
export const deleteNote = mutation({
  args: {
    email: v.string(),
    noteId: v.string(),
    scope: v.string(),
    accountId: v.optional(v.string()),
  },
  handler: async (ctx, { email, noteId, scope, accountId }) => {
    email = email.toLowerCase().trim();

    if (scope === "TEAM") {
      if (!accountId) throw new Error("accountId required for team notes");
      const acc = await ctx.db
        .query("accounts")
        .withIndex("by_accountId", (q) => q.eq("accountId", accountId))
        .first();
      if (!acc) throw new Error("Account not found");
      const notes = acc.notes.filter((n) => n.id !== noteId);
      await ctx.db.patch(acc._id, { notes });
      return notes;
    } else {
      const profile = await ctx.db
        .query("userProfiles")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();
      if (!profile) return [];
      const notes = (profile.notes ?? []).filter((n) => n.id !== noteId);
      await ctx.db.patch(profile._id, { notes });
      return notes;
    }
  },
});
