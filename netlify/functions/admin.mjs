const OWNER = process.env.GITHUB_OWNER || "";
const REPO = process.env.GITHUB_REPO || "";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  });
}

async function githubRequest(path, options = {}) {
  if (!OWNER || !REPO || !TOKEN) {
    throw new Error(
      "GitHub environment variables are not configured in Netlify."
    );
  }

  const url =
    `https://api.github.com/repos/` +
    `${encodeURIComponent(OWNER)}/` +
    `${encodeURIComponent(REPO)}/contents/${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      message: text || "GitHub returned an invalid response."
    };
  }

  if (!response.ok) {
    throw new Error(
      data.message || `GitHub API error: ${response.status}`
    );
  }

  return data;
}

async function getFile(path) {
  try {
    return await githubRequest(path);
  } catch (error) {
    if (
      error.message.includes("Not Found") ||
      error.message.includes("404")
    ) {
      return null;
    }

    throw error;
  }
}

async function saveGitHubFile(path, base64Content, message) {
  const existing = await getFile(path);

  const body = {
    message,
    content: base64Content,
    branch: BRANCH
  };

  if (existing && existing.sha) {
    body.sha = existing.sha;
  }

  return githubRequest(path, {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

async function removeGitHubFile(path, message) {
  const existing = await getFile(path);

  if (!existing || !existing.sha) {
    return {
      skipped: true
    };
  }

  return githubRequest(path, {
    method: "DELETE",
    body: JSON.stringify({
      message,
      sha: existing.sha,
      branch: BRANCH
    })
  });
}

export default async (request) => {
  // CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS
    });
  }

  // Health check
  if (request.method === "GET") {
    return respond({
      success: true,
      service: "StudyNest admin function",
      githubConfigured: Boolean(OWNER && REPO && TOKEN),
      passwordConfigured: Boolean(ADMIN_PASSWORD)
    });
  }

  if (request.method !== "POST") {
    return respond(
      {
        success: false,
        error: "Method not allowed"
      },
      405
    );
  }

  if (!ADMIN_PASSWORD) {
    return respond(
      {
        success: false,
        error: "ADMIN_PASSWORD is not configured in Netlify."
      },
      500
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return respond(
      {
        success: false,
        error: "Invalid JSON request."
      },
      400
    );
  }

  const action = body?.action;
  const password = body?.password;

  // -------------------------
  // LOGIN
  // -------------------------
  if (action === "login") {
    if (
      typeof password !== "string" ||
      password !== ADMIN_PASSWORD
    ) {
      return respond(
        {
          success: false,
          error: "Wrong password"
        },
        401
      );
    }

    return respond({
      success: true,
      message: "Login successful"
    });
  }

  // -------------------------
  // AUTHORIZE ADMIN ACTIONS
  // -------------------------
  if (
    typeof password !== "string" ||
    password !== ADMIN_PASSWORD
  ) {
    return respond(
      {
        success: false,
        error: "Unauthorized"
      },
      401
    );
  }

  try {
    // -------------------------
    // SAVE CONTENT.JSON
    // -------------------------
    if (action === "saveData") {
      if (!body.data || typeof body.data !== "object") {
        return respond(
          {
            success: false,
            error: "Invalid content data."
          },
          400
        );
      }

      const jsonText =
        JSON.stringify(body.data, null, 2) + "\n";

      const base64Content = Buffer.from(
        jsonText,
        "utf8"
      ).toString("base64");

      await saveGitHubFile(
        "site/content.json",
        base64Content,
        "Update StudyNest content"
      );

      return respond({
        success: true,
        message: "Content saved successfully."
      });
    }

    // -------------------------
    // UPLOAD FILE
    // -------------------------
    if (action === "uploadFile") {
      const path = String(body.path || "");
      const base64 = String(body.base64 || "");

      if (!path || !base64) {
        return respond(
          {
            success: false,
            error: "Missing file path or file data."
          },
          400
        );
      }

      // Only allow StudyNest folders
      const allowed =
        path.startsWith("site/pdfs/") ||
        path.startsWith("site/images/toppers/");

      if (!allowed) {
        return respond(
          {
            success: false,
            error: "File path is not allowed."
          },
          400
        );
      }

      // Approximate decoded file size
      const estimatedBytes =
        Math.floor(base64.length * 0.75);

      if (estimatedBytes > 4 * 1024 * 1024) {
        return respond(
          {
            success: false,
            error: "File is too large. Keep it under 4 MB."
          },
          413
        );
      }

      await saveGitHubFile(
        path,
        base64,
        "Upload StudyNest file"
      );

      return respond({
        success: true,
        path
      });
    }

    // -------------------------
    // DELETE FILE
    // -------------------------
    if (action === "deleteFile") {
      const path = String(body.path || "");

      if (!path) {
        return respond(
          {
            success: false,
            error: "Missing file path."
          },
          400
        );
      }

      const allowed =
        path.startsWith("site/pdfs/") ||
        path.startsWith("site/images/toppers/");

      if (!allowed) {
        return respond(
          {
            success: false,
            error: "File path is not allowed."
          },
          400
        );
      }

      await removeGitHubFile(
        path,
        "Delete StudyNest file"
      );

      return respond({
        success: true,
        message: "File deleted successfully."
      });
    }

    // -------------------------
    // UNKNOWN ACTION
    // -------------------------
    return respond(
      {
        success: false,
        error: "Unknown action."
      },
      400
    );
  } catch (error) {
    console.error("StudyNest admin error:", error);

    return respond(
      {
        success: false,
        error: error.message || "Server error."
      },
      500
    );
  }
};