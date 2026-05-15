// BullMQ producer for the api side. Used to enqueue jobs the worker/agent
// containers consume. We only produce here — workers live in their own containers.

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from '../env.js';

const connection = new Redis(env.redisUrl, { maxRetriesPerRequest: null });

export const agentRunQueue = new Queue('agent-run', { connection });
