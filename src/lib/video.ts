/**
 * Extracts a base64 JPEG frame from a video file at a specific timestamp.
 * This runs entirely in the browser using HTML5 Canvas, costing zero server resources.
 */
export async function extractFrame(videoFile: File, timestampSeconds: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(videoFile);
    
    video.src = objectUrl;
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;

    // Wait for metadata to load so we know the video dimensions
    video.onloadedmetadata = () => {
      // Ensure timestamp is within video bounds
      const safeTimestamp = Math.min(Math.max(0, timestampSeconds), video.duration - 0.1);
      video.currentTime = safeTimestamp;
    };

    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas');
        
        // Downscale the image to a reasonable max width to save memory and PDF size
        const MAX_WIDTH = 1024;
        let width = video.videoWidth;
        let height = video.videoHeight;
        
        if (width > MAX_WIDTH) {
          height = Math.floor(height * (MAX_WIDTH / width));
          width = MAX_WIDTH;
        }

        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Could not get 2D context from canvas');
        }
        
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        // Use 0.75 quality to significantly reduce file size while maintaining acceptable visual quality
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75); 
        
        // Cleanup
        URL.revokeObjectURL(objectUrl);
        video.remove();
        
        resolve(dataUrl);
      } catch (err) {
        URL.revokeObjectURL(objectUrl);
        reject(err);
      }
    };

    video.onerror = (e) => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Error loading video for frame extraction: ${e}`));
    };
  });
}

/**
 * Converts a File object to a base64 string (without the data URL prefix)
 * for sending to the Gemini API.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the "data:video/mp4;base64," prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
  });
}
