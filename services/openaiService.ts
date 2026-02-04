
import { RedirectResult, CandidateLog, UrlMetadata, JobStatus } from "../types";
import { SYSTEM_PROMPT } from "../constants";

// --- CONFIGURAÇÃO RÍGIDA DO MODELO ---
const OPENAI_MODEL_ID = "gpt-4.1-mini";

// --- IN-MEMORY JOB STORE ---
const jobStore: Record<string, JobStatus> = {};

// --- UTILITIES (Tokenization & Local Filter) ---

const normalizeTextToTokens = (text: string): Set<string> => {
  if (!text) return new Set();
  try {
    let clean = text.toLowerCase();
    if (clean.includes('http') || clean.includes('www.')) {
        clean = clean.replace(/^(?:https?:\/\/)?(?:www\.)?[^\/]+/, "");
        clean = clean.replace(/\.[a-zA-Z0-9]{3,4}$/, ""); 
    }
    clean = clean.replace(/[\/\-_?=&.+:;|]/g, " ");
    const tokens = clean.split(/\s+/).filter(t => t.length > 2);
    return new Set(tokens);
  } catch (error) {
    return new Set([text.toLowerCase()]);
  }
};

const calculateJaccardScore = (sourceTokens: Set<string>, targetTokens: Set<string>): number => {
  if (sourceTokens.size === 0 || targetTokens.size === 0) return 0;
  let intersection = 0;
  sourceTokens.forEach(token => {
    if (targetTokens.has(token)) intersection++;
  });
  const union = sourceTokens.size + targetTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
};

interface PreProcessedTarget {
  data: UrlMetadata;
  tokens: Set<string>;
}

const findTopCandidates = (
  source: UrlMetadata,
  processedTargets: PreProcessedTarget[],
  limit: number = 30
): UrlMetadata[] => {
  const sourceText = `${source.url} ${source.title || ''} ${source.description || ''}`;
  const sourceTokens = normalizeTextToTokens(sourceText);
  
  if (sourceTokens.size === 0) {
    return processedTargets.slice(0, 5).map(t => t.data);
  }

  const candidates = processedTargets.map(target => ({
    candidate: target.data,
    score: calculateJaccardScore(sourceTokens, target.tokens)
  }));

  candidates.sort((a, b) => b.score - a.score);
  const nonZero = candidates.filter(c => c.score > 0);
  const finalPool = nonZero.length < 5 ? candidates : nonZero;

  return finalPool.slice(0, limit).map(c => c.candidate);
};

// --- BATCH API HELPERS (RESPONSES API) ---

const createJsonlFile = (job: JobStatus): string => {
  return job.batchesData.map(batch => {
    
    // Payload reconstruction
    const inputPayload = batch.originalItems.map((item, idx) => ({
      original: item,
      candidates: batch.candidates[idx]
    }));

    // BODY ALIGNED WITH RESPONSES API (gpt-4.1-mini)
    // Uses 'input' instead of 'messages'
    const body = {
      model: OPENAI_MODEL_ID,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `DADOS DE ENTRADA (JSON):\n${JSON.stringify(inputPayload)}` }
      ],
      temperature: 0.1,
      response_format: { type: "json_object" }
    };

    // ENDPOINT ALIGNED WITH RESPONSES API
    return JSON.stringify({
      custom_id: batch.customId,
      method: "POST",
      url: "/v1/responses",
      body: body
    });
  }).join('\n');
};

