export interface StoryBeat {
  timestamp: number;
  quote: string;
  description: string;
}

export interface VideoAnalysis {
  title: string;
  beats: StoryBeat[];
  styles: {name: string; description: string; promptModifier: string}[];
}

export function analyzeVideo(): never {
  throw new Error('analyzeVideo is now server-side only. Use /api/jobs/analyze.');
}

export function stylizeFrame(): never {
  throw new Error('stylizeFrame is now server-side only. Use /api/jobs/stylize.');
}
