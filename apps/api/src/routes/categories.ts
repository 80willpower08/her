import type { FastifyPluginAsync } from 'fastify';
import { createCategory, listCategories, updateCategory } from '../services/categories.js';

export const categoryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  app.get('/api/categories', async (req) => {
    const categories = await listCategories(req.user.userId);
    return { categories };
  });

  app.post(
    '/api/categories',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
            icon: { type: ['string', 'null'] },
            weight: { type: 'integer', minimum: 1, maximum: 10 },
          },
          additionalProperties: false,
        },
      },
    },
    async (req: any) => {
      const category = await createCategory(req.user.userId, req.body);
      return { category };
    }
  );

  app.patch<{ Params: { id: string } }>(
    '/api/categories/:id',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 100 },
            color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
            icon: { type: ['string', 'null'] },
            weight: { type: 'integer', minimum: 1, maximum: 10 },
            sortOrder: { type: 'integer' },
            archived: { type: 'boolean' },
          },
          additionalProperties: false,
        },
      },
    },
    async (req: any, reply) => {
      try {
        const category = await updateCategory(req.user.userId, req.params.id, req.body);
        if (!category) return reply.notFound();
        return { category };
      } catch (err) {
        return reply.badRequest(err instanceof Error ? err.message : 'Bad request');
      }
    }
  );
};
