import bcrypt from 'bcrypt';
import type { FastifyPluginAsync } from 'fastify';
import { env } from './env.js';
import { prisma } from './prisma.js';
import { seedDefaultCategories } from './services/seed.js';

export const SINGLE_USER_ID = 'default';

export async function ensureSingleUser() {
  await prisma.user.upsert({
    where: { id: SINGLE_USER_ID },
    update: { username: env.adminUsername },
    create: { id: SINGLE_USER_ID, username: env.adminUsername },
  });
  await seedDefaultCategories(SINGLE_USER_ID);
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { username: string; password: string } }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string', minLength: 1 },
            password: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body;
      if (username !== env.adminUsername) {
        return reply.unauthorized('Invalid credentials');
      }
      const ok = await bcrypt.compare(password, env.adminPasswordHash);
      if (!ok) {
        return reply.unauthorized('Invalid credentials');
      }
      const token = app.jwt.sign(
        { userId: SINGLE_USER_ID, username },
        { expiresIn: '30d' }
      );
      return { token, user: { id: SINGLE_USER_ID, username } };
    }
  );

  app.get('/api/me', { preHandler: [app.authenticate] }, async (req) => {
    return { user: req.user };
  });
};
