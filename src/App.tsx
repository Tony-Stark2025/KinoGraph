import { useState, useRef } from 'react';
import { Upload, Film, Wand2, Download, Loader2, Image as ImageIcon, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { analyzeVideo, stylizeFrame, VideoAnalysis, StoryBeat } from './lib/gemini';
import { extractFrame, fileToBase64 } from './lib/video';
import { generateGraphicNovelPDF, Panel } from './lib/pdf';

type AppState = 'IDLE' | 'ANALYZING' | 'STYLE_SELECTION' | 'GENERATING' | 'COMPLETE';

const MAX_FILE_SIZE_MB = 20;

export default function App() {
  const [appState, setAppState] = useState<AppState>('IDLE');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<VideoAnalysis['styles'][0] | null>(null);
  
  // Progress tracking for generation phase
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0, status: '' });
  const [generatedPanels, setGeneratedPanels] = useState<Panel[]>([]);
  
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      setError('Please upload a valid video file.');
      return;
    }

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`File is too large. Please upload a video under ${MAX_FILE_SIZE_MB}MB for this prototype.`);
      return;
    }

    setError(null);
    setVideoFile(file);
    setAppState('ANALYZING');

    try {
      const base64Video = await fileToBase64(file);
      const result = await analyzeVideo(base64Video, file.type);
      setAnalysis(result);
      setAppState('STYLE_SELECTION');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to analyze video.');
      setAppState('IDLE');
    }
  };

  const startGeneration = async (style: VideoAnalysis['styles'][0]) => {
    if (!videoFile || !analysis) return;
    
    setSelectedStyle(style);
    setAppState('GENERATING');
    setGeneratedPanels([]);
    setGenerationProgress({ current: 0, total: analysis.beats.length, status: 'Initializing...' });

    const panels: Panel[] = [];

    try {
      for (let i = 0; i < analysis.beats.length; i++) {
        const beat = analysis.beats[i];
        
        setGenerationProgress({ 
          current: i + 1, 
          total: analysis.beats.length, 
          status: `Extracting frame at ${beat.timestamp}s...` 
        });
        
        // 1. Extract the raw frame from the video
        const rawFrameBase64 = await extractFrame(videoFile, beat.timestamp);
        
        setGenerationProgress({ 
          current: i + 1, 
          total: analysis.beats.length, 
          status: `Applying ${style.name} aesthetic...` 
        });

        // 2. Send to Nano Banana for restyling
        const stylizedFrame = await stylizeFrame(rawFrameBase64, style.promptModifier);
        
        const newPanel = { image: stylizedFrame, quote: beat.quote };
        panels.push(newPanel);
        
        // Update state progressively so user sees panels appear one by one
        setGeneratedPanels([...panels]);
      }
      
      setAppState('COMPLETE');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Failed to generate panels.');
      setAppState('STYLE_SELECTION'); // Go back so they can try again
    }
  };

  const handleDownloadPDF = () => {
    if (generatedPanels.length > 0 && selectedStyle && analysis) {
      generateGraphicNovelPDF(generatedPanels, selectedStyle.name, analysis.title);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-[#0a0a0a]/80 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Film className="w-6 h-6 text-indigo-400" />
            <span className="text-xl font-bold tracking-tight">KinoGraph</span>
          </div>
          {appState !== 'IDLE' && (
            <button 
              onClick={() => {
                setAppState('IDLE');
                setVideoFile(null);
                setAnalysis(null);
                setGeneratedPanels([]);
              }}
              className="text-sm text-zinc-400 hover:text-white transition-colors"
            >
              Start Over
            </button>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          
          {/* STATE: IDLE (Upload) */}
          {appState === 'IDLE' && (
            <motion.div 
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex flex-col items-center justify-center w-full"
            >
              {/* Hero Section */}
              <div className="text-center max-w-4xl mx-auto mt-12 mb-16 px-4">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 text-indigo-400 text-sm font-medium mb-8 border border-indigo-500/20">
                  <Wand2 className="w-4 h-4" />
                  <span>AI-Powered Visual Storytelling</span>
                </div>
                <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-8 leading-tight">
                  Turn Videos Into <br/>
                  <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
                    Graphic Novels
                  </span>
                </h1>
                <p className="text-lg md:text-xl text-zinc-400 max-w-2xl mx-auto leading-relaxed">
                  Upload a clip, choose your aesthetic, and let our AI transform your story into a beautifully illustrated, downloadable comic book.
                </p>
              </div>

              {/* Upload Dropzone */}
              <div className="w-full max-w-2xl mx-auto mb-24 px-4">
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="relative group cursor-pointer"
                >
                  <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-[2rem] blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
                  <div className="relative bg-zinc-900/80 backdrop-blur-xl border border-zinc-800 hover:border-zinc-700 rounded-[2rem] p-12 flex flex-col items-center justify-center transition-all">
                    <div className="w-20 h-20 bg-zinc-800/50 group-hover:bg-indigo-500/20 rounded-full flex items-center justify-center mb-6 transition-colors border border-zinc-700/50 group-hover:border-indigo-500/50 shadow-2xl">
                      <Upload className="w-10 h-10 text-zinc-400 group-hover:text-indigo-400 transition-colors" />
                    </div>
                    <h3 className="text-2xl font-semibold mb-3 text-white">Upload your video</h3>
                    <p className="text-zinc-500 text-center max-w-sm">
                      Drag and drop or click to browse. <br/>
                      <span className="text-sm mt-2 block">MP4, WebM, or MOV (Max {MAX_FILE_SIZE_MB}MB)</span>
                    </p>
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept="video/*" 
                    className="hidden" 
                  />
                </div>

                {error && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm text-center"
                  >
                    {error}
                  </motion.div>
                )}
              </div>

              {/* Sliding Marquee Section */}
              <div className="w-full overflow-hidden relative py-10 before:absolute before:left-0 before:top-0 before:z-10 before:h-full before:w-32 before:bg-gradient-to-r before:from-[#0a0a0a] before:to-transparent after:absolute after:right-0 after:top-0 after:z-10 after:h-full after:w-32 after:bg-gradient-to-l after:from-[#0a0a0a] after:to-transparent">
                <div className="flex w-[200%] animate-marquee hover:[animation-play-state:paused]">
                  {/* First set of images */}
                  <div className="flex w-1/2 justify-around items-center gap-6 px-3">
                    {[
                      { seed: "cyberpunk", quote: "The neon city never sleeps." },
                      { seed: "noir", quote: "Shadows hide the deepest secrets." },
                      { seed: "manga", quote: "I have to keep moving forward!" },
                      { seed: "fantasy", quote: "The ancient sword glowed brightly." },
                      { seed: "scifi", quote: "Hyperdrive engaged. Hold on." }
                    ].map((item, i) => (
                      <div key={i} className="relative w-72 md:w-96 aspect-[4/3] rounded-2xl overflow-hidden border border-zinc-800 flex-shrink-0 group">
                        <img src={`https://picsum.photos/seed/${item.seed}/800/600`} alt="Example" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" referrerPolicy="no-referrer" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent flex items-end p-6">
                          <p className="text-white font-serif italic text-lg border-l-2 border-indigo-500 pl-3">"{item.quote}"</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Duplicate set for seamless looping */}
                  <div className="flex w-1/2 justify-around items-center gap-6 px-3">
                    {[
                      { seed: "cyberpunk", quote: "The neon city never sleeps." },
                      { seed: "noir", quote: "Shadows hide the deepest secrets." },
                      { seed: "manga", quote: "I have to keep moving forward!" },
                      { seed: "fantasy", quote: "The ancient sword glowed brightly." },
                      { seed: "scifi", quote: "Hyperdrive engaged. Hold on." }
                    ].map((item, i) => (
                      <div key={`dup-${i}`} className="relative w-72 md:w-96 aspect-[4/3] rounded-2xl overflow-hidden border border-zinc-800 flex-shrink-0 group">
                        <img src={`https://picsum.photos/seed/${item.seed}/800/600`} alt="Example" className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" referrerPolicy="no-referrer" />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent flex items-end p-6">
                          <p className="text-white font-serif italic text-lg border-l-2 border-indigo-500 pl-3">"{item.quote}"</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* STATE: ANALYZING */}
          {appState === 'ANALYZING' && (
            <motion.div 
              key="analyzing"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="flex flex-col items-center justify-center py-32"
            >
              <div className="relative w-24 h-24 mb-8">
                <div className="absolute inset-0 border-t-2 border-indigo-500 rounded-full animate-spin"></div>
                <div className="absolute inset-2 border-r-2 border-purple-500 rounded-full animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}></div>
                <Film className="absolute inset-0 m-auto w-8 h-8 text-zinc-400" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">Watching your video...</h2>
              <p className="text-zinc-500">Analyzing the story to find the perfect narrative moments and aesthetic vibes.</p>
            </motion.div>
          )}

          {/* STATE: STYLE SELECTION */}
          {appState === 'STYLE_SELECTION' && analysis && (
            <motion.div 
              key="style-selection"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <div className="mb-12">
                <h2 className="text-3xl font-bold mb-4">Choose Your Aesthetic</h2>
                <p className="text-zinc-400">
                  We found {analysis.beats.length} key narrative moments. How should we draw them?
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {analysis.styles.map((style, idx) => (
                  <button
                    key={idx}
                    onClick={() => startGeneration(style)}
                    className="text-left p-6 rounded-2xl border border-zinc-800 bg-zinc-900/50 hover:bg-zinc-800 hover:border-indigo-500/50 transition-all group flex flex-col h-full"
                  >
                    <div className="w-12 h-12 bg-zinc-800 group-hover:bg-indigo-500/20 rounded-full flex items-center justify-center mb-6 transition-colors">
                      <Wand2 className="w-6 h-6 text-zinc-400 group-hover:text-indigo-400" />
                    </div>
                    <h3 className="text-xl font-bold mb-3 text-white">{style.name}</h3>
                    <p className="text-zinc-400 text-sm leading-relaxed flex-grow">
                      {style.description}
                    </p>
                    <div className="mt-6 flex items-center text-sm font-medium text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity">
                      Generate <ChevronRight className="w-4 h-4 ml-1" />
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {/* STATE: GENERATING & COMPLETE */}
          {(appState === 'GENERATING' || appState === 'COMPLETE') && (
            <motion.div 
              key="generating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-12"
            >
              {/* Header / Progress */}
              <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-8 border-b border-zinc-800">
                <div>
                  <h2 className="text-3xl font-bold mb-2">
                    {appState === 'GENERATING' ? 'Drawing Panels...' : analysis?.title || 'Your Graphic Novel'}
                  </h2>
                  <p className="text-zinc-400">
                    {appState === 'GENERATING' 
                      ? generationProgress.status 
                      : `Successfully generated ${generatedPanels.length} panels in ${selectedStyle?.name} style.`}
                  </p>
                </div>
                
                {appState === 'GENERATING' ? (
                  <div className="flex items-center gap-4 bg-zinc-900 px-6 py-3 rounded-full border border-zinc-800">
                    <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                    <span className="text-sm font-medium">
                      Panel {generationProgress.current} of {generationProgress.total}
                    </span>
                  </div>
                ) : (
                  <button 
                    onClick={handleDownloadPDF}
                    className="flex items-center gap-2 bg-white text-black px-6 py-3 rounded-full font-semibold hover:bg-zinc-200 transition-colors"
                  >
                    <Download className="w-5 h-5" />
                    Download PDF
                  </button>
                )}
              </div>

              {/* Panels Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {generatedPanels.map((panel, idx) => (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.5 }}
                    key={idx} 
                    className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 flex flex-col"
                  >
                    <div className="relative aspect-[4/3] bg-zinc-950">
                      <img 
                        src={panel.image} 
                        alt={`Panel ${idx + 1}`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="p-6 flex-grow flex items-center">
                      <p className="text-lg font-serif italic text-zinc-300 border-l-2 border-indigo-500 pl-4">
                        "{panel.quote}"
                      </p>
                    </div>
                  </motion.div>
                ))}

                {/* Placeholder for currently generating panel */}
                {appState === 'GENERATING' && generatedPanels.length < generationProgress.total && (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-zinc-900/50 rounded-2xl border border-zinc-800 border-dashed flex flex-col items-center justify-center aspect-[4/3] p-6"
                  >
                    <ImageIcon className="w-12 h-12 text-zinc-700 mb-4 animate-pulse" />
                    <p className="text-zinc-500 text-sm font-medium">Drawing next panel...</p>
                  </motion.div>
                )}
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </main>
    </div>
  );
}
