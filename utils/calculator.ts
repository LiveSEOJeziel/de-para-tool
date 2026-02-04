
import { CostEstimate } from '../types';

/**
 * MOTOR DE CÁLCULO DETERMINÍSTICO.
 * Implementa estritamente as fórmulas definidas para GPT-4.1 Mini.
 * 
 * PREÇOS (USD/1M tokens): Input $0.15, Output $0.60
 * TOKENS POR URL: Input 3200, Output 800
 * CÂMBIO: 1 USD = 5.25 BRL
 */
export const calculateDeterministicCost = (totalUrls: number): CostEstimate => {
  // CONSTANTES FIXAS
  const INPUT_PRICE_PER_MILLION = 0.15;
  const OUTPUT_PRICE_PER_MILLION = 0.60;
  
  const INPUT_TOKENS_PER_URL = 3200;
  const OUTPUT_TOKENS_PER_URL = 800;
  const TOKENS_PER_URL = INPUT_TOKENS_PER_URL + OUTPUT_TOKENS_PER_URL; // 4000
  
  const USD_TO_BRL_RATE = 5.25;

  // 1️⃣ TOKENS TOTAIS
  const inputTokensTotal = totalUrls * INPUT_TOKENS_PER_URL;
  const outputTokensTotal = totalUrls * OUTPUT_TOKENS_PER_URL;
  const tokensTotal = inputTokensTotal + outputTokensTotal;

  // 2️⃣ CUSTO EM USD
  const custoInputUsd = (inputTokensTotal / 1_000_000) * INPUT_PRICE_PER_MILLION;
  const custoOutputUsd = (outputTokensTotal / 1_000_000) * OUTPUT_PRICE_PER_MILLION;
  const custoTotalUsd = custoInputUsd + custoOutputUsd;

  // 3️⃣ CUSTO POR URL
  // Evitar divisão por zero
  const custoPorUrlUsd = totalUrls > 0 ? custoTotalUsd / totalUrls : 0;

  // 4️⃣ CONVERSÃO PARA BRL
  const custoTotalBrl = custoTotalUsd * USD_TO_BRL_RATE;
  const custoPorUrlBrl = custoPorUrlUsd * USD_TO_BRL_RATE;

  // FORMATO DE SAÍDA JSON
  return {
    modelo: "gpt-4.1-mini-2025-04-14",
    urls_processadas: totalUrls,
    tokens: {
      input_total: inputTokensTotal,
      output_total: outputTokensTotal,
      total: tokensTotal,
      por_url: TOKENS_PER_URL
    },
    custos_usd: {
      input: custoInputUsd,
      output: custoOutputUsd,
      total: custoTotalUsd,
      por_url: custoPorUrlUsd
    },
    custos_brl: {
      total: custoTotalBrl,
      por_url: custoPorUrlBrl
    }
  };
};
