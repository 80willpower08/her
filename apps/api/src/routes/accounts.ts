import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../prisma.js';
import { env } from '../env.js';
import { encryptToken } from '../lib/crypto.js';
import { buildAuthUrl, exchangeCodeForTokens } from '../services/google.js';
import { buildMsAuthUrl, exchangeCodeForMsTokens } from '../services/microsoft.js';

const STATE_TTL = '10m';

export const accountRoutes: FastifyPluginAsync = async (app) => {
  // Authenticated routes
  app.register(async (instance) => {
    instance.addHook('preHandler', instance.authenticate);

    const ACCOUNT_SELECT = {
      id: true,
      kind: true,
      provider: true,
      accountEmail: true,
      displayName: true,
      label: true,
      defaultCategoryId: true,
      color: true,
      status: true,
      lastSyncedAt: true,
      lastError: true,
      scopes: true,
      createdAt: true,
    } as const;

    instance.get('/api/accounts', async (req) => {
      const accounts = await prisma.externalAccount.findMany({
        where: { userId: req.user.userId },
        orderBy: [{ provider: 'asc' }, { accountEmail: 'asc' }],
        select: ACCOUNT_SELECT,
      });
      return { accounts };
    });

    instance.patch<{
      Params: { id: string };
      Body: { label?: string | null; color?: string; defaultCategoryId?: string | null };
    }>(
      '/api/accounts/:id',
      {
        schema: {
          body: {
            type: 'object',
            properties: {
              label: { type: ['string', 'null'], maxLength: 100 },
              color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
              defaultCategoryId: { type: ['string', 'null'] },
            },
            additionalProperties: false,
          },
        },
      },
      async (req, reply) => {
        const acc = await prisma.externalAccount.findFirst({
          where: { id: req.params.id, userId: req.user.userId },
        });
        if (!acc) return reply.notFound();

        if (req.body.defaultCategoryId) {
          const cat = await prisma.category.findFirst({
            where: { id: req.body.defaultCategoryId, userId: req.user.userId },
          });
          if (!cat) return reply.badRequest('Category not found');
        }

        const updated = await prisma.externalAccount.update({
          where: { id: acc.id },
          data: {
            label: req.body.label === undefined ? undefined : req.body.label,
            color: req.body.color,
            defaultCategoryId:
              req.body.defaultCategoryId === undefined ? undefined : req.body.defaultCategoryId,
          },
          select: ACCOUNT_SELECT,
        });
        return { account: updated };
      }
    );

    instance.delete<{ Params: { id: string } }>('/api/accounts/:id', async (req, reply) => {
      const acc = await prisma.externalAccount.findFirst({
        where: { id: req.params.id, userId: req.user.userId },
      });
      if (!acc) return reply.notFound();
      await prisma.externalAccount.delete({ where: { id: req.params.id } });
      return { ok: true };
    });

    // Initiate Google OAuth.
    // Frontend POSTs (with bearer token), gets back the consent URL,
    // then redirects the browser to it. State is a short-lived signed JWT
    // carrying the userId so the unauthenticated callback can verify identity.
    instance.post('/api/accounts/google/start', async (req, reply) => {
      try {
        const state = instance.jwt.sign(
          { userId: req.user.userId, username: req.user.username, intent: 'connect-google' },
          { expiresIn: STATE_TTL }
        );
        const url = buildAuthUrl(state);
        return { url };
      } catch (err) {
        return reply.badRequest(err instanceof Error ? err.message : 'Failed to start OAuth');
      }
    });

    instance.post('/api/accounts/microsoft/start', async (req, reply) => {
      try {
        const state = instance.jwt.sign(
          { userId: req.user.userId, username: req.user.username, intent: 'connect-microsoft' },
          { expiresIn: STATE_TTL }
        );
        const url = buildMsAuthUrl(state);
        return { url };
      } catch (err) {
        return reply.badRequest(err instanceof Error ? err.message : 'Failed to start OAuth');
      }
    });
  });

  // Unauthenticated callback. Verifies the state JWT to identify the user.
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/api/accounts/google/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;
      if (error) {
        return reply.redirect(`${env.publicOrigin}/settings?account=error&reason=${encodeURIComponent(error)}`);
      }
      if (!code || !state) {
        return reply.redirect(`${env.publicOrigin}/settings?account=error&reason=missing-params`);
      }

      let payload: { userId: string; intent?: string };
      try {
        payload = app.jwt.verify(state);
      } catch {
        return reply.redirect(`${env.publicOrigin}/settings?account=error&reason=invalid-state`);
      }
      if (payload.intent !== 'connect-google') {
        return reply.redirect(`${env.publicOrigin}/settings?account=error&reason=bad-intent`);
      }

      try {
        const tokens = await exchangeCodeForTokens(code);
        if (!tokens.email) {
          return reply.redirect(`${env.publicOrigin}/settings?account=error&reason=no-email`);
        }

        await prisma.externalAccount.upsert({
          where: {
            userId_provider_accountEmail: {
              userId: payload.userId,
              provider: 'GOOGLE',
              accountEmail: tokens.email,
            },
          },
          update: {
            kind: 'OAUTH',
            accessTokenEncrypted: encryptToken(tokens.accessToken),
            refreshTokenEncrypted: tokens.refreshToken
              ? encryptToken(tokens.refreshToken)
              : null,
            tokenExpiresAt: tokens.expiresAt,
            scopes: tokens.scopes,
            status: 'ACTIVE',
            lastError: null,
          },
          create: {
            userId: payload.userId,
            kind: 'OAUTH',
            provider: 'GOOGLE',
            accountEmail: tokens.email,
            displayName: tokens.email,
            accessTokenEncrypted: encryptToken(tokens.accessToken),
            refreshTokenEncrypted: tokens.refreshToken
              ? encryptToken(tokens.refreshToken)
              : null,
            tokenExpiresAt: tokens.expiresAt,
            scopes: tokens.scopes,
            color: '#0ea5e9',
            status: 'ACTIVE',
          },
        });

        return reply.redirect(`${env.publicOrigin}/settings?account=connected`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown';
        return reply.redirect(`${env.publicOrigin}/settings?account=error&reason=${encodeURIComponent(reason)}`);
      }
    }
  );

  // Microsoft OAuth callback (unauth — verifies state JWT)
  app.get<{ Querystring: { code?: string; state?: string; error?: string; error_description?: string } }>(
    '/api/accounts/microsoft/callback',
    async (req, reply) => {
      const { code, state, error, error_description } = req.query;
      if (error) {
        const reason = error_description ?? error;
        return reply.redirect(
          `${env.publicOrigin}/settings?account=error&reason=${encodeURIComponent(reason.slice(0, 200))}`
        );
      }
      if (!code || !state) {
        return reply.redirect(`${env.publicOrigin}/settings?account=error&reason=missing-params`);
      }

      let payload: { userId: string; intent?: string };
      try {
        payload = app.jwt.verify(state);
      } catch {
        return reply.redirect(`${env.publicOrigin}/settings?account=error&reason=invalid-state`);
      }
      if (payload.intent !== 'connect-microsoft') {
        return reply.redirect(`${env.publicOrigin}/settings?account=error&reason=bad-intent`);
      }

      try {
        const tokens = await exchangeCodeForMsTokens(code);
        if (!tokens.email) {
          return reply.redirect(`${env.publicOrigin}/settings?account=error&reason=no-email`);
        }

        await prisma.externalAccount.upsert({
          where: {
            userId_provider_accountEmail: {
              userId: payload.userId,
              provider: 'MICROSOFT',
              accountEmail: tokens.email,
            },
          },
          update: {
            kind: 'OAUTH',
            accessTokenEncrypted: encryptToken(tokens.accessToken),
            refreshTokenEncrypted: tokens.refreshToken
              ? encryptToken(tokens.refreshToken)
              : null,
            tokenExpiresAt: tokens.expiresAt,
            scopes: tokens.scopes,
            status: 'ACTIVE',
            lastError: null,
          },
          create: {
            userId: payload.userId,
            kind: 'OAUTH',
            provider: 'MICROSOFT',
            accountEmail: tokens.email,
            displayName: tokens.displayName ?? tokens.email,
            accessTokenEncrypted: encryptToken(tokens.accessToken),
            refreshTokenEncrypted: tokens.refreshToken
              ? encryptToken(tokens.refreshToken)
              : null,
            tokenExpiresAt: tokens.expiresAt,
            scopes: tokens.scopes,
            // Microsoft default color — distinct from Google's sky blue
            color: '#7c3aed',
            status: 'ACTIVE',
          },
        });

        return reply.redirect(`${env.publicOrigin}/settings?account=connected`);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'unknown';
        return reply.redirect(
          `${env.publicOrigin}/settings?account=error&reason=${encodeURIComponent(reason.slice(0, 200))}`
        );
      }
    }
  );
};
