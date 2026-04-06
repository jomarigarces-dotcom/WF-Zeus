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

// Get live status of all users (SUPER_ADMIN only)
export const getLiveStatus = query({
  args: { callerEmail: v.string() },
  handler: async (ctx, { callerEmail }) => {
    callerEmail = callerEmail.toLowerCase().trim();
    if (!SUPER_ADMINS.includes(callerEmail)) return [];

    const profiles = await ctx.db.query("userProfiles").collect();
    const accounts = await ctx.db.query("accounts").collect();
    const now = Date.now();

    const statusConfig: Record<string, number> = {
      ONLINE: 5,
      LUNCH: 4,
      BREAK: 3,
      PRODWALK: 2,
      AFK: 1,
      BIO: 1,
      OFFLINE: 0,
    };

    const statuses = profiles.map((p) => {
      const lastActive = p.lastActive ?? 0;
      const diffMinutes = (now - lastActive) / 1000 / 60;

      let displayStatus = p.auxStatus ?? "ONLINE";
      if (diffMinutes > 120) displayStatus = "Inactive";
      else if (diffMinutes > 30) displayStatus = "Away";

      let accName = "Unassigned";
      for (const acc of accounts) {
        if (acc.users.includes(p.email)) {
          accName = acc.name;
          break;
        }
      }

      return {
        nickname: p.nickname || p.email.split("@")[0],
        email: p.email,
        accountName: accName,
        accountId: p.lastAccount ?? "N/A",
        auxStatus: displayStatus,
        lastActive,
      };
    });

    return statuses.sort(
      (a, b) => (statusConfig[b.auxStatus] ?? 0) - (statusConfig[a.auxStatus] ?? 0)
    );
  },
});
