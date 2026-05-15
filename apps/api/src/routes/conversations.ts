import type { FastifyPluginAsync } from 'fastify';
import type { ConversationEntityType, MessageKind } from '@prisma/client';
import { listMessages, postUserMessage } from '../services/conversations.js';

const ENTITY_TYPES: Record<string, ConversationEntityType> = {
  task: 'TASK',
  goal: 'GOAL',
  event: 'EVENT',
};

const ALLOWED_USER_KINDS: MessageKind[] = ['NOTE', 'QUESTION', 'INSTRUCTION'];

export const conversationRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get<{ Params: { entity: string; entityId: string } }>(
    '/api/conversations/:entity/:entityId/messages',
    async (req, reply) => {
      const entityType = ENTITY_TYPES[req.params.entity];
      if (!entityType) return reply.badRequest('Unknown entity type');
      try {
        const messages = await listMessages(req.user.userId, entityType, req.params.entityId);
        return { messages };
      } catch {
        return reply.notFound();
      }
    }
  );

  app.post<{
    Params: { entity: string; entityId: string };
    Body: { kind: MessageKind; body: string };
  }>(
    '/api/conversations/:entity/:entityId/messages',
    {
      schema: {
        body: {
          type: 'object',
          required: ['kind', 'body'],
          properties: {
            kind: { type: 'string', enum: ALLOWED_USER_KINDS },
            body: { type: 'string', minLength: 1, maxLength: 10000 },
          },
        },
      },
    },
    async (req, reply) => {
      const entityType = ENTITY_TYPES[req.params.entity];
      if (!entityType) return reply.badRequest('Unknown entity type');
      try {
        const message = await postUserMessage(
          req.user.userId,
          entityType,
          req.params.entityId,
          req.body
        );
        return reply.code(201).send({ message });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Bad request';
        return reply.badRequest(msg);
      }
    }
  );
};
