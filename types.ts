
export interface CsvRow {
  [key: string]: string;
}

export interface UrlMetadata {
  url: string;
  title?: string;
  description?: string;
}

export type ConfidenceSource = 'ai' | 'fallback';

export interface RedirectResult {
  originalUrl: string;
  destinationUrl: string;
  score: number;
  justification: string;
  confidence_source: ConfidenceSource;
}

export interface CandidateLog {
  originalUrl: string;
  candidates: string[];
}

export interface ProcessingStats {
  totalSource: number;
  totalTarget: number;
  processedCount: number;
}

export interface CostEstimate {
  modelo: string;
  urls_processadas: number;
  tokens: {
    input_total: number;
    output_total: number;
    total: number;
    por_url: number;
  };
  custos_usd: {
    input: number;
    output: number;
    total: number;
    por_url: number;
  };
  custos_brl: {
    total: number;
    por_url: number;
  };
}

export enum AppStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

// Job Types for OpenAI Batch API
export interface JobStatus {
  id: string;
  apiKey: string; // Stored securely in memory for polling
  
  // App-level status
  status: 'created' | 'uploading' | 'submitted' | 'processing_remote' | 'finalizing' | 'completed' | 'failed';
  
  // OpenAI Batch Specifics
  openaiBatchId?: string;
  inputFileId?: string;
  outputFileId?: string;
  openaiStatus?: string; // 'validating', 'in_progress', 'completed', etc.
  
  progress: {
    current: number;
    total: number; // Total batches (requests), not URLs
  };
  
  // Data Context (Needed for reconstruction)
  batchesData: {
    customId: string;
    originalItems: UrlMetadata[];
    candidates: UrlMetadata[][];
  }[];
  
  results: RedirectResult[];
  logs: string[];
  candidateLogs: CandidateLog[];
  error?: string;
}
