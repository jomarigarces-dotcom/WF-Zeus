const pdf = require('pdf-parse');
console.log("PDF Import:", pdf);
const fs = require('fs');
const path = require('path');

const testFile = "C:\\Users\\jomari.garces\\Documents\\Project Programming\\Vercel Apps\\WF Zeus\\Appscript\\SOP\\Final Walmart SOP - RTA.pdf";

async function test() {
    try {
        const buffer = fs.readFileSync(testFile);
        const data = await pdf(buffer);
        console.log("Text extracted:", data.text.substring(0, 100));
    } catch (e) {
        console.error("Error:", e);
    }
}
test();