const uploadBatchFile = async (apiKey: string, jsonlContent: string): Promise<string> => {
  const blob = new Blob([jsonlContent], { type: 'application/json' });
  const file = new File([blob], "batch_input.jsonl");
  const formData = new FormData();
  formData.append("purpose", "batch");
  formData.append("file", file);

  const response = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Upload Failed: ${err.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.id;
};

const createBatch = async (apiKey: string, inputFileId: string): Promise<string> => {
  const response = await fetch("https://api.openai.com/v1/batches", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      input_file_id: inputFileId,
      endpoint: "/v1/responses", // Updated to match JSONL content
      completion_window: "24h"
    })
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Batch Creation Failed: ${err.error?.message || response.statusText}`);
  }

  const data = await response.json();
  return data.id;
};

// --- LIFECYCLE MANAGEMENT ---

export const createMappingJob = (
  apiKey: string,
  sourceUrls: UrlMetadata[],
  targetUrls: UrlMetadata[]
): string => {
  const jobId = `job_${Date.now()}`;
  
  jobStore[jobId] = {
    id: jobId,
    apiKey,
    status: 'created',
    progress: { current: 0, total: 0 },
    results: [],
    logs: [],
    candidateLogs: [],
    batchesData: []
  };

  // Start background preparation
  setTimeout(() => prepareAndSubmitBatch(jobId, sourceUrls, targetUrls), 0);

  return jobId;
};

const prepareAndSubmitBatch = async (
  jobId: string,
  sourceUrls: UrlMetadata[],
  targetUrls: UrlMetadata[]
) => {
  const job = jobStore[jobId];
  if (!job) return;

  try {
    job.logs.push(`⚙️ Preparando dados e filtro local...`);
    
    // Indexing
    const processedTargets: PreProcessedTarget[] = targetUrls.map(item => ({
      data: item,
      tokens: normalizeTextToTokens(`${item.url} ${item.title || ''} ${item.description || ''}`)
    }));

    // Create Batches of 10
    const BATCH_SIZE = 10;
    const batchesData = [];
    
    for (let i = 0; i < sourceUrls.length; i += BATCH_SIZE) {
      const chunk = sourceUrls.slice(i, i + BATCH_SIZE);
      const candidatesList = chunk.map(src => findTopCandidates(src, processedTargets, 30));
      
      batchesData.push({
        customId: `req_${i}`, // Simple ID mapping
        originalItems: chunk,
        candidates: candidatesList
      });

      // Log candidates for debug
      chunk.forEach((src, idx) => {
        job.candidateLogs.push({
          originalUrl: src.url,
          candidates: candidatesList[idx].map(c => c.url)
        });
      });
    }

    job.batchesData = batchesData;
    job.progress.total = batchesData.length;
    
    // Generate JSONL
    job.logs.push(`📄 Gerando arquivo JSONL (${batchesData.length} requisições)...`);
    const jsonlContent = createJsonlFile(job);

    // Upload
    job.status = 'uploading';
    job.logs.push(`📤 Enviando arquivo para OpenAI...`);
    const fileId = await uploadBatchFile(job.apiKey, jsonlContent);
    job.inputFileId = fileId;
    job.logs.push(`✅ Arquivo enviado. ID: ${fileId}`);

    // Create Batch
    job.logs.push(`🚀 Iniciando Batch na OpenAI (/v1/responses)...`);
    const batchId = await createBatch(job.apiKey, fileId);
    job.openaiBatchId = batchId;
    job.status = 'submitted';
    job.logs.push(`✅ Batch criado. ID: ${batchId}. Aguardando processamento remoto...`);

  } catch (err: any) {
    job.status = 'failed';
    job.error = err.message;
    job.logs.push(`❌ Erro na inicialização: ${err.message}`);
  }
};

export const syncBatchJob = async (jobId: string): Promise<JobStatus | null> => {
  const job = jobStore[jobId];
  if (!job) return null;

  // Don't sync if terminal state
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'created' || job.status === 'uploading') {
    return job;
  }

  try {
    if (!job.openaiBatchId) return job;

    const response = await fetch(`https://api.openai.com/v1/batches/${job.openaiBatchId}`, {
      headers: { "Authorization": `Bearer ${job.apiKey}` }
    });

    if (!response.ok) {
        console.warn("Failed to poll batch status");
        return job;
    }

    const data = await response.json();
    job.openaiStatus = data.status;

    // Update Request Counts
    if (data.request_counts) {
      job.progress.current = data.request_counts.completed + data.request_counts.failed;
      job.progress.total = data.request_counts.total;
    }

    // Handle States
    if (data.status === 'failed' || data.status === 'expired' || data.status === 'cancelled') {
        job.status = 'failed';
        job.error = `OpenAI Batch Failed: ${data.errors?.data?.[0]?.message || 'Unknown error'}`;
        job.logs.push(`❌ Batch falhou na OpenAI: ${job.error}`);
    } 
    else if (data.status === 'completed') {
        if (job.status !== 'finalizing') {
            job.status = 'finalizing';
            job.outputFileId = data.output_file_id;
            job.logs.push(`🏁 Batch concluído na OpenAI. Baixando resultados...`);
            setTimeout(() => finalizeJob(jobId), 0);
        }
    }
    else {
        job.status = 'processing_remote';
    }

  } catch (err: any) {
    console.error("Polling error", err);
  }

  return job;
};

