import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "../config/server";
import { DEFAULT_MODELS, OPENAI_BASE_URL, GEMINI_BASE_URL } from "../constant";
import { collectModelTable } from "../utils/model";
import { makeAzurePath } from "../azure";

const serverConfig = getServerSideConfig();

export async function requestOpenai(req: NextRequest) {
  const controller = new AbortController();
  var authValue, authHeaderName = "";

  if (serverConfig.isAzure) {
    authValue = req.headers.get("Authorization")?.trim().replaceAll("Bearer", "").trim() ?? "";
    authHeaderName = "api-key";
  } else {
    authValue = req.headers.get("Authorization") ?? "";
    authHeaderName = "Authorization";
  }

  let path = `${req.nextUrl.pathname}${req.nextUrl.search}`.replaceAll("/api/openai/", "");
  let baseUrl = serverConfig.azureUrl || serverConfig.baseUrl || OPENAI_BASE_URL;

  if (!baseUrl.startsWith("http")) {
    baseUrl = `https://${baseUrl}`;
  }

  if (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }

  console.log("[Proxy]", path);
  console.log("[BaseUrl]", baseUrl);

  // Create a readable stream to send heartbeats
  const stream = new ReadableStream({
    start(controller) {
      const heartbeat = () => {
        controller.enqueue(new TextEncoder().encode("data: \n"));
      };
      const interval = setInterval(heartbeat, 1000);

      controller.enqueue(new TextEncoder().encode("data: \n")); // Initial heartbeat
      heartbeat(); // Immediately send first heartbeat

      const timeoutId = setTimeout(() => {
        clearInterval(interval);
        controller.close();
        // controller.abort();
      }, 10 * 60 * 1000);

      fetch(fetchUrl, fetchOptions)
        .then(async res => {
          clearInterval(interval);
          clearTimeout(timeoutId);

          const reader = res.body?.getReader();
          if (reader) {
            const read = async () => {
              const { done, value } = await reader.read();
              if (done) {
                controller.close();
                return;
              }
              controller.enqueue(value);
              read();
            };
            read();
          }
        })
        .catch(err => {
          clearInterval(interval);
          clearTimeout(timeoutId);
          console.error(err);
          controller.error(err);
        });
    }
  });

  if (serverConfig.isAzure) {
    if (!serverConfig.azureApiVersion) {
      return NextResponse.json({ error: true, message: `missing AZURE_API_VERSION in server env vars` });
    }
    path = makeAzurePath(path, serverConfig.azureApiVersion);
  }

  const fetchUrl = `${baseUrl}/${path}`;
  const fetchOptions: RequestInit = {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      [authHeaderName]: authValue,
      ...(serverConfig.openaiOrgId && { "OpenAI-Organization": serverConfig.openaiOrgId }),
    },
    method: req.method,
    body: req.body, // to fix #2485: https://stackoverflow.com/questions/55920957/cloudflare-worker-typeerror-one-time-use-body
    redirect: "manual",
    //@ts-ignore
    duplex: "half",
    signal: controller.signal,
  };

  //#1815 try to refuse gpt-4 request
  if (serverConfig.customModels && req.body) {
    try {
      const modelTable = collectModelTable(DEFAULT_MODELS, serverConfig.customModels);
      const clonedBody = await req.text();
      fetchOptions.body = clonedBody;
      const jsonBody = JSON.parse(clonedBody) as { model?: string };

      // not undefined and is false
      if (modelTable[jsonBody?.model ?? ""].available === false) {
        return NextResponse.json({
          error: true,
          message: `you are not allowed to use ${jsonBody?.model} model`,
        }, { status: 403 });
      }
    } catch (e) {
      console.error("[OpenAI] gpt-4 filter", e);
    }
  }

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    }
  });
}