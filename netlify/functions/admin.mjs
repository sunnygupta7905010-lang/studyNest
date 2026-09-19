
const OWNER = process.env.GITHUB_OWNER || "";
const REPO = process.env.GITHUB_REPO || "";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const TOKEN = process.env.GITHUB_TOKEN || "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";

const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function json(statusCode, body) {
  return {
    statusCode,
    headers,
    body: JSON.stringify(body)
  };
}

async function github(path, options = {}) {
  if (!OWNER || !REPO || !TOKEN) {
    throw new Error(
      "GitHub environment variables are not configured in Netlify."
    );
  }

  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(
      OWNER
    )}/${encodeURIComponent(REPO)}/contents/${path}`,
    {
      ...options,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {
      message: text || "GitHub request failed"
    };
  }

  if (!response.ok) {
    throw new Error(
      data.message || `GitHub API error (${response.status})`
    );
  }

  return data;
}

async function getFile(path) {
  try {
    return await github(encodeURI(path));
  } catch (e) {
    if (/404/.test(e.message) || /Not Found/i.test(e.message)) {
      return null;
    }

    throw e;
  }
}

async function putFile(path, contentBase64, message) {
  const existing = await getFile(path);

  const body = {
    message,
    content: contentBase64,
    branch: BRANCH
  };

  if (existing?.sha) {
    body.sha = existing.sha;
  }

  return github(encodeURI(path), {
    method: "PUT",
    body: JSON.stringify(body)
  });
}

async function deleteGitHubFile(path, message) {
  const existing = await getFile(path);

  if (!existing?.sha) {
    return {
      skipped: true
    };
  }

  return github(encodeURI(path), {
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
    return {
      statusCode: 204,
      headers,
      body: ""
    };
  }

  // Health check
  if (request.method === "GET") {
    return json(200, {
      success: true,
      service: "StudyNest admin function"
    });
  }

  // Only POST is allowed for admin actions
  if (request.method !== "POST") {
    return json(405, {
      success: false,
      error: "Method not allowed"
    });
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json(400, {
      success: false,
      error: "Invalid JSON request"
    });
  }

  const { action, password } = body || {};

  // Password must exist in Netlify
  if (!ADMIN_PASSWORD) {
    return json(500, {
      success: false,
      error: "ADMIN_PASSWORD is not configured in Netlify."
    });
  }

  // LOGIN
  if (action === "login") {
    if (
      typeof password !== "string" ||
      password !== ADMIN_PASSWORD
    ) {
      return json(401, {
        success: false,
        error: "Wrong password"
      });
    }

    return json(200, {
      success: true
    });
  }

  // All other admin actions require the password
  if (
    typeof password !== "string" ||
    password !== ADMIN_PASSWORD
  ) {
    return json(401, {
      success: false,
      error: "Unauthorized"
    });
  }

  try {
    // SAVE CONTENT DATA
    if (action === "saveData") {
      const data = body.data;

      if (!data || typeof data !== "object") {
        return json(400, {
          success: false,
          error: "Invalid content data"
        });
      }

      const encoded = Buffer.from(
        JSON.stringify(data, null, 2) + "\n",
        "utf8"
      ).toString("base64");

      await putFile(
        "site/content.json",
        encoded,
        "Update StudyNest content"
      );

      return json(200, {
        success: true
      });
    }

    // UPLOAD PDF / TOPPER IMAGE
    if (action === "uploadFile") {
      const path = String(body.path || "");
      const base64 = String(body.base64 || "");
      const message = String(
        body.message || "Upload StudyNest file"
      );

      if (!path || !base64) {
        return json(400, {
          success: false,
          error: "Missing file path or file data"
        });
      }

      // Only allow these folders
      if (
        !path.startsWith("site/pdfs/") &&
        !path.startsWith("site/images/toppers/")
      ) {
        return json(400, {
          success: false,
          error: "File path is not allowed"
        });
      }

      // Keep uploads under Netlify Function payload limit
      const approxBytes = Math.floor(base64.length * 0.75);

      if (approxBytes > 4 * 1024 * 1024) {
        return json(413, {
          success: false,
          error: "File is too large. Keep it under 4 MB."
        });
      }

      await putFile(path, base64, message);

      return json(200, {
        success: true,
        path
      });
    }

    // DELETE PDF / TOPPER IMAGE
    if (action === "deleteFile") {
      const path = String(body.path || "");

      if (!path) {
        return json(400, {
          success: false,
          error: "Missing file path"
        });
      }

      if (
        !path.startsWith("site/pdfs/") &&
        !path.startsWith("site/images/toppers/")
      ) {
        return json(400, {
          success: false,
          error: "File path is not allowed"
        });
      }

      await deleteGitHubFile(
        path,
        "Delete StudyNest file"
      );

      return json(200, {
        success: true
      });
    }

    return json(400, {
      success: false,
      error: "Unknown action"
    });
  } catch (error) {
    console.error("StudyNest admin error:", error);

    return json(500, {
      success: false,
      error: error.message || "Server error"
    });
  }
};
