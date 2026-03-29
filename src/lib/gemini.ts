import { GoogleGenAI, Type } from '@google/genai';

// Initialize the Gemini SDK. The API key is automatically injected by the AI Studio environment.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface StoryBeat {
  timestamp: number;
  quote: string;
  description: string;
}

export interface VideoAnalysis {
  title: string;
  beats: StoryBeat[];
  styles: { name: string; description: string; promptModifier: string }[];
}

/**
 * Phase 1: The Director
 * Analyzes the video to find key narrative beats and suggests aesthetic styles.
 */
export async function analyzeVideo(base64Video: string, mimeType: string): Promise<VideoAnalysis> {
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: [
      {
        inlineData: {
          data: base64Video,
          mimeType: mimeType,
        }
      },
      `You are a master storyboard director and editor. Watch this video and extract the core narrative beats to adapt it into a graphic novel. 
      
      CRITICAL GUARDRAILS:
      1. DURATION: Extract between 2 to 6 beats depending on the video length (e.g., 2 beats for a 5-second clip, up to 6 for longer clips). Do not force 6 beats on a micro-short.
      2. TIMESTAMPS: Provide highly precise timestamps (using decimals, e.g., 12.4). Ensure the timestamp lands on a frame of peak clarity and emotion, avoiding heavy motion blur.
      3. QUOTES & AUDIO: If there is speech, extract the most impactful quote (translate to English if foreign). If there is NO speech (e.g., a mime, ticking clock, silent action), write a dramatic, comic-book-style narration box (e.g., '[The silence is deafening...]').
      4. STATIC VISUALS: If the video is visually boring (e.g., a static podcast, a black screen), DO NOT just describe 'a man talking'. Invent dynamic, comic-book-style camera angles and framing based on the emotion of the audio (e.g., 'Extreme close-up on eyes, heavy shadows').
      5. SPLIT-SCREENS: If it's a split-screen (e.g., gameplay + podcast), focus the visual description entirely on the primary human subject.
      
      Additionally, suggest 3 distinct visual aesthetic styles (e.g., Cyberpunk, Noir, Vintage Manga) that fit the vibe. Provide a 'promptModifier' for each style. Finally, provide a catchy, contextual 'title' for this graphic novel.`
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: "A catchy, contextual title for the graphic novel" },
          beats: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                timestamp: { type: Type.NUMBER, description: "Exact timestamp in seconds (e.g., 14.2)" },
                quote: { type: Type.STRING, description: "The exact quote spoken, or a dramatic narration box if silent" },
                description: { type: Type.STRING, description: "Dynamic visual description of the scene and camera angle" }
              },
              required: ["timestamp", "quote", "description"]
            }
          },
          styles: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                name: { type: Type.STRING, description: "Name of the style (e.g., Neon Cyberpunk)" },
                description: { type: Type.STRING, description: "Brief description of the vibe" },
                promptModifier: { type: Type.STRING, description: "Text to append to an image prompt, e.g., 'in the style of a neon cyberpunk graphic novel, high contrast, glowing lights, ink outlines'" }
              },
              required: ["name", "description", "promptModifier"]
            }
          }
        },
        required: ["title", "beats", "styles"]
      }
    }
  });

  if (!response.text) {
    throw new Error("Failed to analyze video. Empty response from Gemini.");
  }

  return JSON.parse(response.text) as VideoAnalysis;
}

/**
 * Phase 2: The Artist
 * Takes an extracted video frame and redraws it in the chosen aesthetic style.
 */
export async function stylizeFrame(base64Image: string, stylePromptModifier: string): Promise<string> {
  // Strip the data URL prefix if present
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
          text: `Redraw this image as a high-quality graphic novel panel. Maintain the original composition and subjects, but apply this style heavily: ${stylePromptModifier}. 
          
          CRITICAL GUARDRAILS:
          1. IGNORE AND REMOVE all text, subtitles, watermarks, UI elements, minimaps, or presentation slides. Do not attempt to draw letters or alien runes. Replace text areas with thematic background elements.
          2. If there is a prominent human face, maintain their general likeness and expression, applying the style primarily to the lighting, shading, and environment.
          3. Blend away split-screens or distracting secondary footage into a cohesive background.
          4. If the input image is mostly blank, dark, or abstract, use the style modifier to hallucinate a beautiful, thematic scene that fits the aesthetic.`,
        },
      ],
    },
  });

  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) throw new Error("No image returned from Nano Banana");

  for (const part of parts) {
    if (part.inlineData) {
      return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
    }
  }
  
  throw new Error("No image data found in the response parts.");
}
