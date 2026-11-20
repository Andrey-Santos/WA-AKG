import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { authConfig } from "@/auth.config";

// Brute-force guard (login is exposed on the public tunnel): 8 failed attempts / 15 min per client IP.
const failures = new Map<string, { n: number; reset: number }>();
const MAX_FAILS = 8, WINDOW_MS = 15 * 60_000;

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials, request) => {
        const ip = request?.headers?.get("cf-connecting-ip") || request?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
        const f = failures.get(ip);
        if (f && f.reset > Date.now() && f.n >= MAX_FAILS) return null;
        const fail = () => {
          const cur = f && f.reset > Date.now() ? f : { n: 0, reset: Date.now() + WINDOW_MS };
          cur.n++;
          failures.set(ip, cur);
          return null;
        };

        const parsedCredentials = z
          .object({ email: z.string().email(), password: z.string().min(6) })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          
          const user = await prisma.user.findUnique({ where: { email } });
          if (!user) return fail();

          const passwordsMatch = await bcrypt.compare(password, user.password);

          if (passwordsMatch) {
             failures.delete(ip);
             return user;
          }
        }
        return fail();
      },
    }),
  ],
  secret: process.env.AUTH_SECRET,
});
