import { GoogleGenAI, Type } from '@google/genai';

// Initialize the Gemini API client
// The API key is automatically injected into the environment by AI Studio
const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

export interface CategorizedResult {
  category: 'Task' | 'Idea';
  title: string;
  description: string;
  priority?: number;
}

export async function categorizeMessage(message: string, language: 'en' | 'ru' = 'en'): Promise<CategorizedResult> {
  const langInstruction = language === 'ru' ? 'Russian' : 'English';
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Analyze the following user message and categorize it as either a 'Task' (something actionable to be done) or an 'Idea' (a concept, thought, or potential future project). 
    
Extract a concise title and a detailed description. Write the title and description in ${langInstruction}.
If it is an Idea, assign an initial priority from 1 (lowest) to 5 (highest) based on its apparent impact or urgency.

Message: "${message}"`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          category: {
            type: Type.STRING,
            description: 'The category of the message.',
          },
          title: {
            type: Type.STRING,
            description: 'A short, concise title for the item.',
          },
          description: {
            type: Type.STRING,
            description: 'A detailed description or the core content of the item.',
          },
          priority: {
            type: Type.NUMBER,
            description: 'Priority from 1 to 5 (only relevant for Ideas, default to 3 if unsure).',
          },
        },
        required: ['category', 'title', 'description'],
      },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Failed to generate a response from Gemini.');
  }

  const result = JSON.parse(text);
  
  // Ensure category is strictly 'Task' or 'Idea'
  if (result.category !== 'Task' && result.category !== 'Idea') {
    result.category = 'Idea'; // Fallback
  }

  return result as CategorizedResult;
}
