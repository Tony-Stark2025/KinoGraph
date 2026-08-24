import crypto from 'crypto';
import express, {NextFunction, Request, Response} from 'express';
import {GoogleGenAI, Type} from '@google/genai';
import {createServer as createViteServer} from 'vite';
import {Resend} from 'resend';
import path from 'path';
import {
  HERO_USE_CASE,
  PLAN_DEFINITIONS,
  PLAN_ORDER,
  PlanDefinition,
  PlanKey,
  QUALITY_BAR,
} from './productConfig';

const PORT = Number(process.env.PORT || 3000);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ARTIFACT_TTL_MS = 15 * 60 * 1000;
const JOB_RETRY_COUNT = 2;

const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});

type JobType = 'analyze' | 'stylize';
type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

interface UsageCounters {
  analyses: number;
  stylizations: number;
  exports: number;
}

interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  salt: string;
  plan: PlanKey;
  createdAt: string;
  active: boolean;
  usageByMonth: Record<string, UsageCounters>;
}

interface JobRecord {
  id: string;
  type: JobType;
  userId: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  input: any;
  result?: any;
  error?: string;
}

interface ArtifactRecord {
  id: string;
  mimeType: string;
  base64Data: string;
  token: string;
  expiresAt: number;
  userId: string;
}

const usersByEmail = new Map<string, UserRecord>();
const usersById = new Map<string, UserRecord>();
const tokensToUserId = new Map<string, string>();
const jobs = new Map<string, JobRecord>();
const artifacts = new Map<string, ArtifactRecord>();
const idempotencyIndex = new Map<string, string>();
const jobQueue: string[] = [];
let isProcessingQueue = false;

const ipRateWindows = new Map<string, {count: number; windowStart: number}>();

let resendClient: Resend | null = null;

function getResend() {
  if (!resendClient) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error('RESEND_API_KEY environment variable is required to send emails.');
    }
    resendClient = new Resend(key);
  }
  return resendClient;
}

function getMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

function getUsage(user: UserRecord): UsageCounters {
  const month = getMonthKey();
  if (!user.usageByMonth[month]) {
    user.usageByMonth[month] = {analyses: 0, stylizations: 0, exports: 0};
  }
  return user.usageByMonth[month];
}

