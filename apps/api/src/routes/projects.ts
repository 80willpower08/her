// Project CRUD + import + chat-anchor support.
//
// Projects are long-running narrative containers (VA claim, custody case, etc).
// Body is markdown the agent reads/writes; observations + tasks + goals can
// attach via their own categoryId / relatedFields.

import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../prisma.js';
import { agentRunQueue } from '../lib/queue.js';
import { saveAndExtract } from '../services/attachments.js';

const STATUSES = ['ACTIVE', 'PAUSED', 'COMPLETE', 'ARCHIVED'] as const;
type Status = (typeof STATUSES)[number];

const CreateSchema = {
  type: 'object',
  required: ['title'],
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: ['string', 'null'], maxLength: 1000 },
    body: { type: 'string', maxLength: 2_000_000 }, // ~500K tokens worth — handles long doc dumps
    status: { type: 'string', enum: STATUSES as unknown as string[] },
    primaryCategoryId: { type: ['string', 'null'] },
    secondaryCategoryIds: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    nextActionAt: { type: ['string', 'null'] },
    nextActionNote: { type: ['string', 'null'], maxLength: 500 },
    alwaysInContext: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

const PatchSchema = {
  type: 'object',
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: ['string', 'null'], maxLength: 1000 },
    body: { type: 'string', maxLength: 2_000_000 },
    status: { type: 'string', enum: STATUSES as unknown as string[] },
    primaryCategoryId: { type: ['string', 'null'] },
    secondaryCategoryIds: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    nextActionAt: { type: ['string', 'null'] },
    nextActionNote: { type: ['string', 'null'], maxLength: 500 },
    alwaysInContext: { type: 'boolean' },
    archived: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

const ImportSchema = {
  type: 'object',
  required: ['rawContent'],
  properties: {
    rawContent: { type: 'string', minLength: 50, maxLength: 2_000_000 },
    titleHint: { type: ['string', 'null'], maxLength: 200 },
    categoryId: { type: ['string', 'null'] },
    secondaryCategoryIds: { type: 'array', items: { type: 'string' }, maxItems: 10 },
  },
  additionalProperties: false,
} as const;

