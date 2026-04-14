const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const { ConvexHttpClient } = require('convex/browser');

// Configuration
const SOP_DIR = path.join(__dirname, '..', 'Appscript', 'SOP');
const CONVEX_URL = "https://joyous-ant-26.convex.cloud";
const OPENROUTER_API_KEY = "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";

// Initialize Convex Client
const client = new ConvexHttpClient(CONVEX_URL);

async function getEmbedding(text) {
    const response = await fetch("https://openrouter.ai/api/v1/embeddings", {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            model: "openai/text-embedding-3-small",
            input: text
        })
    });
    const data = await response.json();
    return data.data[0].embedding;
}

function chunkText(text, size = 800, overlap = 200) {
    const chunks = [];
    let start = 0;
    while (start < text.length) {
        const end = Math.min(start + size, text.length);
        chunks.push(text.slice(start, end));
        start += (size - overlap);
    }
    return chunks;
}

async function ingest() {
    console.log("🚀 Starting SOP Ingestion...");
    
    // 0. Clear existing sops (optional)
    // await client.mutation("sops:clearSOPs", {});

    const files = fs.readdirSync(SOP_DIR).filter(f => f.endsWith('.pdf'));
    console.log(`Found ${files.length} PDF files.`);

    for (const file of files) {
        console.log(`\n📄 Processing: ${file}`);
        const filePath = path.join(SOP_DIR, file);
        const dataBuffer = fs.readFileSync(filePath);
        
        try {
            const data = await pdf(dataBuffer);
            const text = data.text.replace(/\s+/g, ' ').trim();
            const chunks = chunkText(text);
            
            console.log(`   Split into ${chunks.length} chunks.`);

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                process.stdout.write(`   ➡️ Chunk ${i+1}/${chunks.length}... `);
                
                const embedding = await getEmbedding(chunk);
                
                await client.mutation("sops:ingestSOPChunk", {
                    fileName: file,
                    text: chunk,
                    embedding: embedding,
                    metadata: {
                        pageNumber: 0, // pdf-parse doesn't easily give page-per-chunk
                        source: "SOP Folder"
                    }
                });
                console.log("Done.");
            }
        } catch (err) {
            console.error(`   ❌ Error processing ${file}:`, err.message);
        }
    }
    
    console.log("\n✅ Ingestion complete!");
}

ingest();
