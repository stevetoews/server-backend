import type { IncomingMessage, ServerResponse } from "node:http";

export interface RequestContext {
  req: IncomingMessage;
  requestId: string;
  url: URL;
}

export interface ErrorBody {
  error: {
    code: string;
    details?: unknown;
    message: string;
    requestId?: string;
  };
  ok: false;
}

export interface JsonResponse<TBody = unknown> {
  body: TBody | ErrorBody;
  headers?: Record<string, string>;
  status: number;
}

export interface AppRoute {
  handler: (context: RequestContext) => Promise<JsonResponse> | JsonResponse;
  method: string;
  pattern: RegExp;
}

export async function readJsonBody<TBody>(
  req: IncomingMessage,
): Promise<TBody | undefined> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as TBody;
}

export function createJsonResponse<TBody>(
  status: number,
  body: TBody,
  headers?: Record<string, string>,
): JsonResponse<TBody> {
  return {
    status,
    body,
    ...(headers ? { headers } : {}),
  };
}

export function createErrorResponse(
  status: number,
  error: ErrorBody["error"],
): JsonResponse<ErrorBody> {
  return {
    status,
    body: {
      ok: false,
      error,
    },
  };
}

export function createNotFoundResponse(error: ErrorBody["error"]): JsonResponse<ErrorBody> {
  return createErrorResponse(404, error);
}

export function createValidationErrorResponse(
  requestId: string,
  details: unknown,
): JsonResponse<ErrorBody> {
  return createErrorResponse(400, {
    code: "VALIDATION_ERROR",
    details,
    message: "Request validation failed",
    requestId,
  });
}

export function sendResponse(res: ServerResponse, response: JsonResponse): void {
  res.writeHead(response.status, {
    "content-type": "application/json; charset=utf-8",
    ...response.headers,
  });
  res.end(JSON.stringify(response.body));
}
