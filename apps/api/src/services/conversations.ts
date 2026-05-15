import type { ConversationEntityType, Message, MessageKind } from '@prisma/client';
import { prisma } from '../prisma.js';

const USER_ALLOWED_KINDS: MessageKind[] = ['NOTE', 'QUESTION', 'INSTRUCTION'];

async function verifyEntity(
  userId: string,
  entityType: ConversationEntityType,
  entityId: string
): Promise<boolean> {
  if (entityType === 'TASK') {
    const t = await prisma.task.findFirst({ where: { id: entityId, userId } });
    return Boolean(t);
  }
  if (entityType === 'GOAL') {
    const g = await prisma.goal.findFirst({ where: { id: entityId, userId } });
    return Boolean(g);
  }
  return false;
}

async function getOrCreateConversation(
  userId: string,
  entityType: ConversationEntityType,
  entityId: string
): Promise<string> {
  const existing = await prisma.conversation.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
  });
  if (existing) return existing.id;
  const created = await prisma.conversation.create({
    data: { userId, entityType, entityId },
  });
  return created.id;
}

export async function listMessages(
  userId: string,
  entityType: ConversationEntityType,
  entityId: string
): Promise<Message[]> {
  if (!(await verifyEntity(userId, entityType, entityId))) {
    throw new Error('Entity not found');
  }
  const conv = await prisma.conversation.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
  });
  if (!conv) return [];
  return prisma.message.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: 'asc' },
  });
}

export async function postUserMessage(
  userId: string,
  entityType: ConversationEntityType,
  entityId: string,
  input: { kind: MessageKind; body: string }
): Promise<Message> {
  if (!USER_ALLOWED_KINDS.includes(input.kind)) {
    throw new Error(`Users may only post: ${USER_ALLOWED_KINDS.join(', ')}`);
  }
  if (!(await verifyEntity(userId, entityType, entityId))) {
    throw new Error('Entity not found');
  }
  const conversationId = await getOrCreateConversation(userId, entityType, entityId);
  const message = await prisma.message.create({
    data: {
      conversationId,
      kind: input.kind,
      body: input.body,
      authorType: 'USER',
      authorId: userId,
    },
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });
  return message;
}
