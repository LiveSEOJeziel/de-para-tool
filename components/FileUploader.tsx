
import React, { useRef, useState } from 'react';
import { Upload, CheckCircle, AlertCircle } from 'lucide-react';
import { UrlMetadata } from '../types';

interface FileUploaderProps {
  label: string;
  subLabel?: string;
  accept: string;
  onFileLoaded: (data: UrlMetadata[], fileName: string) => void;
  count?: number;
  iconColorClass?: string;
}

/**
 * Robust CSV Parser using a State Machine approach.
 * Handles:
 * - Quoted fields containing delimiters (commas)
 * - Quoted fields containing newlines
 * - Escaped quotes ("")
 */
const parseCSVRobust = (text: string): UrlMetadata[] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  
  // Normalize line endings
  const cleanText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote ("") inside a quoted field
        currentField += '"';
        i++; // Skip next quote
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      // End of field
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (char === '\n' && !inQuotes) {
      // End of row
      currentRow.push(currentField.trim());
      if (currentRow.length > 0 && currentRow.some(c => c)) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      // Regular character
      currentField += char;
    }
  }
  
  // Push last field/row if exists
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    rows.push(currentRow);
  }

  // Map to Metadata
  const parsedData: UrlMetadata[] = [];
  
  // Detect header index
  let startIndex = 0;
  if (rows.length > 0 && rows[0][0].toLowerCase().includes('url')) {
    startIndex = 1;
  }

  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i];
    if (row.length === 0) continue;

    const url = row[0]?.replace(/^"|"$/g, '').trim();
    if (url) {
      parsedData.push({
        url: url,
        title: row[1]?.replace(/^"|"$/g, '').trim(),
        description: row[2]?.replace(/^"|"$/g, '').trim()
      });
    }
  }

  return parsedData;
};

export const FileUploader: React.FC<FileUploaderProps> = ({ 
  label, 
  subLabel, 
  accept, 
  onFileLoaded, 
  count,
  iconColorClass = "text-brand-500"
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    processFile(file);
  };

  const processFile = (file: File | undefined) => {
    setError(null);
    if (!file) return;

    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      setError('Por favor, carregue um arquivo CSV válido.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) throw new Error("Arquivo vazio");

        const parsedData = parseCSVRobust(text);

        if (parsedData.length === 0) {
          throw new Error("Nenhuma URL válida encontrada. Verifique o formato (URL, Titulo, Descrição).");
        }

        setFileName(file.name);
        onFileLoaded(parsedData, file.name);
      } catch (err: any) {
        setFileName(null);
        setError(`Erro ao ler CSV: ${err.message}`);
      }
    };
    reader.onerror = () => setError("Falha crítica ao ler o arquivo.");
    reader.readAsText(file);
  };

  return (
    <div className="w-full">
      <div className="flex justify-between items-baseline mb-2">
        <label className="block text-sm font-semibold text-slate-700">{label}</label>
        {subLabel && <span className="text-xs text-slate-500">{subLabel}</span>}
      </div>
      
      <div 
        onClick={() => fileInputRef.current?.click()}
        className={`
          group relative border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200
          ${fileName 
            ? 'border-green-400 bg-green-50/50' 
            : 'border-slate-300 hover:border-brand-400 hover:bg-slate-50 hover:shadow-sm'}
        `}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          accept={accept} 
          onChange={handleFileChange} 
          className="hidden" 
        />
        
        {fileName ? (
          <div className="flex flex-col items-center animate-fade-in">
            <div className="bg-white p-2 rounded-full shadow-sm mb-3">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <span className="text-sm font-medium text-slate-900 truncate max-w-[200px]">{fileName}</span>
            {count !== undefined && (
              <span className="mt-2 inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 border border-green-200">
                {count} URLs detectadas
              </span>
            )}
            <span className="mt-2 text-xs text-slate-400 group-hover:text-brand-600 transition-colors">
              Clique para alterar
            </span>
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <div className={`p-3 rounded-full bg-slate-100 mb-3 group-hover:bg-white group-hover:shadow-md transition-all`}>
              <Upload className={`w-8 h-8 ${iconColorClass} opacity-70 group-hover:opacity-100`} />
            </div>
            <span className="text-sm font-medium text-slate-700 group-hover:text-brand-600">Clique para carregar CSV</span>
            <span className="text-xs text-slate-400 mt-1">Suporta aspas e quebras de linha</span>
          </div>
        )}
      </div>
      {error && (
        <div className="mt-2 flex items-center text-sm text-red-600 bg-red-50 p-2 rounded-md">
          <AlertCircle className="w-4 h-4 mr-2" />
          {error}
        </div>
      )}
    </div>
  );
};
