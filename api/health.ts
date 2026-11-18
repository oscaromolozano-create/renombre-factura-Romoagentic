interface VercelRequestLike {
  method?: string;
}

interface VercelResponseLike {
  status: (code: number) => VercelResponseLike;
  json: (data: unknown) => void;
}

export default function handler(_req: VercelRequestLike, res: VercelResponseLike) {
  res.status(200).json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  });
}