const finalizeJob = async (jobId: string) => {
  const job = jobStore[jobId];
  if (!job || !job.outputFileId) return;

  try {
    const response = await fetch(`https://api.openai.com/v1/files/${job.outputFileId}/content`, {
      headers: { "Authorization": `Bearer ${job.apiKey}` }
    });

    if (!response.ok) throw new Error("Falha ao baixar arquivo de saída");

    const text = await response.text();
    const lines = text.trim().split('\n');
    
    const resultsMap = new Map<string, RedirectResult[]>();

    // Parse Results (DEFENSIVE PARSING FOR RESPONSES API)
    lines.forEach(line => {
      try {
        const json = JSON.parse(line);
        const customId = json.custom_id;
        const responseBody = json.response?.body;
        
        let rawContent: string | null = null;
        
        if (responseBody) {
            // Priority 1: output_text (Standard for Responses API)
            if (responseBody.output_text) {
                rawContent = responseBody.output_text;
            } 
            // Priority 2: output[0].content[0].text (Alternative structure)
            else if (responseBody.output && responseBody.output[0]?.content && responseBody.output[0].content[0]?.text) {
                rawContent = responseBody.output[0].content[0].text;
            }
            // STOP: Do not check choices[0].message.content as per instructions
        }

        if (rawContent) {
            try {
                const parsedContent = JSON.parse(rawContent);
                let batchResults: RedirectResult[] = [];
                
                // Normalizing response variations
                if (Array.isArray(parsedContent)) {
                    batchResults = parsedContent;
                } else if (parsedContent.results && Array.isArray(parsedContent.results)) {
                    batchResults = parsedContent.results;
                } else if (Array.isArray(Object.values(parsedContent)[0])) {
                    batchResults = Object.values(parsedContent)[0] as RedirectResult[];
                }

                resultsMap.set(customId, batchResults);
            } catch (parseErr) {
                console.error(`JSON Parse error for ${customId}`, parseErr);
                // Will default to fallback logic below
            }
        }
      } catch (e) {
        console.error("Error parsing result line", e);
      }
    });

    // Reconstruct Results respecting original order and strict fallback
    const finalResults: RedirectResult[] = [];

    job.batchesData.forEach(batch => {
        const remoteResults = resultsMap.get(batch.customId);
        
        batch.originalItems.forEach(item => {
            // Try to find specific result from AI
            const found = remoteResults?.find(r => r.originalUrl === item.url);
            
            if (found) {
                finalResults.push({
                    ...found,
                    confidence_source: 'ai'
                });
            } else {
                // STRICT FALLBACK
                finalResults.push({
                    originalUrl: item.url,
                    destinationUrl: batch.candidates.find((_, i) => batch.originalItems[i].url === item.url)?.[0]?.url || "",
                    score: 20, // Max 30 allowed, set to 20 for safety
                    justification: "FALHA TÉCNICA: Erro no processamento do Batch ou Parsing (fallback local aplicado).",
                    confidence_source: 'fallback'
                });
            }
        });
    });

    job.results = finalResults;
    job.status = 'completed';
    job.logs.push(`🎉 Processamento finalizado! ${finalResults.length} URLs mapeadas.`);

  } catch (err: any) {
    job.status = 'failed';
    job.error = `Erro ao processar resultados: ${err.message}`;
    job.logs.push(`❌ Falha na finalização: ${err.message}`);
  }
};
