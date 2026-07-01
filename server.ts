import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
  app.post('/api/gemini/advice', async (req, res) => {
    try {
      const { playerHand, dealerCard, action, optimalAction, isCorrect } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not set' });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const prompt = `あなたはプロのブラックジャックディーラー兼戦略コーチです。プレイヤーがとったアクションについて、ベーシックストラテジー（基本戦略）に基づき、日本語で短いアドバイス（2-3文程度）をしてください。
プレイヤーの手札: ${playerHand.join(', ')} (合計: ${playerHand.reduce((a: number, b: number) => a + b, 0) || '不明'})
ディーラーの表向きのカード: ${dealerCard}
プレイヤーが選択したアクション: ${action}
ベーシックストラテジーに基づく最適なアクション: ${optimalAction}

${isCorrect ? '正しい選択でした！' : '最適な選択ではありませんでした。'} その理由を確率とブラックジャックの基本戦略の観点から簡潔に解説してください。フレンドリーかつプロフェッショナルなトーンでお願いします。`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          thinkingConfig: { thinkingLevel: 'MINIMAL' }
        }
      });

      res.json({ advice: response.text });
    } catch (error) {
      console.error('Error in /api/gemini/advice:', error);
      res.status(500).json({ error: 'Failed to generate advice' });
    }
  });

  app.post('/api/gemini/report', async (req, res) => {
    try {
      const { history } = req.body;
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'GEMINI_API_KEY is not set' });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });

      const prompt = `あなたはブラックジャックのプロの戦略コーチです。プレイヤーの過去のプレイ履歴（直近数ハンド）を分析し、改善点や強みを総括したレポート（日本語）を生成してください。
プレイ履歴（抜粋）:
${JSON.stringify(history)}

次の形式（JSON）で出力してください。
{
  "summary": "全体の総評（2-3文）",
  "strengths": ["強み1", "強み2"],
  "weaknesses": ["改善点1", "改善点2"]
}
`;

      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
              weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['summary', 'strengths', 'weaknesses']
          },
          thinkingConfig: { thinkingLevel: 'MINIMAL' }
        }
      });

      res.json(JSON.parse(response.text || '{}'));
    } catch (error) {
      console.error('Error in /api/gemini/report:', error);
      res.status(500).json({ error: 'Failed to generate report' });
    }
  });

  // Vite Integration
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, '../dist/client')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, '../dist/client/index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer();