function hashPassword(password: string, salt: string) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, user: UserRecord) {
  const expected = Buffer.from(user.passwordHash, 'hex');
  const actual = Buffer.from(hashPassword(password, user.salt), 'hex');
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function issueToken(userId: string) {
  const token = crypto.randomBytes(32).toString('hex');
  tokensToUserId.set(token, userId);
  return token;
}

function pickPublicUser(user: UserRecord) {
  const usage = getUsage(user);
  return {
    id: user.id,
    email: user.email,
    plan: user.plan,
    active: user.active,
    usage,
    createdAt: user.createdAt,
  };
}

function getPlan(user: UserRecord): PlanDefinition {
  return PLAN_DEFINITIONS[user.plan];
}

function assertString(value: unknown, fieldName: string, min = 1, max = 10000): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max} characters`);
  }
  return trimmed;
}

function assertPlan(value: unknown): PlanKey {
  if (value !== 'free' && value !== 'pro' && value !== 'team') {
    throw new Error('Invalid plan');
  }
  return value;
}

function audit(event: string, payload: Record<string, unknown>) {
  console.log(`[AUDIT] ${event}`, JSON.stringify({...payload, timestamp: new Date().toISOString()}));
}

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 100;

  const current = ipRateWindows.get(ip);
  if (!current || now - current.windowStart > windowMs) {
    ipRateWindows.set(ip, {count: 1, windowStart: now});
    return next();
  }

  if (current.count >= maxRequests) {
    return res.status(429).json({error: 'Rate limit exceeded'});
  }

  current.count += 1;
  next();
}

interface AuthenticatedRequest extends Request {
  user?: UserRecord;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({error: 'Authentication required'});
  }

  const token = header.slice('Bearer '.length);
  const userId = tokensToUserId.get(token);
  if (!userId) {
    return res.status(401).json({error: 'Invalid token'});
  }

  const user = usersById.get(userId);
  if (!user || !user.active) {
    return res.status(401).json({error: 'User not active'});
  }

  req.user = user;
  next();
}

function checkEntitlement(user: UserRecord, action: keyof UsageCounters) {
  const usage = getUsage(user);
  const plan = getPlan(user);

  const limits: UsageCounters = {
    analyses: plan.monthlyAnalyses,
    stylizations: plan.monthlyStylizations,
    exports: plan.monthlyExports,
  };

  if (usage[action] >= limits[action]) {
    throw new Error(`Plan limit reached for ${action}. Upgrade plan to continue.`);
  }
}

function incrementUsage(user: UserRecord, action: keyof UsageCounters, amount = 1) {
  const usage = getUsage(user);
  usage[action] += amount;
}

function queueJob(job: JobRecord) {
  jobs.set(job.id, job);
  jobQueue.push(job.id);
  processQueue().catch((error) => {
    console.error('Queue processing error:', error);
  });
}

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  try {
    while (jobQueue.length > 0) {
      const jobId = jobQueue.shift();
      if (!jobId) continue;
      const job = jobs.get(jobId);
      if (!job || job.status !== 'queued') continue;

      job.status = 'processing';
      job.updatedAt = new Date().toISOString();

      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= job.maxAttempts; attempt++) {
        job.attempts = attempt;
        try {
          if (job.type === 'analyze') {
            const result = await analyzeVideoWithGemini(job.input.base64Video, job.input.mimeType);
            const owner = usersById.get(job.userId);
            if (!owner) throw new Error('Job owner missing');
            const limitedStyles = result.styles.slice(0, getPlan(owner).styleOptions);
            job.result = {...result, styles: limitedStyles};
            incrementUsage(owner, 'analyses', 1);
          }

          if (job.type === 'stylize') {
            const stylizedDataUrl = await stylizeFrameWithGemini(
              job.input.base64Image,
              job.input.stylePromptModifier,
            );
            const [, metadata, base64Data] = stylizedDataUrl.match(/^data:(.*?);base64,(.*)$/) || [];
            if (!metadata || !base64Data) {
              throw new Error('Invalid generated image output format');
            }
            const artifactId = crypto.randomUUID();
            const artifactToken = crypto.randomBytes(24).toString('hex');
            const expiresAt = Date.now() + ARTIFACT_TTL_MS;
            artifacts.set(artifactId, {
              id: artifactId,
              mimeType: metadata,
              base64Data,
              token: artifactToken,
              expiresAt,
              userId: job.userId,
            });
            const owner = usersById.get(job.userId);
            if (!owner) throw new Error('Job owner missing');
            incrementUsage(owner, 'stylizations', 1);
            job.result = {
              artifactId,
              signedUrl: `/api/artifacts/${artifactId}?token=${artifactToken}`,
              expiresAt,
            };
          }

          job.status = 'completed';
          job.updatedAt = new Date().toISOString();
          lastError = null;
          break;
        } catch (error) {
          lastError = error as Error;
          job.error = lastError.message;
          job.updatedAt = new Date().toISOString();
        }
      }

      if (lastError) {
        job.status = 'failed';
      }
    }
  } finally {
    isProcessingQueue = false;
  }
}

function cleanupArtifacts() {
  const now = Date.now();
  for (const [artifactId, artifact] of artifacts.entries()) {
    if (artifact.expiresAt < now) {
      artifacts.delete(artifactId);
    }
  }
}

setInterval(cleanupArtifacts, 60 * 1000).unref();

async function analyzeVideoWithGemini(base64Video: string, mimeType: string) {
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: [
      {
        inlineData: {
          data: base64Video,
          mimeType,
        },
      },
      `You are a master storyboard director and editor. Watch this video and extract the core narrative beats to adapt it into a graphic novel.

      CRITICAL GUARDRAILS:
      1. DURATION: Extract between 2 to 6 beats depending on the video length.
      2. TIMESTAMPS: Provide precise timestamps with decimals.
      3. QUOTES & AUDIO: If there is speech, extract an impactful quote; otherwise provide dramatic narration.
      4. STATIC VISUALS: If visuals are static, infer dynamic cinematic framing from emotional context.
      5. SPLIT-SCREENS: Focus visual description entirely on the primary human subject.

      Additionally, suggest 3 distinct visual styles and a contextual graphic novel title.`,
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: {type: Type.STRING},
          beats: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                timestamp: {type: Type.NUMBER},
                quote: {type: Type.STRING},
                description: {type: Type.STRING},
              },
              required: ['timestamp', 'quote', 'description'],
            },
          },
          styles: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: {type: Type.STRING},
                description: {type: Type.STRING},
                promptModifier: {type: Type.STRING},
              },
              required: ['name', 'description', 'promptModifier'],
            },
          },
        },
        required: ['title', 'beats', 'styles'],
      },
    },
  });

  if (!response.text) {
    throw new Error('Failed to analyze video. Empty response from Gemini.');
  }

  return JSON.parse(response.text);
}

async function stylizeFrameWithGemini(base64Image: string, stylePromptModifier: string): Promise<string> {
  const cleanBase64 = base64Image.includes(',') ? base64Image.split(',')[1] : base64Image;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: {
      parts: [
        {
          inlineData: {
            data: cleanBase64,
            mimeType: 'image/jpeg',
          },
        },
        {
          text: `Redraw this image as a high-quality graphic novel panel using this style heavily: ${stylePromptModifier}.
          Remove text/watermarks/UI overlays and preserve narrative subject focus.`,
        },
      ],
    },
  });

  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error('No image returned from Gemini');

  for (const part of parts) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }

  throw new Error('No image data found in Gemini response.');
}

async function startServer() {
  const app = express();
  app.use(express.json({limit: '25mb'}));
  app.use(rateLimit);

  app.get('/api/product/config', (_req, res) => {
    res.json({
      heroUseCase: HERO_USE_CASE,
      qualityBar: QUALITY_BAR,
      planOrder: PLAN_ORDER,
      plans: PLAN_DEFINITIONS,
    });
  });

  app.post('/api/auth/register', (req, res) => {
    try {
      const email = assertString(req.body?.email, 'email', 5, 120).toLowerCase();
      const password = assertString(req.body?.password, 'password', 8, 120);
      const requestedPlan = req.body?.plan ? assertPlan(req.body.plan) : 'free';

      if (usersByEmail.has(email)) {
        return res.status(409).json({error: 'Email already registered'});
      }

      const salt = crypto.randomBytes(16).toString('hex');
      const user: UserRecord = {
        id: crypto.randomUUID(),
        email,
        passwordHash: hashPassword(password, salt),
        salt,
        plan: requestedPlan,
        createdAt: new Date().toISOString(),
        active: true,
        usageByMonth: {},
      };

      usersByEmail.set(email, user);
      usersById.set(user.id, user);

      const token = issueToken(user.id);
      audit('user.registered', {userId: user.id, email: user.email, plan: user.plan});
      return res.status(201).json({token, user: pickPublicUser(user)});
    } catch (error) {
      return res.status(400).json({error: (error as Error).message});
    }
  });

  app.post('/api/auth/login', (req, res) => {
    try {
      const email = assertString(req.body?.email, 'email', 5, 120).toLowerCase();
      const password = assertString(req.body?.password, 'password', 8, 120);
      const user = usersByEmail.get(email);

      if (!user || !verifyPassword(password, user)) {
        return res.status(401).json({error: 'Invalid credentials'});
      }

      const token = issueToken(user.id);
      audit('user.logged_in', {userId: user.id, email: user.email});
      return res.json({token, user: pickPublicUser(user)});
    } catch (error) {
      return res.status(400).json({error: (error as Error).message});
    }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({user: pickPublicUser(req.user!)});
  });

  app.get('/api/billing/usage', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const usage = getUsage(user);
    const plan = getPlan(user);
    res.json({
      usage,
      limits: {
        analyses: plan.monthlyAnalyses,
        stylizations: plan.monthlyStylizations,
        exports: plan.monthlyExports,
      },
      plan,
      month: getMonthKey(),
    });
  });

  app.get('/api/billing/invoices', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const plan = getPlan(user);
    const month = getMonthKey();
    res.json({
      invoices: [
        {
          id: `${user.id}-${month}`,
          month,
          plan: plan.name,
          amountUsd: plan.monthlyPriceUsd,
          status: 'paid',
        },
      ],
    });
  });

  app.post('/api/billing/subscribe', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      const plan = assertPlan(req.body?.plan);
      user.plan = plan;
      audit('billing.plan_updated', {userId: user.id, plan});
      res.json({user: pickPublicUser(user), plan: PLAN_DEFINITIONS[plan]});
    } catch (error) {
      res.status(400).json({error: (error as Error).message});
    }
  });

  app.post('/api/billing/cancel', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    user.plan = 'free';
    audit('billing.cancelled', {userId: user.id});
    res.json({user: pickPublicUser(user), plan: PLAN_DEFINITIONS.free});
  });

  app.post('/api/jobs/analyze', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      checkEntitlement(user, 'analyses');

      const base64Video = assertString(req.body?.base64Video, 'base64Video', 100, 40_000_000);
      const mimeType = assertString(req.body?.mimeType, 'mimeType', 5, 120);
      const fileSizeBytes = Number(req.body?.fileSizeBytes || 0);
      const durationSeconds = Number(req.body?.durationSeconds || 0);
      const idempotencyKey = req.header('Idempotency-Key')?.trim();

      if (!QUALITY_BAR.supportedFormats.includes(mimeType)) {
        return res.status(400).json({error: `Unsupported format. Allowed: ${QUALITY_BAR.supportedFormats.join(', ')}`});
      }

      if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0 || fileSizeBytes > MAX_FILE_SIZE_BYTES) {
        return res.status(400).json({error: `Invalid file size. Maximum is ${MAX_FILE_SIZE_BYTES} bytes.`});
      }

      if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return res.status(400).json({error: 'Invalid durationSeconds.'});
      }

      const plan = getPlan(user);
      if (durationSeconds > plan.maxVideoSeconds) {
        return res.status(403).json({
          error: `Your ${plan.name} plan supports videos up to ${plan.maxVideoSeconds} seconds.`,
        });
      }

      if (idempotencyKey) {
        const existingJobId = idempotencyIndex.get(`${user.id}:analyze:${idempotencyKey}`);
        if (existingJobId) {
          const existingJob = jobs.get(existingJobId);
          if (existingJob) {
            return res.json({jobId: existingJob.id, status: existingJob.status, reused: true});
          }
        }
      }

      const job: JobRecord = {
        id: crypto.randomUUID(),
        type: 'analyze',
        userId: user.id,
        status: 'queued',
        attempts: 0,
        maxAttempts: JOB_RETRY_COUNT,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        input: {base64Video, mimeType},
      };

      if (idempotencyKey) {
        idempotencyIndex.set(`${user.id}:analyze:${idempotencyKey}`, job.id);
      }

      queueJob(job);
      audit('job.enqueued', {jobId: job.id, type: job.type, userId: user.id});
      res.status(202).json({jobId: job.id, status: job.status});
    } catch (error) {
      res.status(400).json({error: (error as Error).message});
    }
  });

  app.post('/api/jobs/stylize', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      checkEntitlement(user, 'stylizations');

      const base64Image = assertString(req.body?.base64Image, 'base64Image', 100, 15_000_000);
      const stylePromptModifier = assertString(req.body?.stylePromptModifier, 'stylePromptModifier', 4, 2000);
      const idempotencyKey = req.header('Idempotency-Key')?.trim();

      if (idempotencyKey) {
        const existingJobId = idempotencyIndex.get(`${user.id}:stylize:${idempotencyKey}`);
        if (existingJobId) {
          const existingJob = jobs.get(existingJobId);
          if (existingJob) {
            return res.json({jobId: existingJob.id, status: existingJob.status, reused: true});
          }
        }
      }

      const job: JobRecord = {
        id: crypto.randomUUID(),
        type: 'stylize',
        userId: user.id,
        status: 'queued',
        attempts: 0,
        maxAttempts: JOB_RETRY_COUNT,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        input: {base64Image, stylePromptModifier},
      };

      if (idempotencyKey) {
        idempotencyIndex.set(`${user.id}:stylize:${idempotencyKey}`, job.id);
      }

      queueJob(job);
      audit('job.enqueued', {jobId: job.id, type: job.type, userId: user.id});
      res.status(202).json({jobId: job.id, status: job.status});
    } catch (error) {
      res.status(400).json({error: (error as Error).message});
    }
  });

  app.get('/api/jobs/:jobId', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const job = jobs.get(req.params.jobId);
    if (!job || job.userId !== user.id) {
      return res.status(404).json({error: 'Job not found'});
    }
    return res.json(job);
  });

  app.get('/api/projects', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const completedJobs = [...jobs.values()]
      .filter((job) => job.userId === user.id && job.type === 'analyze' && job.status === 'completed')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map((job) => ({
        id: job.id,
        createdAt: job.createdAt,
        title: job.result?.title || 'Untitled project',
        beats: Array.isArray(job.result?.beats) ? job.result.beats.length : 0,
      }));

    res.json({projects: completedJobs});
  });

  app.post('/api/exports/consume', requireAuth, (req: AuthenticatedRequest, res) => {
    try {
      const user = req.user!;
      checkEntitlement(user, 'exports');

      const panelCount = Number(req.body?.panelCount ?? 0);
      if (!Number.isFinite(panelCount) || panelCount <= 0) {
        return res.status(400).json({error: 'panelCount must be a positive number'});
      }

      incrementUsage(user, 'exports', 1);
      const plan = getPlan(user);
      audit('export.generated', {userId: user.id, panelCount, plan: plan.key});

      res.json({
        ok: true,
        exportQuality: plan.exportQuality,
        watermark: plan.watermark,
      });
    } catch (error) {
      res.status(403).json({error: (error as Error).message});
    }
  });

  app.get('/api/artifacts/:artifactId', (req, res) => {
    const artifact = artifacts.get(req.params.artifactId);
    if (!artifact) {
      return res.status(404).json({error: 'Artifact not found'});
    }

    const token = req.query.token;
    if (typeof token !== 'string' || token !== artifact.token) {
      return res.status(403).json({error: 'Invalid artifact token'});
    }

    if (Date.now() > artifact.expiresAt) {
      artifacts.delete(req.params.artifactId);
      return res.status(410).json({error: 'Artifact URL expired'});
    }

    const imageBuffer = Buffer.from(artifact.base64Data, 'base64');
    res.setHeader('Content-Type', artifact.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.send(imageBuffer);
  });

  app.post('/api/feedback', requireAuth, async (req: AuthenticatedRequest, res) => {
    try {
      const feedback = assertString(req.body?.feedback, 'feedback', 5, 5000);
      const resend = getResend();
      const toEmail = process.env.FEEDBACK_EMAIL_TO || 'support@kinograph.app';
      const user = req.user!;

      const data = await resend.emails.send({
        from: 'KinoGraph Feedback <onboarding@resend.dev>',
        to: [toEmail],
        subject: `New Feedback from ${user.email}`,
        text: feedback,
      });

      audit('feedback.submitted', {userId: user.id, email: user.email});
      res.json({success: true, data});
    } catch (error) {
      console.error('Feedback error:', error);
      res.status(500).json({error: (error as Error).message || 'Failed to send feedback'});
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Fatal server startup error:', error);
  process.exit(1);
});
