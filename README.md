# 🎬 KinoGraph: AI Video Knowledge Extraction & Cinematic Summarizer

[![React](https://img.shields.io/badge/React-18-61DAFB.svg?logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Google Gemini Multimodal](https://img.shields.io/badge/Gemini-Multimodal%20Video-4285F4.svg?logo=google&logoColor=white)](https://ai.google.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**KinoGraph** extracts the essence, structure, and actionable knowledge from long-form video content using Gemini multimodal reasoning.

---

## 🌟 Capabilities

- 🎞️ **Multimodal Video Understanding:** Ingests video timestamps, keyframes, and transcripts to build comprehensive knowledge graphs.
- 📑 **Chapterization & Key Insights:** Automatically generates timestamped topic chapters, executive briefs, and takeaways.
- 🔍 **Interactive Video Search:** Query specific visual moments or spoken concepts across the video timeline.

---

## 🛠️ Tech Stack

- **Frontend:** React 18, TypeScript, Tailwind CSS
- **Backend:** Node.js Server (`server.ts`)
- **AI Engine:** Google Gemini Multimodal API
- **Build System:** Vite

---

## 🚀 Setup & Execution

1. **Clone repository:**
   ```bash
   git clone https://github.com/Tony-Stark2025/KinoGraph.git
   cd KinoGraph
   npm install
   ```

2. **Setup environment variables:**
   ```bash
   cp .env.example .env.local
   # Add your GEMINI_API_KEY
   ```

3. **Start app:**
   ```bash
   npm run dev
   ```

---

## 📄 License

Licensed under the MIT License - see the [LICENSE](LICENSE) file.
