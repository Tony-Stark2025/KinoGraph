export type PlanKey = 'free' | 'pro' | 'team';

export interface PlanDefinition {
  key: PlanKey;
  name: string;
  monthlyPriceUsd: number;
  maxVideoSeconds: number;
  monthlyAnalyses: number;
  monthlyStylizations: number;
  monthlyExports: number;
  styleOptions: number;
  exportQuality: 'standard' | 'high' | 'premium';
  watermark: boolean;
}

export const HERO_USE_CASE = {
  segment: 'Content creators and social marketers',
  onboardingMessage:
    'Turn short campaign clips into stylized narrative assets you can publish, pitch, and repurpose fast.',
};

export const QUALITY_BAR = {
  supportedFormats: ['video/mp4', 'video/webm', 'video/quicktime'],
  targetProcessingSeconds: 90,
  outputConsistency:
    'Generated panels must preserve narrative continuity, maintain quote alignment with scene context, and return coherent style treatment across all panels.',
};

export const PLAN_DEFINITIONS: Record<PlanKey, PlanDefinition> = {
  free: {
    key: 'free',
    name: 'Free',
    monthlyPriceUsd: 0,
    maxVideoSeconds: 30,
    monthlyAnalyses: 10,
    monthlyStylizations: 60,
    monthlyExports: 3,
    styleOptions: 1,
    exportQuality: 'standard',
    watermark: true,
  },
  pro: {
    key: 'pro',
    name: 'Pro',
    monthlyPriceUsd: 29,
    maxVideoSeconds: 180,
    monthlyAnalyses: 120,
    monthlyStylizations: 800,
    monthlyExports: 100,
    styleOptions: 3,
    exportQuality: 'high',
    watermark: false,
  },
  team: {
    key: 'team',
    name: 'Team',
    monthlyPriceUsd: 99,
    maxVideoSeconds: 420,
    monthlyAnalyses: 600,
    monthlyStylizations: 4000,
    monthlyExports: 500,
    styleOptions: 6,
    exportQuality: 'premium',
    watermark: false,
  },
};

export const PLAN_ORDER: PlanKey[] = ['free', 'pro', 'team'];
