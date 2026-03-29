import express from "express";
import { createServer as createViteServer } from "vite";
import { Resend } from "resend";
import path from "path";

let resendClient: Resend | null = null;

function getResend() {
  if (!resendClient) {
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error("RESEND_API_KEY environment variable is required to send emails.");
    }
    resendClient = new Resend(key);
  }
  return resendClient;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API routes FIRST
  app.post("/api/feedback", async (req, res) => {
    try {
      const { feedback } = req.body;
      
      if (!feedback) {
        return res.status(400).json({ error: "Feedback text is required" });
      }

      const resend = getResend();
      const toEmail = process.env.FEEDBACK_EMAIL_TO || "brightonwe30@gmail.com";

      const data = await resend.emails.send({
        from: "KinoGraph Feedback <onboarding@resend.dev>",
        to: [toEmail],
        subject: "New Feedback for KinoGraph",
        text: feedback,
      });

      res.json({ success: true, data });
    } catch (error: any) {
      console.error("Feedback error:", error);
      res.status(500).json({ error: error.message || "Failed to send feedback" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
