import { jsPDF } from "jspdf";

export interface Panel {
  image: string; // base64 data URL
  quote: string;
}

/**
 * Generates a multi-page PDF graphic novel from the stylized panels.
 */
export async function generateGraphicNovelPDF(panels: Panel[], styleName: string, title: string) {
  // Create a portrait A4 document
  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4"
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - (margin * 2);

  let yOffset = margin;

  // Helper to draw the dark background
  const drawBackground = () => {
    doc.setFillColor(15, 15, 15); // Very dark gray/black
    doc.rect(0, 0, pageWidth, pageHeight, 'F');
  };

  drawBackground();

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(28);
  
  // Split title if it's too long
  const splitTitle = doc.splitTextToSize(title, contentWidth);
  doc.text(splitTitle, margin, yOffset);
  
  yOffset += (splitTitle.length * 10);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(150, 150, 150);
  doc.text(`Aesthetic: ${styleName}`, margin, yOffset);
  
  yOffset += 20;

  for (let i = 0; i < panels.length; i++) {
    const panel = panels[i];

    // Calculate image dimensions to fit the width while maintaining aspect ratio
    const imgProps = doc.getImageProperties(panel.image);
    const imgRatio = imgProps.height / imgProps.width;
    const imgHeight = contentWidth * imgRatio;

    // Check if we need a new page
    // We need enough space for the image + the quote + some padding
    if (yOffset + imgHeight + 40 > pageHeight) {
      doc.addPage();
      drawBackground();
      yOffset = margin;
    }

    // Draw Image Panel (with a subtle white border for comic effect)
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(1);
    doc.rect(margin - 1, yOffset - 1, contentWidth + 2, imgHeight + 2);
    // Use FAST compression to keep PDF size small
    doc.addImage(panel.image, 'JPEG', margin, yOffset, contentWidth, imgHeight, undefined, 'FAST');
    
    yOffset += imgHeight + 12;

    // Draw Quote
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(14);
    
    const quoteText = `"${panel.quote}"`;
    const splitQuote = doc.splitTextToSize(quoteText, contentWidth);
    
    doc.text(splitQuote, margin, yOffset);
    
    // Advance Y offset based on the number of lines the quote took, plus padding for the next panel
    yOffset += (splitQuote.length * 7) + 25;
  }

  // Create a safe filename from the title
  const safeFilename = title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf';
  doc.save(safeFilename);
}
