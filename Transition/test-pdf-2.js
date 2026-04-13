const pdfParse = require('pdf-parse');
const fs = require('fs');

async function testExtraction() {
  const filePath = "C:\\Users\\jomari.garces\\Documents\\Project Programming\\Vercel Apps\\WF Zeus\\Appscript\\SOP\\Final Walmart SOP - RTA.pdf";
  const buffer = fs.readFileSync(filePath);
  
  try {
    // If the package is actually pdf-parse, it's often imported as the function itself.
    // However, some versions or mirrors might differ.
    const extract = typeof pdfParse === 'function' ? pdfParse : pdfParse.PDFParse;
    
    const data = await pdfParse(buffer);
    console.log("Success! Characters:", data.text.length);
    console.log("Snippet:", data.text.substring(0, 100));
  } catch (err) {
    console.error("Failed:", err.message);
  }
}

testExtraction();
