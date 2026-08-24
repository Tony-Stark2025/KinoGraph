import {FormEvent, useEffect, useMemo, useState} from 'react';
import {Download, Loader2, Sparkles, Upload} from 'lucide-react';
import {extractFrame, fileToBase64} from './lib/video';
import {generateGraphicNovelPDF, Panel} from './lib/pdf';
import {PlanDefinition, PlanKey} from '../productConfig';

interface StoryBeat {
  timestamp: number;
  quote: string;
  description: string;
}

interface VideoAnalysis {
  title: string;
  beats: StoryBeat[];
  styles: {name: string; description: string; promptModifier: string}[];
}

interface ProductConfigResponse {
  heroUseCase: {segment: string; onboardingMessage: string};
  qualityBar: {
    supportedFormats: string[];
    targetProcessingSeconds: number;
    outputConsistency: string;
  };
  planOrder: PlanKey[];
  plans: Record<PlanKey, PlanDefinition>;
}

interface BillingUsageResponse {
  usage: {analyses: number; stylizations: number; exports: number};
  limits: {analyses: number; stylizations: number; exports: number};
  plan: PlanDefinition;
  month: string;
}

type AppState = 'IDLE' | 'ANALYZING' | 'STYLE_SELECTION' | 'GENERATING' | 'COMPLETE';

