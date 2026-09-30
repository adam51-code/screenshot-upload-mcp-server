// ─── Helper: fetch image from URL ───
async function fetchImage(url) {
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status} ${resp.statusText}`);
  const contentType = resp.headers.get("content-type") || "image/png";
  const arrayBuffer = await resp.arrayBuffer();
  return { buffer: arrayBuffer, contentType };
}

// ─── Helper: upload attachment to ClickUp task ───
async function uploadToClickUp(env, taskId, imageBuffer, filename, contentType, customFieldId) {
  const boundary = "----MCPBoundary" + Date.now();
  const disposition = `Content-Disposition: form-data; name="attachment"; filename="${filename}"`;
  const type = `Content-Type: ${contentType}`;

  const encoder = new TextEncoder();
  const preamble = encoder.encode(
    `--${boundary}\r\n${disposition}\r\n${type}\r\n\r\n`
  );
  const epilogue = encoder.encode(`\r\n--${boundary}--\r\n`);

  const body = new Uint8Array(preamble.length + imageBuffer.byteLength + epilogue.length);
  body.set(preamble, 0);
  body.set(new Uint8Array(imageBuffer), preamble.length);
  body.set(epilogue, preamble.length + imageBuffer.byteLength);

  let url = `https://api.clickup.com/api/v2/task/${taskId}/attachment`;
  if (customFieldId) {
    url += `?custom_field_id=${customFieldId}`;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: env.CLICKUP_API_TOKEN,
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
    },
    body: body.buffer,
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`ClickUp upload failed: ${resp.status} ${errText}`);
  }

  return resp.json();
}

// ─── Helper: set custom field value via API ───
async function setCustomFieldValue(env, taskId, fieldId, attachmentId) {
  const resp = await fetch(
    `https://api.clickup.com/api/v2/task/${taskId}/field/${fieldId}`,
    {
      method: "POST",
      headers: {
        Authorization: env.CLICKUP_API_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: [{ id: attachmentId }] }),
    }
  );

  if (resp.ok) {
    return { success: true, method: "field_endpoint_object_array" };
  }

  const err1 = await resp.text();

  const resp2 = await fetch(
    `https://api.clickup.com/api/v2/task/${taskId}/field/${fieldId}`,
    {
      method: "POST",
      headers: {
        Authorization: env.CLICKUP_API_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: [attachmentId] }),
    }
  );

  if (resp2.ok) {
    return { success: true, method: "field_endpoint_string_array" };
  }

  const err2 = await resp2.text();

  const resp3 = await fetch(
    `https://api.clickup.com/api/v2/task/${taskId}/field/${fieldId}`,
    {
      method: "POST",
      headers: {
        Authorization: env.CLICKUP_API_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: { add: [attachmentId] } }),
    }
  );

  if (resp3.ok) {
    return { success: true, method: "field_endpoint_add_syntax" };
  }

  const err3 = await resp3.text();

  return {
    success: false,
    errors: {
      object_array: err1.substring(0, 200),
      string_array: err2.substring(0, 200),
      add_syntax: err3.substring(0, 200),
    },
  };
}

// ─── Helper: extract token from auth header ───
function extractToken(authHeader) {
  if (!authHeader) return "";
  // Strip "Bearer " prefix if present (case-insensitive)
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

// ─── Tool definitions ───
const TOOLS = {
  screenshot_upload__upload_image_to_task: {
    description:
      "Download an image from a public URL and upload it as an attachment to a ClickUp task. Returns the ClickUp-hosted attachment URL that can be embedded in rich text fields.",
    params: {
      image_url: {
        type: "string",
        description:
          "Public URL of the image to download (e.g. a PagePixels screenshot URL ending in /embed or .png).",
        required: true,
      },
      task_id: {
        type: "string",
        description: "The ClickUp task ID to attach the image to (e.g. '86akpcmb3').",
        required: true,
      },
      filename: {
        type: "string",
        description:
          "Filename for the attachment (e.g. 'desktop.png', 'mobile.png'). Defaults to 'screenshot.png'.",
        required: false,
      },
      custom_field_id: {
        type: "string",
        description:
          "Optional. UUID of an attachment-type custom field (e.g. Screenshots and Media). When provided, the server attempts to place the uploaded image into that custom field in addition to the regular task attachments.",
        required: false,
      },
    },
  },
};

// ─── Execute tool ───
async function executeTool(env, name, args) {
  switch (name) {
    case "screenshot_upload__upload_image_to_task": {
      const { image_url, task_id, filename = "screenshot.png", custom_field_id } = args;
      if (!image_url) throw new Error("image_url is required");
      if (!task_id) throw new Error("task_id is required");

      const { buffer, contentType } = await fetchImage(image_url);
      const result = await uploadToClickUp(env, task_id, buffer, filename, contentType, custom_field_id);

      const output = {
        success: true,
        attachment_id: result.id,
        attachment_url: result.url,
        thumbnail_large: result.thumbnail_large,
        thumbnail_small: result.thumbnail_small,
        title: result.title,
        extension: result.extension,
      };

      if (custom_field_id && result.id) {
        const fieldResult = await setCustomFieldValue(env, task_id, custom_field_id, result.id);
        output.custom_field_result = fieldResult;
      }

      return output;
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── JSON-RPC handler ───
async function handleRpc(request, env) {
  const body = await request.json();
  const { method, params, id } = body;

  if (method === "initialize") {
    return Response.json({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: {
          name: "screenshot-upload-mcp-server",
          version: "2.1.0",
        },
      },
    });
  }

  if (method === "notifications/initialized" || (method && method.startsWith("notifications/"))) {
    return Response.json({ jsonrpc: "2.0", id: id || null, result: {} });
  }

  if (method === "tools/list") {
    const tools = Object.entries(TOOLS).map(([name, def]) => ({
      name,
      description: def.description,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(def.params).map(([k, v]) => [
            k,
            { type: v.type, description: v.description },
          ])
        ),
        required: Object.entries(def.params)
          .filter(([, v]) => v.required)
          .map(([k]) => k),
      },
    }));
    return Response.json({ jsonrpc: "2.0", id, result: { tools } });
  }

  if (method === "tools/call") {
    try {
      const result = await executeTool(env, params.name, params.arguments || {});
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      });
    } catch (err) {
      return Response.json({
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
        },
      });
    }
  }

  return Response.json(
    { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } }
  );
}

// ─── Worker entry ───
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ status: "ok", tools: Object.keys(TOOLS).length });
    }

    // Flexible auth: compare tokens after stripping Bearer prefix from both
    const authHeader = request.headers.get("Authorization") || "";
    const receivedToken = extractToken(authHeader);
    const expectedToken = env.MCP_AUTH_TOKEN;
    if (receivedToken !== expectedToken) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (url.pathname === "/mcp" && request.method === "POST") {
      return handleRpc(request, env);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};