export const projectRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  // List — defaults to non-archived. ?includeArchived=true to widen.
  app.get<{ Querystring: { includeArchived?: string; status?: string } }>(
    '/api/projects',
    async (req) => {
      const includeArchived = req.query.includeArchived === 'true';
      const statusFilter = req.query.status && STATUSES.includes(req.query.status as Status)
        ? (req.query.status as Status)
        : undefined;
      const projects = await prisma.project.findMany({
        where: {
          userId: req.user.userId,
          ...(includeArchived ? {} : { archived: false }),
          ...(statusFilter ? { status: statusFilter } : {}),
        },
        orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      });
      return { projects };
    }
  );

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!project) return reply.notFound();
    return { project };
  });

  app.post<{
    Body: {
      title: string;
      description?: string | null;
      body?: string;
      status?: Status;
      primaryCategoryId?: string | null;
      secondaryCategoryIds?: string[];
      nextActionAt?: string | null;
      nextActionNote?: string | null;
      alwaysInContext?: boolean;
    };
  }>('/api/projects', { schema: { body: CreateSchema } }, async (req, reply) => {
    if (req.body.primaryCategoryId) {
      const cat = await prisma.category.findFirst({
        where: { id: req.body.primaryCategoryId, userId: req.user.userId },
      });
      if (!cat) return reply.badRequest('Unknown primaryCategoryId');
    }
    if (req.body.secondaryCategoryIds?.length) {
      const found = await prisma.category.count({
        where: { id: { in: req.body.secondaryCategoryIds }, userId: req.user.userId },
      });
      if (found !== req.body.secondaryCategoryIds.length) {
        return reply.badRequest('One or more secondaryCategoryIds are unknown');
      }
    }
    const project = await prisma.project.create({
      data: {
        userId: req.user.userId,
        title: req.body.title,
        description: req.body.description ?? null,
        body: req.body.body ?? '',
        status: req.body.status ?? 'ACTIVE',
        primaryCategoryId: req.body.primaryCategoryId ?? null,
        secondaryCategoryIds: req.body.secondaryCategoryIds ?? [],
        nextActionAt: req.body.nextActionAt ? new Date(req.body.nextActionAt) : null,
        nextActionNote: req.body.nextActionNote ?? null,
        alwaysInContext: req.body.alwaysInContext ?? false,
      },
    });
    return { project };
  });

  app.patch<{
    Params: { id: string };
    Body: Record<string, unknown>;
  }>('/api/projects/:id', { schema: { body: PatchSchema } }, async (req, reply) => {
    const existing = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!existing) return reply.notFound();
    const b = req.body as {
      title?: string;
      description?: string | null;
      body?: string;
      status?: Status;
      primaryCategoryId?: string | null;
      secondaryCategoryIds?: string[];
      nextActionAt?: string | null;
      nextActionNote?: string | null;
      alwaysInContext?: boolean;
      archived?: boolean;
    };
    if (b.primaryCategoryId) {
      const cat = await prisma.category.findFirst({
        where: { id: b.primaryCategoryId, userId: req.user.userId },
      });
      if (!cat) return reply.badRequest('Unknown primaryCategoryId');
    }
    if (b.secondaryCategoryIds?.length) {
      const found = await prisma.category.count({
        where: { id: { in: b.secondaryCategoryIds }, userId: req.user.userId },
      });
      if (found !== b.secondaryCategoryIds.length) {
        return reply.badRequest('One or more secondaryCategoryIds are unknown');
      }
    }
    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: {
        title: b.title,
        description: b.description === undefined ? undefined : b.description,
        body: b.body,
        status: b.status,
        primaryCategoryId:
          b.primaryCategoryId === undefined ? undefined : b.primaryCategoryId,
        secondaryCategoryIds: b.secondaryCategoryIds,
        nextActionAt:
          b.nextActionAt === undefined
            ? undefined
            : b.nextActionAt
              ? new Date(b.nextActionAt)
              : null,
        nextActionNote: b.nextActionNote === undefined ? undefined : b.nextActionNote,
        alwaysInContext: b.alwaysInContext,
        archived: b.archived,
      },
    });
    return { project };
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const existing = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!existing) return reply.notFound();
    await prisma.project.delete({ where: { id: req.params.id } });
    return { ok: true };
  });

  // Paste-and-process import: create a draft Project from raw content, then
  // enqueue an agent job that extracts observations + tasks and proposes a
  // cleaned body. Returns the draft project; UI polls it (status='PAUSED'
  // while processing, flips to ACTIVE when done; agent writes via MCP tools).
  app.post<{
    Body: {
      rawContent: string;
      titleHint?: string | null;
      categoryId?: string | null;
      secondaryCategoryIds?: string[];
    };
  }>('/api/projects/import', { schema: { body: ImportSchema } }, async (req, reply) => {
    if (req.body.categoryId) {
      const cat = await prisma.category.findFirst({
        where: { id: req.body.categoryId, userId: req.user.userId },
      });
      if (!cat) return reply.badRequest('Unknown categoryId');
    }
    if (req.body.secondaryCategoryIds?.length) {
      const found = await prisma.category.count({
        where: { id: { in: req.body.secondaryCategoryIds }, userId: req.user.userId },
      });
      if (found !== req.body.secondaryCategoryIds.length) {
        return reply.badRequest('One or more secondaryCategoryIds are unknown');
      }
    }

    const title = req.body.titleHint?.trim() || 'Imported content (processing…)';
    const project = await prisma.project.create({
      data: {
        userId: req.user.userId,
        title,
        description: 'Agent is processing the imported content. Refresh in a minute or two.',
        body: req.body.rawContent,
        status: 'PAUSED', // PAUSED = "draft, agent processing"
        primaryCategoryId: req.body.categoryId ?? null,
        secondaryCategoryIds: req.body.secondaryCategoryIds ?? [],
        alwaysInContext: false,
      },
    });

    // Create a chat thread anchored to this project, post a kickoff message,
    // enqueue a CHAT job. The chat skill knows how to handle the "import"
    // trigger by reading body and proposing extractions.
    const thread = await prisma.chatThread.create({
      data: {
        userId: req.user.userId,
        anchorType: 'project',
        anchorId: project.id,
        title: `Import: ${title}`,
      },
    });
    const userMessage = await prisma.chatMessage.create({
      data: {
        threadId: thread.id,
        role: 'USER',
        body: [
          '**IMPORT MODE**',
          '',
          'I just pasted external content into a new project. Read the project body — that is the raw paste. Do all of the following:',
          '',
          '1. Propose a cleaner Project title (call `update_project_body` to refine the body and `propose_update_project` to suggest title/description/category if appropriate).',
          '2. Extract Observations using `record_observation` — FACTs about the situation, PREFERENCEs the user has stated, COMMITMENTs they made.',
          '3. Extract concrete next steps as Tasks using `propose_create_task` with `categoryId` matching this project where applicable.',
          '4. If you find a long-running goal, use `propose_create_goal`.',
          '5. Replace the raw paste body with a structured markdown summary using `update_project_body` — keep the original facts but drop conversational filler.',
          '6. Reply with a short summary of what you did.',
        ].join('\n'),
      },
    });
    const job = await agentRunQueue.add(
      'chat',
      {
        userId: req.user.userId,
        kind: 'CHAT',
        trigger: `project-import:${project.id}`,
        chatThreadId: thread.id,
        userMessageId: userMessage.id,
      },
      { removeOnComplete: 50, removeOnFail: 50 }
    );

    return { project, thread, jobId: job.id };
  });

  // Multipart import: drag-and-drop files + optional pasted text. Each file
  // is saved as a ProjectAttachment with extracted text; everything is
  // concatenated into rawContent and fed through the same import flow.
  app.post('/api/projects/import-files', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.badRequest('Must be multipart/form-data');
    }

    let titleHint = '';
    let categoryId: string | null = null;
    let secondaryCategoryIds: string[] = [];
    let pastedText = '';
    const files: Array<{ fileName: string; contentType: string; buffer: Buffer }> = [];

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        const buf = await part.toBuffer();
        files.push({
          fileName: part.filename,
          contentType: part.mimetype,
          buffer: buf,
        });
      } else {
        // form field
        const value = String(part.value ?? '');
        if (part.fieldname === 'titleHint') titleHint = value;
        else if (part.fieldname === 'categoryId') categoryId = value || null;
        else if (part.fieldname === 'secondaryCategoryIds') {
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) secondaryCategoryIds = parsed.map(String);
          } catch {
            // ignore malformed
          }
        } else if (part.fieldname === 'pastedText') pastedText = value;
      }
    }

    if (files.length === 0 && pastedText.trim().length < 50) {
      return reply.badRequest('Need at least one file or 50+ chars of pasted text');
    }
    if (categoryId) {
      const cat = await prisma.category.findFirst({
        where: { id: categoryId, userId: req.user.userId },
      });
      if (!cat) return reply.badRequest('Unknown categoryId');
    }
    if (secondaryCategoryIds.length) {
      const found = await prisma.category.count({
        where: { id: { in: secondaryCategoryIds }, userId: req.user.userId },
      });
      if (found !== secondaryCategoryIds.length) {
        return reply.badRequest('One or more secondaryCategoryIds are unknown');
      }
    }

    // Create the project shell first so we have an id to attach files to.
    const project = await prisma.project.create({
      data: {
        userId: req.user.userId,
        title: titleHint.trim() || 'Imported content (processing…)',
        description: 'Agent is processing the imported content. Refresh in a minute or two.',
        body: '',
        status: 'PAUSED',
        primaryCategoryId: categoryId,
        secondaryCategoryIds,
        alwaysInContext: false,
      },
    });

    // Save + extract each file; record as attachment.
    const attachmentParts: string[] = [];
    for (const f of files) {
      const result = await saveAndExtract({
        projectId: project.id,
        userId: req.user.userId,
        fileName: f.fileName,
        contentType: f.contentType,
        buffer: f.buffer,
      });
      await prisma.projectAttachment.create({
        data: {
          projectId: project.id,
          userId: req.user.userId,
          fileName: f.fileName,
          contentType: f.contentType,
          fileSize: f.buffer.length,
          storagePath: result.storagePath,
          extractedText: result.extractedText,
          extractionError: result.extractionError,
        },
      });
      if (result.extractedText) {
        attachmentParts.push(
          `# Attachment: ${f.fileName}\n\n${result.extractedText.trim()}\n`
        );
      } else if (result.extractionError) {
        attachmentParts.push(
          `# Attachment: ${f.fileName}\n\n_(extraction failed: ${result.extractionError})_\n`
        );
      } else {
        attachmentParts.push(
          `# Attachment: ${f.fileName}\n\n_(file saved; no text extracted — format not supported)_\n`
        );
      }
    }

    // Compose the rawContent — files first (with headers), then any pasted text.
    const sections: string[] = [];
    if (attachmentParts.length > 0) sections.push(attachmentParts.join('\n---\n\n'));
    if (pastedText.trim().length > 0) {
      sections.push(`# Pasted text\n\n${pastedText.trim()}`);
    }
    const rawContent = sections.join('\n\n---\n\n');

    // Stuff into project body so the agent reads it through the same path
    // as the JSON import flow.
    await prisma.project.update({
      where: { id: project.id },
      data: { body: rawContent },
    });

    // Kick off the agent with IMPORT MODE.
    const thread = await prisma.chatThread.create({
      data: {
        userId: req.user.userId,
        anchorType: 'project',
        anchorId: project.id,
        title: `Import: ${titleHint || project.title}`,
      },
    });
    const userMessage = await prisma.chatMessage.create({
      data: {
        threadId: thread.id,
        role: 'USER',
        body: [
          '**IMPORT MODE**',
          '',
          `I uploaded ${files.length} file${files.length === 1 ? '' : 's'}${pastedText ? ' plus pasted text' : ''}. The project body has been pre-populated with extracted text from each (under "# Attachment: <filename>" headings). Original files are saved as ProjectAttachments — they remain accessible.`,
          '',
          'Do all of the following:',
          '',
          '1. Read the project body to understand what was uploaded.',
          '2. Propose a cleaner Project title via `propose_update_project` if appropriate (don\'t bother if the user gave a good titleHint).',
          '3. Extract Observations using `record_observation` — FACTs, PREFERENCEs, COMMITMENTs.',
          '4. Extract concrete next steps as Tasks via `propose_create_task` with this project\'s categoryId.',
          '5. Replace the raw body with a structured markdown summary using `update_project_body` mode=replace. Keep facts, drop conversational filler. Use headings like `## Background`, `## Current status`, `## History`, `## Open questions`. **Reference attachments by filename** when relevant.',
          '6. Call `propose_update_project` to set `alwaysInContext: true` if this is a major life situation.',
          '7. Reply with a short summary.',
        ].join('\n'),
      },
    });
    const job = await agentRunQueue.add(
      'chat',
      {
        userId: req.user.userId,
        kind: 'CHAT',
        trigger: `project-import:${project.id}`,
        chatThreadId: thread.id,
        userMessageId: userMessage.id,
      },
      { removeOnComplete: 50, removeOnFail: 50 }
    );

    return { project, thread, jobId: job.id, attachmentCount: files.length };
  });

  // List attachments for a project.
  app.get<{ Params: { id: string } }>('/api/projects/:id/attachments', async (req, reply) => {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (!project) return reply.notFound();
    const attachments = await prisma.projectAttachment.findMany({
      where: { projectId: req.params.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        fileSize: true,
        extractedText: true,
        extractionError: true,
        createdAt: true,
      },
    });
    return { attachments };
  });

  // Delete an attachment.
  app.delete<{ Params: { id: string; attachmentId: string } }>(
    '/api/projects/:id/attachments/:attachmentId',
    async (req, reply) => {
      const att = await prisma.projectAttachment.findFirst({
        where: {
          id: req.params.attachmentId,
          projectId: req.params.id,
          userId: req.user.userId,
        },
      });
      if (!att) return reply.notFound();
      // Best-effort filesystem cleanup.
      try {
        const { unlink } = await import('node:fs/promises');
        const { join } = await import('node:path');
        const { env } = await import('../env.js');
        await unlink(join(env.attachmentsDir, att.storagePath));
      } catch {
        // ignore
      }
      await prisma.projectAttachment.delete({ where: { id: att.id } });
      return { ok: true };
    }
  );
};