export default function App() {
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<{email: string; plan: PlanKey} | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');

  const [productConfig, setProductConfig] = useState<ProductConfigResponse | null>(null);
  const [usageData, setUsageData] = useState<BillingUsageResponse | null>(null);

  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<VideoAnalysis['styles'][0] | null>(null);
  const [generatedPanels, setGeneratedPanels] = useState<Panel[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);

  const selectedPlan = useMemo(() => {
    if (!user || !productConfig) return null;
    return productConfig.plans[user.plan];
  }, [productConfig, user]);

  const authHeaders = useMemo(() => {
    return token ? {Authorization: 'Bearer ' + token} : {};
  }, [token]);

  async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
        ...(init?.headers || {}),
      },
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || `Request failed: ${response.status}`);
    }
    return body as T;
  }

  async function refreshUsage() {
    if (!token) return;
    const usage = await apiJson<BillingUsageResponse>('/api/billing/usage');
    setUsageData(usage);
  }

  useEffect(() => {
    apiJson<ProductConfigResponse>('/api/product/config')
      .then(setProductConfig)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    refreshUsage().catch((err) => setError(err.message));
  }, [token]);

  async function handleAuthSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    try {
      const endpoint = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const payload: Record<string, unknown> = {
        email: authEmail,
        password: authPassword,
      };
      if (authMode === 'register') {
        payload.plan = 'free';
      }
      const result = await apiJson<{token: string; user: {email: string; plan: PlanKey}}>(endpoint, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setToken(result.token);
      setUser(result.user);
      setAuthPassword('');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function changePlan(plan: PlanKey) {
    try {
      const result = await apiJson<{user: {email: string; plan: PlanKey}}>('/api/billing/subscribe', {
        method: 'POST',
        body: JSON.stringify({plan}),
      });
      setUser(result.user);
      await refreshUsage();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function pollJob(jobId: string): Promise<any> {
    for (let i = 0; i < 120; i++) {
      const job = await apiJson<any>(`/api/jobs/${jobId}`);
      if (job.status === 'completed') return job;
      if (job.status === 'failed') {
        throw new Error(job.error || 'Job failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('Job timed out');
  }

  async function downloadImageAsDataUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Failed to fetch generated artifact');
    }
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function handleFileUpload(file: File) {
    setError(null);

    if (!token || !productConfig || !selectedPlan) {
      setError('Sign in first to use generation.');
      return;
    }

    if (!productConfig.qualityBar.supportedFormats.includes(file.type)) {
      setError(`Unsupported format. Use: ${productConfig.qualityBar.supportedFormats.join(', ')}`);
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      setError('File exceeds 20MB upload limit.');
      return;
    }

    const durationSeconds = await new Promise<number>((resolve, reject) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      video.src = url;
      video.onloadedmetadata = () => {
        URL.revokeObjectURL(url);
        resolve(video.duration);
      };
      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Unable to read uploaded video metadata.'));
      };
    });

    if (durationSeconds > selectedPlan.maxVideoSeconds) {
      setError(
        `Your ${selectedPlan.name} plan supports up to ${selectedPlan.maxVideoSeconds}s. Uploaded: ${durationSeconds.toFixed(1)}s.`,
      );
      return;
    }

    setVideoFile(file);
    setAppState('ANALYZING');
    setStatus('Analyzing video...');

    try {
      const base64Video = await fileToBase64(file);
      const {jobId} = await apiJson<{jobId: string}>('/api/jobs/analyze', {
        method: 'POST',
        body: JSON.stringify({
          base64Video,
          mimeType: file.type,
          fileSizeBytes: file.size,
          durationSeconds,
        }),
        headers: {
          'Idempotency-Key': `analyze-${file.name}-${file.size}`,
        },
      });

      const job = await pollJob(jobId);
      setAnalysis(job.result as VideoAnalysis);
      setAppState('STYLE_SELECTION');
      setStatus('Analysis complete. Choose style.');
      await refreshUsage();
    } catch (err) {
      setError((err as Error).message);
      setAppState('IDLE');
      setStatus('');
    }
  }

  async function generatePanels(style: VideoAnalysis['styles'][0]) {
    if (!videoFile || !analysis) return;

    setSelectedStyle(style);
    setAppState('GENERATING');
    setGeneratedPanels([]);

    try {
      const panels: Panel[] = [];

      for (let i = 0; i < analysis.beats.length; i++) {
        const beat = analysis.beats[i];
        setStatus(`Generating panel ${i + 1}/${analysis.beats.length}...`);

        const rawFrameBase64 = await extractFrame(videoFile, beat.timestamp);
        const {jobId} = await apiJson<{jobId: string}>('/api/jobs/stylize', {
          method: 'POST',
          body: JSON.stringify({
            base64Image: rawFrameBase64,
            stylePromptModifier: style.promptModifier,
          }),
          headers: {
            'Idempotency-Key': `stylize-${analysis.title}-${i}-${style.name}`,
          },
        });

        const job = await pollJob(jobId);
        const dataUrl = await downloadImageAsDataUrl(job.result.signedUrl);

        panels.push({image: dataUrl, quote: beat.quote});
        setGeneratedPanels([...panels]);
      }

      await refreshUsage();
      setStatus('Panels generated. Ready to export.');
      setAppState('COMPLETE');
    } catch (err) {
      setError((err as Error).message);
      setAppState('STYLE_SELECTION');
      setStatus('');
    }
  }

  async function exportPdf() {
    if (!analysis || !selectedStyle || generatedPanels.length === 0) return;

    try {
      const exportInfo = await apiJson<{watermark: boolean; exportQuality: 'standard' | 'high' | 'premium'}>(
        '/api/exports/consume',
        {
          method: 'POST',
          body: JSON.stringify({panelCount: generatedPanels.length}),
        },
      );

      await refreshUsage();
      generateGraphicNovelPDF(generatedPanels, selectedStyle.name, analysis.title, {
        watermark: exportInfo.watermark,
        exportQuality: exportInfo.exportQuality,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10">
      <div className="max-w-5xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-4xl font-bold">KinoGraph</h1>
          <p className="text-zinc-400">Production-grade storyboard generation for monetizable creative workflows.</p>
        </header>

        {productConfig && (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-3">
            <h2 className="text-xl font-semibold">Hero use case: {productConfig.heroUseCase.segment}</h2>
            <p className="text-zinc-300">{productConfig.heroUseCase.onboardingMessage}</p>
            <div className="text-sm text-zinc-400 space-y-1">
              <p>Supported formats: {productConfig.qualityBar.supportedFormats.join(', ')}</p>
              <p>Target processing time: ≤ {productConfig.qualityBar.targetProcessingSeconds} seconds per project</p>
              <p>Output consistency bar: {productConfig.qualityBar.outputConsistency}</p>
            </div>
          </section>
        )}

        {!token ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="text-xl font-semibold mb-4">Create account to start</h2>
            <form className="grid gap-3 md:grid-cols-3" onSubmit={handleAuthSubmit}>
              <input
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2"
                placeholder="Email"
                type="email"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                required
              />
              <input
                className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2"
                placeholder="Password (8+ chars)"
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                minLength={8}
                required
              />
              <button className="rounded-xl bg-indigo-500 px-4 py-2 font-semibold hover:bg-indigo-400" type="submit">
                {authMode === 'register' ? 'Register' : 'Login'}
              </button>
            </form>
            <button
              className="mt-3 text-sm text-zinc-400 hover:text-zinc-200"
              onClick={() => setAuthMode(authMode === 'register' ? 'login' : 'register')}
            >
              {authMode === 'register' ? 'Already have an account? Login' : 'Need an account? Register'}
            </button>
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-semibold">Account</h2>
                  <p className="text-zinc-400 text-sm">{user?.email}</p>
                </div>
                <button
                  className="text-sm text-zinc-400 hover:text-zinc-100"
                  onClick={() => {
                    setToken(null);
                    setUser(null);
                    setUsageData(null);
                  }}
                >
                  Sign out
                </button>
              </div>

              {productConfig && (
                <div className="grid md:grid-cols-3 gap-3">
                  {productConfig.planOrder.map((planKey) => {
                    const plan = productConfig.plans[planKey];
                    const active = user?.plan === plan.key;
                    return (
                      <button
                        key={plan.key}
                        onClick={() => changePlan(plan.key)}
                        className={`text-left rounded-xl border p-4 transition ${
                          active
                            ? 'border-indigo-400 bg-indigo-500/10'
                            : 'border-zinc-700 bg-zinc-950 hover:border-zinc-500'
                        }`}
                      >
                        <div className="font-semibold">{plan.name}</div>
                        <div className="text-sm text-zinc-400">${plan.monthlyPriceUsd}/month</div>
                        <div className="text-xs text-zinc-500 mt-2">
                          {plan.maxVideoSeconds}s max video · {plan.styleOptions} style options · {plan.exportQuality} export
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {usageData && (
                <div className="grid md:grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl border border-zinc-700 p-3">
                    Analyses: {usageData.usage.analyses}/{usageData.limits.analyses}
                  </div>
                  <div className="rounded-xl border border-zinc-700 p-3">
                    Stylizations: {usageData.usage.stylizations}/{usageData.limits.stylizations}
                  </div>
                  <div className="rounded-xl border border-zinc-700 p-3">
                    Exports: {usageData.usage.exports}/{usageData.limits.exports}
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
              <h2 className="text-xl font-semibold">1) Upload video</h2>
              <label className="block rounded-xl border border-dashed border-zinc-700 bg-zinc-950 p-6 cursor-pointer hover:border-zinc-500">
                <div className="flex items-center gap-3">
                  <Upload className="w-5 h-5" />
                  <span>Choose video (max 20MB)</span>
                </div>
                <input
                  type="file"
                  className="hidden"
                  accept="video/mp4,video/webm,video/quicktime"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleFileUpload(file).catch((err) => setError((err as Error).message));
                    }
                  }}
                />
              </label>
              {videoFile && <p className="text-sm text-zinc-400">Selected: {videoFile.name}</p>}
              {status && (
                <p className="text-sm text-indigo-300 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> {status}
                </p>
              )}
            </section>

            {appState === 'STYLE_SELECTION' && analysis && (
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
                <h2 className="text-xl font-semibold">2) Choose style</h2>
                <p className="text-zinc-400 text-sm">{analysis.title} · {analysis.beats.length} beats</p>
                <div className="grid md:grid-cols-3 gap-3">
                  {analysis.styles.map((style) => (
                    <button
                      key={style.name}
                      onClick={() => generatePanels(style)}
                      className="rounded-xl border border-zinc-700 bg-zinc-950 p-4 text-left hover:border-indigo-400"
                    >
                      <div className="font-semibold flex items-center gap-2">
                        <Sparkles className="w-4 h-4" /> {style.name}
                      </div>
                      <p className="text-sm text-zinc-400 mt-2">{style.description}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {(appState === 'GENERATING' || appState === 'COMPLETE') && (
              <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">3) Generated panels</h2>
                  <button
                    className="rounded-xl bg-white text-black px-4 py-2 font-semibold disabled:bg-zinc-700 disabled:text-zinc-400"
                    onClick={exportPdf}
                    disabled={appState !== 'COMPLETE'}
                  >
                    <span className="inline-flex items-center gap-2">
                      <Download className="w-4 h-4" /> Export PDF
                    </span>
                  </button>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  {generatedPanels.map((panel, idx) => (
                    <article key={idx} className="rounded-xl border border-zinc-700 overflow-hidden bg-zinc-950">
                      <img src={panel.image} alt={`Panel ${idx + 1}`} className="w-full object-cover aspect-[4/3]" />
                      <p className="p-4 text-zinc-300 italic">"{panel.quote}"</p>
                    </article>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-300">{error}</div>}
      </div>
    </div>
  );
}
