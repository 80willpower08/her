import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import sensible from '@fastify/sensible';
import jwt from '@fastify/jwt';
import { env } from './env.js';
import { prisma } from './prisma.js';
import { authRoutes, ensureSingleUser } from './auth.js';
import { categoryRoutes } from './routes/categories.js';
import { taskRoutes } from './routes/tasks.js';
import { goalRoutes } from './routes/goals.js';
import { conversationRoutes } from './routes/conversations.js';
import { overviewRoutes } from './routes/overview.js';
import { accountRoutes } from './routes/accounts.js';
import { internalRoutes } from './routes/internal.js';
import { calendarRoutes } from './routes/calendar.js';
import { notificationRoutes } from './routes/notifications.js';
import { agentRoutes } from './routes/agent.js';
import { agentInternalRoutes } from './routes/agent-internal.js';
import { mcpRoutes } from './routes/mcp.js';
import { shareRoutes } from './routes/share.js';
import { calendarSourceRoutes } from './routes/calendar-sources.js';
import { sheetSourceRoutes } from './routes/sheet-sources.js';
import { chatRoutes } from './routes/chat.js';
import { observationRoutes } from './routes/observations.js';
import { projectRoutes } from './routes/projects.js';
import { dataSourceRoutes } from './routes/data-sources.js';
import { todayCurationRoutes } from './routes/today-curation.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { dayRatingRoutes } from './routes/day-ratings.js';

const app = Fastify({
  logger: {
    level: env.nodeEnv === 'development' ? 'info' : 'warn',
    transport:
      env.nodeEnv === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
  },
  // 8MB body limit — long pastes (Claude.ai conversation exports, big docs)
  // can run several hundred KB; default 1MB was too tight.
  bodyLimit: 8 * 1024 * 1024,
});

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string; username: string; intent?: string };
    user: { userId: string; username: string; intent?: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => Promise<void>;
  }
}

await app.register(cors, { origin: true, credentials: true });
// Multipart for file uploads (project attachments). Generous limits — long
// scanned PDFs and document dumps can run tens of MB.
await app.register(multipart, {
  limits: {
    fileSize: 25 * 1024 * 1024, // 25 MB per file
    files: 10,
    fields: 20,
  },
});
await app.register(sensible);
await app.register(jwt, { secret: env.jwtSecret });

app.decorate('authenticate', async (req, reply) => {
  try {
    await req.jwtVerify();
  } catch {
    return reply.unauthorized('Authentication required');
  }
});

app.get('/healthz', async (_req, reply) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', service: 'api' };
  } catch (err) {
    app.log.error({ err }, 'health check failed');
    return reply.code(503).send({ status: 'unhealthy', service: 'api' });
  }
});

await app.register(authRoutes);
await app.register(categoryRoutes);
await app.register(taskRoutes);
await app.register(goalRoutes);
await app.register(conversationRoutes);
await app.register(overviewRoutes);
await app.register(accountRoutes);
await app.register(internalRoutes);
await app.register(calendarRoutes);
await app.register(notificationRoutes);
await app.register(agentRoutes);
await app.register(agentInternalRoutes);
await app.register(mcpRoutes);
await app.register(shareRoutes);
await app.register(calendarSourceRoutes);
await app.register(sheetSourceRoutes);
await app.register(chatRoutes);
await app.register(observationRoutes);
await app.register(projectRoutes);
await app.register(dataSourceRoutes);
await app.register(todayCurationRoutes);
await app.register(dashboardRoutes);
await app.register(dayRatingRoutes);

const start = async () => {
  try {
    await ensureSingleUser();
    await app.listen({ port: env.apiPort, host: '0.0.0.0' });
    app.log.info(`API listening on :${env.apiPort}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    app.log.info(`Received ${sig}, shutting down...`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

await start();
