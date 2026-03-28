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
      "You are a master storyboard director and editor. Watch this video and extract the 4 to 6 most critical narrative beats, highlights, or emotional peaks. For each beat, provide the exact timestamp in seconds, the most impactful quote spoken (or a dramatic, comic-book style caption if there is no speech), and a brief visual description of the scene. Additionally, suggest 3 distinct visual aesthetic styles (e.g., Cyberpunk, Noir, Vintage Manga, Watercolor) that would perfectly fit this video if it were adapted into a graphic novel. Provide a 'promptModifier' for each style that can be appended to an image generation prompt to enforce that style. Finally, provide a catchy, contextual 'title' for this graphic novel based on the video's overarching narrative."
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
                timestamp: { type: Type.NUMBER, description: "Exact timestamp in seconds" },
                quote: { type: Type.STRING, description: "The exact quote spoken, or a dramatic caption" },
                description: { type: Type.STRING, description: "Visual description of the scene" }
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
          text: `Redraw this image as a high-quality graphic novel panel. Maintain the exact original composition, subjects, and camera angle, but apply this style heavily: ${stylePromptModifier}`,
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
