
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { FileUploader } from './components/FileUploader';
import { RedirectResult, AppStatus, CandidateLog, CostEstimate, UrlMetadata, JobStatus } from './types';
import { createMappingJob, syncBatchJob } from './services/openaiService';
import { calculateDeterministicCost } from './utils/calculator';
import { Download, ShieldCheck, ArrowRight, AlertTriangle, Loader2, BrainCircuit, Wand2, Lightbulb, FileWarning, Database, Terminal, Zap, FileSpreadsheet, DollarSign, Info, Activity, CloudCog } from 'lucide-react';

const App: React.FC = () => {
  const [apiKey, setApiKey] = useState('');
  const [sourceData, setSourceData] = useState<UrlMetadata[]>([]);
  const [targetData, setTargetData] = useState<UrlMetadata[]>([]);
  
  // Job State
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobState, setJobState] = useState<JobStatus | null>(null);
  
  const [results, setResults] = useState<RedirectResult[]>([]);
  const [candidateLogs, setCandidateLogs] = useState<CandidateLog[]>([]);
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const [logs, setLogs] = useState<string[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const costEstimate: CostEstimate = useMemo(() => {
    return calculateDeterministicCost(sourceData.length);
  }, [sourceData.length]);

  const handleSourceUpload = useCallback((data: UrlMetadata[]) => {
    setSourceData(data);
    addLog(`Carregado arquivo de Origem: ${data.length} URLs (com metadados detectados).`);
  }, []);

  const handleTargetUpload = useCallback((data: UrlMetadata[]) => {
    setTargetData(data);
    addLog(`Carregado arquivo de Destino: ${data.length} URLs (com metadados detectados).`);
  }, []);

  const addLog = (message: string) => {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  };

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // --- BATCH JOB POLLING LOGIC ---
  useEffect(() => {
    if (!activeJobId) return;

    const intervalId = setInterval(async () => {
      // Call Sync Service
      const job = await syncBatchJob(activeJobId);
      
      if (job) {
        setJobState({...job}); // Force update UI

        // Sync Logs
        if (job.logs.length > logs.length) {
            setLogs(job.logs); 
        }

        if (job.status === 'completed') {
            setResults(job.results);
            setCandidateLogs(job.candidateLogs);
            setStatus(AppStatus.COMPLETED);
            setActiveJobId(null);
            clearInterval(intervalId);
        } else if (job.status === 'failed') {
            setStatus(AppStatus.ERROR);
            setErrorMessage(job.error || "Falha desconhecida no Job");
            setActiveJobId(null);
            clearInterval(intervalId);
        }
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(intervalId);
  }, [activeJobId, logs.length]);

  const handleProcess = async () => {
    if (!apiKey) {
      setErrorMessage("Por favor, insira sua chave de API da OpenAI.");
      return;
    }
    if (sourceData.length === 0 || targetData.length === 0) {
      setErrorMessage("Por favor, carregue os dois arquivos CSV (Origem e Destino).");
      return;
    }

    setStatus(AppStatus.PROCESSING);
    setErrorMessage(null);
    setLogs([]); 
    
    // START JOB
    try {
        const jobId = createMappingJob(apiKey, sourceData, targetData);
        setActiveJobId(jobId);
        addLog(`Job Criado Localmente: ${jobId}. Iniciando pipeline de Batch...`);
    } catch (e: any) {
        setErrorMessage(e.message);
        setStatus(AppStatus.ERROR);
    }
  };

  const handleDownload = () => {
    if (results.length === 0) return;
    const headers = ["URL Original,URL Destino,Confiança (%),Fonte,Justificativa"];
    const rows = results.map(r => 
      `"${r.originalUrl}","${r.destinationUrl}",${r.score},"${r.confidence_source.toUpperCase()}","${r.justification.replace(/"/g, '""')}"`
    );
    const csvContent = [headers, ...rows].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "relatorio_redirecionamento_seo.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDownloadCandidates = () => {
    if (candidateLogs.length === 0) return;
    const maxCandidates = Math.max(...candidateLogs.map(l => l.candidates.length), 1);
    const headerRow = ["URL Original", ...Array.from({length: maxCandidates}, (_, i) => `Candidato ${i+1}`)];
    const rows = candidateLogs.map(log => {
        const escapedUrl = `"${log.originalUrl}"`;
        const escapedCandidates = log.candidates.map(c => `"${c}"`);
        const padding = Array(maxCandidates - log.candidates.length).fill("");
        return [escapedUrl, ...escapedCandidates, ...padding].join(",");
    });
    const csvContent = [headerRow.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "debug_candidatos_local.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Helper to get status text
  const getStatusText = () => {
    if (!jobState) return "Inicializando...";
    switch(jobState.status) {
        case 'uploading': return "Enviando arquivo JSONL...";
        case 'submitted': return "Aguardando aceitação da OpenAI...";
        case 'processing_remote': 
            return `Processando na OpenAI (${jobState.openaiStatus})...`;
        case 'finalizing': return "Baixando e Processando Resultados...";
        default: return "Processando...";
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-20 font-sans">
      <header className="bg-gradient-to-r from-slate-900 via-emerald-900 to-slate-900 text-white shadow-lg sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-white/10 p-2 rounded-xl backdrop-blur-sm border border-white/20">
              <BrainCircuit className="w-6 h-6 text-emerald-300" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Mapeador <span className="text-emerald-300">De &gt; Para</span> Inteligente</h1>
              <p className="text-xs text-emerald-100 opacity-80">OpenAI Batch API (GPT-4.1 Mini)</p>
            </div>
          </div>
          <div className="hidden md:flex items-center space-x-2 bg-black/30 px-3 py-1.5 rounded-full border border-white/10 text-xs font-medium text-white/90">
            <CloudCog className="w-3 h-3 text-green-400" />
            <span>Batch Mode Active</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-10">
        
        {/* Step 1: Configuration */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden transition-shadow hover:shadow-md">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <h2 className="text-lg font-bold text-slate-800 flex items-center">
              <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center mr-3 text-sm font-bold">1</div>
              Configuração Neural (OpenAI)
            </h2>
            <div className="text-xs text-slate-400 font-medium uppercase tracking-wider">Acesso Seguro</div>
          </div>
          <div className="p-8">
            <div className="max-w-2xl">
              <label className="block text-sm font-semibold text-slate-700 mb-2">OpenAI API Key</label>
              <div className="relative group">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-emerald-500 focus:ring-emerald-500 sm:text-sm p-3 pl-4 border transition-all group-hover:border-emerald-300"
                />
                <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                  <ShieldCheck className={`h-5 w-5 transition-colors duration-300 ${apiKey ? 'text-green-500' : 'text-slate-300'}`} />
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500 flex items-center">
                <ShieldCheck className="w-3 h-3 mr-1" />
                Chave utilizada para Batch API (GPT-4.1 Mini).
              </p>
            </div>
          </div>
        </section>

        {/* Step 2: Data Upload */}
        <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden transition-shadow hover:shadow-md">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <h2 className="text-lg font-bold text-slate-800 flex items-center">
              <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center mr-3 text-sm font-bold">2</div>
              Ingestão de Dados
            </h2>
          </div>
          <div className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                <FileUploader 
                  label="URLs de Origem (Erro 404)" 
                  subLabel="Lista de URLs antigas para processamento"
                  accept=".csv" 
                  onFileLoaded={handleSourceUpload} 
                  count={sourceData.length}
                  iconColorClass="text-red-500"
                />
              </div>
              <div className="relative">
                <div className="hidden md:block absolute -left-4 top-1/2 -translate-y-1/2 -translate-x-1/2 z-10">
                   <ArrowRight className="w-6 h-6 text-slate-300" />
                </div>
                <FileUploader 
                  label="URLs de Destino (Ativas)" 
                  subLabel="Banco de conhecimento para correspondência"
                  accept=".csv" 
                  onFileLoaded={handleTargetUpload} 
                  count={targetData.length}
                  iconColorClass="text-emerald-500"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Step 3: Metrics */}
        {(sourceData.length > 0 || targetData.length > 0) && (
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-fade-in">
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center space-x-4">
                <div className="p-3 bg-red-50 rounded-xl"><FileWarning className="w-8 h-8 text-red-500" /></div>
                <div>
                   <p className="text-sm font-medium text-slate-500 uppercase">Origem (404)</p>
                   <p className="text-2xl font-bold text-slate-800">{sourceData.length.toLocaleString()}</p>
                </div>
             </div>
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center space-x-4">
                <div className="p-3 bg-emerald-50 rounded-xl"><Database className="w-8 h-8 text-emerald-500" /></div>
                <div>
                   <p className="text-sm font-medium text-slate-500 uppercase">Banco de Destino</p>
                   <p className="text-2xl font-bold text-slate-800">{targetData.length.toLocaleString()}</p>
                </div>
             </div>
             <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex items-center space-x-4">
                <div className="p-3 bg-brand-50 rounded-xl"><DollarSign className="w-8 h-8 text-brand-600" /></div>
                <div>
                   <p className="text-sm font-medium text-slate-500 uppercase">Estimativa (Batch)</p>
                   <p className="text-2xl font-bold text-slate-800">R$ {(costEstimate.custos_brl.total * 0.5).toLocaleString('pt-BR', {minimumFractionDigits:2})}</p>
                   <span className="text-xs text-green-600 font-semibold">* 50% de desconto (Batch API)</span>
                </div>
             </div>
           </div>
        )}

        {/* Step 4: Action */}
        <div className="flex flex-col items-center justify-center pt-6 pb-2">
           {errorMessage && (
             <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-center text-red-700 max-w-2xl w-full shadow-sm">
               <AlertTriangle className="w-5 h-5 mr-3 flex-shrink-0" />
               <p className="font-medium">{errorMessage}</p>
             </div>
           )}

           <button
             onClick={handleProcess}
             disabled={status === AppStatus.PROCESSING || !apiKey || sourceData.length === 0}
             className={`
               group relative flex items-center justify-center px-10 py-5 border border-transparent text-lg font-bold rounded-full text-white 
               transition-all duration-300 shadow-xl
               ${status === AppStatus.PROCESSING 
                 ? 'bg-slate-400 cursor-not-allowed shadow-none' 
                 : 'bg-gradient-to-r from-slate-800 to-emerald-800 hover:from-slate-700 hover:to-emerald-700'}
             `}
           >
             {status === AppStatus.PROCESSING ? (
               <>
                 <Loader2 className="animate-spin -ml-1 mr-3 h-6 w-6 text-white" />
                 {getStatusText()}
               </>
             ) : (
               <>
                 <CloudCog className="w-5 h-5 mr-3 text-emerald-300" />
                 Iniciar Batch Process (JSONL)
                 <ArrowRight className="ml-3 -mr-1 h-6 w-6 group-hover:translate-x-1" />
               </>
             )}
           </button>
           
           {status === AppStatus.PROCESSING && jobState?.openaiStatus === 'in_progress' && (
              <p className="mt-4 text-xs text-slate-400 max-w-md text-center">
                 Dica: Você pode fechar o navegador. O processo continuará na OpenAI.
                 Salve o Job ID para consultar depois (Feature futura).
              </p>
           )}
        </div>

        {/* JOB MONITOR LOGS */}
        {logs.length > 0 && (
          <div className="max-w-4xl mx-auto mt-8 bg-slate-900 rounded-lg shadow-2xl overflow-hidden border border-slate-700 animate-fade-in">
            <div className="bg-slate-800 px-4 py-2 border-b border-slate-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-mono text-slate-300">Batch Job Monitor - {activeJobId || 'Idle'}</span>
              </div>
              {activeJobId && <Activity className="w-4 h-4 text-green-400 animate-pulse" />}
            </div>
            <div className="p-4 h-64 overflow-y-auto font-mono text-xs space-y-1">
              {logs.map((log, index) => (
                <div key={index} className="text-green-400 border-l-2 border-transparent hover:border-slate-600 pl-1">
                  <span className="opacity-50 mr-2">{log.split('] ')[0]}]</span>
                  <span>{log.split('] ')[1]}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* Step 5: Results */}
        {results.length > 0 && (
          <section className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-fade-in ring-1 ring-slate-900/5">
             <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between bg-gradient-to-r from-slate-50 to-white">
               <div>
                 <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                   <BrainCircuit className="w-6 h-6 text-emerald-600" />
                   Resultados do Job
                 </h2>
               </div>
               <div className="flex flex-col sm:flex-row gap-3 mt-4 sm:mt-0">
                 <button onClick={handleDownloadCandidates} className="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg text-slate-600 bg-white border hover:bg-slate-50">
                   <FileSpreadsheet className="-ml-1 mr-2 h-4 w-4" /> Debug
                 </button>
                 <button onClick={handleDownload} className="inline-flex items-center px-5 py-2 text-sm font-semibold rounded-lg text-white bg-emerald-600 hover:bg-emerald-700">
                   <Download className="-ml-1 mr-2 h-4 w-4" /> CSV Final
                 </button>
               </div>
             </div>

             <div className="overflow-x-auto">
               <table className="min-w-full divide-y divide-slate-200">
                 <thead className="bg-slate-50/80">
                   <tr>
                     <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase">URL Original</th>
                     <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase">Destino</th>
                     <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase">Confiança</th>
                     <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase">Fonte</th>
                     <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase">Justificativa</th>
                   </tr>
                 </thead>
                 <tbody className="bg-white divide-y divide-slate-200">
                   {results.map((row, idx) => (
                     <tr key={idx} className="hover:bg-brand-50/30">
                       <td className="px-6 py-4 text-sm text-slate-900 font-mono truncate max-w-xs">{row.originalUrl}</td>
                       <td className="px-6 py-4 text-sm text-slate-900 font-mono truncate max-w-xs">
                         {row.destinationUrl ? <span className="text-blue-700">{row.destinationUrl}</span> : <span className="text-red-400 italic">Sem match</span>}
                       </td>
                       <td className="px-6 py-4">
                         <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${row.score >= 90 ? 'bg-green-100 text-green-800' : row.score >= 50 ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                           {row.score}%
                         </span>
                       </td>
                       <td className="px-6 py-4">
                         {row.confidence_source === 'fallback' ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-slate-200 text-slate-600 uppercase">Fallback</span>
                         ) : (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-700 uppercase">AI</span>
                         )}
                       </td>
                       <td className="px-6 py-4 text-sm text-slate-600">{row.justification}</td>
                     </tr>
                   ))}
                 </tbody>
               </table>
             </div>
          </section>
        )}
      </main>
    </div>
  );
};

export default App;
